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

test("getArtistEvents fans out one strict featuring search per artist", async () => {
  const requested = [];
  const result = await getArtistEvents({
    artists: ["Ben Klock", "Nobody Playing"],
    city: "berlin"
  }, {
    now: NOW,
    fetch: async (url) => {
      const params = new URL(url).searchParams;
      requested.push(params.get("featuring"));
      if (params.get("featuring") === "Ben Klock") {
        return Response.json({ count: 1, events: [show("bk-1", "Klockworks Night", "Ben Klock")] });
      }
      return Response.json({ count: 0, events: [] });
    }
  });

  assert.deepEqual(requested.sort(), ["Ben Klock", "Nobody Playing"]);
  assert.equal(result.date_from, "2026-08-07");
  assert.equal(result.artists.length, 1);
  assert.equal(result.artists[0].artist, "Ben Klock");
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
