import {
  DEFAULT_NEGOTIATED_PROTOCOL_VERSION,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS as SDK_SUPPORTED_PROTOCOL_VERSIONS
} from "@modelcontextprotocol/server";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { MCP_SERVER_INSTRUCTIONS, TOOL_VERSION } from "./config.js";
import { callTool, getPrompt, prompts, tools } from "./tools.js";
import { CACHE_HINTS, createSdkMcpServer } from "./sdkServer.js";

// Protocol revisions this server answers on the modern (stateless) path.
// 2025-era clients are still served through the SDK's legacy fallback.
export const SUPPORTED_PROTOCOL_VERSIONS = ["2026-07-28"];

const SERVER_INFO_META_KEY = "io.modelcontextprotocol/serverInfo";

// In-process dispatch helper for embedders that want the MCP method surface
// without a transport. It mirrors the 2026-07-28 wire shape (resultType on
// every result, cache fields on cacheable results, serverInfo in _meta);
// `initialize` stays for 2025-era embedders during the deprecation window.
export async function handleMcpRequest(request, options = {}) {
  switch (request.method) {
  case "server/discover":
    return complete({
      supportedVersions: SUPPORTED_PROTOCOL_VERSIONS,
      capabilities: { tools: {}, prompts: {} },
      instructions: MCP_SERVER_INSTRUCTIONS
    }, CACHE_HINTS["server/discover"]);
  case "initialize":
    // 2025-era handshake. The version is negotiated, not echoed: replying
    // with whatever the client asked for would agree to a revision this
    // server does not speak, and would drift from the SDK that serves the
    // real transports. The stateless path carries the version in _meta.
    return {
      protocolVersion: negotiateProtocolVersion(request.params?.protocolVersion),
      capabilities: { tools: {}, prompts: {} },
      serverInfo: { name: "dizko", version: TOOL_VERSION },
      instructions: MCP_SERVER_INSTRUCTIONS
    };
  case "tools/list":
    return complete({ tools }, CACHE_HINTS["tools/list"]);
  case "tools/call":
    return complete(await callTool(request.params?.name, request.params?.arguments || {}, options));
  case "prompts/list":
    return complete({ prompts }, CACHE_HINTS["prompts/list"]);
  case "prompts/get":
    return complete(await getPrompt(request.params?.name, request.params?.arguments || {}, options));
  case "notifications/initialized":
    return undefined;
  default:
    throw new Error(`Unsupported MCP method: ${request.method}`);
  }
}

// Mirrors the SDK: a revision it supports is agreed to, anything else falls
// back to the SDK's default rather than being accepted on the client's word.
// The supported list comes from the SDK so it cannot go stale here.
export function negotiateProtocolVersion(requested) {
  if (typeof requested === "string" && SDK_SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) return requested;
  if (requested === undefined || requested === null) return LATEST_PROTOCOL_VERSION;
  return DEFAULT_NEGOTIATED_PROTOCOL_VERSION;
}

function complete(result, cacheHint) {
  return {
    ...result,
    resultType: "complete",
    ...(cacheHint || {}),
    _meta: {
      ...(result._meta || {}),
      [SERVER_INFO_META_KEY]: { name: "dizko", version: TOOL_VERSION }
    }
  };
}

// Serves MCP over stdio with newline-delimited JSON-RPC framing, answering
// both the 2026-07-28 revision and 2025-era openings from one definition.
// Resolves once stdin closes so `bin/dizko-mcp.js` can await it.
export function runMcpServer({ input = process.stdin, output = process.stdout } = {}) {
  const handle = serveStdio(() => createSdkMcpServer(), {
    transport: stdioTransport(input, output),
    onerror: (error) => process.stderr.write(`dizko MCP error: ${error.message}\n`)
  });

  return new Promise((resolve) => {
    const finish = () => resolve(handle);
    input.once("end", finish);
    input.once("close", finish);
    input.once("error", finish);
  });
}

function stdioTransport(input, output) {
  if (input === process.stdin && output === process.stdout) return undefined;
  return new StdioServerTransport(input, output);
}
