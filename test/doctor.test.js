import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { TOOL_VERSION } from "../src/config.js";
import { formatDoctorReport, runDoctor } from "../src/doctor.js";
import { clearEventCache } from "../src/api.js";

beforeEach(() => clearEventCache());

const ENV = {
  EVENTCHAT_API_BASE_URL: "https://api.example.test",
  EVENTCHAT_MCP_URL: "https://mcp.example.test/mcp"
};

function healthyFetch(calls = []) {
  return async (url, init = {}) => {
    const u = String(url);
    calls.push({ url: u, method: init.method || "GET" });
    if (u.endsWith("/health")) return Response.json({ ok: true, name: "eventchat-events" });
    if (u === "https://mcp.example.test/") return Response.json({ endpoint: "/mcp" });
    if (u === "https://mcp.example.test/mcp") {
      return Response.json({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "search_events" }, { name: "get_event" }] } });
    }
    if (u.startsWith("https://api.example.test/events")) {
      return Response.json({ count: 1, events: [{ id: "evt-1", title: "Test Party" }] });
    }
    throw new Error(`Unexpected URL in test: ${u}`);
  };
}

test("doctor reports version, resolved endpoints, and passing checks", async () => {
  const report = await runDoctor({
    env: ENV,
    fetch: healthyFetch(),
    lookup: async (host) => ({ address: `10.0.0.${host.length}`, family: 4 })
  });

  assert.equal(report.ok, true);
  assert.equal(report.package_version, TOOL_VERSION);
  assert.equal(report.api_base_url, "https://api.example.test");
  assert.equal(report.mcp_endpoint, "https://mcp.example.test/mcp");
  assert.deepEqual(report.checks.map((check) => check.name), [
    "api_dns",
    "mcp_dns",
    "api_health",
    "mcp_health",
    "mcp_metadata",
    "mcp_tools_list",
    "live_search"
  ]);
  assert.ok(report.checks.every((check) => check.ok));

  const liveSearch = report.checks.find((check) => check.name === "live_search");
  assert.match(liveSearch.detail, /1 event\(s\)/);

  const formatted = formatDoctorReport(report);
  assert.match(formatted, /package_version: /);
  assert.match(formatted, /PASS\s+api_dns/);
  assert.match(formatted, /All checks passed\./);
});

test("doctor surfaces DNS failure causes without stack traces", async () => {
  const dnsFailure = Object.assign(new Error("getaddrinfo EAI_AGAIN mcp.example.test"), {
    code: "EAI_AGAIN",
    syscall: "getaddrinfo",
    hostname: "mcp.example.test"
  });
  const fetchFailure = new TypeError("fetch failed");
  fetchFailure.cause = dnsFailure;

  const report = await runDoctor({
    env: ENV,
    lookup: async (host) => {
      if (host === "mcp.example.test") throw dnsFailure;
      return { address: "10.0.0.1", family: 4 };
    },
    fetch: async (url, init = {}) => {
      const u = String(url);
      if (u.includes("mcp.example.test")) throw fetchFailure;
      return healthyFetch()(url, init);
    }
  });

  assert.equal(report.ok, false);
  const mcpDns = report.checks.find((check) => check.name === "mcp_dns");
  assert.equal(mcpDns.ok, false);
  assert.equal(mcpDns.code, "EAI_AGAIN");
  assert.match(mcpDns.detail, /failed to resolve/);

  const mcpHealth = report.checks.find((check) => check.name === "mcp_health");
  assert.equal(mcpHealth.ok, false);
  assert.equal(mcpHealth.code, "EAI_AGAIN");
  assert.equal(mcpHealth.classification, "dns");
  assert.equal(mcpHealth.retryable, true);
  assert.match(mcpHealth.detail, /DNS lookup/);

  const formatted = formatDoctorReport(report);
  assert.match(formatted, /FAIL\s+mcp_dns/);
  assert.match(formatted, /Some checks failed\./);
  assert.doesNotMatch(formatted, /at .*\(.*:\d+:\d+\)/, "should not include stack frames");
});

test("doctor treats an empty live search as connectivity success", async () => {
  const report = await runDoctor({
    env: ENV,
    lookup: async () => ({ address: "10.0.0.1", family: 4 }),
    fetch: async (url, init = {}) => {
      const u = String(url);
      if (u.startsWith("https://api.example.test/events")) {
        return Response.json({ count: 0, events: [] });
      }
      return healthyFetch()(url, init);
    }
  });

  const liveSearch = report.checks.find((check) => check.name === "live_search");
  assert.equal(liveSearch.ok, true);
  assert.match(liveSearch.detail, /no-results/);
});
