import { resolve4, resolve6, resolveCname } from "node:dns/promises";
import { expectedToolCount } from "../src/liveChecks.js";

const domain = process.env.DIZKO_CUSTOM_DOMAIN || process.env.EVENTCHAT_CUSTOM_DOMAIN || "mcp.dizko.app";
const expectedServerName = "eventchat-events";
const endpointPath = "/mcp";

async function main() {
  const dns = await readDns(domain);
  const health = await fetchJson(`https://${domain}/health`);
  const metadata = await fetchJson(`https://${domain}/`);
  const mcp = await callMcp(`https://${domain}${endpointPath}`, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    // 2026-07-28 stateless envelope - without it the request is classified
    // as 2025-era and answered over SSE, which readJson cannot parse.
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {},
        "io.modelcontextprotocol/clientInfo": { name: "eventchat-domain-check", version: "0.0.0" }
      }
    }
  });

  const checks = {
    dns_resolves: dns.a.length > 0 || dns.aaaa.length > 0 || dns.cname.length > 0,
    health_ok: health.ok && health.status === 200 && health.body?.ok === true,
    metadata_ok: metadata.ok && metadata.status === 200 && metadata.body?.name === expectedServerName,
    mcp_ok: mcp.ok
      && Array.isArray(mcp.body?.result?.tools)
      && mcp.body.result.tools.length === expectedToolCount()
  };

  const ok = Object.values(checks).every(Boolean);
  const result = {
    ok,
    domain,
    endpoint: `https://${domain}${endpointPath}`,
    dns,
    checks,
    health_status: health.status,
    metadata_status: metadata.status,
    mcp_status: mcp.status,
    mcp_tool_count: mcp.body?.result?.tools?.length || 0,
    next_step: ok
      ? "Custom domain is ready for MCP review traffic."
      : "Verify the Vercel proxy route and DNS, then rerun this check."
  };

  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exitCode = 1;
}

async function readDns(hostname) {
  const [a, aaaa, cname] = await Promise.all([
    resolveMaybe(() => resolve4(hostname)),
    resolveMaybe(() => resolve6(hostname)),
    resolveMaybe(() => resolveCname(hostname))
  ]);
  return { a, aaaa, cname };
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });
    return {
      ok: response.ok,
      status: response.status,
      content_type: response.headers.get("content-type"),
      body: await readJson(response)
    };
  } catch (error) {
    return { ok: false, status: 0, error: error.message };
  }
}

async function callMcp(url, payload) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-method": payload.method
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    });
    return {
      ok: response.ok,
      status: response.status,
      content_type: response.headers.get("content-type"),
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

async function resolveMaybe(fn) {
  try {
    return await fn();
  } catch {
    return [];
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
