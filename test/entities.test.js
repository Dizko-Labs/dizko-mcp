import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import {
  artistHandle,
  findArtist,
  findPromoter,
  findSceneEntities,
  findVenue,
  MATCH_TIER,
  matchTier,
  venueMatches,
  venueTokens
} from "../src/entities.js";
import { ToolInputError } from "../src/errors.js";
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

function event(id, title, venue, lineup = [], extra = {}) {
  return {
    id,
    title,
    start_time: "2026-10-09T22:00:00Z",
    venue_name: venue,
    venue_city: "berlin",
    lineup,
    genres: ["techno"],
    vibe: [],
    event_types: ["party"],
    ...extra
  };
}

// Mock fetch: `handler(url)` returns a JSON body, `[body, status]`, or a
// Response. Every request is recorded on `fetch.calls`.
function fakeFetch(handler) {
  const calls = [];
  const fetch = async (url) => {
    const parsed = new URL(url);
    calls.push(parsed);
    const result = await handler(parsed);
    if (result instanceof Response) return result;
    if (Array.isArray(result)) return Response.json(result[0], { status: result[1] });
    return Response.json(result);
  };
  fetch.calls = calls;
  return fetch;
}

const NOT_FOUND = [{ error: "not found" }, 404];
const paths = (fetch) => fetch.calls.map((url) => url.pathname);

// ---------- lookups ----------

test("find helpers require a query or an id", async () => {
  for (const [name, fn] of [["findArtist", findArtist], ["findVenue", findVenue], ["findPromoter", findPromoter]]) {
    for (const input of [{}, { query: "   " }, { city: "berlin" }]) {
      await assert.rejects(fn(input, OPTIONS), (error) => {
        assert.ok(error instanceof ToolInputError, `${name} should throw ToolInputError`);
        assert.equal(error.code, "invalid_argument");
        assert.equal(error.field, "query");
        return true;
      });
    }
  }

  for (const tool of ["dizko_find_artist", "dizko_find_venue", "dizko_find_promoter"]) {
    const response = await callTool(tool, { city: "berlin" }, { ...OPTIONS, fetch: fakeFetch(() => { throw new Error("must not fetch"); }) });
    assert.equal(response.isError, true, `${tool} without a lookup is an input error`);
    assert.equal(response.structuredContent.code, "invalid_argument");
    assert.match(response.structuredContent.error, /query/);
  }
});

// ---------- artists ----------

test("artist search exposes canonical DJs with scores, handles and a best match", async () => {
  const fetch = fakeFetch(() => ({
    count: 4,
    total_indexed: 2400,
    items: [
      { id: "nina-kraviz", name: "Nina Kraviz", kind: "dj", cities: ["Berlin"], genres: ["techno"], score: 0.98765, instagram_url: "https://instagram.com/ninakraviz" },
      { id: "nina-kraviz-b2b-helena-hauff", name: "Nina Kraviz b2b Helena Hauff", kind: "dj", score: 0.7 },
      { id: "amelie-lens", name: "Amelie Lens", kind: "dj", score: 0.4 },
      { id: "ben-klock", name: "Ben Klock", kind: "dj", score: 0.3 }
    ]
  }));
  const result = await findArtist({ query: "Nina Kraviz", city: "berlin" }, { ...OPTIONS, fetch });

  const requested = fetch.calls[0];
  assert.equal(requested.pathname, "/scene/search");
  assert.equal(requested.searchParams.get("kind"), "dj");
  assert.equal(requested.searchParams.get("q"), "Nina Kraviz");
  assert.equal(requested.searchParams.get("city"), "berlin");

  assert.equal(result.mode, "search");
  assert.equal(result.kind, "artist");
  assert.equal(result.query, "Nina Kraviz");
  assert.equal(result.city, "berlin");
  assert.equal(result.count, 4);
  assert.equal(result.total_indexed, 2400);
  assert.deepEqual(result.entities.map((entity) => entity.name), ["Nina Kraviz", "Nina Kraviz b2b Helena Hauff"], "semantic filler rows are dropped when names match the query");
  assert.equal(result.entities[0].kind, "artist");
  assert.equal(result.entities[0].dizko_url, "https://www.dizko.app/NinaKraviz");
  assert.equal(result.entities[0].match_score, 0.988, "upstream score is rounded to 3 decimals");
  assert.deepEqual(result.entities[0].links, { instagram: "https://instagram.com/ninakraviz" });
  assert.deepEqual(result.best_match, {
    id: "nina-kraviz",
    name: "Nina Kraviz",
    confident: true,
    // Runner-up names travel with the match so the model can offer them
    // without a second round trip.
    alternatives: [{ id: "nina-kraviz-b2b-helena-hauff", name: "Nina Kraviz b2b Helena Hauff", cities: [], genres: [] }]
  });
});

test("artist search falls back to text matches and flags weak best matches", async () => {
  const fetch = fakeFetch(() => ({
    count: 3,
    items: [
      { id: "ben-klock", name: "Ben Klock", kind: "dj" },
      { id: "dj-koze", name: "DJ Koze", kind: "dj", matched_text: true },
      { id: "amelie-lens", name: "Amelie Lens", kind: "dj" }
    ]
  }));
  const result = await findArtist({ query: "koze pampa" }, { ...OPTIONS, fetch });
  assert.deepEqual(result.entities.map((entity) => entity.id), ["dj-koze"]);
  assert.deepEqual(result.best_match, { id: "dj-koze", name: "DJ Koze", confident: false });
  assert.equal(result.city, null);
  assert.equal(result.total_indexed, null);
});

test("artistHandle builds camel-case public handles and keeps non-ASCII letters", () => {
  assert.equal(artistHandle("nina-kraviz"), "NinaKraviz");
  assert.equal(artistHandle("röyksopp"), "Röyksopp");
  assert.equal(artistHandle("  DJ Koze "), "DjKoze");
  assert.equal(artistHandle(""), "");
});

test("artist profiles include the page, insights, split appearances and deduplicated upcoming events", async () => {
  const fetch = fakeFetch((url) => {
    switch (url.pathname) {
      case "/scene/profiles/dj/nina-kraviz":
        return { id: "nina-kraviz", name: "Nina Kraviz", cities: ["Berlin"], genres: ["techno"], bio: "DJ and producer.", soundcloud_url: "https://soundcloud.com/ninakraviz" };
      case "/scene/profiles/dj/nina-kraviz/insights":
        return {
          indexed_events: 42,
          upcoming_events: 3,
          first_event_at: "2019-01-05T00:00:00Z",
          latest_event_at: "2026-10-09T22:00:00Z",
          top_venues: [{ name: "Nitsa", count: 4 }],
          related_djs: Array.from({ length: 10 }, (_, index) => ({ id: `related-${index}`, name: `Related ${index}` })),
          modified_at: "2026-08-20T00:00:00Z"
        };
      case "/scene/directory/djs/nina-kraviz":
        return {
          dj: {
            id: "nina-kraviz",
            experience_level: "headliner",
            event_types: ["club night", "festival"],
            venues_played: Array.from({ length: 14 }, (_, index) => `Venue ${index}`),
            mixes: [{ id: "mix-1", title: "Live at Nitsa", url: "https://soundcloud.com/nina/live-at-nitsa", published_at: "2026-08-20T10:00:00Z", duration: "01:20:00", plays: 9 }],
            press_clips: [{ title: "Interview", publication: "RA", url: "https://ra.co/features/1", published_at: "2026-05-01", body: "dropped" }],
            appearances: [
              { id: "ra-3", title: "Nina Kraviz at Nitsa", date: "2026-10-09T22:00:00Z", city: "Barcelona", venue: "Nitsa", event_url: "https://ra.co/events/ra-3" },
              { id: "ra-old", title: "Spring show", date: "2026-06-01", city: "Berlin", venue: "Berghain" },
              { id: "ra-1", title: "Tonight", date: "2026-08-24", city: "Barcelona", venue: "Razzmatazz" },
              { id: "ra-2", title: "September", date: "2026-09-01", city: "Berlin", venue: "Berghain", is_festival: false },
              { id: "ra-undated", title: "Undated", venue: "Somewhere" },
              { id: "ra-older", title: "Summer show", date: "2026-07-15", city: "Berlin", venue: "Tresor" }
            ]
          }
        };
      case "/artist-pages/public/for-artist/NinaKraviz":
        return {
          slug: "ninakraviz",
          published_at: "2026-08-01T00:00:00Z",
          page: {
            blocks: [
              { type: "embed", id: "blk-1", payload: { title: "Live at Nitsa", provider: "soundcloud", url: "https://soundcloud.com/nina/live-at-nitsa" } },
              { type: "text", id: "blk-2", payload: { text: "Bio" } },
              { type: "embed", id: 3, payload: { title: "Bad id" } }
            ]
          }
        };
      case "/events":
        return {
          count: 4,
          events: [
            event("nina-2", "OFFWEEK Festival", "Parc del Forum", ["Nina Kraviz"], { start_time: "2026-10-09T22:00:00Z" }),
            event("nina-1", "Nina Kraviz all night long", "Nitsa", [], { start_time: "2026-09-05T23:00:00Z" }),
            event("dup-1", "Nina Kraviz all night long", "NITSA", ["Nina Kraviz"], { start_time: "2026-09-05T23:00:00Z", ticket_url: "https://ra.co/events/dup-1" }),
            event("near-1", "Kraviz-inspired night", "Else", ["Someone Else"], { description: "Inspired by Nina Kraviz." })
          ]
        };
      default:
        throw new Error(`Unexpected request: ${url.pathname}`);
    }
  });

  const result = await findArtist({ id: "nina-kraviz", city: "barcelona" }, { ...OPTIONS, fetch });

  const eventQuery = fetch.calls.find((url) => url.pathname === "/events");
  assert.equal(eventQuery.searchParams.get("q"), "Nina Kraviz");
  assert.equal(eventQuery.searchParams.get("sort_by"), "soonest");
  assert.equal(eventQuery.searchParams.get("city"), "barcelona");
  assert.equal(eventQuery.searchParams.get("date_from"), "2026-08-24");
  assert.equal(eventQuery.searchParams.get("featuring"), null);

  assert.equal(result.mode, "profile");
  assert.equal(result.kind, "artist");
  assert.equal(result.entity.name, "Nina Kraviz");
  assert.equal(result.entity.kind, "artist");
  assert.equal(result.entity.dizko_url, "https://www.dizko.app/NinaKraviz");
  assert.deepEqual(result.entity.links, { soundcloud: "https://soundcloud.com/ninakraviz" });
  assert.equal(result.entity.experience_level, "headliner");
  assert.deepEqual(result.entity.event_types, ["club night", "festival"]);
  assert.equal(result.entity.venues_played.length, 12, "venues_played is capped at 12");
  assert.deepEqual(result.entity.mixes, [{ id: "mix-1", title: "Live at Nitsa", url: "https://soundcloud.com/nina/live-at-nitsa", published_at: "2026-08-20T10:00:00Z", duration: "01:20:00" }]);
  assert.deepEqual(result.entity.press_clips, [{ title: "Interview", publication: "RA", url: "https://ra.co/features/1", published_at: "2026-05-01" }]);
  assert.equal(result.entity.appearances, undefined, "the flat appearances list is replaced by the upcoming/past split");

  assert.deepEqual(result.entity.upcoming_appearances.map((row) => row.id), ["ra-1", "ra-2", "ra-3"], "today counts as upcoming; sorted ascending");
  assert.deepEqual(result.entity.upcoming_appearances[2], { id: "ra-3", title: "Nina Kraviz at Nitsa", date: "2026-10-09", city: "Barcelona", venue: "Nitsa", event_url: "https://ra.co/events/ra-3" });
  assert.equal(result.entity.upcoming_appearances_count, 3);
  const past = result.entity.recent_past_appearances;
  assert.equal(past.length, 3, "undated rows count as past");
  assert.ok(past.some((row) => row.id === "ra-undated" && row.date === undefined));
  assert.deepEqual(past.filter((row) => row.date).map((row) => row.id), ["ra-older", "ra-old"], "dated past rows are newest first");
  assert.equal(result.entity.past_appearances_count, 3);

  assert.deepEqual(result.page, {
    published: true,
    handle: "NinaKraviz",
    page_url: "https://www.dizko.app/NinaKraviz",
    slug: "ninakraviz",
    published_at: "2026-08-01T00:00:00Z",
    embeds: [{
      id: "blk-1",
      title: "Live at Nitsa",
      provider: "soundcloud",
      url: "https://soundcloud.com/nina/live-at-nitsa",
      deep_link: "https://www.dizko.app/NinaKraviz?mix=blk-1"
    }]
  });

  assert.equal(result.insights.indexed_events, 42);
  assert.equal(result.insights.upcoming_events, 3);
  assert.equal(result.insights.first_event_at, "2019-01-05T00:00:00Z");
  assert.equal(result.insights.latest_event_at, "2026-10-09T22:00:00Z");
  assert.deepEqual(result.insights.top_venues, [{ name: "Nitsa", count: 4 }]);
  assert.equal(result.insights.related_artists.length, 8, "related artists are capped at 8");
  assert.equal(result.insights.related_artists[0].name, "Related 0");
  assert.equal(result.insights.modified_at, "2026-08-20T00:00:00Z");

  assert.deepEqual(result.upcoming_events.map((row) => row.id), ["dup-1", "nina-2"], "title/lineup matches only, duplicates collapsed, date-ordered");
  assert.equal(result.upcoming_events[0].when, "Sun 6 Sep, 01:00");
  assert.equal(result.upcoming_events[0].timezone, "Europe/Berlin");
  assert.equal(result.upcoming_events[0].ticket_url, "https://ra.co/events/dup-1", "the richer duplicate survives");
  assert.equal(result.upcoming_events[0].event_url, "https://www.dizko.app/events/dup-1");
  assert.equal(result.upcoming_events[0].calendar_url, "https://mcp.dizko.app/e/dup-1/cal");
});

test("artist profiles tolerate a missing page, directory profile and insights", async () => {
  const fetch = fakeFetch((url) => {
    switch (url.pathname) {
      case "/scene/profiles/dj/nina-kraviz":
        return { id: "nina-kraviz", name: "Nina Kraviz", cities: ["Berlin"], genres: ["techno"] };
      case "/scene/profiles/dj/nina-kraviz/insights":
        return [{ error: "boom" }, 500];
      case "/scene/directory/djs/nina-kraviz":
        return [{ error: "boom" }, 503];
      case "/artist-pages/public/for-artist/NinaKraviz":
        return NOT_FOUND;
      case "/events":
        return { count: 0, events: [] };
      default:
        throw new Error(`Unexpected request: ${url.pathname}`);
    }
  });

  const result = await findArtist({ id: "nina-kraviz" }, { ...OPTIONS, fetch });
  assert.equal(result.mode, "profile");
  assert.equal(result.entity.name, "Nina Kraviz");
  assert.equal(result.entity.experience_level, undefined);
  assert.equal(result.entity.upcoming_appearances, undefined);
  assert.equal(result.entity.past_appearances_count, undefined);
  assert.deepEqual(result.page, { published: false, handle: "NinaKraviz", page_url: null, embeds: [] });
  assert.deepEqual(result.insights, {
    indexed_events: 0,
    upcoming_events: 0,
    first_event_at: null,
    latest_event_at: null,
    top_venues: [],
    related_artists: [],
    modified_at: null
  });
  assert.deepEqual(result.upcoming_events, []);
  assert.deepEqual(paths(fetch).sort(), [
    "/artist-pages/public/for-artist/NinaKraviz",
    "/events",
    "/scene/directory/djs/nina-kraviz",
    "/scene/profiles/dj/nina-kraviz",
    "/scene/profiles/dj/nina-kraviz/insights"
  ]);
});

// ---------- venues ----------

test("venue search hits the venue index and reports a best match", async () => {
  const fetch = fakeFetch(() => ({
    count: 1,
    total_indexed: 900,
    items: [{ id: "berghain", name: "Berghain", kind: "venue", cities: ["Berlin"], neighborhood: "Friedrichshain", typical_capacity: 1500, score: 0.91 }]
  }));
  const result = await findVenue({ query: "berghain", city: "Berlin" }, { ...OPTIONS, fetch });
  assert.equal(fetch.calls[0].pathname, "/scene/search");
  assert.equal(fetch.calls[0].searchParams.get("kind"), "venue");
  assert.equal(fetch.calls[0].searchParams.get("city"), "berlin");
  assert.equal(result.kind, "venue");
  assert.equal(result.entities[0].kind, "venue");
  assert.equal(result.entities[0].neighborhood, "Friedrichshain");
  assert.equal(result.entities[0].dizko_url, undefined, "venues have no public Dizko page");
  assert.equal(result.entities[0].match_score, 0.91);
  assert.deepEqual(result.best_match, { id: "berghain", name: "Berghain", confident: true });
});

test("venueMatches compares venue names by token", () => {
  assert.deepEqual(venueTokens("Berghain / Panorama Bar"), ["berghain", "panorama"]);
  assert.deepEqual(venueTokens("RSO.BERLIN"), ["rso"]);
  assert.deepEqual(venueTokens("The Club"), []);

  assert.equal(venueMatches("Berghain / Panorama Bar", "Berghain | Panorama Bar | Säule"), true);
  assert.equal(venueMatches("Berghain / Panorama Bar", "Berghain Kantine"), true);
  assert.equal(venueMatches("Tresor", "Tresor / Globus"), true);
  assert.equal(venueMatches("RSO Berlin", "RSO.BERLIN"), true);
  assert.equal(venueMatches("Salon zur Wilden Renate", "Renate"), true);
  assert.equal(venueMatches("BASEMENT", "BASEMENT NY"), true);
  assert.equal(venueMatches("BASEMENT", "Pacha NYC Basement"), false);
  assert.equal(venueMatches("Fabric", "Private Hire at fabric"), false);
  assert.equal(venueMatches("Berghain", "Else"), false);
  assert.equal(venueMatches("Berghain", ""), false);
  assert.equal(venueMatches("", "Berghain"), false);
});

test("venue profiles match venue names by token", async () => {
  const fetch = fakeFetch((url) => {
    if (url.pathname === "/events") {
      return {
        count: 5,
        events: [
          event("bh-3", "Klubnacht", "Berghain", [], { start_time: "2026-10-10T22:00:00Z", ticket_url: "https://ra.co/events/bh-3" }),
          event("else-1", "Unrelated", "Else", [], { start_time: "2026-10-08T22:00:00Z" }),
          event("bh-1", "Klubnacht", "BERGHAIN", [], { start_time: "2026-10-10T22:00:00Z" }),
          event("bh-2", "Afterparty", "Berghain Kantine", [], { start_time: "2026-10-09T22:00:00Z" }),
          event("bh-4", "Säule Night", "Berghain | Panorama Bar | Säule", [], { start_time: "2026-10-10T23:00:00Z" })
        ]
      };
    }
    return { id: "berghain", name: "Berghain / Panorama Bar", kind: "venue", cities: ["Berlin"], neighborhood: "Friedrichshain" };
  });

  const result = await findVenue({ id: "berghain", city: "berlin" }, { ...OPTIONS, fetch });

  assert.deepEqual(paths(fetch), ["/scene/profiles/venue/berghain", "/events"], "one upstream query when the first token already matches");
  const query = fetch.calls[1].searchParams;
  assert.equal(query.get("venue"), "berghain", "queries by the first distinctive token");
  assert.equal(query.get("sort_by"), "soonest");
  assert.equal(query.get("city"), "berlin");

  assert.equal(result.mode, "profile");
  assert.equal(result.kind, "venue");
  assert.equal(result.entity.name, "Berghain / Panorama Bar");
  assert.equal(result.returned_event_count, 3);
  assert.deepEqual(result.upcoming_events.map((row) => row.id), ["bh-2", "bh-3", "bh-4"], "unrelated venue dropped, same-show duplicate collapsed, sorted by start");
  assert.deepEqual(result.upcoming_events.map((row) => row.venue), ["Berghain Kantine", "Berghain", "Berghain | Panorama Bar | Säule"]);
  assert.equal(result.upcoming_events[1].ticket_url, "https://ra.co/events/bh-3", "the richer duplicate wins");
  assert.equal(result.upcoming_events[0].when, "Sat 10 Oct, 00:00");
  assert.equal(result.upcoming_events[0].timezone, "Europe/Berlin");
});

test("venue profiles retry with the last token and the full name before giving up", async () => {
  const fetch = fakeFetch((url) => {
    if (url.pathname === "/events") {
      const needle = url.searchParams.get("venue");
      if (needle === "BASEMENT") {
        return { count: 2, events: [event("ny-2", "Rave", "BASEMENT NY", [], { start_time: "2026-10-11T03:00:00Z", venue_city: "new-york" }), event("pacha-2", "Pacha night", "Pacha NYC Basement", [], { venue_city: "new-york" })] };
      }
      return { count: 1, events: [event("pacha-1", "Pacha night", "Pacha NYC Basement", [], { venue_city: "new-york" })] };
    }
    return { id: "basement", name: "BASEMENT", kind: "venue", cities: ["New York"] };
  });

  const result = await findVenue({ id: "basement" }, { ...OPTIONS, fetch });
  assert.deepEqual(
    fetch.calls.filter((url) => url.pathname === "/events").map((url) => url.searchParams.get("venue")),
    ["basement", "BASEMENT"],
    "single-token names retry with the full name only"
  );
  assert.equal(fetch.calls[1].searchParams.get("city"), "new-york", "city defaults to the profile's first city, sent as the upstream slug");
  assert.deepEqual(result.upcoming_events.map((row) => row.id), ["ny-2"]);
  assert.equal(result.returned_event_count, 1);

  const empty = fakeFetch((url) => (url.pathname === "/events"
    ? { count: 1, events: [event("hire-1", "Corporate", "Private Hire at fabric", [], { venue_city: "london" })] }
    : { id: "fabric", name: "Fabric London", kind: "venue", cities: ["London"] }));
  const none = await findVenue({ id: "fabric", city: "london" }, { ...OPTIONS, fetch: empty });
  assert.deepEqual(
    empty.calls.filter((url) => url.pathname === "/events").map((url) => url.searchParams.get("venue")),
    ["fabric", "Fabric London"],
    "the stop-word city suffix leaves a single token, then the full name"
  );
  assert.equal(none.returned_event_count, 0);
  assert.deepEqual(none.upcoming_events, []);
});

// ---------- promoters and collectives ----------

test("promoter search merges the city promoter list with collective search results", async () => {
  const fetch = fakeFetch((url) => {
    if (url.pathname === "/scene/search") {
      return {
        count: 2,
        items: [
          { id: "mini-mal", name: "Mini-Mal Elektrokneipe", kind: "collective", bio: "Kneipe crew.", cities: ["Berlin"] },
          { id: "gegen", name: "Gegen", kind: "collective", matched_text: true }
        ]
      };
    }
    if (url.pathname === "/promoters/berlin") {
      return {
        city: "Berlin",
        promoters: [
          { slug: "mini-mal-elektrokneipe", name: "Mini-Mal Elektrokneipe", city_slug: "berlin", genres: ["house"], upcoming_count: 2, next_event_at: "2026-09-12T22:00:00Z" },
          { slug: "other-crew", name: "Other Crew", city_slug: "berlin", upcoming_count: 1 }
        ]
      };
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });

  const result = await findPromoter({ query: "Mini-Mal", city: "berlin" }, { ...OPTIONS, fetch });
  assert.deepEqual(paths(fetch).sort(), ["/promoters/berlin", "/scene/search"]);
  const scene = fetch.calls.find((url) => url.pathname === "/scene/search").searchParams;
  assert.equal(scene.get("kind"), "collective");
  assert.equal(scene.get("q"), "Mini-Mal");
  assert.equal(fetch.calls.find((url) => url.pathname === "/promoters/berlin").searchParams.get("limit"), "200");

  assert.equal(result.mode, "search");
  assert.equal(result.kind, "promoter");
  assert.equal(result.city, "berlin");
  assert.equal(result.note, undefined);
  assert.deepEqual(result.entities.map((entity) => entity.name), ["Mini-Mal Elektrokneipe"], "the query filters promoters; unrelated collectives are dropped");
  assert.equal(result.count, 1);
  const merged = result.entities[0];
  assert.equal(merged.kind, "promoter", "a name present in both lists is a promoter");
  assert.equal(merged.bio, "Kneipe crew.", "collective facts are merged in");
  assert.equal(merged.upcoming_count, 2, "promoter listing facts are kept");
  assert.equal(merged.city, "Berlin");
});

test("promoter search without a city searches collectives only and says so", async () => {
  const fetch = fakeFetch((url) => {
    if (url.pathname === "/scene/search") {
      return { count: 1, items: [{ id: "gegen", name: "Gegen", kind: "collective", cities: ["Berlin"], genres: ["techno"] }] };
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const result = await findPromoter({ query: "Gegen" }, { ...OPTIONS, fetch });
  assert.deepEqual(paths(fetch), ["/scene/search"]);
  assert.equal(result.kind, "promoter");
  assert.equal(result.city, null);
  assert.match(result.note, /pass a city/i);
  assert.equal(result.count, 1);
  assert.deepEqual(result.entities[0], {
    id: "gegen",
    kind: "collective",
    name: "Gegen",
    cities: ["Berlin"],
    genres: ["techno"],
    dizko_url: "https://www.dizko.app/collectives/gegen"
  });

  const promotersOnly = fakeFetch(() => { throw new Error("must not fetch"); });
  const none = await findPromoter({ query: "Gegen", kind: "promoter" }, { ...OPTIONS, fetch: promotersOnly });
  assert.equal(none.kind, "promoter");
  assert.deepEqual(none.entities, [], "kind=promoter without a city has nothing to search");
  assert.deepEqual(paths(promotersOnly), []);
});

test("promoter profiles by id need a city and expose the promoter's events", async () => {
  const notFound = fakeFetch(() => NOT_FOUND);
  await assert.rejects(findPromoter({ id: "mini-mal-elektrokneipe" }, { ...OPTIONS, fetch: notFound }), (error) => {
    assert.ok(error instanceof ToolInputError);
    assert.equal(error.code, "missing_city");
    assert.equal(error.field, "city");
    return true;
  });
  assert.deepEqual(paths(notFound), ["/scene/profiles/collective/mini-mal-elektrokneipe"], "without a city only the collective index is consulted");

  const missingCity = await callTool("dizko_find_promoter", { id: "mini-mal-elektrokneipe" }, { ...OPTIONS, fetch: fakeFetch(() => NOT_FOUND) });
  assert.equal(missingCity.isError, true);
  assert.equal(missingCity.structuredContent.code, "missing_city");
  assert.equal(missingCity.structuredContent.field, "city");
  assert.match(missingCity.structuredContent.error, /needs a city/i);

  const fetch = fakeFetch((url) => {
    if (url.pathname === "/promoters/berlin/mini-mal-elektrokneipe") {
      return {
        slug: "mini-mal-elektrokneipe",
        name: "Mini-Mal Elektrokneipe",
        city: "Berlin",
        city_slug: "berlin",
        genres: ["house"],
        upcoming_count: 1,
        past_count: 12,
        venues: ["://about blank"],
        external_url: "https://minimal.example",
        events: [event("promoter-1", "Mini-Mal Night", "://about blank", ["Resident"], { start_time: "2026-09-12T21:59:00Z" })]
      };
    }
    if (url.pathname === "/scene/profiles/collective/mini-mal-elektrokneipe") return NOT_FOUND;
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const response = await callTool("dizko_find_promoter", { id: "mini-mal-elektrokneipe", city: "berlin" }, { ...OPTIONS, fetch });
  assert.deepEqual(paths(fetch).sort(), ["/promoters/berlin/mini-mal-elektrokneipe", "/scene/profiles/collective/mini-mal-elektrokneipe"]);
  assert.equal(response.isError, false);
  const body = response.structuredContent;
  assert.equal(body.mode, "profile");
  assert.equal(body.kind, "promoter");
  assert.equal(body.entity.kind, "promoter");
  assert.equal(body.entity.id, "mini-mal-elektrokneipe");
  assert.equal(body.entity.name, "Mini-Mal Elektrokneipe");
  assert.equal(body.entity.dizko_url, "https://www.dizko.app/promoters/berlin/mini-mal-elektrokneipe");
  assert.equal(body.entity.past_count, 12);
  assert.deepEqual(body.entity.venues, ["://about blank"]);
  assert.equal(body.entity.external_url, "https://minimal.example");
  assert.equal(body.entity.claimed, false);
  assert.equal(body.entity.collective_url, undefined);
  assert.equal(body.data_note, undefined);
  assert.equal(body.upcoming_events.length, 1);
  assert.equal(body.upcoming_events[0].title, "Mini-Mal Night");
  assert.equal(body.upcoming_events[0].when, "Sat 12 Sep, 23:59");
  assert.equal(body.upcoming_events[0].timezone, "Europe/Berlin");
  assert.equal(body.upcoming_events[0].event_url, "https://www.dizko.app/events/promoter-1");
  assert.equal(body.upcoming_events[0].directions_url, "https://mcp.dizko.app/e/promoter-1/map");
  assert.match(body.assistant_instruction, /upcoming_events/);
});

test("promoter profiles merge a promoter record with its collective profile", async () => {
  const fetch = fakeFetch((url) => {
    if (url.pathname === "/promoters/berlin/gegen") {
      return { slug: "gegen", name: "Gegen", city: "Berlin", city_slug: "berlin", upcoming_count: 1, claimed: true, events: [event("gegen-1", "Gegen", "KitKat")] };
    }
    if (url.pathname === "/scene/profiles/collective/gegen") {
      return { id: "gegen", name: "Gegen", cities: ["Berlin"], genres: ["techno"], bio: "Queer techno institution.", founded: 2011 };
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  const result = await findPromoter({ id: "gegen", city: "berlin" }, { ...OPTIONS, fetch });
  assert.equal(result.kind, "promoter");
  assert.equal(result.entity.kind, "promoter");
  assert.equal(result.entity.bio, "Queer techno institution.");
  assert.equal(result.entity.founded, 2011);
  assert.equal(result.entity.claimed, true);
  assert.equal(result.entity.collective_url, "https://www.dizko.app/collectives/gegen");
  assert.equal(result.entity.dizko_url, "https://www.dizko.app/promoters/berlin/gegen");
  assert.equal(result.upcoming_events.length, 1);
  assert.equal(result.data_note, undefined);
});

test("collective-only profiles return catalog data without fabricated event links", async () => {
  const fetch = fakeFetch((url) => {
    assert.equal(url.pathname, "/scene/profiles/collective/fraktvred");
    return { id: "fraktvred", name: "Fraktvred", kind: "collective", cities: ["Berlin"], genres: ["techno"], bio: "Berlin collective." };
  });
  const result = await findPromoter({ id: "fraktvred", kind: "collective" }, { ...OPTIONS, fetch });
  assert.equal(fetch.calls.length, 1, "kind=collective skips the promoter lookup entirely");
  assert.equal(result.mode, "profile");
  assert.equal(result.kind, "collective");
  assert.equal(result.entity.kind, "collective");
  assert.equal(result.entity.name, "Fraktvred");
  assert.equal(result.entity.bio, "Berlin collective.");
  assert.equal(result.entity.collective_url, "https://www.dizko.app/collectives/fraktvred");
  assert.equal(result.entity.dizko_url, "https://www.dizko.app/collectives/fraktvred");
  assert.deepEqual(result.upcoming_events, []);
  assert.match(result.data_note, /no verified collective-to-event links/i);

  const withCity = fakeFetch((url) => (url.pathname === "/promoters/berlin/fraktvred"
    ? NOT_FOUND
    : { id: "fraktvred", name: "Fraktvred", kind: "collective", cities: ["Berlin"] }));
  const tolerated = await findPromoter({ id: "fraktvred", city: "berlin" }, { ...OPTIONS, fetch: withCity });
  assert.deepEqual(paths(withCity).sort(), ["/promoters/berlin/fraktvred", "/scene/profiles/collective/fraktvred"]);
  assert.equal(tolerated.kind, "collective", "a 404 from the promoter endpoint is tolerated when the collective exists");
  assert.match(tolerated.data_note, /pass a city/i);

  const nothing = fakeFetch(() => NOT_FOUND);
  await assert.rejects(findPromoter({ id: "ghost", city: "berlin" }, { ...OPTIONS, fetch: nothing }), (error) => error.status === 404);
});

// ---------- legacy router ----------

test("findSceneEntities routes legacy kinds to the new finders", async () => {
  const fetch = fakeFetch((url) => {
    assert.equal(url.pathname, "/scene/search");
    const kind = url.searchParams.get("kind");
    if (kind === "dj") return { count: 1, items: [{ id: "nina-kraviz", name: "Nina Kraviz", kind: "dj" }] };
    if (kind === "venue") return { count: 1, items: [{ id: "berghain", name: "Berghain", kind: "venue" }] };
    if (kind === "collective") return { count: 1, items: [{ id: "gegen", name: "Gegen", kind: "collective" }] };
    return { count: 2, items: [{ id: "nina-kraviz", name: "Nina Kraviz", kind: "dj" }, { id: "berghain", name: "Berghain", kind: "venue" }] };
  });

  const artist = await findSceneEntities({ kind: "dj", query: "Nina Kraviz" }, { ...OPTIONS, fetch });
  assert.equal(artist.kind, "artist");
  assert.equal(artist.entities[0].dizko_url, "https://www.dizko.app/NinaKraviz");
  assert.equal(artist.best_match.confident, true);

  const venue = await findSceneEntities({ kind: "venue", query: "Berghain" }, { ...OPTIONS, fetch });
  assert.equal(venue.kind, "venue");
  assert.equal(venue.entities[0].kind, "venue");

  const collective = await findSceneEntities({ kind: "collective", query: "Gegen" }, { ...OPTIONS, fetch });
  assert.equal(collective.kind, "collective");
  assert.equal(collective.entities[0].kind, "collective");
  assert.match(collective.note, /pass a city/i);

  const any = await findSceneEntities({ query: "Berlin" }, { ...OPTIONS, fetch });
  assert.equal(any.kind, "any");
  assert.equal(fetch.calls.at(-1).searchParams.get("kind"), null, "no kind searches every kind");
  assert.deepEqual(any.entities.map((entity) => entity.kind), ["artist", "venue"]);

  assert.deepEqual(await findSceneEntities({}, OPTIONS), { error: "Pass an entity id or a search query", code: "missing_entity_lookup" });
  assert.deepEqual(await findSceneEntities({ kind: "bogus", query: "x" }, OPTIONS), { error: "kind must be artist, venue, collective, or promoter", code: "invalid_entity_kind" });
});

// Name-match ranking -------------------------------------------------------
// Upstream relevance cannot order these: measured against the live catalog,
// its score put Nina Kraviz last of nineteen "Nina" profiles and its
// `authority` field was the same 0.59 for every artist.

test("an exact name outranks a longer name that merely contains the query", async () => {
  const fetch = fakeFetch(() => ({
    count: 3,
    items: [
      { id: "berghain-panorama-bar", name: "Berghain / Panorama Bar", kind: "venue", score: 0.063 },
      { id: "berghain", name: "Berghain", kind: "venue", score: 0.065 },
      { id: "berghain-kantine", name: "Berghain Kantine", kind: "venue", score: 0.065 }
    ]
  }));
  const result = await findVenue({ query: "Berghain" }, { ...OPTIONS, fetch });

  assert.equal(result.entities[0].name, "Berghain", "the exact match must lead regardless of upstream order");
  assert.equal(result.best_match.name, "Berghain");
  assert.equal(result.best_match.confident, true, "exactly one profile carries the name exactly");
  assert.deepEqual(result.best_match.alternatives.map((entry) => entry.name), ["Berghain / Panorama Bar", "Berghain Kantine"]);
});

test("a query that two profiles answer equally well is not a confident match", async () => {
  const fetch = fakeFetch(() => ({
    count: 2,
    items: [
      { id: "bj-klock", name: "BJ Klock", kind: "dj", score: 0.02 },
      { id: "ben-klock", name: "Ben Klock", kind: "dj", score: 0.02 }
    ]
  }));
  const result = await findArtist({ query: "Klock" }, { ...OPTIONS, fetch });

  // Answering "Klock" with either DJ would be a coin flip presented as fact.
  assert.equal(result.best_match.confident, false);
  assert.deepEqual(result.best_match.alternatives.map((entry) => entry.name), ["Ben Klock"]);
});

test("a whole-word match that nothing competes with stays confident", async () => {
  const fetch = fakeFetch(() => ({
    count: 1,
    items: [{ id: "berghain-panorama-bar", name: "Berghain / Panorama Bar", kind: "venue", score: 0.05 }]
  }));
  const result = await findVenue({ query: "Panorama Bar" }, { ...OPTIONS, fetch });
  assert.equal(result.best_match.confident, true, "one candidate is not an ambiguity");
});

test("a query buried inside a longer word is never a confident match", async () => {
  const fetch = fakeFetch(() => ({
    count: 1,
    items: [{ id: "medlock", name: "Medlock", kind: "dj", score: 0.015 }]
  }));
  const result = await findArtist({ query: "lock" }, { ...OPTIONS, fetch });
  assert.equal(result.best_match.confident, false, "\"lock\" inside \"Medlock\" is a coincidence, not an answer");
});

test("match tiers order exact, prefix, whole word, then buried substring", () => {
  assert.equal(matchTier("Berghain", "berghain"), MATCH_TIER.exact);
  assert.equal(matchTier("Berghain Kantine", "berghain"), MATCH_TIER.prefix);
  assert.equal(matchTier("Berghain / Panorama Bar", "panorama bar"), MATCH_TIER.word);
  assert.equal(matchTier("Medlock", "lock"), MATCH_TIER.substring);
  assert.equal(matchTier("Amelie Lens", "berghain"), null);
  assert.equal(matchTier("", "berghain"), null);
});
