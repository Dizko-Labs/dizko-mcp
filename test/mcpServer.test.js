import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { PassThrough } from "node:stream";
import { handleMcpRequest, runMcpServer } from "../src/mcpServer.js";
import { clearEventCache, SORT_OPTIONS } from "../src/api.js";
import { LEGACY_TOOL_ALIASES } from "../src/tools.js";
import { WHEN_PRESETS } from "../src/dateRange.js";

// 2026-07-28 carries the protocol revision and client capabilities per
// request instead of negotiating them once via initialize.
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "test", version: "0" }
};

// The 19 public tools, in the exact order tools/list serves them.
const PUBLIC_TOOL_NAMES = [
  "dizko_search_events",
  "dizko_plan_night",
  "dizko_daily_roundup",
  "dizko_city_pulse",
  "dizko_get_event",
  "dizko_list_cities",
  "dizko_find_artist",
  "dizko_find_venue",
  "dizko_find_promoter",
  "dizko_artist_events",
  "dizko_create_profile",
  "dizko_update_profile",
  "dizko_get_profile",
  "dizko_delete_profile",
  "dizko_record_feedback",
  "dizko_ticket_offers",
  "dizko_quote_tickets",
  "dizko_purchase_tickets",
  "dizko_calendar_file"
];

// Pre-0.8 names that keep working through tools/call but are never listed.
const LEGACY_ONLY_HANDLERS = [
  "get_preference_onboarding",
  "get_event_search_followups",
  "get_event_feedback_prompt",
  "get_ticket_purchase_policy",
  "get_artist_page",
  "find_scene_entities"
];

const TEST_CONFIG = { apiBaseUrl: "https://api.example.test", userAgent: "test" };

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
  assert.deepEqual(response.capabilities, { tools: {}, prompts: {} });
  assert.match(response.instructions, /live event inventory/);
  assert.match(response.instructions, /dizko_search_events/);
  assert.match(response.instructions, /`when`/);
  assert.match(response.instructions, /consent/);
  assert.match(response.instructions, /profile_id and profile_secret/);
  assert.match(response.instructions, /dizko_create_profile/);
  assert.match(response.instructions, /dizko_record_feedback/);
  assert.match(response.instructions, /dizko_ticket_offers/);
  assert.match(response.instructions, /dizko_purchase_tickets/);
  // Retired tool names and the old framework shout-out are gone.
  assert.doesNotMatch(response.instructions, /get_preference_onboarding/);
  assert.doesNotMatch(response.instructions, /get_event_search_followups/);
  assert.doesNotMatch(response.instructions, /Hermes, OpenClaw/);
});

test("MCP server/discover advertises tools and prompts capabilities", async () => {
  const response = await handleMcpRequest({ method: "server/discover", params: { _meta: MODERN_META } });

  assert.deepEqual(response.supportedVersions, ["2026-07-28"]);
  assert.deepEqual(response.capabilities, { tools: {}, prompts: {} });
  assert.equal(response.resultType, "complete");
  assert.match(response.instructions, /dizko_search_events/);
});

test("MCP lists the 19 dizko_ tools in order and hides legacy names", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });
  const names = response.tools.map((tool) => tool.name);

  assert.deepEqual(names, PUBLIC_TOOL_NAMES);
  for (const legacy of [...Object.keys(LEGACY_TOOL_ALIASES), ...LEGACY_ONLY_HANDLERS]) {
    assert.equal(names.includes(legacy), false, `${legacy} must not be listed`);
  }
});

test("MCP legacy tool names still dispatch through tools/call", async () => {
  assert.equal(LEGACY_TOOL_ALIASES.search_events.name, "dizko_search_events");
  assert.equal(LEGACY_TOOL_ALIASES.get_event.name, "dizko_get_event");

  const options = {
    config: { ...TEST_CONFIG, apiCacheTtlMs: 0 },
    fetch: async (url) => String(url).includes("/events/evt-1")
      ? Response.json({ id: "evt-1", title: "Legacy Lookup", start_time: "2026-09-12T20:00:00Z", venue_city: "berlin" })
      : Response.json({ count: 1, events: [{ id: "evt-1", title: "Legacy Search", start_time: "2026-09-12T20:00:00Z", venue_city: "berlin" }] })
  };

  const search = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "berlin" } }
  }, options);
  assert.equal(search.isError, false);
  assert.equal(search.structuredContent.rank, "relevance");
  assert.equal(search.structuredContent.events[0].title, "Legacy Search");

  const event = await handleMcpRequest({
    method: "tools/call",
    params: { name: "get_event", arguments: { id: "evt-1" } }
  }, options);
  assert.equal(event.isError, false);
  assert.equal(event.structuredContent.title, "Legacy Lookup");
  assert.equal(event.structuredContent.when, "Sat 12 Sep, 22:00");

  // recommend_events maps onto taste ranking of the same search tool.
  const recommend = await handleMcpRequest({
    method: "tools/call",
    params: { name: "recommend_events", arguments: { city: "berlin", result_limit: 1 } }
  }, options);
  assert.equal(recommend.isError, false);
  assert.equal(recommend.structuredContent.rank, "taste");
  assert.equal(recommend.structuredContent.events.length, 1);
});

test("MCP rejects unknown tools with the allowed list", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_everything", arguments: {} }
  });

  assert.equal(response.isError, true);
  assert.deepEqual(response.structuredContent, {
    error: "Unknown tool: search_everything.",
    code: "unknown_tool",
    allowed: PUBLIC_TOOL_NAMES
  });
});

test("MCP tool annotations describe read, write, and destructive behavior", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });
  const tools = Object.fromEntries(response.tools.map((tool) => [tool.name, tool]));

  for (const tool of response.tools) {
    for (const key of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"]) {
      assert.equal(typeof tool.annotations?.[key], "boolean", `${tool.name} is missing annotations.${key}`);
    }
  }

  assert.equal(tools.dizko_search_events.annotations.readOnlyHint, true);
  assert.equal(tools.dizko_search_events.annotations.idempotentHint, true);
  assert.equal(tools.dizko_search_events.annotations.openWorldHint, false);
  assert.equal(tools.dizko_create_profile.annotations.readOnlyHint, false);
  assert.equal(tools.dizko_create_profile.annotations.destructiveHint, false);
  assert.equal(tools.dizko_create_profile.annotations.openWorldHint, false);
  assert.equal(tools.dizko_record_feedback.annotations.readOnlyHint, false);
  assert.equal(tools.dizko_record_feedback.annotations.openWorldHint, false);
  assert.equal(tools.dizko_delete_profile.annotations.destructiveHint, true);
  assert.equal(tools.dizko_delete_profile.annotations.readOnlyHint, false);
  assert.equal(tools.dizko_delete_profile.annotations.openWorldHint, false);
  assert.equal(tools.dizko_ticket_offers.annotations.readOnlyHint, true);
  assert.equal(tools.dizko_quote_tickets.annotations.readOnlyHint, true);
  assert.equal(tools.dizko_quote_tickets.annotations.idempotentHint, false);
  assert.equal(tools.dizko_purchase_tickets.annotations.readOnlyHint, false);
  assert.equal(tools.dizko_purchase_tickets.annotations.destructiveHint, true);
  assert.equal(tools.dizko_purchase_tickets.annotations.openWorldHint, true);
});

test("MCP tool metadata is review-friendly", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });

  for (const tool of response.tools) {
    assert.equal(typeof tool.title, "string", `${tool.name} is missing a title`);
    assert.ok(tool.title.length > 0, `${tool.name} has an empty title`);
    assert.ok(tool.description.length >= 60, `${tool.name} description should explain routing, inputs and output`);
    assert.equal(typeof tool.inputSchema, "object", `${tool.name} is missing inputSchema`);
    assert.equal(tool.outputSchema, undefined, `${tool.name} should omit redundant outputSchema`);
    assert.deepEqual(tool.securitySchemes, [{ type: "noauth" }], `${tool.name} should advertise noauth securitySchemes`);
    assert.deepEqual(tool._meta?.securitySchemes, [{ type: "noauth" }], `${tool.name} should mirror noauth securitySchemes in _meta`);
    const invoking = tool._meta?.["openai/toolInvocation/invoking"];
    const invoked = tool._meta?.["openai/toolInvocation/invoked"];
    assert.equal(typeof invoking, "string", `${tool.name} should define invoking status text`);
    assert.equal(typeof invoked, "string", `${tool.name} should define invoked status text`);
    assert.ok(invoking.length <= 64, `${tool.name} invoking status is too long`);
    assert.ok(invoked.length <= 64, `${tool.name} invoked status is too long`);
    assert.notEqual(invoking, "Working", `${tool.name} should carry a tool-specific invoking label`);
    assert.notEqual(invoked, "Ready", `${tool.name} should carry a tool-specific invoked label`);
  }

  const search = response.tools.find((tool) => tool.name === "dizko_search_events");
  assert.equal(search._meta["openai/toolInvocation/invoking"], "Searching live events");
  assert.equal(search._meta["openai/toolInvocation/invoked"], "Live events found");
});

test("MCP tool list carries full parameter docs within budget while preserving input contracts", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });
  const tools = Object.fromEntries(response.tools.map((tool) => [tool.name, tool]));

  // 0.8.0 serves full descriptions and defaults on every parameter (about
  // 32 KB). Keep it under 48 KB so a client can list without pagination.
  assert.ok(Buffer.byteLength(JSON.stringify(response)) < 48_000);

  const search = tools.dizko_search_events.inputSchema;
  for (const [name, property] of Object.entries(search.properties)) {
    assert.equal(typeof property.description, "string", `dizko_search_events.${name} needs a description`);
    assert.ok(property.description.length > 0, `dizko_search_events.${name} has an empty description`);
  }
  assert.equal(search.properties.limit.default, 12);
  assert.equal(search.properties.offset.default, 0);
  assert.deepEqual(search.properties.sort_by.enum, SORT_OPTIONS);
  assert.deepEqual(search.properties.rank.enum, ["relevance", "taste"]);
  assert.deepEqual(search.dependentRequired.profile_id, ["profile_secret"]);

  assert.equal(tools.dizko_find_promoter.inputSchema.properties.kind.enum.includes("promoter"), true);
  assert.equal(tools.dizko_find_promoter.inputSchema.properties.kind.enum.includes("collective"), true);
  assert.ok(tools.dizko_find_artist.inputSchema.anyOf.some((branch) => branch.required.includes("query")));
  assert.ok(tools.dizko_find_artist.inputSchema.anyOf.some((branch) => branch.required.includes("id")));
  assert.equal(tools.dizko_plan_night.inputSchema.properties.profile_id.type, "string");
  assert.deepEqual(tools.dizko_plan_night.inputSchema.dependentRequired.profile_id, ["profile_secret"]);
  assert.equal(tools.dizko_create_profile.inputSchema.properties.preferences.$ref, "#/$defs/preferences");
  assert.equal(tools.dizko_create_profile.inputSchema.$defs.preferences.properties.day_filters.additionalProperties.$ref, "#/$defs/dayPreference");
  assert.ok(tools.dizko_record_feedback.inputSchema.anyOf.some((branch) => branch.required.includes("liked")));
  assert.ok(tools.dizko_record_feedback.inputSchema.anyOf.some((branch) => branch.required.includes("rating")));
  assert.ok(tools.dizko_record_feedback.inputSchema.anyOf.some((branch) => branch.required.includes("notes")));
  assert.equal(tools.dizko_delete_profile.inputSchema.properties.confirm_delete.type, "boolean");
  assert.ok(tools.dizko_delete_profile.inputSchema.required.includes("confirm_delete"));
  assert.ok(tools.dizko_purchase_tickets.inputSchema.required.includes("confirmation_text"));
});

test("MCP lists and serves prompts", async () => {
  const list = await handleMcpRequest({ method: "prompts/list" });
  assert.equal(list.resultType, "complete");
  assert.deepEqual(list.prompts.map((prompt) => prompt.name), [
    "dizko_onboarding",
    "dizko_search_followups",
    "dizko_post_event_feedback",
    "dizko_ticket_policy"
  ]);
  for (const prompt of list.prompts) {
    assert.ok(prompt.description.length > 0, `${prompt.name} needs a description`);
    assert.ok(Array.isArray(prompt.arguments), `${prompt.name} needs an arguments array`);
  }
  const feedback = list.prompts.find((prompt) => prompt.name === "dizko_post_event_feedback");
  assert.deepEqual(feedback.arguments.map((argument) => [argument.name, argument.required]), [["event_id", true]]);

  const onboarding = await handleMcpRequest({ method: "prompts/get", params: { name: "dizko_onboarding" } });
  assert.equal(onboarding.resultType, "complete");
  assert.match(onboarding.description, /dizko_create_profile with consent=true/);
  assert.equal(onboarding.messages.length, 1);
  assert.equal(onboarding.messages[0].role, "user");
  assert.equal(onboarding.messages[0].content.type, "text");
  assert.match(onboarding.messages[0].content.text, /1\. /);
  assert.match(onboarding.messages[0].content.text, /profile_id and profile_secret/);

  const policy = await handleMcpRequest({ method: "prompts/get", params: { name: "dizko_ticket_policy" } });
  assert.match(policy.messages[0].content.text, /Autonomous purchase available on this server: no/);

  const unknown = await handleMcpRequest({ method: "prompts/get", params: { name: "dizko_missing" } })
    .then(() => null, (error) => error);
  assert.equal(unknown?.name, "ToolInputError");
  assert.equal(unknown?.field, "name");
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
    error: "id is required.",
    code: "invalid_argument",
    field: "id",
    hint: "Fix the argument and call dizko_get_event again."
  });
});

test("MCP coerces model-friendly argument shapes and rejects the rest before fetching", async () => {
  const requested = [];
  const options = {
    config: { ...TEST_CONFIG, apiCacheTtlMs: 0 },
    now: new Date("2026-09-08T12:00:00Z"),
    fetch: async (url) => {
      requested.push(new URL(url));
      return Response.json({ count: 0, events: [] });
    }
  };

  const coerced = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin", limit: "5", genres: "techno,house", free: "true" } }
  }, options);
  assert.equal(coerced.isError, false);
  assert.equal(requested[0].searchParams.get("limit"), "5");
  assert.deepEqual(requested[0].searchParams.getAll("genres"), ["techno", "house"]);
  assert.equal(requested[0].searchParams.get("free"), "true");
  // The fixture returns nothing, so the empty-result path also probes the
  // unfiltered baseline to tell the model why. That is the only extra call.
  assert.equal(requested.length, 2);
  assert.deepEqual(requested[1].searchParams.getAll("genres"), []);

  const rejected = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin", limit: "many" } }
  }, options);
  assert.equal(rejected.isError, true);
  assert.equal(requested.length, 2, "invalid input must not reach the upstream");
  assert.deepEqual(rejected.structuredContent, {
    error: "limit must be a whole number.",
    code: "invalid_argument",
    field: "limit",
    hint: "Fix the argument and call dizko_search_events again."
  });

  const scopeless = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: {} }
  }, options);
  assert.equal(scopeless.isError, true);
  assert.equal(requested.length, 2, "a scopeless call must not reach the upstream either");
  assert.equal(scopeless.structuredContent.code, "invalid_argument");
  assert.equal(scopeless.structuredContent.field, "city");
  assert.match(scopeless.structuredContent.hint, /dizko_list_cities/);
});

test("MCP resolves weekday presets in city time and rejects unknown `when` values", async () => {
  const requested = [];
  const options = {
    config: { ...TEST_CONFIG, apiCacheTtlMs: 0 },
    // A Tuesday: "friday" must land on 2026-09-11.
    now: new Date("2026-09-08T12:00:00Z"),
    fetch: async (url) => {
      requested.push(new URL(url));
      return Response.json({ count: 0, events: [] });
    }
  };

  const friday = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin", when: "friday" } }
  }, options);
  assert.equal(friday.isError, false);
  assert.equal(requested[0].searchParams.get("date_from"), "2026-09-11");
  assert.equal(requested[0].searchParams.get("date_to"), "2026-09-11");
  assert.equal(requested[0].searchParams.get("sort_by"), "soonest", "single-day requests default to soonest");
  assert.equal(friday.structuredContent.sort_by, "soonest");

  const someday = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin", when: "someday" } }
  }, options);
  assert.equal(someday.isError, true);
  assert.equal(requested.length, 1, "an unsupported preset must not reach the upstream");
  assert.equal(someday.structuredContent.code, "invalid_argument");
  assert.equal(someday.structuredContent.field, "when");
  assert.match(someday.structuredContent.error, /Unsupported "when" value: "someday"/);
  assert.deepEqual(someday.structuredContent.allowed, WHEN_PRESETS);
  assert.match(someday.structuredContent.hint, /date_from and date_to/);
});

test("MCP lists covered cities with status, timezone, live counts and freshness", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_list_cities", arguments: {} }
  }, {
    config: TEST_CONFIG,
    fetch: async () => Response.json({
      live: [
        { slug: "london", name: "London", country: "United Kingdom", event_count: 456, last_scraped_at: "2026-08-24T09:00:00Z", stale: true },
        { slug: "berlin", name: "Berlin", country: "Germany", event_count: 321, last_scraped_at: "2026-08-24T08:00:00Z", stale: false }
      ],
      unlocking: [{ slug: "lisbon", name: "Lisbon", country: "Portugal", event_count: 40, last_scraped_at: "2026-08-24T07:00:00Z", stale: false }],
      early: [{ slug: "athens", event_count: 3 }]
    })
  });

  assert.equal(response.isError, false);
  assert.equal(response.structuredContent.count, 4);
  assert.equal(response.structuredContent.live_count, 2);
  // Live first, then alphabetical inside each status bucket.
  assert.deepEqual(response.structuredContent.cities.map((city) => [city.slug, city.status]), [
    ["berlin", "live"],
    ["london", "live"],
    ["lisbon", "unlocking"],
    ["athens", "early"]
  ]);
  assert.deepEqual(response.structuredContent.cities[0], {
    slug: "berlin",
    name: "Berlin",
    country: "Germany",
    status: "live",
    timezone: "Europe/Berlin",
    event_count: 321,
    freshness: "fresh",
    last_successful_fetch: "2026-08-24T08:00:00Z"
  });
  assert.equal(response.structuredContent.cities[1].freshness, "stale");
  // Sparse upstream rows are filled from the static city table.
  assert.deepEqual(response.structuredContent.cities[3], {
    slug: "athens",
    name: "Athens",
    country: "Greece",
    status: "early",
    timezone: "Europe/Athens",
    event_count: 3,
    freshness: "fresh",
    last_successful_fetch: null
  });
  assert.match(response.structuredContent.assistant_instruction, /Unlocking and early cities/);
});

test("unsupported cities return honest nearest coverage instead of an outage", async () => {
  const options = {
    config: TEST_CONFIG,
    retries: 0,
    fetch: async (url) => String(url).endsWith("/cities")
      ? Response.json({
        live: [{ slug: "london", name: "London", country: "United Kingdom", event_count: 456, last_scraped_at: "2026-08-24T08:00:00Z", stale: false }],
        unlocking: [{ slug: "dublin", name: "Dublin", country: "Ireland", event_count: 12, last_scraped_at: "2026-08-24T08:00:00Z", stale: false }]
      })
      : Response.json({ error: "Unsupported city" }, { status: 422 })
  };

  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "Bristol" } }
  }, options);

  assert.equal(response.isError, true);
  assert.equal(response.structuredContent.error, "Bristol is not covered by Dizko yet.");
  assert.equal(response.structuredContent.code, "unsupported_city");
  assert.equal(response.structuredContent.field, "city");
  assert.equal(response.structuredContent.requested_city, "Bristol");
  const nearest = response.structuredContent.nearest_covered_city;
  assert.equal(nearest.slug, "london");
  assert.equal(nearest.name, "London");
  assert.equal(nearest.status, "live");
  assert.equal(nearest.event_count, 456);
  assert.equal(nearest.timezone, "Europe/London");
  assert.equal(nearest.distance_km, 170);
  assert.match(response.structuredContent.assistant_instruction, /not covered/);
  assert.match(response.structuredContent.assistant_instruction, /London, 170 km away/);
  assert.doesNotMatch(JSON.stringify(response), /unavailable|outage/i);

  // Nothing live within 700 km: nearest_covered_city is null, not a guess.
  const far = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "Nairobi" } }
  }, options);
  assert.equal(far.isError, true);
  assert.equal(far.structuredContent.code, "unsupported_city");
  assert.equal(far.structuredContent.nearest_covered_city, null);
  assert.match(far.structuredContent.assistant_instruction, /dizko_list_cities/);
  assert.doesNotMatch(JSON.stringify(far), /unavailable|outage/i);
});

test("MCP legacy get_event_search_followups still asks for missing event type and vibe", async () => {
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
  assert.match(response.structuredContent.assistant_instruction, /dizko_search_events/);
});

test("MCP legacy get_event_feedback_prompt returns questions for post-event learning", async () => {
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

  assert.equal(response.isError, false);
  assert.equal(response.structuredContent.event.title, "Basement Night");
  // No venue_city on the upstream row, so local time stays UTC and says so.
  assert.equal(response.structuredContent.event.when, "Tue 9 Jun, 22:00");
  assert.equal(response.structuredContent.event.timezone, "UTC");
  assert.equal(response.structuredContent.event.venue, "RSO.BERLIN");
  assert.equal(response.structuredContent.attended_at, "2026-06-09");
  assert.ok(response.structuredContent.questions.some((question) => question.includes("Did you like")));
  assert.match(response.structuredContent.assistant_instruction, /dizko_record_feedback/);
});

test("MCP dizko_search_events returns compact event summaries and opt-in fields", async () => {
  const options = {
    config: TEST_CONFIG,
    fetch: async () => Response.json({
      count: 1,
      events: [{
        id: "1",
        title: "Night One",
        start_time: "2026-09-12T21:59:00Z",
        end_time: "2026-09-13T04:00:00Z",
        venue_name: "Berghain",
        venue_address: "Am Wriezener Bahnhof",
        venue_city: "berlin",
        price_min: 20,
        price_max: 20,
        currency: "EUR",
        genres: ["techno"],
        vibe: [],
        event_types: ["party"],
        lineup: [],
        billing: [{ parts: [{ text: "23:00" }, { artist: "DJ A" }] }],
        ra_pick: true,
        price_trend: "selling_fast",
        sound_tags: ["dub techno"],
        promoters: [{ name: "Example Collective", slug: "example-collective" }],
        description: "Night One takes place at Berghain in Berlin on Saturday 12 September. Techno on the lineup.",
        image_url: "https://images.example.test/night-one.jpg",
        lat: 52.5,
        lng: 13.4,
        source: "resident_advisor"
      }]
    })
  };

  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin" } }
  }, options);

  assert.equal(response.isError, false);
  assert.equal(response.content[0].type, "text");
  assert.match(response.content[0].text, /Night One/);

  const body = response.structuredContent;
  assert.equal(body.city, "Berlin");
  assert.equal(body.timezone, "Europe/Berlin");
  assert.equal(body.rank, "relevance");
  assert.equal(body.count, 1);
  assert.equal(body.returned, 1);
  assert.equal(body.offset, 0);
  assert.equal(body.has_more, false);
  assert.equal(body.next_offset, null);
  assert.equal(body.search_fallback, null);
  assert.equal(body.app_download_url, "https://www.dizko.app/ios");
  assert.match(body.assistant_instruction, /render it verbatim/);

  const event = body.events[0];
  assert.equal(event.title, "Night One");
  assert.equal(event.when, "Sat 12 Sep, 23:59");
  assert.equal(event.starts_at, "2026-09-12T21:59:00Z");
  assert.equal(event.ends_at, "2026-09-13T04:00:00Z");
  assert.equal(event.starts_at_local, "2026-09-12T23:59:00+02:00");
  assert.equal(event.ends_at_local, "2026-09-13T06:00:00+02:00");
  assert.equal(event.timezone, "Europe/Berlin");
  assert.equal(event.venue, "Berghain");
  assert.equal(event.address, "Am Wriezener Bahnhof");
  assert.equal(event.city, "Berlin");
  assert.equal(event.city_slug, "berlin");
  assert.equal(event.price, "€20");
  assert.deepEqual(event.set_times, [{ artist: "DJ A", at: "23:00" }]);
  assert.equal(event.featured, true);
  assert.equal("pick" in event, false, "`pick` was replaced by `featured`");
  assert.deepEqual(event.promoters, ["Example Collective"], "promoters are names by default");
  assert.equal(event.event_url, "https://www.dizko.app/events/1");
  assert.equal(event.calendar_url, "https://mcp.dizko.app/e/1/cal");
  assert.equal(event.directions_url, "https://mcp.dizko.app/e/1/map");
  // Compact by default: no images, coordinates, source, currency, sound
  // tags or boilerplate description unless asked for. (price_trend is not
  // asserted here: src/format.js still emits it on compact summaries.)
  for (const key of ["sound_tags", "image_url", "lat", "lng", "source", "currency", "description"]) {
    assert.equal(key in event, false, `${key} should be omitted from the compact summary`);
  }

  const detailed = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin", fields: ["images", "coordinates"] } }
  }, options);
  const detailedEvent = detailed.structuredContent.events[0];
  assert.equal(detailedEvent.image_url, "https://images.example.test/night-one.jpg");
  assert.equal(detailedEvent.lat, 52.5);
  assert.equal(detailedEvent.lng, 13.4);
  assert.equal("source" in detailedEvent, false, "fields are opt-in one by one");
  assert.deepEqual(detailedEvent.promoters, ["Example Collective"]);

  const withPromoters = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin", fields: ["promoters", "source"] } }
  }, options);
  assert.deepEqual(withPromoters.structuredContent.events[0].promoters, [{ name: "Example Collective", slug: "example-collective" }]);
  assert.equal(withPromoters.structuredContent.events[0].source, "resident_advisor");
  assert.equal(withPromoters.structuredContent.events[0].currency, "EUR");
});

test("MCP dizko_search_events ranks by taste when asked", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin", when: "friday", genres: ["techno"], rank: "taste", limit: 1 } }
  }, {
    config: TEST_CONFIG,
    now: new Date("2026-09-08T12:00:00Z"),
    fetch: async () => Response.json({
      count: 2,
      events: [
        { id: "jazz", title: "Jazz Eve", start_time: "2026-09-11T19:00:00Z", venue_city: "berlin", genres: ["jazz"] },
        { id: "techno", title: "Techno Night", start_time: "2026-09-11T21:00:00Z", venue_city: "berlin", genres: ["techno"] }
      ]
    })
  });

  assert.equal(response.isError, false);
  const body = response.structuredContent;
  assert.equal(body.rank, "taste");
  assert.equal(body.city, "Berlin");
  assert.equal(body.count, 2);
  assert.equal(body.ranked_count, 2);
  assert.equal(body.returned, 1);
  // Taste re-ranks a candidate window, so there is no stable cursor: paging
  // it would re-score and repeat events. The keys are still present and
  // explicitly closed, so a client looping on has_more behaves the same in
  // both ranking modes instead of reading undefined.
  assert.equal(body.has_more, false, "taste mode ranks a page rather than paginating");
  assert.equal(body.next_offset, null);
  assert.match(body.paging_note, /raise limit/);
  assert.equal(body.events[0].id, "techno", "the genre match outranks upstream order");
  assert.equal(typeof body.events[0].recommendation_score, "number");
  assert.ok(body.events[0].recommendation_reasons.includes("genre match: techno"));
});

test("MCP dizko_get_event reports removed events as event_not_found", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_get_event", arguments: { id: "evt-gone" } }
  }, {
    config: TEST_CONFIG,
    retries: 0,
    fetch: async () => new Response("not found", { status: 404 })
  });

  assert.equal(response.isError, true);
  assert.deepEqual(response.structuredContent, {
    error: "The requested event was not found. It may have ended or been removed.",
    code: "event_not_found"
  });
});

test("MCP search returns structured tool errors for slow upstream calls", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin" } }
  }, {
    config: { ...TEST_CONFIG, apiTimeoutMs: 5 },
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
    code: "upstream_timeout",
    retryable: true
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
    params: { name: "dizko_ticket_offers", arguments: { event_id: "event-1" } }
  }, options);

  assert.equal(offers.isError, false);
  assert.equal(offers.structuredContent.count, 1);
  assert.equal(offers.structuredContent.offers[0].provider, "resident_advisor");
  assert.equal(offers.structuredContent.offers[0].purchase_mode, "external_checkout");
  assert.equal(offers.structuredContent.offers[0].autonomous_purchase_supported, false);
  assert.equal(offers.structuredContent.offers[0].estimated_price, "$100");
  assert.ok(offers.structuredContent.policy.supported_modes.includes("dizko_checkout"));
  assert.equal(offers.structuredContent.policy.supported_modes.includes("uplayground_checkout"), false);
  assert.equal(offers.structuredContent.event.when, "Sat 13 Jun, 06:00");

  const quote = await handleMcpRequest({
    method: "tools/call",
    params: {
      name: "dizko_quote_tickets",
      arguments: {
        event_id: "event-1",
        quantity: 2,
        ticket_type: "GA",
        max_total: 240,
        currency: "USD"
      }
    }
  }, options);

  assert.equal(quote.isError, false);
  assert.equal(quote.structuredContent.quoted, true);
  assert.equal(quote.structuredContent.quote.quantity, 2);
  assert.equal(quote.structuredContent.quote.max_total, 240);
  assert.match(quote.structuredContent.quote_token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "quote_token is payload.signature");
  assert.match(quote.structuredContent.confirmation_prompt, /Yes, buy 2 ticket/);
  assert.match(quote.structuredContent.assistant_instruction, /dizko_purchase_tickets/);

  const purchase = await handleMcpRequest({
    method: "tools/call",
    params: {
      name: "dizko_purchase_tickets",
      arguments: {
        quote_token: quote.structuredContent.quote_token,
        confirmation_text: "Yes, buy 2 tickets for Ostbahnhof XL, max total USD240. Stop if price, date, venue, ticket type, quantity, or refund terms change."
      }
    }
  }, options);

  assert.equal(purchase.isError, false);
  assert.equal(purchase.structuredContent.purchased, false);
  assert.equal(purchase.structuredContent.status, "requires_external_checkout");
  assert.equal(purchase.structuredContent.checkout_url, "https://ra.co/events/2339406");
  assert.match(purchase.structuredContent.assistant_instruction, /do not claim the agent bought/);

  // A token edited between quote and purchase fails the signature check.
  const [payload, signature] = quote.structuredContent.quote_token.split(".");
  const tampered = await handleMcpRequest({
    method: "tools/call",
    params: {
      name: "dizko_purchase_tickets",
      arguments: {
        quote_token: `${payload.slice(0, -2)}AA.${signature}`,
        confirmation_text: "Yes, buy 2 tickets, max total 240."
      }
    }
  }, options);
  assert.equal(tampered.isError, true);
  assert.equal(tampered.structuredContent.code, "invalid_quote_token");
  assert.equal(tampered.structuredContent.field, "quote_token");
  assert.match(tampered.structuredContent.error, /invalid, altered/);
});

test("MCP legacy ticket names reject vague confirmation with the missing pieces", async () => {
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
  assert.equal(quote.isError, false);
  assert.equal(quote.structuredContent.quoted, true);

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
  assert.equal(purchase.structuredContent.code, "confirmation_mismatch");
  assert.match(purchase.structuredContent.error, /buy or purchase/);
  assert.deepEqual(purchase.structuredContent.missing, ["the word buy or purchase", "the quantity 2", "the max total 80"]);
  assert.match(purchase.structuredContent.confirmation_prompt, /Yes, buy 2 ticket/);
});

test("MCP dizko_purchase_tickets sanitizes failed provider responses", async () => {
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
    now: new Date("2026-06-10T12:00:00Z"),
    ticketPurchaseProvider: {
      canPurchase: () => true,
      purchase: async () => ({
        purchased: false,
        status: "https://backend-production-958d.up.railway.app failed",
        receipt_url: "https://backend-production-958d.up.railway.app/debug",
        provider_response: { error: "Traceback: private upstream body" }
      })
    }
  };
  const quote = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_quote_tickets", arguments: { event_id: "event-1", quantity: 1 } }
  }, options);

  const purchase = await handleMcpRequest({
    method: "tools/call",
    params: {
      name: "dizko_purchase_tickets",
      arguments: {
        quote_token: quote.structuredContent.quote_token,
        confirmation_text: "Yes, buy 1 ticket for Club Night."
      }
    }
  }, options);

  assert.equal(purchase.structuredContent.purchased, false);
  assert.equal(purchase.structuredContent.status, "purchase_failed");
  assert.equal(purchase.structuredContent.error, "Ticket purchase could not be completed.");
  assert.doesNotMatch(JSON.stringify(purchase), /backend-production-958d|railway\.app|traceback|private upstream body/i);
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
  assert.equal(typeof discover.result.capabilities.prompts, "object");

  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: { _meta: MODERN_META }
  })}\n`);

  const list = await nextMessage(lines);
  assert.equal(list.result.resultType, "complete");
  assert.ok(list.result.tools.some((tool) => tool.name === "dizko_search_events"));
  assert.equal(list.result.tools.some((tool) => tool.name === "search_events"), false);

  input.write(`${JSON.stringify({
    jsonrpc: "2.0",
    id: 3,
    method: "prompts/list",
    params: { _meta: MODERN_META }
  })}\n`);

  const prompts = await nextMessage(lines);
  assert.ok(prompts.result.prompts.some((prompt) => prompt.name === "dizko_onboarding"));

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

test("MCP search sanitizes retryable DNS failures", async () => {
  const dnsError = new TypeError("fetch failed");
  dnsError.cause = Object.assign(new Error("getaddrinfo EAI_AGAIN backend.example.test"), {
    code: "EAI_AGAIN",
    syscall: "getaddrinfo",
    hostname: "backend.example.test"
  });

  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "los angeles", when: "week", limit: 1 } }
  }, {
    config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
    retries: 1,
    sleep: async () => {},
    fetch: async () => { throw dnsError; }
  });

  assert.equal(response.isError, true);
  assert.deepEqual(response.structuredContent, {
    error: "The event service is temporarily unavailable. Try again shortly.",
    code: "upstream_unavailable",
    retryable: true
  });
});

test("MCP search sanitizes retryable HTTP 5xx errors", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin", when: "week", limit: 1 } }
  }, {
    config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
    retries: 0,
    fetch: async () => new Response("upstream exploded", { status: 503 })
  });

  assert.equal(response.isError, true);
  assert.deepEqual(response.structuredContent, {
    error: "The event service is temporarily unavailable. Try again shortly.",
    code: "upstream_unavailable",
    retryable: true
  });
});

test("MCP error responses never expose upstream hosts, URLs, or causes", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "dizko_search_events", arguments: { city: "berlin", limit: 1 } }
  }, {
    config: {
      apiBaseUrl: "https://backend-production-958d.up.railway.app",
      userAgent: "test"
    },
    retries: 0,
    fetch: async () => new Response("Traceback: private stack detail", { status: 503 })
  });

  assert.equal(response.isError, true);
  assert.deepEqual(Object.keys(response.structuredContent).sort(), ["code", "error", "retryable"]);
  assert.equal(response.structuredContent.retryable, true);
  const serialized = JSON.stringify(response);
  assert.doesNotMatch(serialized, /backend-production-958d/i);
  assert.doesNotMatch(serialized, /railway\.app/i);
  assert.doesNotMatch(serialized, /https?:\/\//i);
  assert.doesNotMatch(serialized, /traceback|stack detail/i);
});
