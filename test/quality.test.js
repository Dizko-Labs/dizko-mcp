import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { buildCalendarEvent } from "../src/calendar.js";
import { MCP_SERVER_INSTRUCTIONS } from "../src/config.js";
import { MCP_ATTRIBUTION, summarizeEvent, withMcpAttribution } from "../src/format.js";
import { buildPlan } from "../src/planner.js";
import {
  QUALITY_INSTRUCTION,
  assessCurrency,
  assessEndTime,
  cityCurrency,
  collapseNearDuplicates,
  isNearDuplicate,
  qualityFlags,
  withQualityNote
} from "../src/quality.js";
import { rankEvents } from "../src/rank.js";
import { buildTicketOffers, quoteTicketOrder } from "../src/tickets.js";
import { callTool, tools } from "../src/tools.js";
import { surfaceTools } from "../src/surfaces.js";

beforeEach(() => clearEventCache());

const TEST_CONFIG = { apiBaseUrl: "https://api.example.test", userAgent: "test" };
const NOW = new Date("2026-10-08T06:00:00Z");

function goaEvent(overrides = {}) {
  return {
    id: "goa-1",
    title: "Sunset Sessions",
    start_time: "2026-10-09T14:30:00+00:00",
    end_time: "2026-10-09T18:30:00+00:00",
    venue_name: "Thalassa",
    venue_city: "goa",
    source: "whatsupgoa",
    currency: "INR",
    price_min: 1500,
    price_max: 1500,
    ...overrides
  };
}

function eventsFetch(events) {
  return async () => Response.json({ count: events.length, events });
}

// ---------------------------------------------------------------------------
// Goa is a covered city, so its listings render in India time
// ---------------------------------------------------------------------------

test("Goa renders in Asia/Kolkata, not UTC", () => {
  const summary = summarizeEvent(goaEvent(), { env: {} });
  assert.equal(summary.timezone, "Asia/Kolkata");
  assert.equal(summary.when, "Fri 9 Oct, 20:00", "14:30 UTC is 20:00 in Goa");
  assert.equal(summary.starts_at_local, "2026-10-09T20:00:00+05:30");
  assert.equal(cityCurrency("goa"), "INR");
  assert.equal(cityCurrency("Panjim"), "INR", "local spellings resolve to Goa");
});

// ---------------------------------------------------------------------------
// 1. Currency sanity
// ---------------------------------------------------------------------------

test("a EUR price on an Indian event is shown without the wrong symbol and flagged", () => {
  const summary = summarizeEvent(goaEvent({ currency: "EUR", price_min: 500, price_max: 500 }), { env: {} });
  assert.equal(summary.price, "500 (currency unconfirmed)");
  assert.equal(summary.currency, undefined, "an unverified code is never asserted");
  assert.equal(summary.currency_status, "unverified");
  assert.ok(summary.quality_flags.includes("currency_unverified"));
  assert.equal(summary.price_min, 500, "the raw number stays available");

  const range = summarizeEvent(goaEvent({ currency: "EUR", price_min: 499, price_max: 999 }), { env: {} });
  assert.equal(range.price, "499-999 (currency unconfirmed)");
  assert.doesNotMatch(range.price, /€|EUR/);
});

test("the city currency is used only when the backend says the code was inferred", () => {
  const inferred = summarizeEvent(goaEvent({ currency: "EUR", currency_inferred: true, price_min: 500, price_max: 500 }), { env: {} });
  assert.equal(inferred.price, "INR 500");
  assert.equal(inferred.currency, "INR");
  assert.equal(inferred.currency_status, "inferred");
  assert.ok(inferred.quality_flags.includes("currency_inferred"));

  const bySource = assessCurrency(goaEvent({ currency: "EUR", currency_source: "city_default" }));
  assert.deepEqual(bySource, { currency: "INR", status: "inferred", flag: "currency_inferred" });
});

test("a matching currency, a free event and an unknown city are left alone", () => {
  const inr = summarizeEvent(goaEvent(), { env: {} });
  assert.equal(inr.price, "INR 1500");
  assert.equal(inr.currency, "INR");
  assert.equal(inr.currency_status, undefined);
  assert.equal(inr.quality_flags, undefined, "a clean listing carries no flags");

  const free = summarizeEvent(goaEvent({ currency: "EUR", price_min: 0, price_max: 0 }), { env: {} });
  assert.equal(free.price, "free", "free needs no currency");

  const unpriced = summarizeEvent(goaEvent({ currency: "EUR", price_min: null, price_max: null }), { env: {} });
  assert.equal(unpriced.currency, undefined, "a mismatched code is still not asserted");
  assert.equal(unpriced.quality_flags, undefined, "but with no amount there is nothing to flag");

  const unknownCity = summarizeEvent(goaEvent({ venue_city: "atlantis", currency: "EUR", price_min: 20, price_max: 20 }), { env: {} });
  assert.equal(unknownCity.price, "€20", "no city country, nothing to disagree with");
});

test("ticket offers and quotes do not carry an unverified currency forward", () => {
  const event = goaEvent({ currency: "EUR", price_min: 500, price_max: 500, ticket_url: "https://partyhunt.example/qilla" });
  const offers = buildTicketOffers(event, { env: {} });
  assert.equal(offers.offers[0].currency, null);
  assert.equal(offers.offers[0].estimated_price, "500 (currency unconfirmed)");
  const quoted = quoteTicketOrder(event, { quantity: 2, max_total: 1000 }, { env: {}, now: NOW, quoteSigningSecret: "s" });
  assert.equal(quoted.quote.currency, null);
  assert.doesNotMatch(quoted.confirmation_prompt, /EUR/);
});

// ---------------------------------------------------------------------------
// 2. Near-duplicate guard (the Qilla case)
// ---------------------------------------------------------------------------

// Goa, Fri 9 Oct 2026: one party at Qilla listed by two sources with start
// times an hour apart.
const QILLA_A = goaEvent({
  id: "qilla-whatsupgoa",
  title: "Friday Night at Qilla",
  venue_name: "Qilla",
  source: "whatsupgoa",
  start_time: "2026-10-09T15:30:00+00:00",
  end_time: null,
  lat: 15.6028,
  lng: 73.7356,
  lineup: []
});
const QILLA_B = goaEvent({
  id: "qilla-partyhunt",
  title: "Qilla Fridays ft. DJ Nyx",
  venue_name: "Qilla Goa, Vagator",
  source: "partyhunt",
  start_time: "2026-10-09T16:30:00+00:00",
  end_time: "2026-10-09T21:30:00+00:00",
  lat: 15.6031,
  lng: 73.7359,
  lineup: ["DJ Nyx"],
  ticket_url: "https://partyhunt.example/qilla"
});

test("the Qilla party listed twice an hour apart collapses to the better listing", () => {
  const collapsed = collapseNearDuplicates([QILLA_A, QILLA_B]);
  assert.equal(collapsed.length, 1);
  const [kept] = collapsed;
  assert.equal(kept.id, "qilla-partyhunt", "the listing with a lineup, a ticket link and a real end wins");
  assert.deepEqual(kept.also_listed_by, ["whatsupgoa"]);
  assert.deepEqual(kept.duplicate_ids, ["qilla-whatsupgoa"]);
  assert.equal(kept.start_time_conflict, true);

  const summary = summarizeEvent(kept, { env: {} });
  assert.equal(summary.when, "Fri 9 Oct, 22:00");
  assert.deepEqual(summary.alternate_starts_local, ["2026-10-09T21:00:00+05:30"], "the other source's start is surfaced, not hidden");
  assert.ok(summary.quality_flags.includes("start_time_conflict"));
});

test("the duplicate guard stays conservative", () => {
  assert.equal(isNearDuplicate(QILLA_A, { ...QILLA_B, source: "whatsupgoa" }), false, "one source listing two nights is not a duplicate");
  assert.equal(isNearDuplicate(QILLA_A, { ...QILLA_B, start_time: "2026-10-09T18:30:00+00:00" }), false, "three hours apart is an early and a late session");
  assert.equal(isNearDuplicate(QILLA_A, { ...QILLA_B, venue_name: "Hilltop", lat: 15.59, lng: 73.75 }), false, "a different venue is a different party");
  assert.equal(isNearDuplicate(QILLA_A, { ...QILLA_B, title: "Karaoke Wednesday at Qilla" }), false, "different titles at one venue are different nights");
  assert.equal(isNearDuplicate(
    { ...QILLA_A, start_time: "2026-10-09T18:00:00+00:00" },
    { ...QILLA_B, start_time: "2026-10-09T19:00:00+00:00" }
  ), false, "23:30 and 00:30 local are on different local dates");
  assert.equal(collapseNearDuplicates([QILLA_A]).length, 1);
});

test("a real pair from the 2026-10-14 Goa feed collapses (Masaya, an hour apart)", () => {
  const district = goaEvent({ id: "masaya-district", title: "Brosso | Friday | Masaya | Goa", venue_name: "Masaya | Vagator, Goa", source: "district", start_time: "2026-10-16T15:30:00+00:00", end_time: null });
  const whatsup = goaEvent({ id: "masaya-whatsupgoa", title: "Friday Night at Masaya", venue_name: "Masaya", source: "whatsupgoa", start_time: "2026-10-16T14:30:00+00:00", end_time: null });
  assert.equal(collapseNearDuplicates([district, whatsup]).length, 1);
});

test("search_events returns the Qilla party once and tells the assistant about the conflict", async () => {
  const response = await callTool("search_events", { city: "goa", date_from: "2026-10-09", date_to: "2026-10-10" }, {
    config: TEST_CONFIG,
    now: NOW,
    fetch: eventsFetch([QILLA_A, QILLA_B, goaEvent({ id: "other", title: "Sunset Sessions" })])
  });
  assert.equal(response.isError, false, response.content[0].text);
  const ids = response.structuredContent.events.map((event) => event.id);
  assert.deepEqual(ids.sort(), ["other", "qilla-partyhunt"]);
  assert.ok(response.structuredContent.assistant_instruction.endsWith(QUALITY_INSTRUCTION));
});

test("plan_night cannot offer the same party as primary and alternate", async () => {
  const response = await callTool("plan_night", { city: "goa", when: "2026-10-09" }, {
    config: TEST_CONFIG,
    now: NOW,
    fetch: eventsFetch([QILLA_A, QILLA_B])
  });
  assert.equal(response.structuredContent.events.length, 1);
});

// ---------------------------------------------------------------------------
// 3. Time sanity
// ---------------------------------------------------------------------------

test("a 23:59 city-local end is a placeholder and is not printed", () => {
  // 18:29 UTC is 23:59 in Goa.
  const summary = summarizeEvent(goaEvent({ end_time: "2026-10-09T18:29:00+00:00" }), { env: {} });
  assert.equal(summary.ends_at, undefined);
  assert.equal(summary.ends_at_local, undefined);
  assert.equal(summary.when, "Fri 9 Oct, 20:00");
  assert.equal(summary.quality_flags, undefined, "an unknown end is omitted, not something to talk about");
  assert.equal(assessEndTime(goaEvent({ end_time: "2026-10-09T18:29:00+00:00" })).flag, "end_time_unknown");
});

test("an end equal to the start, or before it, is an unknown end", () => {
  const same = summarizeEvent(goaEvent({ end_time: "2026-10-09T14:30:00+00:00" }), { env: {} });
  assert.equal(same.ends_at, undefined);
  assert.ok(same.quality_flags.includes("start_equals_end"));

  const before = summarizeEvent(goaEvent({ end_time: "2026-10-09T12:00:00+00:00" }), { env: {} });
  assert.equal(before.ends_at, undefined);
  assert.equal(before.ends_at_local, undefined);
  assert.equal(before.when, "Fri 9 Oct, 20:00");
});

test("a multi-day listing with a 23:59 close keeps its dates, not the fake hour", () => {
  const summary = summarizeEvent({ id: "x", title: "Exhibition", start_time: "2026-10-14T11:00:00Z", end_time: "2026-11-01T23:59:00Z", venue_city: "lisbon" }, { env: {} });
  assert.equal(summary.when, "Wed 14 Oct, 12:00 → Sun 1 Nov");
  assert.equal(summary.ends_on_local, "2026-11-01");
  assert.equal(summary.ends_at, undefined);
});

test("calendar files and links use a default duration instead of a fake end", () => {
  const ics = buildCalendarEvent(goaEvent({ end_time: "2026-10-09T14:30:00+00:00" }), { env: {} });
  assert.equal(ics.ends_at, "2026-10-09T17:30:00.000Z", "three hours after the start");
});

test("a show whose end is before its start is not dropped from tonight as already over", async () => {
  const now = new Date("2026-10-09T13:00:00Z"); // 18:30 in Goa
  const response = await callTool("search_events", { city: "goa", when: "tonight" }, {
    config: TEST_CONFIG,
    now,
    fetch: eventsFetch([goaEvent({ id: "late", start_time: "2026-10-09T16:30:00+00:00", end_time: "2026-10-09T10:00:00+00:00" })])
  });
  assert.deepEqual(response.structuredContent.events.map((event) => event.id), ["late"]);
});

test("a 23:59 placeholder still keeps an all-day listing on today's list", async () => {
  const now = new Date("2026-10-14T15:00:00Z"); // 16:00 in Lisbon
  const response = await callTool("search_events", { city: "lisbon", when: "today" }, {
    config: TEST_CONFIG,
    now,
    fetch: eventsFetch([{ id: "expo", title: "Exhibition", start_time: "2026-10-14T09:00:00Z", end_time: "2026-10-14T22:59:00Z", venue_city: "lisbon", source: "agendalx" }])
  });
  const [event] = response.structuredContent.events;
  assert.equal(event.id, "expo");
  assert.equal(event.ends_at, undefined, "the placeholder is still not printed");
});

// ---------------------------------------------------------------------------
// 4. Quality signals
// ---------------------------------------------------------------------------

test("start equal to end plus an aggregator-only source ranks lower, with a reason", () => {
  const clean = goaEvent({ id: "clean", source: "district" });
  const stale = goaEvent({ id: "stale", source: "allevents", end_time: "2026-10-09T14:30:00+00:00" });
  const ranked = rankEvents([stale, clean], {}, NOW);
  assert.deepEqual(ranked.map((event) => event.id), ["clean", "stale"]);
  assert.ok(ranked[1].recommendation_reasons.includes("listing details unverified"));
  assert.deepEqual(qualityFlags(stale).sort(), ["aggregator_only", "start_equals_end"]);
  assert.equal(buildPlan(ranked)[0].id, "clean", "the plan leads with the listing Dizko can stand behind");
});

test("an aggregator listing corroborated by another source is not aggregator-only", () => {
  const [merged] = collapseNearDuplicates([
    goaEvent({ id: "a", source: "allevents", title: "Naadrang Concert", venue_name: "Kala Academy" }),
    goaEvent({ id: "b", source: "district", title: "Naadrang Concert", venue_name: "Kala Academy Panjim" })
  ]);
  assert.equal(qualityFlags(merged).includes("aggregator_only"), false);
});

test("backend quality flags and confidence pass through", () => {
  const summary = summarizeEvent(goaEvent({ quality_flags: ["artist_double_booked", { code: "stale_source" }, "not a code!"], confidence: 0.3 }), { env: {} });
  assert.deepEqual(summary.quality_flags, ["artist_double_booked", "stale_source"]);
  assert.equal(summary.listing_confidence, 0.3);
  const lowered = rankEvents([goaEvent({ id: "doubted", confidence: "low" }), goaEvent({ id: "fine" })], {}, NOW);
  assert.equal(lowered[0].id, "fine");
});

test("the quality note is added only when a returned event is flagged", () => {
  assert.equal(withQualityNote("Base.", [{ id: "a" }]), "Base.");
  assert.equal(withQualityNote("Base.", [{ id: "a", quality_flags: ["start_equals_end"] }]), `Base. ${QUALITY_INSTRUCTION}`);
  assert.ok(QUALITY_INSTRUCTION.length < 220, "the note stays short");
  assert.match(MCP_SERVER_INSTRUCTIONS, /quality_flags/);
});

// ---------------------------------------------------------------------------
// 5. Ticket honesty
// ---------------------------------------------------------------------------

function ticketOptions(event, extra = {}) {
  return {
    config: TEST_CONFIG,
    now: NOW,
    quoteSigningSecret: "quality-test-secret",
    fetch: async (url) => new URL(url).pathname === `/events/${encodeURIComponent(event.id)}` ? Response.json(event) : new Response("nf", { status: 404 }),
    ...extra
  };
}

test("tool text says hand off to checkout when no provider can buy", () => {
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  assert.match(byName.purchase_ticket_order.description, /hands off to checkout/);
  assert.match(byName.purchase_ticket_order.description, /buys nothing/);
  assert.match(byName.get_ticket_offers.description, /hand_off_to_checkout/);
  assert.match(byName.quote_ticket_order.description, /hand off to checkout/);
  assert.match(MCP_SERVER_INSTRUCTIONS, /hand off to checkout/);
});

test("a third-party-only event is a checkout hand off end to end", async () => {
  const event = goaEvent({ id: "handoff", ticket_url: "https://partyhunt.example/qilla" });
  const options = ticketOptions(event);
  const offers = (await callTool("get_ticket_offers", { event_id: event.id }, options)).structuredContent;
  assert.equal(offers.offers[0].next_step, "hand_off_to_checkout");
  assert.match(offers.assistant_instruction, /hand off to checkout/);
  assert.match(offers.assistant_instruction, /never offer to buy it/);

  const quote = (await callTool("quote_ticket_order", { event_id: event.id, quantity: 2, max_total: 3000 }, options)).structuredContent;
  assert.equal(quote.quote.handoff_only, true);
  assert.match(quote.assistant_instruction, /Dizko will not buy the ticket/);

  const done = (await callTool("purchase_ticket_order", { quote_token: quote.quote_token, confirmation_text: "Yes, buy 2 tickets, max total 3000" }, options)).structuredContent;
  assert.equal(done.purchased, false);
  assert.equal(done.status, "requires_external_checkout");
  assert.equal(done.next_step, "hand_off_to_checkout");
  assert.equal(done.checkout_url, "https://partyhunt.example/qilla");
  assert.match(done.assistant_instruction, /Nothing was bought/);
});

test("purchase_ticket_order refuses without the user's written confirmation, server side", async () => {
  const event = goaEvent({ id: "guarded", ticket_url: "https://partyhunt.example/qilla" });
  let providerCalls = 0;
  const provider = { canPurchase: () => true, purchase: async () => { providerCalls += 1; return { purchased: true, status: "purchased" }; } };
  const options = ticketOptions(event, { ticketPurchaseProvider: provider });
  const quote = (await callTool("quote_ticket_order", { event_id: event.id, quantity: 2, max_total: 3000 }, options)).structuredContent;

  const missing = await callTool("purchase_ticket_order", { quote_token: quote.quote_token }, options);
  assert.equal(missing.isError, true, "confirmation_text is required by the schema");

  for (const text of ["ok", "sure go ahead", "I am the buyer of 2, 3000", "buy 2 tickets"]) {
    const refused = (await callTool("purchase_ticket_order", { quote_token: quote.quote_token, confirmation_text: text }, options)).structuredContent;
    assert.equal(refused.purchased, false, text);
    assert.equal(refused.code, "confirmation_mismatch", text);
  }
  assert.equal(providerCalls, 0, "the provider is never reached without a matching confirmation");

  const bought = (await callTool("purchase_ticket_order", { quote_token: quote.quote_token, confirmation_text: "Yes, buy 2 tickets, max total 3000" }, options)).structuredContent;
  assert.equal(bought.status, "purchased");
  assert.equal(providerCalls, 1);
});

// ---------------------------------------------------------------------------
// 6. Attribution
// ---------------------------------------------------------------------------

test("Dizko web links carry MCP attribution; other links stay clean", () => {
  const summary = summarizeEvent(goaEvent({ ticket_url: "https://partyhunt.example/qilla?x=1" }), { env: {} });
  assert.equal(summary.dizko_url, "https://www.dizko.app/events/goa-1?utm_source=dizko_mcp&utm_medium=ai_assistant");
  assert.equal(summary.event_url, "https://www.dizko.app/events/goa-1", "the canonical id link stays clean");
  assert.equal(summary.ticket_url, "https://partyhunt.example/qilla?x=1");
  assert.ok(!summary.calendar_url.includes("utm_"));
  assert.ok(!summary.directions_url.includes("utm_"));

  assert.deepEqual(MCP_ATTRIBUTION, { utm_source: "dizko_mcp", utm_medium: "ai_assistant" });
  assert.equal(withMcpAttribution("https://www.dizko.app/AvalonEmerson?mix=b1"), "https://www.dizko.app/AvalonEmerson?mix=b1&utm_source=dizko_mcp&utm_medium=ai_assistant");
  assert.equal(withMcpAttribution("https://www.dizko.app/x?utm_source=newsletter"), "https://www.dizko.app/x?utm_source=newsletter&utm_medium=ai_assistant", "an existing source is not overwritten");
  assert.equal(withMcpAttribution("https://ra.co/events/1"), "https://ra.co/events/1");
  assert.equal(withMcpAttribution("https://mcp.dizko.app/e/1/ics"), "https://mcp.dizko.app/e/1/ics");
  assert.equal(withMcpAttribution("https://events.selfhost.test/events/1", "https://events.selfhost.test"), "https://events.selfhost.test/events/1?utm_source=dizko_mcp&utm_medium=ai_assistant", "a self-hosted web base is attributed too");
  assert.equal(withMcpAttribution("not a url"), "not a url");
});

// ---------------------------------------------------------------------------
// 8. Re-audit: backend fields, false positives, time zones, link encoding
// ---------------------------------------------------------------------------

test("the backend's currency_inferred is preferred over the connector's own guess", () => {
  // Stated by the source: kept, even when it is not the city's currency.
  const stated = summarizeEvent(goaEvent({ currency: "EUR", currency_inferred: false, price_min: 60, price_max: 60 }), { env: {} });
  assert.equal(stated.price, "€60", "a Goa festival that really sells in EUR is not second-guessed");
  assert.equal(stated.currency, "EUR");
  assert.equal(stated.quality_flags, undefined);

  // Inferred and matching the city: shown, labelled as inferred.
  const inferred = summarizeEvent(goaEvent({ currency: "INR", currency_inferred: true }), { env: {} });
  assert.equal(inferred.currency, "INR");
  assert.equal(inferred.currency_status, "inferred");
  assert.deepEqual(inferred.quality_flags, ["currency_inferred"]);

  // Absent (an older backend): the connector's own check still runs.
  const legacy = summarizeEvent(goaEvent({ currency: "EUR", price_min: 60, price_max: 60 }), { env: {} });
  assert.equal(legacy.currency_status, "unverified");
});

test("dollar pricing in Mexico, Argentina, Colombia and Turkiye is not flagged; EUR still is", () => {
  const cdmx = (overrides) => ({ id: "m", title: "Festival", start_time: "2026-11-20T03:00:00Z", venue_city: "mexico-city", source: "ra", price_min: 80, price_max: 80, ...overrides });
  assert.deepEqual(assessCurrency(cdmx({ currency: "USD" })), { currency: "USD", status: null, flag: null });
  assert.equal(assessCurrency(cdmx({ currency: "EUR" })).flag, "currency_unverified", "EUR is the old fallback's signature");
  assert.equal(assessCurrency(cdmx({ currency: "MXN" })).flag, null);
});

test("a high price in the right currency is never flagged", () => {
  const vip = summarizeEvent(goaEvent({ price_min: 25000, price_max: 150000 }), { env: {} });
  assert.match(vip.price, /^INR 25000-INR 150000$/);
  assert.equal(vip.quality_flags, undefined);
});

test("backend quality_flags replace the connector's own listing inference", () => {
  // An aggregator with start equal to end: the backend calls it
  // zero_duration_aggregator, so the connector does not add its own pair.
  const flagged = goaEvent({ source: "allevents", end_time: "2026-10-09T14:30:00+00:00", quality_flags: ["zero_duration_aggregator"] });
  assert.deepEqual(qualityFlags(flagged), ["zero_duration_aggregator"]);
  assert.equal(summarizeEvent(flagged, { env: {} }).ends_at, undefined, "the fake end is still never printed");
  const ranked = rankEvents([flagged, goaEvent({ id: "fine", quality_flags: [] })], {}, NOW);
  assert.equal(ranked[0].id, "fine");
  assert.ok(ranked[1].recommendation_reasons.includes("listing details unverified"));

  // An empty backend list means the backend checked and found nothing.
  assert.deepEqual(qualityFlags(goaEvent({ source: "allevents", quality_flags: [] })), []);
  // Absent: the connector infers its own.
  assert.deepEqual(qualityFlags(goaEvent({ source: "allevents" })), ["aggregator_only"]);
  // A merge conflict is still the connector's to report.
  assert.deepEqual(qualityFlags(goaEvent({ quality_flags: [], start_time_conflict: true })), ["start_time_conflict"]);
});

test("two venues that share only a generic word, or sit far apart, never merge", () => {
  const base = { title: "Jazz Jam Session", start_time: "2026-10-14T19:00:00Z", venue_city: "lisbon", lineup: [] };
  const cafe = { ...base, id: "a", source: "agendalx", venue_name: "Jazz Cafe" };
  const bar = { ...base, id: "b", source: "ra", venue_name: "Jazz Bar", title: "Jazz Jam" };
  assert.equal(isNearDuplicate(cafe, bar), false, "'jazz' names the kind of room, not the room");

  const farA = { ...QILLA_A, lat: 15.6028, lng: 73.7356 };
  const farB = { ...QILLA_B, venue_name: "Qilla", lat: 15.55, lng: 73.76 };
  assert.equal(isNearDuplicate(farA, farB), false, "a same-named room 5 km away is another room");

  assert.equal(isNearDuplicate(QILLA_A, { ...QILLA_B, venue_city: "lisbon", lat: null, lng: null }), false, "another city is another party");
  assert.equal(isNearDuplicate(QILLA_A, QILLA_B), true, "the real duplicate still collapses");
});

test("times west of UTC, across midnight and across a DST change stay local", () => {
  // New York, Sat 31 Oct 2026 23:00 EDT to Sun 1 Nov 05:00 EST (clocks go back at 02:00).
  const nyc = summarizeEvent({ id: "n", title: "Halloween", start_time: "2026-11-01T03:00:00Z", end_time: "2026-11-01T10:00:00Z", venue_city: "new-york" }, { env: {} });
  assert.equal(nyc.when, "Sat 31 Oct, 23:00");
  assert.equal(nyc.starts_at_local, "2026-10-31T23:00:00-04:00");
  assert.equal(nyc.ends_at_local, "2026-11-01T05:00:00-05:00");

  // Los Angeles: 23:59 local (06:59 UTC next day) is a placeholder, 23:59 UTC (16:59 local) is a real end.
  const placeholder = { id: "l", title: "Show", start_time: "2026-10-15T03:00:00Z", end_time: "2026-10-16T06:59:00Z", venue_city: "los-angeles" };
  assert.equal(assessEndTime(placeholder).flag, "end_time_unknown");
  const matinee = { id: "l2", title: "Matinee", start_time: "2026-10-15T20:00:00Z", end_time: "2026-10-15T23:59:00Z", venue_city: "los-angeles" };
  assert.equal(assessEndTime(matinee).flag, null, "a UTC 23:59 is not a local placeholder");
});

test("attribution never re-encodes an existing query or drops a fragment", () => {
  assert.equal(
    withMcpAttribution("https://www.dizko.app/share?t=a%2Fb%20c&sig=Zx%2B1#top"),
    "https://www.dizko.app/share?t=a%2Fb%20c&sig=Zx%2B1&utm_source=dizko_mcp&utm_medium=ai_assistant#top"
  );
  const once = withMcpAttribution("https://www.dizko.app/events/1");
  assert.equal(withMcpAttribution(once), once, "never appended twice");
  assert.equal(withMcpAttribution("https://www.dizko.app/x?"), "https://www.dizko.app/x?utm_source=dizko_mcp&utm_medium=ai_assistant");
  assert.doesNotMatch(once, /[?&]ref=/, "ref holds referral codes and is never used for attribution");
});

test("annotations: the ChatGPT surface is 13 read-only tools; overwrites are destructive", () => {
  const openai = surfaceTools("openai");
  assert.equal(openai.length, 13);
  for (const tool of openai) {
    assert.equal(tool.annotations.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
  }
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations]));
  assert.equal(byName.save_event_preferences.destructiveHint, true, "mode replace overwrites the saved profile");
  assert.equal(byName.delete_event_preferences.destructiveHint, true);
  assert.equal(byName.purchase_ticket_order.destructiveHint, true);
  assert.equal(byName.purchase_ticket_order.readOnlyHint, false);
});

// ---------------------------------------------------------------------------
// 7. Tool count
// ---------------------------------------------------------------------------

test("the connector exposes exactly 30 tools", () => {
  assert.equal(tools.length, 30);
  assert.equal(new Set(tools.map((tool) => tool.name)).size, 30);
});

test("the honesty wording keeps tools/list inside the submission byte budget", () => {
  // scripts/verify-submission.mjs holds tools/list under 48,000 bytes.
  const bytes = Buffer.byteLength(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools } }), "utf8");
  assert.ok(bytes < 48_000, `${bytes} bytes`);
});
