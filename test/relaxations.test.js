import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { baselineSearchInput, buildNoResults, describeFilters, hasNarrowingFilters } from "../src/relaxations.js";
import { callTool } from "../src/tools.js";
import { clearEventCache } from "../src/api.js";

const CONFIG = { apiBaseUrl: "https://api.example.test", userAgent: "test" };

beforeEach(() => clearEventCache());

test("describeFilters reports only the narrowing arguments the caller sent", () => {
  const active = describeFilters({
    city: "berlin",
    when: "weekend",
    limit: 12,
    offset: 0,
    genres: ["techno"],
    vibe: [],
    price_max: 20,
    free: false,
    venue: "Berghain",
    avoid: ["mainstream"]
  });

  assert.deepEqual(active, [
    { key: "genres", values: ["techno"] },
    { key: "venue", values: ["Berghain"] },
    { key: "price_max", values: [20] }
  ]);
  // city, when, limit and offset scope a search; they do not narrow it.
  // `avoid` only penalizes in ranking, so it can never empty a result set.
  assert.equal(hasNarrowingFilters({ city: "berlin", when: "weekend", avoid: ["mainstream"] }), false);
  assert.equal(hasNarrowingFilters({ city: "berlin", genres: ["techno"] }), true);
});

test("baselineSearchInput keeps the scope and drops every filter", () => {
  assert.deepEqual(baselineSearchInput({
    city: "berlin",
    when: "tonight",
    genres: ["techno"],
    price_max: 5,
    venue: "Tresor",
    limit: 50
  }), { city: "berlin", when: "tonight", date_from: undefined, date_to: undefined, limit: 1 });
});

test("a filtered-out search names the blocking filters and offers retry arguments", () => {
  const input = { city: "berlin", when: "tonight", genres: ["techno"], vibe: ["seated"], price_max: 5 };
  const result = buildNoResults(input, { baselineCount: 132, cityName: "Berlin" });

  assert.equal(result.reason, "filters_too_narrow");
  assert.equal(result.baseline_count, 132);
  assert.deepEqual(result.active_filters.map((item) => item.filter), ["genres", "vibe", "price_max"]);

  // Price leads: a cap silently excludes every event with no published price.
  assert.equal(result.suggested_relaxations[0].relax, "price_max");
  assert.match(result.suggested_relaxations[0].why, /price is not published/);
  assert.deepEqual(result.suggested_relaxations[0].retry_with, {
    city: "berlin",
    when: "tonight",
    genres: ["techno"],
    vibe: ["seated"]
  });

  // Every suggestion is a directly callable argument set, never prose.
  for (const suggestion of result.suggested_relaxations) {
    assert.equal(suggestion.retry_with.city, "berlin");
    assert.equal(suggestion.retry_with.when, "tonight");
  }

  // The last one clears all of them at once, because dropping a single
  // filter is often not enough when three are combined.
  const combined = result.suggested_relaxations.at(-1);
  assert.equal(combined.relax, "genres + vibe + price_max");
  assert.deepEqual(combined.retry_with, { city: "berlin", when: "tonight" });

  assert.match(result.assistant_instruction, /132 other events/);
  assert.match(result.assistant_instruction, /Never invent events/);
  assert.doesNotMatch(result.assistant_instruction, /nothing on\b(?!.)/);
});

test("an empty timeframe is reported as no inventory, not as bad filters", () => {
  const result = buildNoResults({ city: "berlin", when: "2027-12-25", genres: ["techno"] }, { baselineCount: 0, cityName: "Berlin" });

  assert.equal(result.reason, "empty_timeframe");
  assert.equal(result.suggested_relaxations.at(-1).relax, "when");
  assert.match(result.assistant_instruction, /nothing listed in Berlin/);
  assert.match(result.assistant_instruction, /dizko_list_cities/);
  assert.doesNotMatch(result.assistant_instruction, /other events are listed/);
});

test("an unfiltered search that returns nothing suggests widening the timeframe", () => {
  const result = buildNoResults({ city: "berlin", when: "tonight" }, { baselineCount: 0, cityName: "Berlin" });

  assert.equal(result.reason, "empty_timeframe");
  assert.deepEqual(result.active_filters, []);
  assert.equal(result.suggested_relaxations.at(-1).retry_with.when, "week");
});

test("profile credentials never leak into the retry arguments", () => {
  const result = buildNoResults({
    city: "berlin",
    when: "tonight",
    genres: ["techno"],
    profile_id: "dzk_secret-id",
    profile_secret: "dzs_secret-value"
  }, { baselineCount: 40, cityName: "Berlin" });

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /dzs_secret-value/);
  assert.doesNotMatch(serialized, /dzk_secret-id/);
});

test("dizko_search_events attaches no_results with a live baseline count", async () => {
  const urls = [];
  const response = await callTool("dizko_search_events", {
    city: "berlin",
    when: "tomorrow",
    genres: ["polka"],
    price_max: 5
  }, {
    config: CONFIG,
    now: new Date("2026-09-08T12:00:00Z"),
    fetch: async (url) => {
      urls.push(String(url));
      // The filtered search is empty; the baseline probe is not.
      const filtered = String(url).includes("genres=polka");
      return Response.json(filtered ? { count: 0, events: [] } : { count: 88, events: [] });
    }
  });

  assert.equal(response.isError, false);
  const body = response.structuredContent;
  assert.equal(body.count, 0);
  assert.equal(body.no_results.reason, "filters_too_narrow");
  assert.equal(body.no_results.baseline_count, 88);
  assert.equal(body.no_results.suggested_relaxations[0].relax, "price_max");
  // The empty-list response must not still tell the model to render events.
  assert.equal(body.assistant_instruction, body.no_results.assistant_instruction);
  assert.doesNotMatch(body.assistant_instruction, /markdown list/);

  // Exactly one extra upstream call, and it drops the filters.
  assert.equal(urls.length, 2);
  assert.match(urls[1], /city=berlin/);
  assert.doesNotMatch(urls[1], /genres=/);
  assert.doesNotMatch(urls[1], /price_max=/);
});

test("a successful search carries no no_results block and keeps the render template", async () => {
  const response = await callTool("dizko_search_events", { city: "berlin", when: "tomorrow" }, {
    config: CONFIG,
    now: new Date("2026-09-08T12:00:00Z"),
    fetch: async () => Response.json({
      count: 1,
      events: [{ id: "e1", title: "Klubnacht", start_time: "2026-09-09T21:00:00+00:00", venue_name: "Berghain", venue_city: "berlin" }]
    })
  });

  const body = response.structuredContent;
  assert.equal(body.no_results, undefined);
  assert.match(body.assistant_instruction, /markdown list/);
});

test("dizko_plan_night explains an empty plan instead of returning bare events", async () => {
  const response = await callTool("dizko_plan_night", {
    city: "berlin",
    when: "tomorrow",
    genres: ["polka"]
  }, {
    config: CONFIG,
    now: new Date("2026-09-08T12:00:00Z"),
    fetch: async (url) => Response.json(String(url).includes("genres=polka")
      ? { count: 0, events: [] }
      : { count: 51, events: [] })
  });

  const body = response.structuredContent;
  assert.deepEqual(body.events, []);
  assert.equal(body.no_results.baseline_count, 51);
  assert.equal(body.no_results.suggested_relaxations[0].relax, "genres");
  assert.match(body.assistant_instruction, /51 other events/);
});

test("the baseline probe failing still yields suggestions", async () => {
  const response = await callTool("dizko_search_events", {
    city: "berlin",
    when: "tomorrow",
    venue: "Nowhere"
  }, {
    config: CONFIG,
    now: new Date("2026-09-08T12:00:00Z"),
    retries: 0,
    fetch: async (url) => String(url).includes("venue=")
      ? Response.json({ count: 0, events: [] })
      : new Response("upstream down", { status: 503 })
  });

  const body = response.structuredContent;
  assert.equal(body.no_results.baseline_count, null);
  assert.equal(body.no_results.suggested_relaxations[0].relax, "venue");
  assert.doesNotMatch(body.no_results.assistant_instruction, /null/);
});
