import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import * as lib from "dizko-events";
import { clearEventCache } from "../src/api.js";

beforeEach(() => clearEventCache());

test("public library entry exposes the stable agent-integration surface", () => {
  for (const name of [
    "tools", "callTool",
    "searchEvents", "getEvent", "recommendEvents", "planNight", "dailyRoundup", "summarizeEvent",
    "getConfig", "SUPPORTED_CITIES", "TOOL_VERSION", "MCP_SERVER_INSTRUCTIONS",
    "EventChatAPIError", "EventChatNetworkError",
    "handleMcpRequest", "createSdkMcpServer", "createHttpMcpServer"
  ]) {
    assert.ok(name in lib, `missing export: ${name}`);
  }
  assert.equal(Array.isArray(lib.tools), true);
  assert.equal(lib.tools.length, 21);
  assert.equal(typeof lib.callTool, "function");
});

test("an embedded agent can call tools in-process with an injected fetch", async () => {
  const result = await lib.callTool("search_events", { city: "berlin", when: "any", limit: 1 }, {
    config: { apiBaseUrl: "https://api.test", userAgent: "t", apiCacheTtlMs: 0 },
    fetch: async () => Response.json({ count: 1, events: [{ id: "e1", title: "Embedded", start_time: "2026-06-13T22:00:00Z", venue_name: "Club", venue_city: "berlin" }] })
  });
  assert.equal(result.isError ?? false, false);
  assert.equal(result.structuredContent.events[0].title, "Embedded");
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

  const offers = await lib.callTool("get_ticket_offers", { event_id: "evt-1" }, opts);
  assert.equal(offers.structuredContent.offers.some((o) => o.autonomous_purchase_supported === true), true,
    "injected adapter should advertise autonomous purchase support");
});
