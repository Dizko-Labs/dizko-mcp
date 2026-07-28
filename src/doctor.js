import dns from "node:dns/promises";
import { searchEvents } from "./api.js";
import { getConfig, TOOL_VERSION } from "./config.js";
import { describeNetworkError, hostnameFromUrl } from "./netError.js";

// Connectivity diagnostics for `dizko-events doctor`. Every check
// reports a one-line detail with the underlying cause - no stack traces.
export async function runDoctor(options = {}) {
  const config = options.config || getConfig(options.env);
  const lookup = options.lookup || ((host) => dns.lookup(host));
  const fetchImpl = options.fetch || fetch;
  const timeoutMs = options.timeoutMs ?? config.apiTimeoutMs;
  const mcpBase = config.mcpUrl.replace(/\/mcp\/?$/, "");
  const apiHost = hostnameFromUrl(config.apiBaseUrl);
  const mcpHost = hostnameFromUrl(config.mcpUrl);

  // All checks are independent - run them concurrently so doctor answers
  // in one round-trip time instead of seven.
  const checks = await Promise.all([
    dnsCheck("api_dns", apiHost, lookup),
    dnsCheck("mcp_dns", mcpHost, lookup),
    httpCheck("api_health", `${config.apiBaseUrl}/health`, fetchImpl, timeoutMs),
    httpCheck("mcp_health", `${mcpBase}/health`, fetchImpl, timeoutMs),
    httpCheck("mcp_metadata", `${mcpBase}/`, fetchImpl, timeoutMs, (body) => body?.endpoint === "/mcp"),
    mcpToolsCheck(config.mcpUrl, fetchImpl, timeoutMs),
    liveSearchCheck(config, { ...options, fetch: options.fetch, timeoutMs })
  ]);

  return {
    ok: checks.every((check) => check.ok),
    package_version: TOOL_VERSION,
    api_base_url: config.apiBaseUrl,
    mcp_endpoint: config.mcpUrl,
    checks
  };
}

export function formatDoctorReport(report) {
  const lines = [
    `dizko-events doctor`,
    `  package_version: ${report.package_version}`,
    `  api_base_url:    ${report.api_base_url}`,
    `  mcp_endpoint:    ${report.mcp_endpoint}`,
    ``
  ];
  for (const check of report.checks) {
    lines.push(`  ${check.ok ? "PASS" : "FAIL"}  ${check.name.padEnd(14)} ${check.detail}`);
  }
  lines.push("");
  lines.push(report.ok
    ? "All checks passed."
    : "Some checks failed. Transient DNS/network failures usually clear on retry; persistent ones may need EVENTCHAT_API_BASE_URL / EVENTCHAT_MCP_URL overrides or a network/VPN/DNS fix.");
  return lines.join("\n");
}

async function dnsCheck(name, hostname, lookup) {
  if (!hostname) return { name, ok: false, detail: "no hostname configured" };
  try {
    const result = await lookup(hostname);
    const address = result?.address || (Array.isArray(result) ? result[0]?.address : null) || "resolved";
    return { name, ok: true, detail: `${hostname} -> ${address}` };
  } catch (error) {
    const described = describeNetworkError(error, null);
    return {
      name,
      ok: false,
      detail: `${hostname} failed to resolve (${described.code || error.message})`,
      code: described.code,
      cause: described.cause
    };
  }
}

async function httpCheck(name, url, fetchImpl, timeoutMs, validate = null) {
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await safeJson(response);
    if (!response.ok) {
      return { name, ok: false, detail: `HTTP ${response.status} from ${url}`, status: response.status };
    }
    if (validate && !validate(body)) {
      return { name, ok: false, detail: `HTTP ${response.status} but unexpected body from ${url}`, status: response.status };
    }
    return { name, ok: true, detail: `HTTP ${response.status}`, status: response.status };
  } catch (error) {
    return failureFromError(name, error, url);
  }
}

async function mcpToolsCheck(endpoint, fetchImpl, timeoutMs) {
  const name = "mcp_tools_list";
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = await safeJson(response);
    if (!response.ok) {
      return { name, ok: false, detail: `HTTP ${response.status} from ${endpoint}`, status: response.status };
    }
    const count = body?.result?.tools?.length ?? 0;
    if (!count) {
      return { name, ok: false, detail: "tools/list returned no tools", status: response.status };
    }
    return { name, ok: true, detail: `${count} tools`, status: response.status };
  } catch (error) {
    return failureFromError(name, error, endpoint);
  }
}

async function liveSearchCheck(config, options) {
  const name = "live_search";
  const city = options.city || "los angeles";
  try {
    const response = await searchEvents(
      { city, when: "week", limit: 1 },
      { config, fetch: options.fetch, timeoutMs: options.timeoutMs, retries: 1, now: options.now }
    );
    const count = response.count ?? response.events?.length ?? 0;
    return {
      name,
      ok: true,
      detail: count > 0
        ? `${count} event(s) for "${city}" this week`
        : `connectivity OK, but 0 events matched "${city}" this week (application-level no-results)`
    };
  } catch (error) {
    return failureFromError(name, error, error.url || config.apiBaseUrl);
  }
}

function failureFromError(name, error, url) {
  const described = describeNetworkError(error, url);
  return {
    name,
    ok: false,
    detail: described.message,
    code: error.code ?? described.code,
    status: error.status ?? null,
    hostname: error.hostname ?? described.hostname,
    url: error.url ?? (url ? String(url) : null),
    classification: error.classification ?? described.classification,
    retryable: error.retryable ?? described.retryable,
    cause: described.cause
  };
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}
