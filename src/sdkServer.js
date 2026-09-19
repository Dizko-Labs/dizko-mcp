import { Server } from "@modelcontextprotocol/server";
import { MCP_SERVER_INSTRUCTIONS, TOOL_VERSION } from "./config.js";
import { callTool, tools } from "./tools.js";
import { currentAuthContext } from "./authContext.js";
import { cityFromInput, recordToolCall } from "./telemetry.js";

export const SERVER_INFO = { name: "dizko", version: TOOL_VERSION };

// SEP-2549 cache hints for the 2026-07-28 revision. Our tool list is a
// static array baked into the build, so it is safe for shared caches to
// hold it; the TTL is what stops clients re-listing on every turn.
// Anything not listed here keeps the conservative default (ttlMs 0,
// cacheScope private). 2025-era responses never carry these fields.
export const CACHE_HINTS = {
  "tools/list": { ttlMs: 300_000, cacheScope: "public" },
  "server/discover": { ttlMs: 300_000, cacheScope: "public" }
};

// One factory serves both protocol eras: the 2026-07-28 path and the
// stateless 2025-era fallback are built from this same definition, so the
// two can never drift apart. Callers must treat it as per-serving-unit -
// createMcpHandler calls it once per HTTP request.
export function createSdkMcpServer(options = {}) {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: MCP_SERVER_INSTRUCTIONS,
    cacheHints: CACHE_HINTS
  });

  server.setRequestHandler("tools/list", async () => ({ tools }));
  server.setRequestHandler("tools/call", async (request) => {
    const started=performance.now(); const input=request.params.arguments || {};
    const result=await callTool(request.params.name,input,{...options,authContext:currentAuthContext()});
    const data=result?.structuredContent || {};
    void recordToolCall({tool:request.params.name,city:cityFromInput(input),latency_ms:Math.round(performance.now()-started),outcome:result?.isError?"error":"success",...(result?.isError&&data.code?{error_code:String(data.code).slice(0,80)}:{}),...(Number.isInteger(data.count)?{result_count:data.count}: {})},options);
    return result;
  });

  return server;
}
