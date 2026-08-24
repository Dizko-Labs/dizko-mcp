import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { PassThrough } from "node:stream";
import { handleMcpRequest, runMcpServer } from "../src/mcpServer.js";
import { clearEventCache } from "../src/api.js";

// 2026-07-28 carries the protocol revision and client capabilities per
// request instead of negotiating them once via initialize.
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" }
};

beforeEach(() => clearEventCache());

test("MCP initialize exposes server instructions for cross-tool workflows", async () => {
  const response = await handleMcpRequest({
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0" }
    }
  });

  assert.equal(response.serverInfo.name, "dizko");
  assert.match(response.instructions, /live event discovery/);
  assert.match(response.instructions, /get_preference_onboarding/);
  assert.match(response.instructions, /consent/);
  assert.match(response.instructions, /profile_id and profile_secret/);
  assert.match(response.instructions, /get_event_search_followups/);
  assert.match(response.instructions, /record_event_feedback/);
  assert.match(response.instructions, /get_ticket_offers/);
  assert.match(response.instructions, /purchase_ticket_order/);
  assert.match(response.instructions, /Hermes, OpenClaw/);
});

test("MCP lists event tools", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });
  assert.deepEqual(response.tools.map((tool) => tool.name), [
    "get_preference_onboarding",
    "create_event_preference_profile",
    "save_event_preferences",
    "get_event_preferences",
    "delete_event_preferences",
    "record_event_feedback",
    "get_event_feedback_prompt",
    "get_event_search_followups",
    "list_cities",
    "search_events",
    "recommend_events",
    "recommend_events_for_user",
    "plan_night",
    "get_daily_roundup",
    "get_artist_events",
    "get_city_pulse",
    "get_event",
    "get_ticket_purchase_policy",
    "get_ticket_offers",
    "quote_ticket_order",
    "purchase_ticket_order",
    "create_event_calendar_file"
  ]);
});

test("MCP tool annotations describe read, write, and destructive behavior", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });
  const tools = Object.fromEntries(response.tools.map((tool) => [tool.name, tool]));

  assert.equal(tools.search_events.annotations.readOnlyHint, true);
  assert.equal(tools.search_events.annotations.openWorldHint, false);
  assert.equal(tools.create_event_preference_profile.annotations.readOnlyHint, false);
  assert.equal(tools.create_event_preference_profile.annotations.destructiveHint, false);
  assert.equal(tools.create_event_preference_profile.annotations.openWorldHint, false);
  assert.equal(tools.get_event_feedback_prompt.annotations.readOnlyHint, true);
  assert.equal(tools.get_event_search_followups.annotations.openWorldHint, false);
  assert.equal(tools.record_event_feedback.annotations.openWorldHint, false);
  assert.equal(tools.delete_event_preferences.annotations.destructiveHint, true);
  assert.equal(tools.delete_event_preferences.annotations.readOnlyHint, false);
  assert.equal(tools.delete_event_preferences.annotations.openWorldHint, false);
  assert.equal(tools.get_ticket_offers.annotations.readOnlyHint, true);
  assert.equal(tools.quote_ticket_order.annotations.readOnlyHint, true);
  assert.equal(tools.purchase_ticket_order.annotations.readOnlyHint, false);
  assert.equal(tools.purchase_ticket_order.annotations.destructiveHint, true);
  assert.equal(tools.purchase_ticket_order.annotations.openWorldHint, true);
});

test("MCP tool metadata is review-friendly", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });

  for (const tool of response.tools) {
    assert.equal(typeof tool.title, "string", `${tool.name} is missing a title`);
    assert.ok(tool.title.length > 0, `${tool.name} has an empty title`);
    assert.match(tool.description, /^Use this (when|only when)\b/, `${tool.name} description should start with "Use this..."`);
    assert.equal(typeof tool.inputSchema, "object", `${tool.name} is missing inputSchema`);
    assert.equal(tool.outputSchema, undefined, `${tool.name} should omit redundant outputSchema`);
    assert.deepEqual(tool.securitySchemes, [{ type: "noauth" }], `${tool.name} should advertise noauth securitySchemes`);
    assert.deepEqual(tool._meta?.securitySchemes, [{ type: "noauth" }], `${tool.name} should mirror noauth securitySchemes in _meta`);
    assert.equal(typeof tool._meta?.["openai/toolInvocation/invoking"], "string", `${tool.name} should define invoking status text`);
    assert.equal(typeof tool._meta?.["openai/toolInvocation/invoked"], "string", `${tool.name} should define invoked status text`);
    assert.ok(tool._meta["openai/toolInvocation/invoking"].length <= 64, `${tool.name} invoking status is too long`);
    assert.ok(tool._meta["openai/toolInvocation/invoked"].length <= 64, `${tool.name} invoked status is too long`);
  }
});

test("MCP tool list stays compact while preserving input contracts", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });
  const tools = Object.fromEntries(response.tools.map((tool) => [tool.name, tool]));

  assert.ok(Buffer.byteLength(JSON.stringify(response)) < 19_600);
  assert.equal(tools.plan_night.inputSchema.properties.profile_id.type, "string");
  assert.deepEqual(tools.plan_night.inputSchema.dependentRequired.profile_id, ["profile_secret"]);
  assert.equal(tools.create_event_preference_profile.inputSchema.properties.preferences.$ref, "#/$defs/preferences");
  assert.equal(tools.create_event_preference_profile.inputSchema.$defs.preferences.properties.day_filters.additionalProperties.$ref, "#/$defs/dayPreference");
  assert.ok(tools.record_event_feedback.inputSchema.anyOf.some((branch) => branch.required.includes("liked")));
  assert.ok(tools.record_event_feedback.inputSchema.anyOf.some((branch) => branch.required.includes("rating")));
  assert.ok(tools.record_event_feedback.inputSchema.anyOf.some((branch) => branch.required.includes("notes")));
  assert.equal(tools.delete_event_preferences.inputSchema.properties.confirm_delete.type, "boolean");
  assert.ok(tools.delete_event_preferences.inputSchema.required.includes("confirm_delete"));
  assert.ok(tools.purchase_ticket_order.inputSchema.required.includes("confirmation_text"));
});

test("MCP enforces required arguments before calling the upstream", async () => {
  let fetchCalls = 0;
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "get_event", arguments: {} }
  }, {
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("should not fetch");
    }
  });

  assert.equal(fetchCalls, 0);
  assert.equal(response.isError, true);
  assert.deepEqual(response.structuredContent, {
    error: "Missing required argument: id.",
    code: "missing_required_argument"
  });
});

test("MCP lists covered cities with live counts and freshness", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "list_cities", arguments: {} }
  }, {
    config: { apiBaseUrl: "https://api.example.test", userAgent: "test" },
    fetch: async () => Response.json({
      live: [{ slug: "berlin", name: "Berlin", country: "Germany", event_count: 321, last_scraped_at: "2026-08-24T08:00:00Z", stale: false }]
    })
  });

  assert.equal(response.structuredContent.count, 1);
  assert.deepEqual(response.structuredContent.cities[0], {
    slug: "berlin",
    name: "Berlin",
    country: "Germany",
    event_count: 321,
    freshness: "fresh",
    last_successful_fetch: "2026-08-24T08:00:00Z"
  });
});

test("unsupported cities return honest nearest coverage instead of an outage", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "Bristol" } }
  }, {
    config: { apiBaseUrl: "https://api.example.test", userAgent: "test" },
    retries: 0,
    fetch: async (url) => String(url).endsWith("/cities")
      ? Response.json({ live: [{ slug: "london", name: "London", country: "United Kingdom", event_count: 456, last_scraped_at: "2026-08-24T08:00:00Z", stale: false }] })
      : Response.json({ error: "Unsupported city" }, { status: 422 })
  });

  assert.equal(response.isError, true);
  assert.equal(response.structuredContent.code, "unsupported_city");
  assert.equal(response.structuredContent.nearest_covered_city.name, "London");
  assert.equal(response.structuredContent.nearest_covered_city.event_count, 456);
  assert.match(response.structuredContent.assistant_instruction, /not covered/);
  assert.doesNotMatch(JSON.stringify(response), /unavailable|outage/i);
});

test("MCP get_event_search_followups asks for missing event type and vibe", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "get_event_search_followups", arguments: { city: "berlin", when: "tonight" } }
  });

  assert.equal(response.structuredContent.needs_followup, true);
  assert.ok(response.structuredContent.missing_fields.includes("event_types"));
  assert.ok(response.structuredContent.missing_fields.includes("vibe"));
  assert.ok(response.structuredContent.questions.some((question) => question.includes("type of event")));
  assert.ok(response.structuredContent.questions.some((question) => question.includes("vibe")));
  assert.equal(response.structuredContent.search_args_hint.city, "berlin");
  assert.equal(response.structuredContent.search_args_hint.when, "tonight");
});

test("MCP get_event_feedback_prompt returns questions for post-event learning", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "get_event_feedback_prompt", arguments: { event_id: "event-1", attended_at: "2026-06-09" } }
  }, {
    fetch: async () => Response.json({
      id: "event-1",
      title: "Basement Night",
      start_time: "2026-06-09T22:00:00Z",
      genres: ["techno"],
      vibe: ["warehouse"],
      event_types: ["party"],
      lineup: [],
      venue_name: "RSO.BERLIN"
    })
  });

  assert.equal(response.structuredContent.event.title, "Basement Night");
  assert.equal(response.structuredContent.attended_at, "2026-06-09");
  assert.ok(response.structuredContent.questions.some((question) => question.includes("Did you like")));
  assert.match(response.structuredContent.assistant_instruction, /record_event_feedback/);
});

test("MCP search_events returns tool content", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "berlin" } }
  }, {
    config: { apiBaseUrl: "https://api.example.test", userAgent: "test" },
    fetch: async () => Response.json({
      count: 1,
      events: [{
        id: "1",
        title: "Night One",
        genres: [],
        vibe: [],
        event_types: [],
        lineup: [],
        ra_pick: true,
        price_trend: "selling_fast",
        sound_tags: ["dub techno"],
        promoters: ["Example Collective"],
        image_url: "https://images.example.test/night-one.jpg",
        lat: 52.5,
        lng: 13.4
      }]
    })
  });

  assert.equal(response.content[0].type, "text");
  assert.match(response.content[0].text, /Night One/);
  assert.equal(response.structuredContent.events[0].title, "Night One");
  assert.equal(response.structuredContent.events[0].pick, true);
  assert.equal(response.structuredContent.events[0].price_trend, "selling_fast");
  assert.deepEqual(response.structuredContent.events[0].sound_tags, ["dub techno"]);
  assert.deepEqual(response.structuredContent.events[0].promoters, ["Example Collective"]);
  assert.equal(response.structuredContent.events[0].image_url, "https://images.example.test/night-one.jpg");
  assert.equal(response.structuredContent.events[0].lat, 52.5);
  assert.equal(response.structuredContent.events[0].lng, 13.4);
  assert.equal(response.structuredContent.app_download_url, "https://www.dizko.app/ios");
});

test("MCP search_events returns structured tool errors for slow upstream calls", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "berlin" } }
  }, {
    config: { apiBaseUrl: "https://api.example.test", userAgent: "test", apiTimeoutMs: 5 },
    fetch: async (_url, init) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 50);
        init.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }
  });

  assert.equal(response.isError, true);
  assert.deepEqual(response.structuredContent, {
    error: "The event service timed out. Try again shortly.",
    code: "upstream_timeout"
  });
});

test("MCP ticket tools quote and hand off third-party checkout after written confirmation", async () => {
  const options = {
    fetch: async () => Response.json({
      id: "event-1",
      title: "Ostbahnhof XL",
      start_time: "2026-06-13T13:00:00Z",
      end_time: "2026-06-14T02:00:00Z",
      venue_name: "Psstudio",
      venue_city: "los angeles",
      price_min: 100,
      price_max: 100,
      currency: "USD",
      source: "resident_advisor",
      source_display: "resident_advisor",
      ticket_url: "https://ra.co/events/2339406",
      genres: ["techno"],
      vibe: ["warehouse"],
      event_types: ["party"],
      lineup: []
    }),
    now: new Date("2026-06-10T12:00:00Z")
  };

  const offers = await handleMcpRequest({
    method: "tools/call",
    params: { name: "get_ticket_offers", arguments: { event_id: "event-1" } }
  }, options);

  assert.equal(offers.structuredContent.count, 1);
  assert.equal(offers.structuredContent.offers[0].provider, "resident_advisor");
  assert.equal(offers.structuredContent.offers[0].purchase_mode, "external_checkout");
  assert.equal(offers.structuredContent.offers[0].autonomous_purchase_supported, false);

  const quote = await handleMcpRequest({
    method: "tools/call",
    params: {
      name: "quote_ticket_order",
      arguments: {
        event_id: "event-1",
        quantity: 2,
        ticket_type: "GA",
        max_total: 240,
        currency: "USD"
      }
    }
  }, options);

  assert.equal(quote.structuredContent.quoted, true);
  assert.equal(quote.structuredContent.quote.quantity, 2);
  assert.equal(quote.structuredContent.quote.max_total, 240);
  assert.match(quote.structuredContent.confirmation_prompt, /Yes, buy 2 ticket/);

  const purchase = await handleMcpRequest({
    method: "tools/call",
    params: {
      name: "purchase_ticket_order",
      arguments: {
        quote_token: quote.structuredContent.quote_token,
        confirmation_text: "Yes, buy 2 tickets for Ostbahnhof XL, max total USD240. Stop if price, date, venue, ticket type, quantity, or refund terms change."
      }
    }
  }, options);

  assert.equal(purchase.structuredContent.purchased, false);
  assert.equal(purchase.structuredContent.status, "requires_external_checkout");
  assert.equal(purchase.structuredContent.checkout_url, "https://ra.co/events/2339406");
  assert.match(purchase.structuredContent.assistant_instruction, /do not claim the agent bought/);
});

test("MCP purchase_ticket_order rejects vague confirmation", async () => {
  const options = {
    fetch: async () => Response.json({
      id: "event-1",
      title: "Club Night",
      ticket_url: "https://tickets.example.test/event-1",
      source: "hermes",
      genres: [],
      vibe: [],
      event_types: [],
      lineup: []
    }),
    now: new Date("2026-06-10T12:00:00Z")
  };
  const quote = await handleMcpRequest({
    method: "tools/call",
    params: { name: "quote_ticket_order", arguments: { event_id: "event-1", quantity: 2, max_total: 80 } }
  }, options);

  const purchase = await handleMcpRequest({
    method: "tools/call",
    params: {
      name: "purchase_ticket_order",
      arguments: {
        quote_token: quote.structuredContent.quote_token,
        confirmation_text: "sounds good"
      }
    }
  }, options);

  assert.equal(purchase.structuredContent.purchased, false);
  assert.equal(purchase.structuredContent.status, "confirmation_required");
  assert.match(purchase.structuredContent.error, /buy or purchase/);
});

test("MCP stdio serves newline-delimited JSON-RPC on the 2026-07-28 revision", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const closed = runMcpServer({ input, output });

  const lines = [];
  output.on("data", (chunk) => lines.push(...String(chunk).split("\n").filter(Boolean)));

  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "server/discover",
    params: { _meta: MODERN_META }
  })}\n`);

  const discover = await nextMessage(lines);
  assert.deepEqual(discover.result.supportedVersions, ["2026-07-28"]);
  assert.equal(discover.result.resultType, "complete");

  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: { _meta: MODERN_META }
  })}\n`);

  const list = await nextMessage(lines);
  assert.equal(list.result.resultType, "complete");
  assert.ok(list.result.tools.some((tool) => tool.name === "search_events"));

  input.end();
  await closed;
});

async function nextMessage(lines) {
  for (let attempt = 0; attempt < 200 && lines.length === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(lines.length > 0, "expected a JSON-RPC message on stdout");
  return JSON.parse(lines.shift());
}

test("MCP search_events sanitizes retryable DNS failures", async () => {
  const dnsError = new TypeError("fetch failed");
  dnsError.cause = Object.assign(new Error("getaddrinfo EAI_AGAIN backend.example.test"), {
    code: "EAI_AGAIN",
    syscall: "getaddrinfo",
    hostname: "backend.example.test"
  });

  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "los angeles", when: "week", limit: 1 } }
  }, {
    config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
    retries: 1,
    sleep: async () => {},
    fetch: async () => { throw dnsError; }
  });

  assert.equal(response.isError, true);
  const body = response.structuredContent;
  assert.deepEqual(body, {
    error: "The event service is temporarily unavailable. Try again shortly.",
    code: "upstream_unavailable"
  });
});

test("MCP search_events sanitizes retryable HTTP 5xx errors", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "berlin", when: "week", limit: 1 } }
  }, {
    config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
    retries: 0,
    fetch: async () => new Response("upstream exploded", { status: 503 })
  });

  assert.equal(response.isError, true);
  const body = response.structuredContent;
  assert.deepEqual(body, {
    error: "The event service is temporarily unavailable. Try again shortly.",
    code: "upstream_unavailable"
  });
});

test("MCP error responses never expose upstream hosts, URLs, or causes", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "berlin", limit: 1 } }
  }, {
    config: {
      apiBaseUrl: "https://backend-production-958d.up.railway.app",
      userAgent: "test"
    },
    retries: 0,
    fetch: async () => new Response("Traceback: private stack detail", { status: 503 })
  });

  assert.equal(response.isError, true);
  assert.deepEqual(Object.keys(response.structuredContent).sort(), ["code", "error"]);
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, /backend-production-958d/i);
  assert.doesNotMatch(serialized, /railway\.app/i);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /traceback|stack detail/i);
});
