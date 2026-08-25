import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { findSceneEntities, rankSceneResults, venueNameMatches, venueQueryTerms } from "../src/entities.js";
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

test("venue name matching compares rooms, not raw strings", () => {
  // The join has to survive different spellings of the same rooms...
  assert.equal(venueNameMatches("Berghain / Panorama Bar", "Berghain | Panorama Bar | Säule"), true);
  assert.equal(venueNameMatches("Berghain / Panorama Bar", "Berghain"), true);
  assert.equal(venueNameMatches("Tresor", "Tresor / Globus"), true);
  assert.equal(venueNameMatches("Tresor", "Tresor Berlin"), true);
  // ...without collapsing venues that merely share a word.
  assert.equal(venueNameMatches("Berghain", "Berghain Kantine"), false);
  assert.equal(venueNameMatches("Berghain / Panorama Bar", "Kantine, Berghain"), false);
  assert.equal(venueNameMatches("BASEMENT", "Pacha NYC Basement"), false);
  assert.equal(venueNameMatches("The Bar", "Berghain | Panorama Bar | Säule"), false);
});

test("venue query terms fall back to the profile name's rooms", () => {
  assert.deepEqual(
    venueQueryTerms("Berghain / Panorama Bar"),
    ["Berghain / Panorama Bar", "Berghain", "Panorama Bar"]
  );
  assert.deepEqual(venueQueryTerms("Nowadays"), ["Nowadays"]);
  assert.deepEqual(venueQueryTerms(""), []);
});

test("venue profiles retry with a room name when the full name matches nothing", async () => {
  const venueQueries = [];
  const result = await findSceneEntities({ kind: "venue", id: "berghain", city: "berlin" }, {
    ...OPTIONS,
    fetch: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/events") {
        const venue = parsed.searchParams.get("venue");
        venueQueries.push(venue);
        // Mirrors the live API: `venue` is matched as a substring of
        // venue_name, so the full profile name finds nothing.
        if (venue !== "Berghain") return Response.json({ count: 0, events: [] });
        return Response.json({
          count: 2,
          events: [
            event("bh-1", "Klubnacht", "Berghain | Panorama Bar | Säule"),
            event("bh-2", "Afterparty", "Berghain Kantine")
          ]
        });
      }
      return Response.json({
        id: "berghain",
        name: "Berghain / Panorama Bar",
        cities: ["Berlin"]
      });
    }
  });

  assert.deepEqual(venueQueries, ["Berghain / Panorama Bar", "Berghain"]);
  assert.equal(result.returned_event_count, 1);
  assert.equal(result.venue_query, "Berghain");
  assert.deepEqual(result.matched_venue_names, ["Berghain | Panorama Bar | Säule"]);
});

test("venue profiles with no indexed events say so instead of returning a bare zero", async () => {
  const result = await findSceneEntities({ kind: "venue", id: "sisyphos", city: "berlin" }, {
    ...OPTIONS,
    fetch: async (url) => {
      const parsed = new URL(url);
      if (parsed.pathname === "/events") return Response.json({ count: 0, events: [] });
      return Response.json({ id: "sisyphos", name: "Sisyphos", cities: ["Berlin"] });
    }
  });

  assert.equal(result.returned_event_count, 0);
  assert.match(result.data_note, /no upcoming indexed events/);
});

function sceneItem(id, name, score, extra = {}) {
  return { id, kind: "venue", name, cities: ["Berlin"], score, ...extra };
}

test("canonical Dizko profiles outrank thin third-party stubs of the same place", () => {
  const ranked = rankSceneResults([
    sceneItem("wd-q136975", "Berghain", 0.0653, { source_url: "https://www.wikidata.org/wiki/Q136975" }),
    sceneItem("osm-way-286165789", "Berghain Kantine", 0.0648, { source_url: "https://www.openstreetmap.org/way/286165789" }),
    sceneItem("berghain", "Berghain / Panorama Bar", 0.0635, { profile_url: "https://greenroom.dance/venue/berghain" })
  ], "venue");

  // The stub named exactly "Berghain" folds into the native profile...
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].profile.id, "berghain");
  assert.equal(ranked[0].source, "dizko");
  assert.deepEqual(ranked[0].mergedSources, ["wikidata"]);
  // ...while Berghain Kantine stays its own venue.
  assert.equal(ranked[1].profile.id, "osm-way-286165789");
  assert.equal(ranked[1].source, "openstreetmap");
});

test("merging a duplicate keeps the canonical identity and only backfills descriptions", () => {
  const [merged] = rankSceneResults([
    sceneItem("wd-q136975", "Berghain", 0.07, {
      source_url: "https://www.wikidata.org/wiki/Q136975",
      website_url: "https://www.berghain.berlin/en/",
      country: "Germany"
    }),
    sceneItem("berghain", "Berghain / Panorama Bar", 0.06, {
      profile_url: "https://greenroom.dance/venue/berghain",
      country: null
    })
  ], "venue");

  assert.equal(merged.profile.id, "berghain");
  assert.equal(merged.profile.name, "Berghain / Panorama Bar");
  // Provenance never crosses over from the stub...
  assert.equal(merged.profile.source_url, undefined);
  assert.equal(merged.profile.profile_url, "https://greenroom.dance/venue/berghain");
  // ...but a field the canonical record lacks is filled in.
  assert.equal(merged.profile.website_url, "https://www.berghain.berlin/en/");
  assert.equal(merged.profile.country, "Germany");
});

test("the canonical boost is bounded, so a far better stub still wins", () => {
  const ranked = rankSceneResults([
    sceneItem("wd-q30941469", "Zhuhai Opera House", 0.065, { source_url: "https://www.wikidata.org/wiki/Q30941469" }),
    sceneItem("ohm", "OHM", 0.016, { profile_url: "https://greenroom.dance/venue/ohm" })
  ], "venue");

  assert.equal(ranked[0].profile.id, "wd-q30941469");
  assert.equal(ranked[1].profile.id, "ohm");
});

test("scene search reports source and canonical flags per entity", async () => {
  const result = await findSceneEntities({ kind: "venue", query: "Berghain" }, {
    ...OPTIONS,
    fetch: async () => Response.json({
      count: 2,
      total_indexed: 109724,
      items: [
        sceneItem("wd-q136975", "Berghain", 0.0653, { source_url: "https://www.wikidata.org/wiki/Q136975" }),
        sceneItem("berghain", "Berghain / Panorama Bar", 0.0635, { profile_url: "https://greenroom.dance/venue/berghain" })
      ]
    })
  });

  assert.equal(result.count, 1);
  assert.equal(result.entities[0].id, "berghain");
  assert.equal(result.entities[0].source, "dizko");
  assert.equal(result.entities[0].canonical, true);
  assert.deepEqual(result.entities[0].merged_sources, ["wikidata"]);
});

function sceneSearchOptions(items) {
  return {
    ...OPTIONS,
    fetch: async () => Response.json({ count: items.length, total_indexed: 109724, items })
  };
}

test("scene search reports a relevance signal per hit", async () => {
  const result = await findSceneEntities({ kind: "artist", query: "Nina Kraviz" }, sceneSearchOptions([
    { id: "nina-kraviz", kind: "dj", name: "Nina Kraviz", score: 0.0656, semantic_similarity: 0.7189, matched_text: true },
    { id: "nina-rabe", kind: "dj", name: "Nina Rabe", score: 0.0588, semantic_similarity: 0.5753, matched_text: true }
  ]));

  assert.equal(result.count, 2);
  assert.equal(result.entities[0].relevance, 0.0656);
  assert.equal(result.entities[0].semantic_similarity, 0.7189);
  assert.equal(result.entities[0].match, "name");
});

test("a query with no real match returns nothing rather than plausible names", async () => {
  // What the live index returns for nonsense: the semantic retriever's
  // nearest vectors, all at the reciprocal-rank floor with no text match.
  const result = await findSceneEntities({ kind: "artist", query: "zzzqqq nonexistent" }, sceneSearchOptions([
    { id: "bugged", kind: "dj", name: "Bugged", score: 0.0164, semantic_similarity: 0.6207, matched_text: false },
    { id: "critical-error-404", kind: "dj", name: "CRITICAL ERROR 404", score: 0.0161, semantic_similarity: 0.6179, matched_text: false },
    { id: "t-error-404", kind: "dj", name: "T_error 404", score: 0.0159, semantic_similarity: 0.6153, matched_text: false }
  ]));

  assert.equal(result.count, 0);
  assert.equal(result.no_match, true);
  assert.deepEqual(result.entities, []);
  assert.deepEqual(result.nearest_matches.map((item) => item.name), ["Bugged", "CRITICAL ERROR 404", "T_error 404"]);
  assert.match(result.data_note, /never as an answer/);
});

test("descriptive queries stay above the confidence floor", async () => {
  const result = await findSceneEntities({ kind: "artist", query: "dark hypnotic warehouse techno" }, sceneSearchOptions([
    { id: "hypnotic-inc", kind: "dj", name: "HYPNOTIC INC.", score: 0.0643, semantic_similarity: 0.6911, matched_text: true }
  ]));

  assert.equal(result.no_match, undefined);
  assert.equal(result.count, 1);
  assert.equal(result.entities[0].match, "name");
});

test("an upstream without matched_text falls back to the score floor", async () => {
  const matched = await findSceneEntities({ kind: "artist", query: "Nina Kraviz" }, sceneSearchOptions([
    { id: "nina-kraviz", kind: "dj", name: "Nina Kraviz", score: 0.0656 }
  ]));
  assert.equal(matched.count, 1);

  const unmatched = await findSceneEntities({ kind: "artist", query: "zzzqqq" }, sceneSearchOptions([
    { id: "bugged", kind: "dj", name: "Bugged", score: 0.0164 }
  ]));
  assert.equal(unmatched.no_match, true);
});

test("the index size is reported as an all-kinds figure, not a per-kind count", async () => {
  // Upstream returns the same 109,724 for every kind, so the field name has
  // to stop a caller inferring "109,724 venues".
  const result = await findSceneEntities({ kind: "venue", query: "Berghain" }, sceneSearchOptions([
    { id: "berghain", kind: "venue", name: "Berghain / Panorama Bar", score: 0.0635, matched_text: true }
  ]));

  assert.equal(result.total_indexed_all_kinds, 109724);
  assert.equal(result.total_indexed, undefined);
});

test("a kind:dj request is answered in the caller's own word", async () => {
  const result = await findSceneEntities({ kind: "dj", query: "Nina Kraviz" }, sceneSearchOptions([
    { id: "nina-kraviz", kind: "dj", name: "Nina Kraviz", score: 0.0656, matched_text: true }
  ]));

  assert.equal(result.kind, "dj");
  // The alias is named rather than applied silently.
  assert.equal(result.kind_canonical, "artist");
  assert.equal(result.entities[0].kind, "dj");
  // The canonical kind still drives the URL shape.
  assert.equal(result.entities[0].dizko_url, "https://www.dizko.app/djs/nina-kraviz");
});

test("a kind:artist request is unchanged and carries no alias field", async () => {
  const result = await findSceneEntities({ kind: "artist", query: "Nina Kraviz" }, sceneSearchOptions([
    { id: "nina-kraviz", kind: "dj", name: "Nina Kraviz", score: 0.0656, matched_text: true }
  ]));

  assert.equal(result.kind, "artist");
  assert.equal(result.kind_canonical, undefined);
  assert.equal(result.entities[0].kind, "artist");
});

function promotersOptions(promoters, extra = {}) {
  return {
    ...OPTIONS,
    fetch: async () => Response.json({ city: "berlin", city_slug: "berlin", count: promoters.length, promoters, ...extra })
  };
}

const BERLIN_PROMOTERS = [
  { slug: "mini-mal-elektrokneipe", name: "mini.mal elektrokneipe", upcoming_count: 59, genres: ["minimal"] },
  { slug: "d-edge", name: "D-EDGE", upcoming_count: 4, genres: ["house"] },
  { slug: "sensorium", name: "Sensorium", upcoming_count: 20, genres: ["techno"] }
];

test("promoter search folds punctuation, so \"d edge\" finds D-EDGE", async () => {
  const result = await findSceneEntities(
    { kind: "promoter", city: "berlin", query: "d edge" },
    promotersOptions(BERLIN_PROMOTERS)
  );

  assert.equal(result.count, 1);
  assert.equal(result.entities[0].name, "D-EDGE");
});

test("a city Dizko indexes no promoters for reports a coverage gap, not a failed query", async () => {
  const result = await findSceneEntities(
    { kind: "promoter", city: "lagos", query: "anything" },
    promotersOptions([], { city: "lagos", city_slug: "lagos" })
  );

  assert.equal(result.count, 0);
  assert.equal(result.no_match, true);
  assert.equal(result.evidence.promoters_scanned, 0);
  assert.match(result.data_note, /coverage gap/);
  // Nothing to suggest, so no misleading "did you mean".
  assert.equal(result.nearest_matches, undefined);
});

test("a query matching none of a populated city says how many it scanned", async () => {
  const result = await findSceneEntities(
    { kind: "promoter", city: "berlin", query: "zzzznope" },
    promotersOptions(BERLIN_PROMOTERS)
  );

  assert.equal(result.no_match, true);
  assert.equal(result.evidence.promoters_scanned, 3);
  assert.match(result.data_note, /out of 3 scanned/);
  assert.equal(result.nearest_matches.length, 3);
});

test("a genre filter that excludes everything is named as the reason", async () => {
  const result = await findSceneEntities(
    { kind: "promoter", city: "berlin", query: "anything", genre: "polka" },
    promotersOptions(BERLIN_PROMOTERS)
  );

  assert.equal(result.no_match, true);
  assert.match(result.data_note, /tagged with genre "polka"/);
  assert.equal(result.nearest_matches, undefined);
});

test("a truncated promoter list says the match was partial", async () => {
  const result = await findSceneEntities(
    { kind: "promoter", city: "berlin", query: "sensorium" },
    // count exceeds the returned page: the 200 ceiling truncated the city.
    promotersOptions(BERLIN_PROMOTERS, { count: 240 })
  );

  assert.equal(result.count, 1);
  assert.match(result.data_note, /first 3 of 240 promoters/);
});
