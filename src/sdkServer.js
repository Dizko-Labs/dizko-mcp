import { Server } from "@modelcontextprotocol/server";
import { MCP_SERVER_INSTRUCTIONS, TOOL_VERSION } from "./config.js";
import { callTool, getPrompt, prompts, tools } from "./tools.js";

export const SERVER_INFO = { name: "dizko", version: TOOL_VERSION };

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
    return callTool(request.params.name, request.params.arguments || {}, options);
  });
  server.setRequestHandler("prompts/list", async () => ({ prompts }));
  server.setRequestHandler("prompts/get", async (request) => {
    return getPrompt(request.params.name, request.params.arguments || {}, options);
  });

  return server;
}
