import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_MCP_URL } from "../src/config.js";
import { directionsUrl, formatEventList, googleCalendarUrl, shortLinkBase, summarizeEvent } from "../src/format.js";

const EVENT = {
  id: "evt-1",
  title: "Warehouse Party",
  start_time: "2026-06-13T22:00:00+00:00",
  end_time: "2026-06-14T04:00:00+00:00",
  venue_name: "Knockdown Center",
  venue_city: "new york",
  lat: 40.7141,
  lng: -73.9082,
  ticket_url: "https://ra.co/events/123",
  genres: ["techno"],
  vibe: ["underground"]
};

const SHORT_BASE = DEFAULT_MCP_URL.replace(/\/mcp$/, "");

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

test("summarizeEvent strips null and empty fields but keeps id/title/event_url/pick", () => {
  const summary = summarizeEvent({ id: "evt-2", title: "Mystery" }, { env: {} });
  assert.deepEqual(Object.keys(summary).sort(), ["event_url", "id", "pick", "title"]);
  assert.equal(summary.pick, false);
});

test("googleCalendarUrl builds a prefilled link with dates, location, and event card", () => {
  const url = googleCalendarUrl(summarizeEvent(EVENT, { env: {} }));
  assert.match(url, /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
  assert.match(url, /dates=20260613T220000Z%2F20260614T040000Z/);
  assert.match(url, /Knockdown\+Center/);
  assert.ok(url.includes(encodeURIComponent("events/evt-1")), "details should link back to the event card");
});

test("googleCalendarUrl defaults to a 3-hour duration and requires a start time", () => {
  const url = googleCalendarUrl({ title: "Party", starts_at: "2026-06-13T22:00:00+00:00" });
  assert.match(url, /dates=20260613T220000Z%2F20260614T010000Z/);
  assert.equal(googleCalendarUrl({ title: "Mystery" }), null);
});

test("directionsUrl prefers coordinates, falls back to venue text, skips placeholders", () => {
  assert.match(directionsUrl(EVENT, {}), /destination=40\.7141%2C-73\.9082/);
  assert.equal(
    directionsUrl({ venue_name: "Brooklyn Bridge Park Pier 1", venue_city: "new york", lat: null, lng: null }),
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent("Brooklyn Bridge Park Pier 1, new york")}`
  );
  assert.equal(directionsUrl({ venue_name: "TBA", venue_city: "new york", lat: null, lng: null }), null);
  assert.equal(directionsUrl({ venue_name: "Secret Location", venue_city: "berlin", lat: null, lng: null }), null);
  assert.match(directionsUrl({ venue_name: "TBA", venue_city: "berlin", lat: 52.5, lng: 13.4 }, {}), /destination=52\.5%2C13\.4/);
  assert.equal(directionsUrl({ lat: null, lng: null }), null);
});

test("formatEventList prints short directions and calendar lines", () => {
  const text = formatEventList([EVENT], { env: {} });
  assert.match(text, /Directions: .*\/e\/evt-1\/map/);
  assert.match(text, /Add to calendar: .*\/e\/evt-1\/cal/);
  assert.match(text, /Event: .*\/events\/evt-1/);
});

test("summarizeEvent includes a collapsed, truncated one-line description", () => {
  const long = "An  all-night\nwarehouse   experience.\n\n" + "x".repeat(300);
  const summary = summarizeEvent({ ...EVENT, description: long }, { env: {} });
  assert.ok(summary.description.startsWith("An all-night warehouse experience."));
  assert.ok(summary.description.length <= 200);
  assert.ok(summary.description.endsWith("…"));
  assert.equal(summarizeEvent({ ...EVENT, description: "  \n " }, { env: {} }).description, undefined);
  assert.equal(summarizeEvent({ ...EVENT, description: undefined }, { env: {} }).description, undefined);
});

test("event summaries preserve currency for paid and free events", () => {
  const paid = summarizeEvent({ ...EVENT, price_min: 30, currency: "BRL" });
  assert.equal(paid.currency, "BRL");
  assert.equal(paid.price, "BRL30");
  const free = summarizeEvent({ ...EVENT, price_min: 0, currency: "USD" });
  assert.equal(free.currency, "USD");
  assert.equal(free.price, "free");
});
