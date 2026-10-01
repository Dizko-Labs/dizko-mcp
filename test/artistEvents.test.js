import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { getArtistEvents, normalizeArtists } from "../src/artistEvents.js";
import { callTool } from "../src/tools.js";

beforeEach(() => clearEventCache());

const NOW = new Date("2026-08-07T12:00:00Z");

function show(id, title, artist) {
  return {
    id,
    title,
    start_time: "2026-08-14T22:00:00Z",
    venue_name: "Basement",
    venue_city: "berlin",
    lineup: [artist],
    genres: ["techno"],
    vibe: [],
    event_types: ["party"]
  };
}

test("artist name normalization dedupes and splits commas", () => {
  assert.deepEqual(
    normalizeArtists(["Ben Klock, Marcel Dettmann", "ben klock", "  ", "DVS1"]),
    ["Ben Klock", "Marcel Dettmann", "DVS1"]
  );
});

test("getArtistEvents queries exact catalog names and rejects semantic near matches", async () => {
  const requested = [];
  const result = await getArtistEvents({
    artists: ["Ben Klock", "Nobody Playing"],
    city: "berlin"
  }, {
    now: NOW,
    fetch: async (url) => {
      const params = new URL(url).searchParams;
      requested.push(params.get("q"));
      if (params.get("q") === "Ben Klock") {
        return Response.json({
          count: 2,
          events: [
            show("bk-1", "Klockworks Night", "Ben Klock"),
            show("bk-near", "Klockworks Inspired", "Someone Else")
          ]
        });
      }
      return Response.json({ count: 0, events: [] });
    }
  });

  assert.deepEqual(requested.sort(), ["Ben Klock", "Nobody Playing"]);
  assert.equal(result.date_from, "2026-08-07");
  assert.equal(result.artists.length, 1);
  assert.equal(result.artists[0].artist, "Ben Klock");
  assert.equal(result.artists[0].count, 1);
  assert.equal(result.artists[0].events[0].title, "Klockworks Night");
  assert.ok(result.artists[0].events[0].event_url.startsWith("https://www.dizko.app/events/"));
  assert.deepEqual(result.not_found, ["Nobody Playing"]);
  assert.deepEqual(result.dropped_artists, []);
});

test("get_artist_events falls back to the profile's saved featuring list", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-artists-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    const created = await callTool("create_event_preference_profile", {
      consent: true,
      preferences: { featuring: ["Ben Klock"] }
    }, { preferencesPath });
    const createdBody = JSON.parse(created.content[0].text);

    const tracked = await callTool("get_artist_events", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret
    }, {
      preferencesPath,
      now: NOW,
      fetch: async () => Response.json({ count: 1, events: [show("bk-2", "Photon Closing", "Ben Klock")] })
    });
    const trackedBody = JSON.parse(tracked.content[0].text);
    assert.equal(tracked.isError, false);
    assert.equal(trackedBody.artists[0].artist, "ben klock");
    assert.equal(trackedBody.artists[0].events[0].title, "Photon Closing");
    assert.equal(trackedBody.profile.profile_id, createdBody.profile.profile_id);

    const empty = await callTool("get_artist_events", {}, { preferencesPath });
    assert.equal(empty.isError, true);
    assert.match(JSON.parse(empty.content[0].text).error, /No artists/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Local verification, dedupe and ordering (AUDIT_2026-09-08.md F12 / B15).
// ---------------------------------------------------------------------------
import { dedupeEvents, eventFeaturesArtist } from "../src/artistEvents.js";

test("eventFeaturesArtist matches the lineup exactly or the title as a whole word", () => {
  assert.equal(eventFeaturesArtist({ title: "Klubnacht", lineup: ["Ben Klock", "Marcel Dettmann"] }, "ben klock"), true);
  assert.equal(eventFeaturesArtist({ title: "Klubnacht w/ Ben Klock", lineup: [] }, "Ben Klock"), true);
  assert.equal(eventFeaturesArtist({ title: "Photon: Ben Klock all night", lineup: ["Someone Else"] }, "Ben Klock"), true);
  assert.equal(eventFeaturesArtist({ title: "Klubnacht", lineup: ["Ben Klocker"] }, "Ben Klock"), false, "no partial lineup match");
  assert.equal(eventFeaturesArtist({ title: "Klubnacht w/ Ben Klocker", lineup: [] }, "Ben Klock"), false, "no partial title match");
  assert.equal(eventFeaturesArtist({
    title: "Klockworks Inspired",
    lineup: ["Someone Else"],
    description: "A night inspired by Ben Klock and the Berghain sound."
  }, "Ben Klock"), false, "a description mention is not an appearance");
  assert.equal(eventFeaturesArtist({ title: "Klubnacht", lineup: ["Ben Klock"] }, ""), false);
});

test("dedupeEvents collapses same-day rows at the same venue and keeps the busier row", () => {
  const rows = [
    { id: "a", start_time: "2026-08-14T22:00:00Z", venue_name: "Anfiteatro De Pedra - Anfiteatro Professor", attendance_count: 40 },
    { id: "b", start_time: "2026-08-14T23:00:00Z", venue_name: "Anfiteatro de Pedra", attendance_count: 120 },
    { id: "c", start_time: "2026-08-15T22:00:00Z", venue_name: "Anfiteatro de Pedra", attendance_count: 5 },
    { id: "d", start_time: "2026-08-14T22:00:00Z", venue_name: "Basement", attendance_count: 10 }
  ];
  const kept = dedupeEvents(rows).map((event) => event.id).sort();
  assert.deepEqual(kept, ["b", "c", "d"]);
});

test("dedupeEvents prefers rows with tickets and an end time when attendance ties", () => {
  const rows = [
    { id: "plain", start_time: "2026-08-14T22:00:00Z", venue_name: "Basement", attendance_count: 10 },
    { id: "rich", start_time: "2026-08-14T22:00:00Z", venue_name: "Basement Club", attendance_count: 10, ticket_url: "https://ra.co/events/1", end_time: "2026-08-15T06:00:00Z" }
  ];
  assert.deepEqual(dedupeEvents(rows).map((event) => event.id), ["rich"]);
});

test("getArtistEvents asks upstream for soonest and returns each artist's dates in start order", async () => {
  const requested = [];
  const row = (id, start, venue) => ({ ...show(id, "Klubnacht", "Ben Klock"), start_time: start, venue_name: venue });
  const result = await getArtistEvents({ artists: ["Ben Klock"], city: "berlin" }, {
    now: NOW,
    fetch: async (url) => {
      requested.push(new URL(url));
      return Response.json({
        count: 3,
        events: [
          row("late", "2026-08-28T22:00:00Z", "Berghain"),
          row("soon", "2026-08-08T22:00:00Z", "Tresor"),
          row("mid", "2026-08-15T22:00:00Z", "Basement")
        ]
      });
    }
  });

  assert.equal(requested.length, 1);
  assert.equal(requested[0].searchParams.get("sort_by"), "soonest");
  assert.equal(requested[0].searchParams.get("q"), "Ben Klock");
  assert.equal(requested[0].searchParams.get("date_from"), "2026-08-07");
  assert.deepEqual(result.artists[0].events.map((event) => event.id), ["soon", "mid", "late"]);
  assert.deepEqual(result.artists[0].events.map((event) => event.starts_at), [
    "2026-08-08T22:00:00Z", "2026-08-15T22:00:00Z", "2026-08-28T22:00:00Z"
  ]);
  assert.equal(result.artists[0].count, 3);
});
