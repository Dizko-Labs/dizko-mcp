import assert from "node:assert/strict";
import test from "node:test";
import { connectorPage, decodeEventCursor, encodeEventCursor } from "../src/connectorV1.js";
import { callTool, tools } from "../src/tools.js";

test("connector cursors are opaque, stable, and reject malformed values", () => {
  const cursor = encodeEventCursor(12);
  assert.equal(decodeEventCursor(cursor), 12);
  assert.throws(() => decodeEventCursor("not-a-cursor"), /Invalid cursor/);
});

test("connector pages carry a version and next cursor", () => {
  const page = connectorPage({ events: [{ id: "a" }], total: 3, limit: 1, offset: 0 });
  assert.equal(page.contract_version, "2026-09-19");
  assert.equal(decodeEventCursor(page.page.next_cursor), 1);
});

test("Muse V1 read tools have stable names and read-only annotations", () => {
  const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
  for (const name of ["search_events", "get_event", "get_artist", "get_venue", "recommend_events"]) {
    assert.equal(byName[name].annotations.readOnlyHint, true, name);
    assert.equal(byName[name].annotations.destructiveHint, false, name);
    assert.equal(byName[name].annotations.idempotentHint, true, name);
  }
});

test("search_events returns normalized provenance, freshness and cursor metadata", async () => {
  const result = await callTool("search_events", { city: "berlin", limit: 1 }, {
    now: new Date("2026-09-19T10:00:00Z"),
    fetch: async () => new Response(JSON.stringify({ count: 2, events: [{
      id: "event-1",
      title: "Live test",
      source: "resident_advisor",
      start_time: "2026-09-20T20:00:00+02:00",
      end_time: "2026-09-21T02:00:00+02:00",
      venue_name: "Test Venue",
      venue_city: "berlin",
      price_min: 10,
      price_max: 20,
      currency: "EUR",
      ticket_url: "https://tickets.example/event-1"
    }] }), { status: 200, headers: { "Content-Type": "application/json" } })
  });
  const body = result.structuredContent;
  assert.equal(body.contract_version, "2026-09-19");
  assert.ok(body.page.next_cursor);
  assert.equal(body.events[0].source_url, "https://tickets.example/event-1");
  assert.equal(body.events[0].availability.confidence, "low");
  assert.equal(body.events[0].price_freshness.status, "unverified");
  assert.match(body.events[0].starts_at, /\+02:00$/);
});
