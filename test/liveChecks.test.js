import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MCP_URL } from "../src/config.js";
import {
  expectedToolCount,
  mcpBaseUrl,
  resolveMcpEndpoint,
  runMonitorChecks
} from "../src/liveChecks.js";
import { tools } from "../src/tools.js";

const ENDPOINT = "https://mcp.example.test/mcp";

test("resolveMcpEndpoint uses the shared config default and env override", () => {
  assert.equal(resolveMcpEndpoint({}), DEFAULT_MCP_URL);
  assert.equal(resolveMcpEndpoint({ EVENTCHAT_MCP_URL: ENDPOINT }), ENDPOINT);
  assert.equal(mcpBaseUrl(ENDPOINT), "https://mcp.example.test");
});

test("expected tool count comes from the real tool registry, not a hardcoded number", () => {
  assert.equal(expectedToolCount(), tools.length);
});

function healthyMonitorFetch({ toolCount = tools.length, events = [{ id: "evt-1", title: "Test Party" }] } = {}) {
  return async (url, init = {}) => {
    const u = String(url);
    if (u === "https://mcp.example.test/health") return Response.json({ ok: true, name: "eventchat-events" });
    if (u === "https://mcp.example.test/") return Response.json({ endpoint: "/mcp" });
    if (u === ENDPOINT && init.method === "POST") {
      const payload = JSON.parse(init.body);
      if (payload.method === "tools/list") {
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { tools: Array.from({ length: toolCount }, (_, i) => ({ name: `tool_${i}` })) }
        });
      }
      if (payload.method === "tools/call") {
        return Response.json({
          jsonrpc: "2.0",
          id: 1,
          result: { structuredContent: { count: events.length, events }, content: [], isError: false }
        });
      }
    }
    throw new Error(`Unexpected URL in test: ${u}`);
  };
}

test("monitor checks pass against a healthy endpoint", async () => {
  const result = await runMonitorChecks({ endpoint: ENDPOINT, fetch: healthyMonitorFetch() });
  assert.equal(result.ok, true);
  assert.equal(result.endpoint, ENDPOINT);
  assert.equal(result.checks.tools.tool_count, tools.length);
  assert.equal(result.checks.live_search.event_count, 1);
});

test("monitor failures carry check name, classification, code, hostname, url, and cause for DNS errors", async () => {
  const dnsError = new TypeError("fetch failed");
  dnsError.cause = Object.assign(new Error("getaddrinfo EAI_AGAIN mcp.example.test"), {
    code: "EAI_AGAIN",
    syscall: "getaddrinfo",
    hostname: "mcp.example.test"
  });
  const result = await runMonitorChecks({
    endpoint: ENDPOINT,
    fetch: async () => { throw dnsError; }
  });

  assert.equal(result.ok, false);
  for (const [name, check] of Object.entries(result.checks)) {
    assert.equal(check.ok, false, `${name} should fail`);
    assert.equal(check.check, name);
    assert.equal(check.classification, "dns");
    assert.equal(check.code, "EAI_AGAIN");
    assert.equal(check.hostname, "mcp.example.test");
    assert.ok(check.url?.startsWith("https://mcp.example.test"), `${name} should carry the target url`);
    assert.match(check.cause, /getaddrinfo EAI_AGAIN/);
    assert.match(check.error, /DNS lookup/);
  }
});

test("monitor distinguishes refused connections and timeouts", async () => {
  const refused = new TypeError("fetch failed");
  refused.cause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" });
  const refusedResult = await runMonitorChecks({ endpoint: ENDPOINT, fetch: async () => { throw refused; } });
  assert.equal(refusedResult.checks.health.classification, "connection_refused");

  const timeout = new Error("The operation was aborted due to timeout");
  timeout.name = "TimeoutError";
  const timeoutResult = await runMonitorChecks({ endpoint: ENDPOINT, fetch: async () => { throw timeout; } });
  assert.equal(timeoutResult.checks.health.classification, "timeout");
});

test("monitor distinguishes HTTP errors and invalid JSON", async () => {
  const httpErrorResult = await runMonitorChecks({
    endpoint: ENDPOINT,
    fetch: async () => new Response(JSON.stringify({ detail: "boom" }), { status: 502 })
  });
  assert.equal(httpErrorResult.checks.health.classification, "http_error");
  assert.equal(httpErrorResult.checks.health.status, 502);

  const invalidJsonResult = await runMonitorChecks({
    endpoint: ENDPOINT,
    fetch: async () => new Response("<html>not json</html>", { status: 200 })
  });
  assert.equal(invalidJsonResult.checks.health.classification, "invalid_json");
  assert.match(invalidJsonResult.checks.health.cause, /<html>/);
});

test("monitor flags zero live-search results as application-level no_results", async () => {
  const result = await runMonitorChecks({
    endpoint: ENDPOINT,
    fetch: healthyMonitorFetch({ events: [] })
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.live_search.classification, "no_results");
  assert.match(result.checks.live_search.cause, /not a connectivity failure/);
});

test("monitor flags tool-count drift with the expected and actual counts", async () => {
  const result = await runMonitorChecks({
    endpoint: ENDPOINT,
    fetch: healthyMonitorFetch({ toolCount: 3 })
  });
  assert.equal(result.ok, false);
  assert.equal(result.checks.tools.classification, "bad_response");
  assert.match(result.checks.tools.error, new RegExp(`Expected ${tools.length} tools, got 3`));
});
