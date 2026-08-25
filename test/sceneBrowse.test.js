import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { findSceneEntities } from "../src/entities.js";

const OPTIONS = {
  config: {
    apiBaseUrl: "https://api.example.test",
    webBaseUrl: "https://www.dizko.app",
    mcpUrl: "https://mcp.dizko.app/mcp",
    userAgent: "test",
    apiCacheTtlMs: 0
  },
  retries: 0,
  now: new Date("2026-08-24T12:00:00Z")
};

beforeEach(() => clearEventCache());

function event(venue, lineup, attendance = 0, genres = ["techno"]) {
  return {
    id: `e-${venue}-${lineup.join("-")}`,
    title: "Night",
    start_time: "2026-08-30T22:00:00Z",
    venue_name: venue,
    venue_city: "sao paulo",
    lineup,
    genres,
    attendance_count: attendance
  };
}

function eventsOptions(events, capture = {}) {
  return {
    ...OPTIONS,
    fetch: async (url) => {
      capture.url = new URL(url);
      return Response.json({ count: events.length, events });
    }
  };
}

test("kind plus city browses a city's top venues without an id or query", async () => {
  const capture = {};
  const result = await findSceneEntities({ kind: "venue", city: "sao paulo" }, eventsOptions([
    event("Jai Club", ["A"], 100),
    event("Jai Club", ["B"], 50),
    event("Mundo Pensante", ["C"], 900)
  ], capture));

  assert.equal(result.error, undefined);
  assert.equal(result.mode, "browse");
  assert.equal(result.kind, "venue");
  assert.equal(capture.url.pathname, "/events");
  assert.equal(capture.url.searchParams.get("city"), "sao paulo");
  // Bookings rank first, attendance only breaks ties.
  assert.deepEqual(result.entities.map((entity) => entity.name), ["Jai Club", "Mundo Pensante"]);
  assert.equal(result.entities[0].event_count, 2);
});

test("browse drops listings that use the city itself as the venue", async () => {
  const result = await findSceneEntities({ kind: "venue", city: "sao paulo" }, eventsOptions([
    // Accented spelling of the requested city - a placeholder, not a venue.
    event("São Paulo", ["A"]),
    event("São Paulo", ["B"]),
    event("TBA", ["C"]),
    event("Jai Club", ["D"])
  ]));

  assert.deepEqual(result.entities.map((entity) => entity.name), ["Jai Club"]);
});

test("browsing artists ranks lineup appearances and cites the venues", async () => {
  const result = await findSceneEntities({ kind: "artist", city: "sao paulo" }, eventsOptions([
    event("Jai Club", ["Sven Vath", "Ciel"], 400),
    event("Mundo Pensante", ["Sven Vath"], 100)
  ]));

  assert.equal(result.mode, "browse");
  assert.equal(result.entities[0].name, "Sven Vath");
  assert.equal(result.entities[0].event_count, 2);
  assert.deepEqual(result.entities[0].venues, ["Jai Club", "Mundo Pensante"]);
});

test("browse states the sample it ranked over", async () => {
  const result = await findSceneEntities({ kind: "venue", city: "sao paulo" }, {
    ...OPTIONS,
    fetch: async () => Response.json({ count: 1004, events: [event("Jai Club", ["A"])] })
  });

  assert.equal(result.evidence.total_available, 1004);
  assert.equal(result.evidence.sample_size, 1);
  assert.match(result.evidence.note, /highest-attendance/);
});

test("browsing promoters ranks by upcoming event count", async () => {
  const result = await findSceneEntities({ kind: "promoter", city: "sao paulo" }, {
    ...OPTIONS,
    fetch: async () => Response.json({
      city: "sao paulo",
      city_slug: "sao-paulo",
      promoters: [
        { slug: "beon", name: "BEON-Entertainment", upcoming_count: 3, genres: ["techno"] },
        { slug: "d-edge", name: "D-EDGE", upcoming_count: 4, genres: ["house"] }
      ]
    })
  });

  assert.deepEqual(result.entities.map((entity) => entity.name), ["D-EDGE", "BEON-Entertainment"]);
  assert.equal(result.entities[0].dizko_url, "https://www.dizko.app/promoters/sao-paulo/d-edge");
});

test("browsing collectives refuses rather than ranking noise", async () => {
  const result = await findSceneEntities({ kind: "collective", city: "sao paulo" }, {
    ...OPTIONS,
    fetch: async () => {
      throw new Error("browse must not reach the network for collectives");
    }
  });

  assert.equal(result.code, "browse_unavailable");
});

test("no id, no query and no city still explains what is missing", async () => {
  const result = await findSceneEntities({ kind: "venue" }, OPTIONS);
  assert.equal(result.code, "missing_entity_lookup");
  assert.match(result.error, /city/);
});
