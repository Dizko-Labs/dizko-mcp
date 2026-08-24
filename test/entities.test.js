import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { findSceneEntities } from "../src/entities.js";
import { callTool } from "../src/tools.js";

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

function event(id, title, venue, lineup = []) {
  return {
    id,
    title,
    start_time: "2026-10-09T22:00:00Z",
    venue_name: venue,
    venue_city: "berlin",
    lineup,
    genres: ["techno"],
    vibe: [],
    event_types: ["party"]
  };
}

test("scene entity search exposes canonical DJs", async () => {
  let requested;
  const result = await findSceneEntities({ kind: "artist", query: "Nina Kraviz", city: "berlin" }, {
    ...OPTIONS,
    fetch: async (url) => {
      requested = new URL(url);
      return Response.json({
        count: 1,
        total_indexed: 2400,
        items: [{
          id: "nina-kraviz",
          name: "Nina Kraviz",
          kind: "dj",
          cities: ["Berlin"],
          genres: ["techno"],
          instagram_url: "https://instagram.com/ninakraviz"
        }]
      });
    }
  });

  assert.equal(requested.pathname, "/scene/search");
  assert.equal(requested.searchParams.get("kind"), "dj");
  assert.equal(requested.searchParams.get("q"), "Nina Kraviz");
  assert.equal(result.entities[0].name, "Nina Kraviz");
  assert.equal(result.entities[0].dizko_url, "https://www.dizko.app/djs/nina-kraviz");
});

test("DJ profiles include insights and exact upcoming appearances", async () => {
  let eventQuery;
  const result = await findSceneEntities({ kind: "dj", id: "nina-kraviz" }, {
    ...OPTIONS,
    fetch: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname.endsWith("/insights")) {
        return Response.json({
          indexed_events: 1,
          upcoming_events: 1,
          top_venues: [{ name: "Nitsa", count: 1 }],
          related_djs: [{ id: "helena-hauff", name: "Helena Hauff" }]
        });
      }
      if (parsed.pathname === "/events") {
        eventQuery = parsed;
        return Response.json({
          count: 2,
          events: [
            event("nina-1", "OFFWEEK Festival", "Parc del Forum", ["Nina Kraviz"]),
            event("near-1", "Kraviz-inspired night", "Else", ["Someone Else"])
          ]
        });
      }
      return Response.json({
        id: "nina-kraviz",
        name: "Nina Kraviz",
        cities: ["Berlin"],
        genres: ["techno"],
        bio: "DJ and producer."
      });
    }
  });

  assert.equal(eventQuery.searchParams.get("q"), "Nina Kraviz");
  assert.equal(eventQuery.searchParams.get("featuring"), null);
  assert.equal(result.entity.name, "Nina Kraviz");
  assert.equal(result.insights.upcoming_events, 1);
  assert.equal(result.upcoming_events.length, 1);
  assert.equal(result.upcoming_events[0].title, "OFFWEEK Festival");
});

test("venue profiles only return events at the exact venue", async () => {
  const result = await findSceneEntities({ kind: "venue", id: "berghain", city: "berlin" }, {
    ...OPTIONS,
    fetch: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/events") {
        return Response.json({
          count: 2,
          events: [
            event("bh-1", "Klubnacht", "Berghain"),
            event("bh-2", "Afterparty", "Berghain Kantine")
          ]
        });
      }
      return Response.json({
        id: "berghain",
        name: "Berghain",
        cities: ["Berlin"],
        neighborhood: "Friedrichshain"
      });
    }
  });

  assert.equal(result.entity.name, "Berghain");
  assert.equal(result.returned_event_count, 1);
  assert.equal(result.upcoming_events[0].venue, "Berghain");
});

test("collective profiles return catalog data without fabricated event links", async () => {
  let fetchCalls = 0;
  const result = await findSceneEntities({ kind: "collective", id: "fraktvred" }, {
    ...OPTIONS,
    fetch: async () => {
      fetchCalls += 1;
      return Response.json({
        id: "fraktvred",
        name: "Fraktvred",
        cities: ["Berlin"],
        genres: ["techno"],
        bio: "Berlin collective."
      });
    }
  });

  assert.equal(fetchCalls, 1);
  assert.equal(result.entity.name, "Fraktvred");
  assert.equal(result.upcoming_events, undefined);
  assert.match(result.data_note, /no verified collective-to-event links/i);
});

test("promoter lookup requires a city and exposes profile events", async () => {
  const missingCity = await findSceneEntities({ kind: "promoter", query: "Mini Mal" }, OPTIONS);
  assert.deepEqual(missingCity, { error: "Promoter search requires a city", code: "missing_city" });

  const response = await callTool("find_scene_entities", {
    kind: "promoter",
    id: "mini-mal-elektrokneipe",
    city: "berlin"
  }, {
    ...OPTIONS,
    fetch: async () => Response.json({
      slug: "mini-mal-elektrokneipe",
      name: "Mini-Mal Elektrokneipe",
      city: "Berlin",
      city_slug: "berlin",
      genres: ["house"],
      upcoming_count: 1,
      events: [event("promoter-1", "Mini-Mal Night", "://about blank")]
    })
  });

  assert.equal(response.isError, false);
  assert.equal(response.structuredContent.entity.name, "Mini-Mal Elektrokneipe");
  assert.equal(response.structuredContent.entity.dizko_url, "https://www.dizko.app/promoters/berlin/mini-mal-elektrokneipe");
  assert.equal(response.structuredContent.upcoming_events.length, 1);
});
