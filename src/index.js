// Public library entry point for agent frameworks (Hermes, OpenClaw,
// LangGraph, OpenAI Agents SDK, custom loops) that want to embed the
// UPlayground Events tools in-process or self-host the MCP server —
// rather than connect to the hosted endpoint over MCP.
//
// Three embed styles:
//   1. Register tools as native function-calls:
//        import { tools, callTool } from "uplayground-events";
//        // expose `tools` (JSON Schemas) to your model, then:
//        const result = await callTool(name, args);
//   2. Self-host the MCP server with your own ticket-purchase adapter:
//        import { createHttpMcpServer } from "uplayground-events";
//        createHttpMcpServer({ ticketPurchaseProvider }).listen(8787);
//   3. Call the data layer directly:
//        import { searchEvents, recommendEvents } from "uplayground-events";
//
// Autonomous ticket purchase (the Hermes/OpenClaw integration point) is
// only injectable in styles 1 and 2 — pass a ticketPurchaseProvider with
// canPurchase(event, summary) and purchase({ quote, confirmation_text,
// delivery_email, add_to_calendar }). The hosted endpoint cannot accept
// an adapter because the process is ours, so it returns checkout handoff.

export { tools, callTool, toolJson, EVENT_LINKS_INSTRUCTION } from "./tools.js";
export {
  getConfig,
  SUPPORTED_CITIES,
  TOOL_VERSION,
  MCP_SERVER_INSTRUCTIONS,
  DEFAULT_API_BASE_URL,
  DEFAULT_WEB_BASE_URL,
  DEFAULT_MCP_URL
} from "./config.js";
export {
  searchEvents,
  getEvent,
  buildEventQuery,
  clearEventCache,
  EventChatAPIError,
  EventChatNetworkError
} from "./api.js";
export { recommendEvents, planNight } from "./planner.js";
export { summarizeEvent, eventUrl } from "./format.js";
export { TICKET_PURCHASE_POLICY } from "./tickets.js";

// MCP transports — mount in a custom host or run the canonical servers.
export { handleMcpRequest, runMcpServer } from "./mcpServer.js";
export { createSdkMcpServer } from "./sdkServer.js";
export { createHttpMcpServer, runHttpMcpServer } from "./httpServer.js";
