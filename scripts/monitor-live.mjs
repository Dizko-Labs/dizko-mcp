const endpoint = process.env.EVENTCHAT_MCP_URL || "https://eventchat-events-mcp-production.up.railway.app/mcp";
const baseUrl = endpoint.replace(/\/mcp\/?$/, "");
const timeoutMs = Number(process.env.EVENTCHAT_MONITOR_TIMEOUT_MS || 10000);
const expectedToolCount = Number(process.env.EVENTCHAT_MONITOR_TOOL_COUNT || 13);

async function main() {
  const startedAt = Date.now();
  const checks = {
    health: await checkHealth(),
    metadata: await checkMetadata(),
    tools: await checkTools(),
    live_search: await checkLiveSearch()
  };

  const ok = Object.values(checks).every((check) => check.ok);
  const result = {
    ok,
    checked_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    endpoint,
    checks
  };

  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exitCode = 1;
}

async function checkHealth() {
  const response = await fetchJson(`${baseUrl}/health`);
  return {
    ok: response.ok && response.status === 200 && response.body?.ok === true && response.body?.name === "eventchat-events",
    status: response.status,
    body: response.body
  };
}

async function checkMetadata() {
  const response = await fetchJson(`${baseUrl}/`);
  return {
    ok: response.ok && response.status === 200 && response.body?.endpoint === "/mcp",
    status: response.status,
    body: response.body
  };
}

async function checkTools() {
  const response = await callRpc("tools/list");
  const tools = response.body?.result?.tools || [];
  return {
    ok: response.ok && response.status === 200 && tools.length === expectedToolCount,
    status: response.status,
    tool_count: tools.length,
    sample_tools: tools.slice(0, 5).map((tool) => tool.name)
  };
}

async function checkLiveSearch() {
  const response = await callRpc("tools/call", {
    name: "search_events",
    arguments: {
      city: "berlin",
      when: "week",
      limit: 1
    }
  });
  const events = response.body?.result?.structuredContent?.events || [];
  return {
    ok: response.ok && response.status === 200 && events.length > 0,
    status: response.status,
    event_count: events.length,
    sample_event: events[0] ? { id: events[0].id, title: events[0].title } : null
  };
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await readJson(response)
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

async function callRpc(method, params) {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        ...(params ? { params } : {})
      }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await readJson(response)
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 500);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
