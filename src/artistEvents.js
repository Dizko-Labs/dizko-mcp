import { searchEvents } from "./api.js";
import { getConfig } from "./config.js";
import { isoDate } from "./dateRange.js";
import { summarizeEvent } from "./format.js";

// Bounded fan-out: one exact-name query per artist. The event API recognizes
// catalog artist names and lets those searches see beyond the general browse
// horizon. We still verify every returned row locally before presenting it.
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
      query: artist,
      date_from: dateFrom,
      date_to: input.date_to,
      limit: Math.min(perArtist * 4, 40)
    }, { ...options, config });
    const events = (response.events || [])
      .filter((event) => eventFeaturesArtist(event, artist))
      .slice(0, perArtist)
      .map((event) => summarizeEvent(event, summaryOptions));
    return { artist, count: events.length, events };
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

export function eventFeaturesArtist(event, artist) {
  const target = normalizeName(artist);
  if (!target) return false;
  if ((event?.lineup || []).some((name) => normalizeName(name) === target)) return true;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i");
  return boundary.test(normalizeName(event?.title)) || boundary.test(normalizeName(event?.description));
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

function normalizeName(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}
