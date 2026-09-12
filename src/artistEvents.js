import { searchEvents } from "./api.js";
import { getConfig } from "./config.js";
import { cityTimezone } from "./cities.js";
import { isoDate } from "./dateRange.js";
import { summarizeEvent } from "./format.js";

// Bounded fan-out: one exact-name query per artist. Every returned row is
// verified locally against the lineup or title, deduplicated across
// sources, and sorted by start time before it is presented.
export const MAX_ARTISTS = 8;

export async function getArtistEvents(input = {}, options = {}) {
  const config = options.config || getConfig(options.env);
  const artists = normalizeArtists(input.artists);
  const tracked = artists.slice(0, MAX_ARTISTS);
  const timezone = cityTimezone(input.city) || "UTC";
  const dateFrom = input.date_from || isoDate(options.now || new Date(), timezone);
  const perArtist = boundedLimit(input.limit_per_artist, 5, 10);
  const summaryOptions = { ...options, webBaseUrl: config.webBaseUrl, linkBaseUrl: config.mcpUrl, fields: input.fields };

  const results = await Promise.all(tracked.map(async (artist) => {
    const response = await searchEvents({
      city: input.city,
      query: artist,
      date_from: dateFrom,
      date_to: input.date_to,
      sort_by: "soonest",
      limit: Math.min(perArtist * 4, 40)
    }, { ...options, config });
    const events = dedupeEvents((response.events || []).filter((event) => eventFeaturesArtist(event, artist)))
      .sort(compareStart)
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

// A row counts when the artist is on the lineup or named in the title. A
// description mention ("inspired by X") is not an appearance.
export function eventFeaturesArtist(event, artist) {
  const target = normalizeName(artist);
  if (!target) return false;
  if ((event?.lineup || []).some((name) => normalizeName(name) === target)) return true;
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "iu");
  return boundary.test(normalizeName(event?.title));
}

// Two sources often list one show twice with slightly different venue
// strings. Same local date plus the same leading venue token is one show.
export function dedupeEvents(events) {
  const seen = new Map();
  for (const event of events) {
    const key = `${String(event.start_time || "").slice(0, 10)}|${venueKey(event.venue_name)}`;
    const existing = seen.get(key);
    if (!existing || score(event) > score(existing)) seen.set(key, event);
  }
  return [...seen.values()];
}

// Same local date, same venue token and same leading title token: one show
// listed by two sources. Used for venue pages and search pages, where two
// different shows at one venue on one day are common and must survive.
export function dedupeSameShow(events) {
  const seen = new Map();
  for (const event of events) {
    const key = `${String(event.start_time || "").slice(0, 10)}|${venueKey(event.venue_name)}|${normalizeName(event.title).replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 12)}`;
    const existing = seen.get(key);
    if (!existing || score(event) > score(existing)) seen.set(key, event);
  }
  return [...seen.values()];
}

function venueKey(name) {
  const tokens = normalizeName(name).split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 1);
  return tokens.length ? (tokens[0].length >= 4 ? tokens[0] : tokens.slice(0, 2).join("")) : "";
}

function score(event) {
  return Number(event.attendance_count || 0) + (event.ticket_url ? 1 : 0) + (event.end_time ? 1 : 0);
}

function compareStart(a, b) {
  return String(a.start_time || "").localeCompare(String(b.start_time || ""));
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
