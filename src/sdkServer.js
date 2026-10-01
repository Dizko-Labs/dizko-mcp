import { Server } from "@modelcontextprotocol/server";
import { MCP_SERVER_INSTRUCTIONS, TOOL_VERSION } from "./config.js";
import { callTool, getPrompt, prompts, tools } from "./tools.js";
import { currentAuthContext } from "./authContext.js";
import { cityFromInput, recordToolCall } from "./telemetry.js";

export const SERVER_INFO = { name: "dizko", version: TOOL_VERSION };

// Telemetry forwards facts upstream under the server's own secret, so the
// tool name - caller text until it matches a listed tool - is recorded only
// when it is one of ours. Anything else would let a caller write arbitrary
// text into Dizko's telemetry store.
const TOOL_NAMES = new Set(tools.map((tool) => tool.name));

// SEP-2549 cache hints for the 2026-07-28 revision. The tool and prompt
// lists are static arrays baked into the build, so shared caches may hold
// them; the TTL is what stops clients re-listing on every turn.
export const CACHE_HINTS = {
  "tools/list": { ttlMs: 300_000, cacheScope: "public" },
  "prompts/list": { ttlMs: 300_000, cacheScope: "public" },
  "server/discover": { ttlMs: 300_000, cacheScope: "public" }
};

// One factory serves both protocol eras. Callers must treat it as
// per-serving-unit - createMcpHandler calls it once per HTTP request.
export function createSdkMcpServer(options = {}) {
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {}, prompts: {} },
    instructions: MCP_SERVER_INSTRUCTIONS,
    cacheHints: CACHE_HINTS
  });

  server.setRequestHandler("tools/list", async () => ({ tools }));
  server.setRequestHandler("tools/call", async (request) => {
    const started=performance.now(); const input=request.params.arguments || {};
    const result=await callTool(request.params.name,input,{...options,authContext:currentAuthContext()});
    const data=result?.structuredContent || {};
    void recordToolCall({tool:TOOL_NAMES.has(request.params.name)?request.params.name:"unknown",city:cityFromInput(input),latency_ms:Math.round(performance.now()-started),outcome:result?.isError?"error":"success",...(result?.isError&&data.code?{error_code:String(data.code).slice(0,80)}:{}),...(Number.isInteger(data.count)?{result_count:data.count}: {})},options);
    return result;
  });
  server.setRequestHandler("prompts/list", async () => ({ prompts }));
  server.setRequestHandler("prompts/get", async (request) => {
    return getPrompt(request.params.name, request.params.arguments || {}, options);
  });

  return server;
}
