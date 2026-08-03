import { TOOL_VERSION, getConfig } from "./config.js";
import { describeNetworkError, hostnameFromUrl } from "./netError.js";
import { tools } from "./tools.js";

// Shared plumbing for scripts/smoke-live.mjs and scripts/monitor-live.mjs.
// Endpoint resolution goes through getConfig() and the expected tool count
// comes from the real tool registry, so the scripts cannot drift from the
// package. Failures carry classification ("dns", "connection_refused",
// "timeout", "http_error", "rpc_error", "invalid_json", "bad_response",
// "no_results"), code, hostname, url, and the underlying cause.

export class LiveCheckError extends Error {
  constructor(message, { check = null, classification = "unknown", code = null, hostname = null, url = null, status = null, cause = null } = {}) {
    super(message);
    this.name = "LiveCheckError";
    this.check = check;
    this.classification = classification;
    this.code = code;
    this.hostname = hostname ?? hostnameFromUrl(url);
    this.url = url;
    this.status = status;
    this.cause = cause;
  }
}

export function resolveMcpEndpoint(env = process.env) {
  return getConfig(env).mcpUrl;
}

export function mcpBaseUrl(endpoint) {
  return endpoint.replace(/\/mcp\/?$/, "");
}

export function expectedToolCount() {
  return tools.length;
}

export async function fetchJson(url, { fetchImpl = fetch, timeoutMs = 10_000, check = null, method = "GET", body = undefined, headers = undefined } = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers: {
        accept: "application/json, text/event-stream",
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...(headers || {})
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    const described = describeNetworkError(error, url);
    throw new LiveCheckError(described.message, {
      check,
      classification: described.classification,
      code: described.code,
      hostname: described.hostname,
      url: String(url),
      status: null,
      cause: described.cause
    });
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new LiveCheckError(`Invalid JSON from ${url} (HTTP ${response.status})`, {
      check,
      classification: "invalid_json",
      url: String(url),
      status: response.status,
      cause: text.slice(0, 300)
    });
  }

  if (!response.ok) {
    throw new LiveCheckError(`HTTP ${response.status} from ${url}`, {
      check,
      classification: "http_error",
      url: String(url),
      status: response.status,
      cause: JSON.stringify(parsed).slice(0, 300)
    });
  }

  return { status: response.status, body: parsed };
}

// 2026-07-28 is stateless: the revision and the client's capabilities ride
// in `_meta` on every request, and Mcp-Method / Mcp-Name let intermediaries
// route without parsing the body (SEP-2243). Sending the modern envelope
// also keeps responses as a single JSON body - the 2025-era fallback
// answers over SSE, which this JSON parser could not read.
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "eventchat-live-checks", version: TOOL_VERSION }
};

export async function rpcCall(endpoint, method, params = undefined, options = {}) {
  const { status, body } = await fetchJson(endpoint, {
    ...options,
    method: "POST",
    headers: {
      "mcp-method": method,
      ...(method === "tools/call" && params?.name ? { "mcp-name": params.name } : {})
    },
    body: {
      jsonrpc: "2.0",
      id: options.id ?? 1,
      method,
      params: { ...(params || {}), _meta: MODERN_META }
    }
  });
  if (body.error) {
    throw new LiveCheckError(`${method} returned JSON-RPC error: ${body.error.message}`, {
      check: options.check,
      classification: "rpc_error",
      url: String(endpoint),
      status,
      cause: JSON.stringify(body.error).slice(0, 300)
    });
  }
  return body.result;
}

export async function runMonitorChecks(options = {}) {
  const endpoint = options.endpoint || resolveMcpEndpoint(options.env);
  const base = mcpBaseUrl(endpoint);
  const fetchImpl = options.fetch || fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const toolCount = options.expectedToolCount ?? expectedToolCount();
  const city = options.city || "berlin";

  const checks = {
    health: await runCheck("health", `${base}/health`, async () => {
      const { status, body } = await fetchJson(`${base}/health`, { fetchImpl, timeoutMs, check: "health" });
      if (body?.ok !== true || body?.name !== "eventchat-events") {
        throw new LiveCheckError("Health endpoint responded but did not report ok/name", {
          check: "health",
          classification: "bad_response",
          url: `${base}/health`,
          status,
          cause: JSON.stringify(body).slice(0, 300)
        });
      }
      return { status };
    }),
    metadata: await runCheck("metadata", `${base}/`, async () => {
      const { status, body } = await fetchJson(`${base}/`, { fetchImpl, timeoutMs, check: "metadata" });
      if (body?.endpoint !== "/mcp") {
        throw new LiveCheckError("Metadata endpoint responded but did not advertise /mcp", {
          check: "metadata",
          classification: "bad_response",
          url: `${base}/`,
          status,
          cause: JSON.stringify(body).slice(0, 300)
        });
      }
      return { status };
    }),
    tools: await runCheck("tools", endpoint, async () => {
      const result = await rpcCall(endpoint, "tools/list", undefined, { fetchImpl, timeoutMs, check: "tools" });
      const listed = result?.tools || [];
      if (listed.length !== toolCount) {
        throw new LiveCheckError(`Expected ${toolCount} tools, got ${listed.length}`, {
          check: "tools",
          classification: "bad_response",
          url: String(endpoint),
          status: 200,
          cause: `tool names: ${listed.map((tool) => tool.name).slice(0, 8).join(", ")}`
        });
      }
      return {
        status: 200,
        tool_count: listed.length,
        sample_tools: listed.slice(0, 5).map((tool) => tool.name)
      };
    }),
    live_search: await runCheck("live_search", endpoint, async () => {
      const result = await rpcCall(endpoint, "tools/call", {
        name: "search_events",
        arguments: { city, when: "week", limit: 1 }
      }, { fetchImpl, timeoutMs, check: "live_search" });
      const structured = result?.structuredContent || {};
      if (result?.isError) {
        throw new LiveCheckError(`search_events tool error: ${structured.error || "unknown"}`, {
          check: "live_search",
          classification: structured.classification || "tool_error",
          code: structured.code || null,
          hostname: structured.hostname || null,
          url: String(endpoint),
          status: 200,
          cause: structured.cause || structured.error || null
        });
      }
      const events = structured.events || [];
      if (!events.length) {
        throw new LiveCheckError(`search_events returned 0 events for "${city}" this week`, {
          check: "live_search",
          classification: "no_results",
          url: String(endpoint),
          status: 200,
          cause: "application-level empty result, not a connectivity failure"
        });
      }
      return {
        status: 200,
        event_count: events.length,
        sample_event: { id: events[0].id, title: events[0].title }
      };
    })
  };

  return {
    ok: Object.values(checks).every((check) => check.ok),
    endpoint,
    checks
  };
}

async function runCheck(name, url, run) {
  try {
    return { ok: true, check: name, ...(await run()) };
  } catch (error) {
    if (error instanceof LiveCheckError) {
      return {
        ok: false,
        check: name,
        status: error.status,
        error: error.message,
        classification: error.classification,
        code: error.code,
        hostname: error.hostname,
        url: error.url,
        cause: error.cause
      };
    }
    const described = describeNetworkError(error, url);
    return {
      ok: false,
      check: name,
      status: null,
      error: described.message,
      classification: described.classification,
      code: described.code,
      hostname: described.hostname,
      url: url ? String(url) : null,
      cause: described.cause
    };
  }
}
