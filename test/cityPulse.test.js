import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { cityPulse } from "../src/cityPulse.js";
import { callTool } from "../src/tools.js";

beforeEach(() => clearEventCache());

const NOW = new Date("2026-08-07T12:00:00Z");

function pulseEvent(id, { date, venue, genres = [], attendance = 0, price = null }) {
  return {
    id,
    title: `Event ${id}`,
    start_time: `${date}T22:00:00Z`,
    venue_name: venue,
    venue_city: "berlin",
    genres,
    vibe: [],
    event_types: ["party"],
    attendance_count: attendance,
    price_min: price
  };
}

test("cityPulse aggregates nights, venues, genres, and headliners with evidence counts", async () => {
  const events = [
    pulseEvent("e1", { date: "2026-08-07", venue: "Berghain", genres: ["techno"], attendance: 900 }),
    pulseEvent("e2", { date: "2026-08-08", venue: "Berghain", genres: ["techno"], attendance: 500 }),
    pulseEvent("e3", { date: "2026-08-08", venue: "Tresor", genres: ["techno", "acid"], attendance: 200 }),
    pulseEvent("e4", { date: "2026-08-08", venue: "Panke", genres: ["jazz"], price: 0 })
  ];
  let requestedUrl = null;
  const pulse = await cityPulse({ city: "berlin", days: 3 }, {
    now: NOW,
    fetch: async (url) => {
      requestedUrl = new URL(url);
      return Response.json({ count: 40, events });
    }
  });

  assert.equal(requestedUrl.searchParams.get("date_from"), "2026-08-07");
  assert.equal(requestedUrl.searchParams.get("date_to"), "2026-08-09");
  assert.equal(requestedUrl.searchParams.get("limit"), "200");

  assert.equal(pulse.total_available, 40);
  assert.equal(pulse.sample_size, 4);
  assert.match(pulse.sample_note, /highest-attendance/);

  assert.deepEqual(pulse.busiest_nights[0], { date: "2026-08-08", weekday: "saturday", events: 3 });
  assert.deepEqual(pulse.top_venues[0], { venue: "Berghain", events: 2, total_attendance: 1400 });
  assert.deepEqual(pulse.top_genres[0], { genre: "techno", events: 3 });
  assert.equal(pulse.headliners[0].id, "e1");
  assert.equal(pulse.headliners.length, 3, "zero-attendance events stay out of headliners");
  assert.equal(pulse.free_events_in_sample, 1);
});

test("get_city_pulse tool wraps the aggregates with a grounding instruction", async () => {
  const result = await callTool("get_city_pulse", { city: "berlin" }, {
    now: NOW,
    fetch: async () => Response.json({
      count: 1,
      events: [pulseEvent("only", { date: "2026-08-07", venue: "OHM", genres: ["dub"], attendance: 80 })]
    })
  });
  const body = JSON.parse(result.content[0].text);
  assert.equal(result.isError, false);
  assert.equal(body.sample_size, 1);
  assert.match(body.sample_note, /full inventory/);
  assert.match(body.assistant_instruction, /evidence counts/);
});
