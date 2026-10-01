import { Server } from "@modelcontextprotocol/server";
import { MCP_SERVER_INSTRUCTIONS, TOOL_VERSION } from "./config.js";
import { callTool, getPrompt, prompts, toolJson, tools } from "./tools.js";
import { currentAuthContext } from "./authContext.js";
import { cityFromInput, recordToolCall } from "./telemetry.js";
import { SURFACES, surfaceAllowsTool, surfaceInput, surfaceResult, surfaceTools } from "./surfaces.js";

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
// options.surface picks a reviewed tool subset (see surfaces.js); the default
// serves the full catalog. Prompts belong to the full catalog only: they walk
// the model through profiles, feedback and ticket purchase, none of which the
// reviewed plugin surface offers.
export function createSdkMcpServer(options = {}) {
  const surface = options.surface || "full";
  const listedTools = surfaceTools(surface);
  const servesPrompts = !SURFACES[surface];
  const server = new Server(SERVER_INFO, {
    capabilities: { tools: {}, ...(servesPrompts ? { prompts: {} } : {}) },
    instructions: SURFACES[surface]?.instructions || MCP_SERVER_INSTRUCTIONS,
    cacheHints: CACHE_HINTS
  });

  server.setRequestHandler("tools/list", async () => ({ tools: listedTools }));
  server.setRequestHandler("tools/call", async (request) => {
    const started=performance.now(); const input=surfaceInput(surface,request.params.arguments || {});
    const result=surfaceAllowsTool(surface,request.params.name)
      ? surfaceResult(surface,await callTool(request.params.name,input,{...options,authContext:currentAuthContext()}))
      : toolJson({ error: "The requested tool does not exist.", code: "unknown_tool" }, true);
    const data=result?.structuredContent || {};
    void recordToolCall({tool:TOOL_NAMES.has(request.params.name)?request.params.name:"unknown",city:cityFromInput(input),latency_ms:Math.round(performance.now()-started),outcome:result?.isError?"error":"success",...(result?.isError&&data.code?{error_code:String(data.code).slice(0,80)}:{}),...(Number.isInteger(data.count)?{result_count:data.count}: {})},options);
    return result;
  });
  if (servesPrompts) {
    server.setRequestHandler("prompts/list", async () => ({ prompts }));
    server.setRequestHandler("prompts/get", async (request) => {
      return getPrompt(request.params.name, request.params.arguments || {}, options);
    });
  }

  return server;
}
