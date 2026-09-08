import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MCP_URL } from "../src/config.js";
import {
  EVENT_FIELD_OPTIONS,
  directionsUrl,
  eventTimezone,
  formatEventList,
  formatPrice,
  formatWhen,
  googleCalendarUrl,
  isBoilerplateDescription,
  localTimes,
  normalizeFields,
  setTimesFromBilling,
  shortLinkBase,
  summarizeEvent
} from "../src/format.js";

const EVENT = {
  id: "evt-1",
  title: "Warehouse Party",
  start_time: "2026-06-13T22:00:00+00:00",
  end_time: "2026-06-14T04:00:00+00:00",
  venue_name: "Knockdown Center",
  venue_address: "52-19 Flushing Ave, Maspeth",
  venue_city: "new-york",
  lat: 40.7141,
  lng: -73.9082,
  ticket_url: "https://ra.co/events/123",
  genres: ["techno"],
  vibe: ["underground"]
};

const SHORT_BASE = DEFAULT_MCP_URL.replace(/\/mcp$/, "");
const BOILERPLATE = "Warehouse Party takes place at Knockdown Center in New York on Saturday 13 June. A, B and C are on the lineup. The listed genre is techno.";

test("summarizeEvent emits short calendar and directions links plus the event card", () => {
  const summary = summarizeEvent(EVENT, { env: {} });
  assert.match(summary.event_url, /\/events\/evt-1$/);
  assert.equal(summary.calendar_url, `${SHORT_BASE}/e/evt-1/cal`);
  assert.equal(summary.directions_url, `${SHORT_BASE}/e/evt-1/map`);
});

test("short links are omitted when the underlying data is missing", () => {
  const noStart = summarizeEvent({ ...EVENT, start_time: null }, { env: {} });
  assert.equal(noStart.calendar_url, undefined, "no start time -> no calendar link");
  const noWhere = summarizeEvent({ ...EVENT, lat: null, lng: null, venue_name: "TBA" }, { env: {} });
  assert.equal(noWhere.directions_url, undefined, "unmappable venue -> no directions link");
});

test("shortLinkBase honors env override and explicit linkBaseUrl", () => {
  assert.equal(shortLinkBase({ env: { EVENTCHAT_MCP_URL: "https://mcp.example.test/mcp/" } }), "https://mcp.example.test");
  assert.equal(shortLinkBase({ linkBaseUrl: "https://other.example.test/mcp" }), "https://other.example.test");
});

test("summarizeEvent renders city-local times with the IANA timezone", () => {
  const summary = summarizeEvent(EVENT, { env: {} });
  assert.equal(summary.when, "Sat 13 Jun, 18:00");
  assert.equal(summary.starts_at, "2026-06-13T22:00:00+00:00", "starts_at stays the upstream UTC string");
  assert.equal(summary.ends_at, "2026-06-14T04:00:00+00:00");
  assert.equal(summary.starts_at_local, "2026-06-13T18:00:00-04:00");
  assert.equal(summary.ends_at_local, "2026-06-14T00:00:00-04:00");
  assert.equal(summary.timezone, "America/New_York");

  const berlin = summarizeEvent({ id: "b", title: "Klubnacht", start_time: "2026-09-12T21:59:00Z", end_time: "2026-09-13T04:00:00Z", venue_city: "berlin" }, { env: {} });
  assert.equal(berlin.when, "Sat 12 Sep, 23:59", "a night that crosses midnight but lasts under 12h shows the start only");
  assert.equal(berlin.starts_at_local, "2026-09-12T23:59:00+02:00");
  assert.equal(berlin.ends_at_local, "2026-09-13T06:00:00+02:00");
  assert.equal(berlin.timezone, "Europe/Berlin");
});

test("summarizeEvent spells out both ends of a multi-day event", () => {
  const festival = summarizeEvent({ id: "f", title: "Weekender", start_time: "2026-09-11T10:00:00Z", end_time: "2026-09-13T21:59:00Z", venue_city: "berlin" }, { env: {} });
  assert.equal(festival.when, "Fri 11 Sep, 12:00 → Sun 13 Sep, 23:59");
  const longSameDay = summarizeEvent({ id: "d", title: "Day rave", start_time: "2026-09-12T00:00:00Z", end_time: "2026-09-12T20:00:00Z", venue_city: "london" }, { env: {} });
  assert.equal(longSameDay.when, "Sat 12 Sep, 01:00", ">12h but ending the same local date stays a single stamp");
});

test("unknown cities fall back to UTC and a title-cased display name", () => {
  const summary = summarizeEvent({ id: "u", title: "Somewhere", start_time: "2026-09-12T23:59:00Z", venue_city: "atlantis-city" }, { env: {} });
  assert.equal(summary.timezone, "UTC");
  assert.equal(summary.when, "Sat 12 Sep, 23:59");
  assert.equal(summary.starts_at_local, "2026-09-12T23:59:00+00:00");
  assert.equal(summary.city, "Atlantis City");
  assert.equal(summary.city_slug, "atlantis-city");
  const undated = summarizeEvent({ id: "n", title: "No date", venue_city: "atlantis-city" }, { env: {} });
  assert.equal(undated.timezone, undefined, "no start time -> no timezone claim");
  assert.equal(undated.when, undefined);
});

test("eventTimezone, localTimes and formatWhen are exported helpers", () => {
  assert.equal(eventTimezone({ venue_city: "berlin" }), "Europe/Berlin");
  assert.equal(eventTimezone({ venue_city: "new york" }), "America/New_York", "display-name spellings resolve too");
  assert.equal(eventTimezone({ venue_city: "nowhere", timezone: "Asia/Tokyo" }), "Asia/Tokyo", "an explicit event timezone is honored for unknown cities");
  assert.equal(eventTimezone({ venue_city: "nowhere" }), null);

  const local = localTimes({ start_time: "2026-09-12T21:59:00Z", end_time: "2026-09-13T04:00:00Z" }, "Europe/Berlin");
  assert.deepEqual(local, {
    when: "Sat 12 Sep, 23:59",
    starts_at_local: "2026-09-12T23:59:00+02:00",
    ends_at_local: "2026-09-13T06:00:00+02:00",
    timezone: "Europe/Berlin"
  });
  assert.deepEqual(localTimes({}, "Europe/Berlin"), { when: null, starts_at_local: null, ends_at_local: null, timezone: null });

  assert.equal(formatWhen(new Date("2026-09-12T21:59:00Z"), "Europe/Berlin"), "Sat 12 Sep, 23:59");
  assert.equal(formatWhen(new Date("2026-09-12T21:59:00Z")), "Sat 12 Sep, 21:59", "defaults to UTC");
});

test("summarizeEvent names the city, address and venue", () => {
  const summary = summarizeEvent(EVENT, { env: {} });
  assert.equal(summary.venue, "Knockdown Center");
  assert.equal(summary.address, "52-19 Flushing Ave, Maspeth");
  assert.equal(summary.city, "New York");
  assert.equal(summary.city_slug, "new-york");
  assert.equal(summarizeEvent({ id: "x", title: "y", venue_city: "berlin" }, { env: {} }).city, "Berlin");
});

test("formatPrice renders currency symbols, ranges and free entry", () => {
  assert.equal(formatPrice({ price_min: 0 }), "free");
  assert.equal(formatPrice({ price_min: 0, price_max: 0, currency: "USD" }), "free");
  assert.equal(formatPrice({ price_min: 20, currency: "EUR" }), "€20");
  assert.equal(formatPrice({ price_min: 10, price_max: 20, currency: "USD" }), "$10-$20");
  assert.equal(formatPrice({ price_min: 0, price_max: 20, currency: "EUR" }), "free-€20");
  assert.equal(formatPrice({ price_min: 12.5, currency: "GBP" }), "£12.50");
  assert.equal(formatPrice({ price_min: 3000, currency: "JPY" }), "¥3000");
  assert.equal(formatPrice({ price_min: 5, currency: "CZK" }), "CZK 5");
  assert.equal(formatPrice({ price_min: 30, currency: "BRL" }), "R$30");
  assert.equal(formatPrice({ price_max: 15, currency: "EUR" }), "€15", "max only");
  assert.equal(formatPrice({ price_min: 20, price_max: 20, currency: "EUR" }), "€20", "equal min/max collapses to one value");
  assert.equal(formatPrice({ currency: "EUR" }), null, "no price -> null");
});

test("event summaries carry a price string; currency only appears in detail mode", () => {
  const paid = summarizeEvent({ ...EVENT, price_min: 30, currency: "BRL" }, { env: {} });
  assert.equal(paid.price, "R$30");
  assert.equal(paid.currency, undefined, "raw currency is not part of the compact summary");
  const euro = summarizeEvent({ ...EVENT, price_min: 20, currency: "EUR" }, { env: {} });
  assert.equal(euro.price, "€20");
  const free = summarizeEvent({ ...EVENT, price_min: 0, currency: "USD" }, { env: {} });
  assert.equal(free.price, "free");
  assert.equal(free.currency, undefined);
  const detail = summarizeEvent({ ...EVENT, price_min: 10, price_max: 20, currency: "USD" }, { env: {}, detail: true });
  assert.equal(detail.price, "$10-$20");
  assert.equal(detail.currency, "USD");
});

test("summarizeEvent strips null and empty fields but always keeps id/title/event_url", () => {
  const summary = summarizeEvent({ id: "evt-2", title: "Mystery" }, { env: {} });
  assert.deepEqual(Object.keys(summary).sort(), ["event_url", "id", "title"]);
  assert.equal(summary.pick, undefined, "the old pick flag is gone");
  assert.equal(summary.featured, undefined, "featured is absent rather than false");
});

test("featured is true only for RA picks or featured events", () => {
  assert.equal(summarizeEvent({ ...EVENT, ra_pick: true }, { env: {} }).featured, true);
  assert.equal(summarizeEvent({ ...EVENT, featured_at: "2026-06-01T00:00:00Z" }, { env: {} }).featured, true);
  const plain = summarizeEvent({ ...EVENT, ra_pick: false, featured_at: null }, { env: {} });
  assert.equal(plain.featured, undefined);
  assert.equal("pick" in plain, false);
});

test("lineup is capped at 8 with a count, and full in detail mode", () => {
  const lineup = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
  const summary = summarizeEvent({ ...EVENT, lineup }, { env: {} });
  assert.deepEqual(summary.lineup, lineup.slice(0, 8));
  assert.equal(summary.lineup_count, 10);

  const detail = summarizeEvent({ ...EVENT, lineup }, { env: {}, detail: true });
  assert.deepEqual(detail.lineup, lineup);
  assert.equal(detail.lineup_count, 10);

  const short = summarizeEvent({ ...EVENT, lineup: ["A", null, "B"] }, { env: {} });
  assert.deepEqual(short.lineup, ["A", "B"], "falsy lineup entries are dropped");
  assert.equal(short.lineup_count, undefined, "no count when the lineup is not capped");
  assert.equal(summarizeEvent({ ...EVENT, lineup: ["A", "B"] }, { env: {}, detail: true }).lineup_count, 2, "detail mode always reports the count");
  assert.equal(summarizeEvent({ ...EVENT, lineup: [] }, { env: {}, detail: true }).lineup_count, undefined);
});

test("set_times are parsed from upstream billing lines", () => {
  const billing = [
    { parts: [{ text: "19:00" }, { artist: "Opener" }] },
    { parts: [{ text: "23.30" }, { artist: "Headliner" }, { artist: "B2B Guest" }] },
    { parts: [{ text: "Closing" }, { artist: "Nobody" }] },
    { parts: [{ text: "02:00" }] },
    null
  ];
  assert.deepEqual(setTimesFromBilling(billing), [
    { artist: "Opener", at: "19:00" },
    { artist: "Headliner", at: "23:30" },
    { artist: "B2B Guest", at: "23:30" }
  ]);
  assert.deepEqual(setTimesFromBilling(undefined), []);
  assert.deepEqual(setTimesFromBilling("19:00 Opener"), []);

  const many = Array.from({ length: 14 }, (_, index) => ({ parts: [{ text: `${String(index + 8).padStart(2, "0")}:00` }, { artist: `DJ ${index}` }] }));
  assert.equal(setTimesFromBilling(many).length, 10, "capped at 10 rows");

  const summary = summarizeEvent({ ...EVENT, billing: billing.slice(0, 1) }, { env: {} });
  assert.deepEqual(summary.set_times, [{ artist: "Opener", at: "19:00" }]);
  assert.equal(summarizeEvent(EVENT, { env: {} }).set_times, undefined, "no billing -> no set_times key");
});

test("promoters are names by default and full objects only when requested", () => {
  const promoters = [{ id: "p1", name: "Teksupport", slug: "teksupport" }, "Other Crew", { id: "p3" }];
  const summary = summarizeEvent({ ...EVENT, promoters }, { env: {} });
  assert.deepEqual(summary.promoters, ["Teksupport", "Other Crew"]);
  const requested = summarizeEvent({ ...EVENT, promoters }, { env: {}, fields: ["promoters"] });
  assert.deepEqual(requested.promoters, promoters);
  assert.deepEqual(summarizeEvent({ ...EVENT, promoters }, { env: {}, detail: true }).promoters, promoters);
});

test("heavy fields are opt-in through fields or detail", () => {
  const rich = {
    ...EVENT,
    image_url: "https://img.example/1.jpg",
    source: "ra",
    source_display: "Resident Advisor",
    currency: "USD",
    price_min: 15,
    sound_tags: ["big room"],
    artist_socials: [{ name: "Headliner", soundcloud: "https://soundcloud.com/h", instagram: null, extra: "dropped" }, { soundcloud: "https://soundcloud.com/anon" }],
    attendance_count: 240,
    price_trend: "rising"
  };
  const summary = summarizeEvent(rich, { env: {} });
  for (const key of ["image_url", "lat", "lng", "source", "currency", "sound_tags", "artist_socials"]) {
    assert.equal(key in summary, false, `${key} should be absent by default`);
  }
  assert.equal(summary.attendance_count, 240);
  assert.equal(summary.price_trend, "rising", "price_trend is kept when present");

  const withFields = summarizeEvent(rich, { env: {}, fields: ["images", "coordinates", "socials", "source"] });
  assert.equal(withFields.image_url, "https://img.example/1.jpg");
  assert.equal(withFields.lat, 40.7141);
  assert.equal(withFields.lng, -73.9082);
  assert.equal(withFields.source, "Resident Advisor");
  assert.equal(withFields.currency, "USD", "source also exposes the raw currency");
  assert.deepEqual(withFields.artist_socials, [{ name: "Headliner", soundcloud: "https://soundcloud.com/h" }], "socials are compacted and unnamed rows dropped");
  assert.equal(withFields.sound_tags, undefined, "sound_tags are detail-only");

  const commaFields = summarizeEvent(rich, { env: {}, fields: "images, COORDINATES" });
  assert.equal(commaFields.image_url, "https://img.example/1.jpg");
  assert.equal(commaFields.lat, 40.7141);
  assert.equal(commaFields.source, undefined);

  const detail = summarizeEvent(rich, { env: {}, detail: true });
  assert.equal(detail.image_url, "https://img.example/1.jpg");
  assert.equal(detail.lat, 40.7141);
  assert.equal(detail.source, "Resident Advisor");
  assert.equal(detail.currency, "USD");
  assert.deepEqual(detail.sound_tags, ["big room"]);
  assert.equal(detail.artist_socials.length, 1);
});

test("normalizeFields accepts arrays or comma strings and ignores unknown names", () => {
  assert.deepEqual(EVENT_FIELD_OPTIONS, ["description", "images", "coordinates", "socials", "promoters", "source"]);
  assert.deepEqual(normalizeFields("Description, IMAGES ,bogus"), ["description", "images"]);
  assert.deepEqual(normalizeFields(["socials", "nope"]), ["socials"]);
  assert.deepEqual(normalizeFields(undefined), []);
});

test("googleCalendarUrl builds a prefilled link with dates, venue + address, and event card", () => {
  const url = googleCalendarUrl(summarizeEvent(EVENT, { env: {} }));
  assert.match(url, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.match(url, /dates=20260613T220000Z%2F20260614T040000Z/);
  const params = new URL(url).searchParams;
  assert.equal(params.get("location"), "Knockdown Center, 52-19 Flushing Ave, Maspeth");
  assert.match(params.get("details"), /Event: https:\/\/www\.dizko\.app\/events\/evt-1/);
  assert.match(params.get("details"), /Tickets: https:\/\/ra\.co\/events\/123/);
});

test("googleCalendarUrl falls back to the city, defaults to 3 hours, and requires a start time", () => {
  const url = googleCalendarUrl({ title: "Party", starts_at: "2026-06-13T22:00:00+00:00", venue: "Berghain", city: "Berlin" });
  assert.match(url, /dates=20260613T220000Z%2F20260614T010000Z/);
  assert.equal(new URL(url).searchParams.get("location"), "Berghain, Berlin");
  assert.equal(googleCalendarUrl({ title: "Mystery" }), null);
});

test("directionsUrl prefers coordinates, then venue + address, then venue + city", () => {
  assert.match(directionsUrl(EVENT, {}), /destination=40\.7141%2C-73\.9082/);
  assert.equal(
    directionsUrl({ venue_name: "Berghain", venue_address: "Am Wriezener Bahnhof", venue_city: "berlin", lat: null, lng: null }),
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("Berghain, Am Wriezener Bahnhof")}`
  );
  assert.equal(
    directionsUrl({ venue_name: "Brooklyn Bridge Park Pier 1", venue_city: "new-york", lat: null, lng: null }),
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("Brooklyn Bridge Park Pier 1, New York")}`
  );
  assert.equal(
    directionsUrl({ venue_name: "Berghain", venue_city: "berlin" }, { venue: "Berghain", address: "Am Wriezener Bahnhof", city: "Berlin" }),
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("Berghain, Am Wriezener Bahnhof")}`,
    "summary fields win over raw event fields"
  );
  assert.match(directionsUrl({ venue_name: "TBA", venue_city: "berlin", lat: 52.5, lng: 13.4 }, {}), /destination=52\.5%2C13\.4/);
  assert.equal(directionsUrl({ lat: null, lng: null }), null);
});

test("directionsUrl skips placeholder venues", () => {
  for (const venue of ["TBA", "tbd", "Secret Location", "Various Locations", "Undisclosed Location", "Multiple Locations", "Online"]) {
    assert.equal(directionsUrl({ venue_name: venue, venue_city: "berlin", lat: null, lng: null }), null, `${venue} should not get a directions link`);
  }
});

test("formatEventList prints local when, where, set times and lineup overflow", () => {
  const event = {
    ...EVENT,
    price_min: 10,
    price_max: 20,
    currency: "USD",
    lineup: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"],
    billing: [{ parts: [{ text: "19:00" }, { artist: "Opener" }] }, { parts: [{ text: "23:30" }, { artist: "Headliner" }] }]
  };
  const text = formatEventList([event], { env: {} });
  assert.match(text, /^1\. Warehouse Party$/m);
  assert.match(text, /^ {3}When: Sat 13 Jun, 18:00 \(America\/New_York\)$/m);
  assert.match(text, /^ {3}Where: Knockdown Center, 52-19 Flushing Ave, Maspeth$/m);
  assert.match(text, /^ {3}Price: \$10-\$20$/m);
  assert.match(text, /^ {3}Lineup: A, B, C, D, E, F, G, H \+2 more$/m);
  assert.match(text, /^ {3}Set times: 19:00 Opener, 23:30 Headliner$/m);
  assert.match(text, /^ {3}Tags: techno, underground$/m);
  assert.match(text, /Directions: .*\/e\/evt-1\/map/);
  assert.match(text, /Add to calendar: .*\/e\/evt-1\/cal/);
  assert.match(text, /Event: .*\/events\/evt-1/);

  const noAddress = formatEventList([{ ...EVENT, venue_address: null }], { env: {} });
  assert.match(noAddress, /^ {3}Where: Knockdown Center, New York$/m, "falls back to the city display name");
  assert.doesNotMatch(noAddress, /Set times:/);
  assert.equal(formatEventList([], { env: {} }), "No matching events found.");
});

test("summarizeEvent keeps a real description, collapsed and truncated to 160 characters", () => {
  const long = "An  all-night\nwarehouse   experience.\n\n" + "x".repeat(300);
  const summary = summarizeEvent({ ...EVENT, description: long }, { env: {} });
  assert.ok(summary.description.startsWith("An all-night warehouse experience."));
  assert.ok(summary.description.length <= 160);
  assert.ok(summary.description.endsWith("…"));
  const detail = summarizeEvent({ ...EVENT, description: long }, { env: {}, detail: true });
  assert.ok(detail.description.length > 160 && detail.description.length <= 600, "detail mode allows up to 600 characters");
  assert.equal(summarizeEvent({ ...EVENT, description: "  \n " }, { env: {} }).description, undefined);
  assert.equal(summarizeEvent({ ...EVENT, description: undefined }, { env: {} }).description, undefined);
  assert.equal(summarizeEvent({ ...EVENT, description: "Three floors of techno." }, { env: {} }).description, "Three floors of techno.");
});

test("boilerplate descriptions are dropped by default and reduced when requested", () => {
  assert.equal(isBoilerplateDescription(BOILERPLATE), true);
  assert.equal(isBoilerplateDescription("Nachtschicht lands at Tresor in Berlin. Ben Klock and Marcel Dettmann are on the lineup."), true);
  assert.equal(isBoilerplateDescription("An all-night warehouse experience with three floors."), false);
  assert.equal(isBoilerplateDescription(""), false);
  assert.equal(isBoilerplateDescription(null), false);

  assert.equal(summarizeEvent({ ...EVENT, description: BOILERPLATE }, { env: {} }).description, undefined, "pure boilerplate is dropped");
  assert.equal(summarizeEvent({ ...EVENT, description: BOILERPLATE }, { env: {}, fields: ["description"] }).description, undefined, "nothing beyond the structured fields survives");

  const mixed = `${BOILERPLATE} Expect strobe lights and a late-night rooftop set.`;
  assert.equal(summarizeEvent({ ...EVENT, description: mixed }, { env: {} }).description, undefined, "still boilerplate by default");
  assert.equal(
    summarizeEvent({ ...EVENT, description: mixed }, { env: {}, fields: ["description"] }).description,
    "Expect strobe lights and a late-night rooftop set."
  );
  assert.equal(
    summarizeEvent({ ...EVENT, description: mixed }, { env: {}, detail: true }).description,
    "Expect strobe lights and a late-night rooftop set."
  );
});
