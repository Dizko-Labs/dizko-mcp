import { MCP_SERVER_INSTRUCTIONS, TOOL_VERSION } from "./config.js";
import { callTool, tools } from "./tools.js";

export async function handleMcpRequest(request, options = {}) {
  switch (request.method) {
    case "initialize":
      return {
        protocolVersion: request.params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "eventchat-events", version: TOOL_VERSION },
        instructions: MCP_SERVER_INSTRUCTIONS
      };
    case "tools/list":
      return { tools };
    case "tools/call":
      return callTool(request.params?.name, request.params?.arguments || {}, options);
    case "notifications/initialized":
      return undefined;
    default:
      throw new Error(`Unsupported MCP method: ${request.method}`);
  }
}

export async function runMcpServer({ input = process.stdin, output = process.stdout } = {}) {
  let buffer = "";
  input.setEncoding("utf8");
  for await (const chunk of input) {
    buffer += chunk;
    while (true) {
      const message = extractMessage(buffer);
      if (!message) break;
      buffer = message.remaining;
      const response = await handlePayload(message.payload);
      if (response) writeMcpMessage(output, response);
    }
  }
}

export function writeMcpMessage(output, message) {
  const payload = JSON.stringify(message);
  output.write(`Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}`);
}

export function extractMessage(buffer) {
  if (!buffer) return null;

  const headerEnd = buffer.indexOf("\r\n\r\n");
  if (headerEnd !== -1) {
    const header = buffer.slice(0, headerEnd);
    const match = /^Content-Length:\s*(\d+)$/im.exec(header);
    if (!match) throw new Error("Missing MCP Content-Length header");
    const length = Number(match[1]);
    const payloadStart = headerEnd + 4;
    const payloadEnd = payloadStart + length;
    if (buffer.length < payloadEnd) return null;
    return {
      payload: buffer.slice(payloadStart, payloadEnd),
      remaining: buffer.slice(payloadEnd)
    };
  }

  const newline = buffer.indexOf("\n");
  if (newline === -1) return null;
  return {
    payload: buffer.slice(0, newline).trim(),
    remaining: buffer.slice(newline + 1)
  };
}

async function handlePayload(payload) {
  let request;
  try {
    if (!payload) return null;
    request = JSON.parse(payload);
    const result = await handleMcpRequest(request);
    if (request.id === undefined || result === undefined) return null;
    return { jsonrpc: "2.0", id: request.id, result };
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id: request?.id ?? null,
      error: { code: -32000, message: error.message }
    };
  }
}
