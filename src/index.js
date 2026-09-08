// Public library entry point for agent frameworks (Hermes, OpenClaw,
// LangGraph, OpenAI Agents SDK, custom loops) that want to embed the
// Dizko Events tools in-process or self-host the MCP server.
//
// Three embed styles:
//   1. Register tools as native function-calls:
//        import { tools, callTool } from "dizko-events";
//        // expose `tools` (JSON Schemas) to your model, then:
//        const result = await callTool(name, args);
//   2. Self-host the MCP server with your own ticket-purchase adapter:
//        import { createHttpMcpServer } from "dizko-events";
//        createHttpMcpServer({ ticketPurchaseProvider }).listen(8787);
//   3. Call the data layer directly:
//        import { searchEvents, recommendEvents } from "dizko-events";
//
// Autonomous ticket purchase is only injectable in styles 1 and 2 - pass a
// ticketPurchaseProvider with canPurchase(event, summary) and
// purchase({ quote, confirmation_text, delivery_email, add_to_calendar }).
// Set DIZKO_QUOTE_SIGNING_SECRET so signed quote tokens survive restarts.

export {
  tools,
  prompts,
  callTool,
  getPrompt,
  toolJson,
  buildSearchFollowups,
  LEGACY_TOOL_ALIASES,
  EVENT_LINKS_INSTRUCTION
} from "./tools.js";
export {
  getConfig,
  SUPPORTED_CITIES,
  TOOL_VERSION,
  MCP_SERVER_INSTRUCTIONS,
  DEFAULT_API_BASE_URL,
  DEFAULT_APP_DOWNLOAD_URL,
  DEFAULT_WEB_BASE_URL,
  DEFAULT_MCP_URL
} from "./config.js";
export { CITY_TABLE, resolveCity, cityTimezone, cityDisplayName, nearestCoveredCity } from "./cities.js";
export { resolveDateRange, WHEN_PRESETS, isoDate, weekdayName } from "./dateRange.js";
export { ToolInputError } from "./errors.js";
export {
  searchEvents,
  getEvent,
  listCities,
  searchScene,
  getSceneProfile,
  getDjDirectoryProfile,
  getDjInsights,
  listPromoters,
  getPromoter,
  buildEventQuery,
  clearEventCache,
  MAX_SEARCH_LIMIT,
  SORT_OPTIONS,
  EventChatAPIError,
  EventChatNetworkError
} from "./api.js";
export { recommendEvents, planNight } from "./planner.js";
export { dailyRoundup } from "./roundup.js";
export { getArtistEvents } from "./artistEvents.js";
export { getArtistPage } from "./artistPage.js";
export { findArtist, findVenue, findPromoter, findSceneEntities } from "./entities.js";
export { cityPulse } from "./cityPulse.js";
export { summarizeEvent, eventUrl, EVENT_FIELD_OPTIONS } from "./format.js";
export { TICKET_PURCHASE_POLICY } from "./tickets.js";
export { validateInput } from "./validate.js";

// MCP transports - mount in a custom host or run the canonical servers.
export { handleMcpRequest, runMcpServer } from "./mcpServer.js";
export { createSdkMcpServer } from "./sdkServer.js";
export { createHttpMcpServer, runHttpMcpServer } from "./httpServer.js";
