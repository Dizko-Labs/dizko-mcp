import { searchEvents } from "./api.js";
import { getConfig } from "./config.js";
import { isoDate } from "./dateRange.js";
import { summarizeEvent } from "./format.js";

// Bounded fan-out: one strict `featuring` search per artist. 8 artists
// x default 5 events keeps the payload agent-sized; anything dropped is
// reported, never silently truncated.
const MAX_ARTISTS = 8;

export async function getArtistEvents(input = {}, options = {}) {
  const config = options.config || getConfig(options.env);
  const artists = normalizeArtists(input.artists);
  const tracked = artists.slice(0, MAX_ARTISTS);
  const dateFrom = input.date_from || isoDate(options.now || new Date());
  const perArtist = boundedLimit(input.limit_per_artist, 5, 10);
  const summaryOptions = { ...options, webBaseUrl: config.webBaseUrl };

  const results = await Promise.all(tracked.map(async (artist) => {
    const response = await searchEvents({
      city: input.city,
      featuring: artist,
      date_from: dateFrom,
      date_to: input.date_to,
      limit: perArtist
    }, { ...options, config });
    const events = (response.events || []).map((event) => summarizeEvent(event, summaryOptions));
    return { artist, count: response.count ?? events.length, events };
  }));

  return {
    city: input.city || null,
    date_from: dateFrom,
    date_to: input.date_to || null,
    artists: results.filter((result) => result.events.length),
    not_found: results.filter((result) => !result.events.length).map((result) => result.artist),
    dropped_artists: artists.slice(MAX_ARTISTS)
  };
}

export function normalizeArtists(value) {
  const list = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const artists = [];
  for (const item of list) {
    for (const name of String(item || "").split(",")) {
      const trimmed = name.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) continue;
      seen.add(key);
      artists.push(trimmed);
    }
  }
  return artists;
}

function boundedLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}
