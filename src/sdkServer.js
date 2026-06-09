import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCP_SERVER_INSTRUCTIONS, TOOL_VERSION } from "./config.js";
import { callTool, tools } from "./tools.js";

export function createSdkMcpServer(options = {}) {
  const server = new Server(
    {
      name: "eventchat-events",
      version: TOOL_VERSION
    },
    {
      capabilities: {
        tools: {}
      },
      instructions: MCP_SERVER_INSTRUCTIONS
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return callTool(request.params.name, request.params.arguments || {}, options);
  });

  return server;
}
