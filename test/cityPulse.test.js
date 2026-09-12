import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { cityPulse } from "../src/cityPulse.js";
import { callTool } from "../src/tools.js";

beforeEach(() => clearEventCache());

// A Thursday in Berlin (CEST, UTC+2). The 3-day window is Thu 10 - Sat 12.
const NOW = new Date("2026-09-10T12:00:00Z");

function pulseEvent(id, { start, venue, genres = [], attendance = 0, price = null }) {
  return {
    id,
    title: `Event ${id}`,
    start_time: start,
    venue_name: venue,
    venue_city: "berlin",
    genres,
    vibe: [],
    event_types: ["party"],
    attendance_count: attendance,
    price_min: price
  };
}

const EVENTS = [
  // Thu 10 Sep, 22:00 local.
  pulseEvent("e1", { start: "2026-09-10T20:00:00Z", venue: "Berghain", genres: ["techno"], attendance: 900 }),
  // Fri 11 Sep, 22:00 local.
  pulseEvent("e5", { start: "2026-09-11T20:00:00Z", venue: "Uber Eck", genres: ["ambient"], attendance: 2000 }),
  // 23:00 UTC on the 11th is already Sat 12 Sep, 01:00 in Berlin.
  pulseEvent("e2", { start: "2026-09-11T23:00:00Z", venue: "Berghain", genres: ["techno"], attendance: 500 }),
  // Sat 12 Sep, 03:00 local.
  pulseEvent("e3", { start: "2026-09-12T01:00:00Z", venue: "Tresor", genres: ["techno", "acid"], attendance: 200 }),
  // Sat 12 Sep, 22:00 local, free entry, no attendance signal.
  pulseEvent("e4", { start: "2026-09-12T20:00:00Z", venue: "Panke", genres: ["jazz"], price: 0 })
];

test("cityPulse aggregates city-local nights, weighted venues, genres, and headliners with evidence counts", async () => {
  let requestedUrl = null;
  const pulse = await cityPulse({ city: "berlin", days: 3 }, {
    now: NOW,
    fetch: async (url) => {
      requestedUrl = new URL(url);
      return Response.json({ count: 40, events: EVENTS });
    }
  });

  assert.equal(requestedUrl.searchParams.get("city"), "berlin");
  assert.equal(requestedUrl.searchParams.get("date_from"), "2026-09-10");
  assert.equal(requestedUrl.searchParams.get("date_to"), "2026-09-12");
  assert.equal(requestedUrl.searchParams.get("limit"), "200");

  assert.equal(pulse.city, "berlin");
  assert.equal(pulse.timezone, "Europe/Berlin");
  assert.equal(pulse.date_from, "2026-09-10");
  assert.equal(pulse.date_to, "2026-09-12");
  assert.equal(pulse.days, 3);
  assert.equal(pulse.total_available, 40);
  assert.equal(pulse.sample_size, 5);
  assert.match(pulse.sample_note, /highest-attendance/);

  // Nights are bucketed by the city's local date: e2 (23:00Z Fri) and e3
  // (01:00Z Sat) both belong to Saturday in Berlin.
  assert.deepEqual(pulse.busiest_nights, [
    { date: "2026-09-12", weekday: "saturday", events: 3 },
    { date: "2026-09-10", weekday: "thursday", events: 1 },
    { date: "2026-09-11", weekday: "friday", events: 1 }
  ]);

  // Venues rank by events + total_attendance / 100: one 2000-strong night
  // (weight 21) beats two Berghain nights (weight 16). The weight itself
  // is internal and stays out of the payload.
  assert.deepEqual(pulse.top_venues, [
    { venue: "Uber Eck", events: 1, total_attendance: 2000 },
    { venue: "Berghain", events: 2, total_attendance: 1400 },
    { venue: "Tresor", events: 1, total_attendance: 200 },
    { venue: "Panke", events: 1, total_attendance: 0 }
  ]);
  assert.ok(pulse.top_venues.every((venue) => !("weight" in venue)));

  assert.deepEqual(pulse.top_genres[0], { genre: "techno", events: 3 });
  assert.equal(pulse.top_genres.length, 4);

  assert.deepEqual(pulse.headliners.map((event) => event.id), ["e5", "e1", "e2", "e3"], "zero-attendance events stay out of headliners");
  assert.equal(pulse.headliners[0].when, "Fri 11 Sep, 22:00");
  assert.equal(pulse.headliners[0].timezone, "Europe/Berlin");
  assert.equal(pulse.headliners[0].venue, "Uber Eck");
  assert.equal(pulse.headliners[2].when, "Sat 12 Sep, 01:00");
  assert.equal(pulse.free_events_in_sample, 1);
});

test("cityPulse rejects a malformed date_from before fetching", async () => {
  let called = false;
  await assert.rejects(
    cityPulse({ city: "berlin", date_from: "next friday" }, { now: NOW, fetch: async () => { called = true; return Response.json({ events: [] }); } }),
    (error) => error.name === "ToolInputError" && error.field === "date_from"
  );
  assert.equal(called, false);
});

test("dizko_city_pulse tool wraps the aggregates with a grounding instruction", async () => {
  const options = {
    now: NOW,
    fetch: async () => Response.json({
      count: 1,
      events: [pulseEvent("only", { start: "2026-09-10T20:00:00Z", venue: "OHM", genres: ["dub"], attendance: 80 })]
    })
  };

  const result = await callTool("dizko_city_pulse", { city: "berlin" }, options);
  const body = JSON.parse(result.content[0].text);
  assert.equal(result.isError, false);
  assert.equal(body.city, "Berlin", "the tool reports the display name");
  assert.equal(body.timezone, "Europe/Berlin");
  assert.equal(body.days, 7);
  assert.equal(body.sample_size, 1);
  assert.deepEqual(body.busiest_nights, [{ date: "2026-09-10", weekday: "thursday", events: 1 }]);
  assert.match(body.sample_note, /full inventory/);
  assert.match(body.assistant_instruction, /evidence counts/);

  // The pre-0.8 name still routes to the same handler.
  const legacy = await callTool("get_city_pulse", { city: "berlin" }, options);
  assert.equal(legacy.isError, false);
  assert.equal(JSON.parse(legacy.content[0].text).sample_size, 1);
});
