import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import * as lib from "dizko-events";
import { clearEventCache } from "../src/api.js";

beforeEach(() => clearEventCache());

test("public library entry exposes the stable agent-integration surface", () => {
  for (const name of [
    "tools", "prompts", "callTool", "getPrompt", "toolJson", "buildSearchFollowups", "LEGACY_TOOL_ALIASES", "EVENT_LINKS_INSTRUCTION",
    "searchEvents", "getEvent", "listCities", "recommendEvents", "planNight", "dailyRoundup", "summarizeEvent", "eventUrl", "EVENT_FIELD_OPTIONS",
    "searchScene", "getSceneProfile", "getDjDirectoryProfile", "getDjInsights", "listPromoters", "getPromoter",
    "findArtist", "findVenue", "findPromoter", "findSceneEntities", "getArtistPage", "getArtistEvents", "cityPulse",
    "getConfig", "SUPPORTED_CITIES", "TOOL_VERSION", "MCP_SERVER_INSTRUCTIONS",
    "DEFAULT_API_BASE_URL", "DEFAULT_APP_DOWNLOAD_URL", "DEFAULT_WEB_BASE_URL", "DEFAULT_MCP_URL",
    "CITY_TABLE", "resolveCity", "cityTimezone", "cityDisplayName", "nearestCoveredCity",
    "resolveDateRange", "WHEN_PRESETS", "isoDate", "weekdayName",
    "ToolInputError", "validateInput",
    "buildEventQuery", "clearEventCache", "MAX_SEARCH_LIMIT", "SORT_OPTIONS",
    "DizkoAPIError", "DizkoNetworkError", "EventChatAPIError", "EventChatNetworkError", "TICKET_PURCHASE_POLICY",
    "handleMcpRequest", "runMcpServer", "createSdkMcpServer", "createHttpMcpServer", "runHttpMcpServer"
  ]) {
    assert.ok(name in lib, `missing export: ${name}`);
  }
  assert.equal(Array.isArray(lib.tools), true);
  assert.equal(lib.tools.length, 19);
  assert.ok(lib.tools.every((tool) => tool.name.startsWith("dizko_")), "every public tool carries the dizko_ prefix");
  assert.equal(Array.isArray(lib.prompts), true);
  assert.equal(lib.prompts.length, 4);
  assert.equal(typeof lib.callTool, "function");
  assert.equal(typeof lib.getPrompt, "function");
  assert.equal(typeof lib.validateInput, "function");
  assert.equal(lib.MAX_SEARCH_LIMIT, 200);
  assert.ok(lib.SORT_OPTIONS.includes("soonest"));
  assert.ok(lib.WHEN_PRESETS.includes("weekend"));
  assert.equal(lib.LEGACY_TOOL_ALIASES.search_events.name, "dizko_search_events");
  assert.equal(lib.LEGACY_TOOL_ALIASES.create_event_preference_profile.name, "dizko_create_profile");
  assert.equal(lib.cityTimezone("berlin"), "Europe/Berlin");
  assert.equal(lib.cityDisplayName("new-york"), "New York");
  assert.equal(lib.resolveCity("NYC").slug, "new-york");
  assert.ok(new lib.ToolInputError("x", { field: "city" }) instanceof Error);
});

test("an embedded agent can call tools in-process with an injected fetch", async () => {
  const options = {
    config: { apiBaseUrl: "https://api.test", userAgent: "t", apiCacheTtlMs: 0 },
    fetch: async () => Response.json({ count: 1, events: [{ id: "e1", title: "Embedded", start_time: "2026-06-13T22:00:00Z", venue_name: "Club", venue_city: "berlin" }] })
  };

  const result = await lib.callTool("dizko_search_events", { city: "berlin", when: "any", limit: 1 }, options);
  assert.equal(result.isError ?? false, false);
  assert.equal(result.structuredContent.city, "Berlin");
  assert.equal(result.structuredContent.timezone, "Europe/Berlin");
  assert.equal(result.structuredContent.events[0].title, "Embedded");
  assert.equal(result.structuredContent.events[0].when, "Sun 14 Jun, 00:00");

  // Pre-0.8 names keep working for existing embedders.
  const legacy = await lib.callTool("search_events", { city: "berlin", when: "any", limit: 1 }, options);
  assert.equal(legacy.isError ?? false, false);
  assert.equal(legacy.structuredContent.events[0].title, "Embedded");
});

test("validateInput coerces model-friendly shapes against a tool schema", () => {
  const search = lib.tools.find((tool) => tool.name === "dizko_search_events");
  const { value, errors } = lib.validateInput(search.inputSchema, { city: "berlin", limit: "5", genres: "techno,house", free: "yes" });
  assert.deepEqual(errors, []);
  assert.equal(value.limit, 5);
  assert.deepEqual(value.genres, ["techno", "house"]);
  assert.equal(value.free, true);

  const invalid = lib.validateInput(search.inputSchema, { city: "berlin", sort_by: "random" });
  assert.equal(invalid.errors[0].field, "sort_by");
  assert.deepEqual(invalid.errors[0].allowed, lib.SORT_OPTIONS);
});

test("a ticketPurchaseProvider adapter (Hermes/OpenClaw) lights up autonomous purchase", async () => {
  const event = {
    id: "evt-1", title: "Show", start_time: "2026-06-13T22:00:00Z",
    venue_name: "Hall", venue_city: "berlin", ticket_url: "https://tickets.test/evt-1"
  };
  const hermesAdapter = {
    canPurchase: () => true,
    purchase: async ({ confirmation_text }) => ({ status: "purchased", order_id: "ord_1", confirmation_text })
  };
  const opts = {
    config: { apiBaseUrl: "https://api.test", userAgent: "t", apiCacheTtlMs: 0 },
    fetch: async () => Response.json(event),
    ticketPurchaseProvider: hermesAdapter
  };

  const offers = await lib.callTool("dizko_ticket_offers", { event_id: "evt-1" }, opts);
  assert.equal(offers.isError, false);
  assert.equal(offers.structuredContent.offers.some((o) => o.autonomous_purchase_supported === true), true,
    "injected adapter should advertise autonomous purchase support");
  assert.equal(offers.structuredContent.offers[0].purchase_mode, "partner_api_purchase");
});
