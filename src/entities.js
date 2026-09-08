import {
  getDjDirectoryProfile,
  getDjInsights,
  getPromoter,
  getPublicArtistPage,
  getSceneProfile,
  listPromoters,
  searchEvents,
  searchScene
} from "./api.js";
import { getConfig } from "./config.js";
import { cityTimezone } from "./cities.js";
import { isoDate } from "./dateRange.js";
import { ToolInputError } from "./errors.js";
import { dedupeSameShow, getArtistEvents } from "./artistEvents.js";
import { summarizeEvent } from "./format.js";

const SCENE_KIND = {
  artist: "dj",
  venue: "venue",
  collective: "collective"
};

const UPCOMING_APPEARANCES_CAP = 10;
const PAST_APPEARANCES_CAP = 5;
const PRESS_CAP = 6;

// Legacy entry point kept for callers of the old find_scene_entities tool.
export async function findSceneEntities(input = {}, options = {}) {
  const kind = normalizeEntityKind(input.kind);
  if (input.kind && !kind) {
    return entityError("kind must be artist, venue, collective, or promoter", "invalid_entity_kind");
  }
  if (!input.id && !String(input.query || "").trim()) {
    return entityError("Pass an entity id or a search query", "missing_entity_lookup");
  }
  if (kind === "venue") return findVenue(input, options);
  if (kind === "promoter" || kind === "collective") return findPromoter({ ...input, kind }, options);
  if (kind === "artist") return findArtist(input, options);
  return findAnyEntity(input, options);
}

function requireLookup(input) {
  if (input.id) return;
  if (!String(input.query || "").trim()) {
    throw new ToolInputError("Pass a name to search for, or an id from a previous result.", { field: "query" });
  }
}

// ---------- artists ----------

export async function findArtist(input = {}, options = {}) {
  requireLookup(input);
  if (input.id) return artistProfile(String(input.id).trim(), input, options);
  const query = String(input.query).trim();
  const limit = boundedLimit(input.limit, 10, 20);
  const response = await searchScene({ query, kind: "dj", city: input.city, genre: input.genre, limit }, options);
  const entities = relevantItems(response.items, query).map((profile) => sceneProfileSummary(profile, "artist"));
  return {
    mode: "search",
    kind: "artist",
    query,
    city: input.city || null,
    count: response.count ?? entities.length,
    total_indexed: response.total_indexed ?? null,
    entities,
    best_match: entities[0] ? { id: entities[0].id, name: entities[0].name, confident: isConfidentMatch(query, entities) } : null
  };
}

async function artistProfile(id, input, options) {
  const profile = await getSceneProfile("dj", id, options);
  const entity = sceneProfileSummary(profile, "artist");
  const handle = artistHandle(profile.id);
  const [insights, calendar, directory, page] = await Promise.all([
    getDjInsights(id, options).catch(() => ({})),
    getArtistEvents({
      artists: [profile.name],
      city: input.city,
      date_from: input.date_from,
      date_to: input.date_to,
      limit_per_artist: boundedLimit(input.limit, 8, 10),
      fields: input.fields
    }, options),
    getDjDirectoryProfile(id, options).catch(() => null),
    getPublicArtistPage(handle, options).catch(() => null)
  ]);
  const pageProfile = directory?.dj || null;
  const today = isoDate(options.now || new Date(), cityTimezone(input.city) || "UTC");
  const appearances = splitAppearances(pageProfile?.appearances, today);
  return {
    mode: "profile",
    kind: "artist",
    entity: {
      ...entity,
      ...directoryProfileFields(pageProfile),
      ...appearances
    },
    page: publishedPage(page, handle),
    insights: {
      indexed_events: insights.indexed_events ?? 0,
      upcoming_events: insights.upcoming_events ?? 0,
      first_event_at: insights.first_event_at || null,
      latest_event_at: insights.latest_event_at || null,
      top_venues: insights.top_venues || [],
      related_artists: (insights.related_djs || []).slice(0, 8),
      modified_at: insights.modified_at || null
    },
    upcoming_events: calendar.artists?.[0]?.events || []
  };
}

// The published microsite, if any, with stable embed ids for deep links.
function publishedPage(page, handle) {
  const pageUrl = `https://www.dizko.app/${encodeURIComponent(handle)}`;
  if (!page) return { published: false, handle, page_url: null, embeds: [] };
  const blocks = Array.isArray(page.page?.blocks) ? page.page.blocks : [];
  const embeds = blocks
    .filter((block) => block && block.type === "embed" && typeof block.id === "string")
    .map((block) => ({
      id: block.id,
      title: String(block.payload?.title || ""),
      provider: String(block.payload?.provider || ""),
      url: String(block.payload?.url || ""),
      deep_link: `${pageUrl}?mix=${encodeURIComponent(block.id)}`
    }));
  return {
    published: true,
    handle,
    page_url: pageUrl,
    slug: typeof page.slug === "string" ? page.slug : null,
    published_at: typeof page.published_at === "string" ? page.published_at : null,
    embeds
  };
}

function splitAppearances(appearances, today) {
  if (!Array.isArray(appearances) || !appearances.length) return {};
  const rows = appearances.map((appearance) => compactObject({
    id: appearance.id,
    title: appearance.title,
    date: typeof appearance.date === "string" ? appearance.date.slice(0, 10) : null,
    city: appearance.city,
    venue: appearance.venue,
    event_url: appearance.event_url,
    is_festival: appearance.is_festival
  }));
  const upcoming = rows.filter((row) => row.date && row.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  const past = rows.filter((row) => !row.date || row.date < today).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return compactObject({
    upcoming_appearances: upcoming.slice(0, UPCOMING_APPEARANCES_CAP),
    upcoming_appearances_count: upcoming.length,
    recent_past_appearances: past.slice(0, PAST_APPEARANCES_CAP),
    past_appearances_count: past.length
  });
}

function directoryProfileFields(profile) {
  if (!profile || typeof profile !== "object") return {};
  return compactObject({
    experience_level: profile.experience_level,
    event_types: profile.event_types || [],
    venues_played: (profile.venues_played || []).slice(0, 12),
    mixes: (profile.mixes || []).slice(0, 8).map((mix) => compactObject({
      id: mix.id,
      title: mix.title,
      url: mix.url,
      published_at: mix.published_at,
      duration: mix.duration
    })),
    press_clips: (profile.press_clips || []).slice(0, PRESS_CAP).map((clip) => compactObject({
      title: clip.title,
      publication: clip.publication,
      url: clip.url,
      published_at: clip.published_at
    }))
  });
}

// Public artist URLs are the camelCase directory handle: /NinaKraviz.
// Non-ASCII letters are kept so diacritic ids do not lose characters.
export function artistHandle(artistId) {
  return String(artistId || "")
    .trim()
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

// ---------- venues ----------

export async function findVenue(input = {}, options = {}) {
  requireLookup(input);
  if (input.id) return venueProfile(String(input.id).trim(), input, options);
  const query = String(input.query).trim();
  const limit = boundedLimit(input.limit, 10, 20);
  const response = await searchScene({ query, kind: "venue", city: input.city, genre: input.genre, limit }, options);
  const entities = relevantItems(response.items, query).map((profile) => sceneProfileSummary(profile, "venue"));
  return {
    mode: "search",
    kind: "venue",
    query,
    city: input.city || null,
    count: response.count ?? entities.length,
    total_indexed: response.total_indexed ?? null,
    entities,
    best_match: entities[0] ? { id: entities[0].id, name: entities[0].name, confident: isConfidentMatch(query, entities) } : null
  };
}

async function venueProfile(id, input, options) {
  const profile = await getSceneProfile("venue", id, options);
  const entity = sceneProfileSummary(profile, "venue");
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const city = input.city || profile.cities?.[0];
  const events = await venueEvents(profile.name, { city, date_from: input.date_from, date_to: input.date_to }, { ...options, config });
  const upcomingEvents = events
    .slice(0, boundedLimit(input.limit, 10, 20))
    .map((event) => summarizeEvent(event, { ...options, webBaseUrl: config.webBaseUrl, linkBaseUrl: config.mcpUrl, fields: input.fields }));
  return {
    mode: "profile",
    kind: "venue",
    entity,
    returned_event_count: upcomingEvents.length,
    upcoming_events: upcomingEvents
  };
}

// Upstream `venue=` is a text match and event venue strings vary ("Tresor /
// Globus", "Berghain | Panorama Bar | Säule", "RSO.BERLIN"). Query by the
// profile's most distinctive token, then keep rows whose venue tokens agree.
async function venueEvents(profileName, filters, options) {
  const tokens = venueTokens(profileName);
  const candidates = unique([tokens[0], tokens[tokens.length - 1], profileName].filter(Boolean));
  for (const needle of candidates) {
    const response = await searchEvents({ ...filters, venue: needle, sort_by: "soonest", limit: 60 }, options);
    const matches = dedupeSameShow((response.events || []).filter((event) => venueMatches(profileName, event.venue_name)));
    if (matches.length) return matches.sort((a, b) => String(a.start_time || "").localeCompare(String(b.start_time || "")));
  }
  return [];
}

const VENUE_STOP_WORDS = new Set(["the", "club", "bar", "berlin", "london", "nyc", "ny", "new", "york", "la", "of", "and", "at", "im", "am", "der", "die", "das", "de", "le", "la", "el"]);

export function venueTokens(name) {
  return normalizeText(name)
    .split(/[\s/|.,&()\-–—:+]+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((token) => token && !VENUE_STOP_WORDS.has(token));
}

export function venueMatches(profileName, eventVenue) {
  const profile = venueTokens(profileName);
  const event = venueTokens(eventVenue);
  if (!profile.length || !event.length) return false;
  if (profile[0] === event[0]) return true;
  const profileSet = new Set(profile);
  return event.every((token) => profileSet.has(token));
}

// ---------- promoters and collectives ----------

export async function findPromoter(input = {}, options = {}) {
  requireLookup(input);
  if (input.id) return promoterProfile(String(input.id).trim(), input, options);
  const query = String(input.query).trim();
  const limit = boundedLimit(input.limit, 10, 20);
  const needle = normalizeText(query);
  const genre = normalizeText(input.genre);
  const [collectives, promoters] = await Promise.all([
    input.kind === "promoter" ? Promise.resolve({ items: [] }) : searchScene({ query, kind: "collective", city: input.city, genre: input.genre, limit }, options).catch(() => ({ items: [] })),
    input.city && input.kind !== "collective" ? listPromoters(input.city, 200, options).catch(() => ({ promoters: [] })) : Promise.resolve({ promoters: [] })
  ]);
  const promoterRows = (promoters.promoters || [])
    .filter((item) => !needle || normalizeText(`${item.name} ${item.slug}`).includes(needle))
    .filter((item) => !genre || (item.genres || []).some((value) => normalizeText(value).includes(genre)))
    .slice(0, limit)
    .map((item) => promoterSummary(item, promoters.city || input.city));
  const collectiveRows = relevantItems(collectives.items, query, { max: 5 }).map((profile) => sceneProfileSummary(profile, "collective"));
  const entities = mergeByName([...promoterRows, ...collectiveRows]).slice(0, limit);
  return {
    mode: "search",
    kind: input.kind || "promoter",
    query,
    city: input.city || null,
    count: entities.length,
    entities,
    ...(input.city ? {} : { note: "Pass a city to include promoters with upcoming Dizko event listings; collectives are searched worldwide." })
  };
}

async function promoterProfile(id, input, options) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const wantCollective = input.kind !== "promoter";
  const wantPromoter = input.kind !== "collective" && Boolean(input.city);
  const [promoter, collective] = await Promise.all([
    wantPromoter ? getPromoter(input.city, id, options).catch((error) => (error?.status === 404 ? null : Promise.reject(error))) : Promise.resolve(null),
    wantCollective ? getSceneProfile("collective", id, options).catch((error) => (error?.status === 404 ? null : Promise.reject(error))) : Promise.resolve(null)
  ]);
  if (!promoter && !collective) {
    if (!input.city && input.kind !== "collective") {
      throw new ToolInputError("Promoter lookup by id needs a city (promoter ids are per city). Pass city, or search by name first.", { field: "city", code: "missing_city" });
    }
    const error = new Error("Scene entity not found");
    error.status = 404;
    throw error;
  }
  const entity = compactObject({
    ...(collective ? sceneProfileSummary(collective, "collective") : {}),
    ...(promoter ? {
      ...promoterSummary(promoter, promoter.city || input.city),
      past_count: promoter.past_count ?? 0,
      venues: promoter.venues || [],
      external_url: promoter.external_url || null,
      claimed: Boolean(promoter.claimed)
    } : {}),
    kind: promoter && collective ? "promoter" : promoter ? "promoter" : "collective",
    collective_url: collective ? `https://www.dizko.app/collectives/${encodeURIComponent(collective.id)}` : null
  });
  return {
    mode: "profile",
    kind: entity.kind,
    entity,
    upcoming_events: (promoter?.events || []).map((event) => summarizeEvent(event, {
      ...options,
      webBaseUrl: config.webBaseUrl,
      linkBaseUrl: config.mcpUrl,
      fields: input.fields
    })),
    ...(promoter ? {} : { data_note: "Dizko has no verified collective-to-event links for this profile; pass a city to look up its promoter listings." })
  };
}

// ---------- any kind ----------

async function findAnyEntity(input, options) {
  const query = String(input.query).trim();
  const limit = boundedLimit(input.limit, 10, 20);
  const response = await searchScene({ query, city: input.city, genre: input.genre, limit }, options);
  const entities = (response.items || []).map((profile) => sceneProfileSummary(profile, kindFromScene(profile.kind)));
  return {
    mode: "search",
    kind: "any",
    query,
    city: input.city || null,
    count: response.count ?? entities.length,
    total_indexed: response.total_indexed ?? null,
    entities
  };
}

// ---------- shared ----------

// The scene index is semantic and always fills the page; keep rows that
// actually matched the text (or contain the query), never fewer than 3.
function relevantItems(items, query, { max = 20 } = {}) {
  const list = Array.isArray(items) ? items : [];
  const needle = normalizeText(query);
  const strong = list.filter((item) => normalizeText(item?.name).includes(needle));
  if (strong.length) return strong.slice(0, max);
  const textMatches = list.filter((item) => item?.matched_text === true);
  return (textMatches.length ? textMatches : list).slice(0, Math.min(max, 5));
}

function isConfidentMatch(query, entities) {
  if (!entities.length) return false;
  const needle = normalizeText(query);
  const top = normalizeText(entities[0].name);
  return top === needle || needle.includes(top) || top.includes(needle);
}

function mergeByName(rows) {
  const seen = new Map();
  for (const row of rows) {
    const key = normalizeText(row.name);
    if (!seen.has(key)) seen.set(key, row);
    else seen.set(key, { ...seen.get(key), ...row, kind: "promoter" });
  }
  return [...seen.values()];
}

function kindFromScene(kind) {
  if (kind === "dj") return "artist";
  return kind || "entity";
}

export function sceneProfileSummary(profile, kind) {
  const links = compactObject({
    profile: profile.profile_url,
    website: profile.website_url,
    soundcloud: profile.soundcloud_url,
    resident_advisor: profile.resident_advisor_url,
    instagram: profile.instagram_url,
    source: profile.source_url
  });
  const dizkoUrl = kind === "artist"
    ? `https://www.dizko.app/${encodeURIComponent(artistHandle(profile.id))}`
    : kind === "collective"
      ? `https://www.dizko.app/collectives/${encodeURIComponent(profile.id)}`
      : null;
  return compactObject({
    id: profile.id,
    kind,
    name: profile.name,
    cities: profile.cities || [],
    regions: profile.regions || [],
    country: profile.country,
    neighborhood: profile.neighborhood,
    genres: profile.genres || [],
    bio: profile.bio,
    typical_capacity: profile.typical_capacity,
    founded: profile.founded,
    dizko_url: dizkoUrl,
    match_score: typeof profile.score === "number" ? Math.round(profile.score * 1000) / 1000 : undefined,
    links
  });
}

function promoterSummary(profile, fallbackCity) {
  const city = profile.city || fallbackCity;
  const citySlug = profile.city_slug || city;
  return compactObject({
    id: profile.slug,
    kind: "promoter",
    name: profile.name,
    city,
    genres: profile.genres || [],
    upcoming_count: profile.upcoming_count ?? 0,
    next_event_at: profile.next_event_at,
    dizko_url: citySlug && profile.slug
      ? `https://www.dizko.app/promoters/${encodeURIComponent(citySlug)}/${encodeURIComponent(profile.slug)}`
      : null
  });
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => {
    if (item === undefined || item === null || item === "") return false;
    if (Array.isArray(item) && item.length === 0) return false;
    if (typeof item === "object" && !Array.isArray(item) && Object.keys(item).length === 0) return false;
    return true;
  }));
}

function normalizeEntityKind(value) {
  const kind = normalizeText(value);
  if (kind === "dj" || kind === "artist") return "artist";
  if (kind === "venue") return "venue";
  if (kind === "collective") return "collective";
  if (kind === "promoter") return "promoter";
  return null;
}

function normalizeText(value) {
  return String(value || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values)];
}

function boundedLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function entityError(error, code) {
  return { error, code };
}
