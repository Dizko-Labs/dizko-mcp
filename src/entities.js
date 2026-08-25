import {
  getDjInsights,
  getPromoter,
  getSceneProfile,
  listPromoters,
  searchEvents,
  searchScene
} from "./api.js";
import { getConfig } from "./config.js";
import { getArtistEvents } from "./artistEvents.js";
import { summarizeEvent } from "./format.js";

const SCENE_KIND = {
  artist: "dj",
  venue: "venue",
  collective: "collective"
};

export async function findSceneEntities(input = {}, options = {}) {
  const kind = normalizeEntityKind(input.kind);
  if (!kind) {
    return entityError("kind must be artist, venue, collective, or promoter", "invalid_entity_kind");
  }
  if (input.id) return getEntityProfile(kind, String(input.id).trim(), input, options);
  if (!String(input.query || "").trim()) {
    return entityError("Pass an entity id or a search query", "missing_entity_lookup");
  }
  return searchEntities(kind, input, options);
}

async function searchEntities(kind, input, options) {
  const query = String(input.query).trim();
  const limit = boundedLimit(input.limit, 10, 20);
  if (kind === "promoter") {
    if (!String(input.city || "").trim()) {
      return entityError("Promoter search requires a city", "missing_city");
    }
    const response = await listPromoters(input.city, 200, options);
    const needle = normalizeText(query);
    const genre = normalizeText(input.genre);
    const entities = (response.promoters || [])
      .filter((item) => !needle || normalizeText(`${item.name} ${item.slug}`).includes(needle))
      .filter((item) => !genre || (item.genres || []).some((value) => normalizeText(value).includes(genre)))
      .slice(0, limit)
      .map((item) => promoterSummary(item, response.city || input.city));
    return {
      mode: "search",
      kind,
      query,
      city: response.city || input.city,
      count: entities.length,
      entities
    };
  }

  const response = await searchScene({
    query,
    kind: SCENE_KIND[kind],
    // Ask for headroom: duplicates of one entity across sources collapse
    // into a single result, so a raw `limit` would under-fill the page.
    limit: Math.min(limit * 2, 40),
    city: input.city,
    genre: input.genre
  }, options);
  const ranked = rankSceneResults(response.items || [], kind);
  const confident = ranked.filter(isConfidentSceneMatch).slice(0, limit);
  // Below the confidence floor the index has nothing for this query, and the
  // rows upstream returned are the nearest vectors rather than answers.
  // Saying so beats handing back ten plausible-looking names.
  if (!confident.length) {
    const nearest = ranked.slice(0, 3).map(({ profile }) => compactObject({
      id: profile.id,
      name: profile.name,
      relevance: roundRelevance(profile.score)
    }));
    return {
      mode: "search",
      kind,
      query,
      city: input.city || null,
      count: 0,
      no_match: true,
      // Always present and always empty here: a caller reading `entities`
      // must see an empty list, not a missing key it might treat as an error.
      entities: [],
      ...(nearest.length ? { nearest_matches: nearest } : {}),
      total_indexed_all_kinds: response.total_indexed ?? null,
      data_note: `No indexed ${kind} matches "${query}". Entries under nearest_matches are the closest names in the index, not matches - offer them as a "did you mean", never as an answer.`
    };
  }
  return {
    mode: "search",
    kind,
    query,
    city: input.city || null,
    count: confident.length,
    // Deliberately not `total_indexed`: upstream reports one figure for the
    // whole scene index and repeats it for every kind, so a per-kind name
    // invites a caller to claim there are 109,724 venues.
    total_indexed_all_kinds: response.total_indexed ?? null,
    entities: confident.map(({ profile, source, canonical, mergedSources }) => compactObject({
      ...sceneProfileSummary(profile, kind),
      source,
      // Emitted only when true: `source` already tells a caller when a
      // result is a third-party stub.
      canonical: canonical || undefined,
      merged_sources: mergedSources,
      relevance: roundRelevance(profile.score),
      semantic_similarity: roundRelevance(profile.semantic_similarity),
      match: profile.matched_text ? "name" : "semantic"
    }))
  };
}

// Upstream fuses a text retriever and a semantic one with reciprocal rank
// fusion, so a hit only the semantic side found scores 1/(60+rank) - about
// 0.0164 at rank 1, and never more. Every nonsense query we sampled tops out
// at exactly that value with matched_text false, while every real or
// descriptive query clears 0.049 with matched_text true. The floor sits in
// that gap: above it means two retrievers agreed, which no query without a
// real match can reach.
const SCENE_RELEVANCE_FLOOR = 0.02;

function isConfidentSceneMatch(entry) {
  if (entry.profile.matched_text === true) return true;
  if (entry.profile.matched_text === false) return false;
  // matched_text is a newer field. Fall back to the score when there is one,
  // and trust an upstream that scores nothing at all rather than suppressing
  // every result it returns.
  if (!Number.isFinite(Number(entry.profile.score))) return true;
  return entry.score >= SCENE_RELEVANCE_FLOOR;
}

function roundRelevance(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 10_000) / 10_000;
}

// Dizko's own profiles are the ranking target: they carry the bio, genres,
// capacity and links an agent actually needs, while Wikidata and OSM
// contribute thin stubs of the same places. Upstream ranks on text and
// semantic match alone, so a stub named exactly "Berghain" outranks the
// native "Berghain / Panorama Bar" profile. Fold duplicates into the
// canonical record and give it a bounded boost.
export function rankSceneResults(items, kind) {
  const groups = [];
  for (const profile of items) {
    if (!profile?.name) continue;
    const entry = {
      profile,
      source: sceneSource(profile),
      canonical: isCanonicalProfile(profile),
      score: Number(profile.score) || 0,
      mergedSources: []
    };
    const existing = groups.find((group) => sameSceneEntity(group, entry, kind));
    if (!existing) {
      groups.push(entry);
      continue;
    }
    mergeSceneDuplicate(existing, entry);
  }
  // A modest multiplier, not an absolute precedence: it flips the near-ties
  // that duplicate stubs create without letting a weakly-matching native
  // profile jump a stub that is genuinely the better answer.
  const CANONICAL_BOOST = 1.25;
  return groups
    .map((group) => ({ ...group, ranked: group.score * (group.canonical ? CANONICAL_BOOST : 1) }))
    .sort((a, b) => b.ranked - a.ranked);
}

// Two results describe one entity when their names agree. Venue names vary
// by room enumeration across sources, so they compare room-wise; other
// kinds compare on the normalized name.
function sameSceneEntity(a, b, kind) {
  if (a.profile.id === b.profile.id) return true;
  if (kind === "venue") return venueNameMatches(a.profile.name, b.profile.name);
  return normalizeText(a.profile.name) === normalizeText(b.profile.name);
}

// Keeps the canonical record as the surviving one, backfills only the fields
// it is missing, and records which sources were folded in so a caller can
// still see that a third-party entry existed.
function mergeSceneDuplicate(existing, duplicate) {
  const preferDuplicate = !existing.canonical && duplicate.canonical;
  const winner = preferDuplicate ? duplicate : existing;
  const loser = preferDuplicate ? existing : duplicate;
  // Read the loser before `existing` is overwritten with the winner - when
  // the duplicate wins, `existing` and `loser` are the same object.
  const loserProfile = loser.profile;
  const loserSource = loser.source;
  const score = Math.max(existing.score, duplicate.score);

  existing.profile = { ...winner.profile };
  existing.source = winner.source;
  existing.canonical = winner.canonical;
  existing.score = score;

  for (const field of MERGEABLE_PROFILE_FIELDS) {
    const value = loserProfile[field];
    const current = existing.profile[field];
    if (value === undefined || value === null) continue;
    if (current === undefined || current === null || (Array.isArray(current) && !current.length)) {
      existing.profile[field] = value;
    }
  }
  if (loserSource && loserSource !== existing.source && !existing.mergedSources.includes(loserSource)) {
    existing.mergedSources.push(loserSource);
  }
}

// Only descriptive fields cross over when duplicates merge. Identity and
// provenance (id, name, source_url, profile_url) stay the winner's, so a
// merged result never claims a stub's id or cites a stub as its source.
const MERGEABLE_PROFILE_FIELDS = [
  "cities", "regions", "country", "neighborhood", "genres", "bio",
  "typical_capacity", "founded", "website_url", "soundcloud_url",
  "resident_advisor_url", "instagram_url"
];

// Dizko's own catalog ids are plain slugs; imported stubs are namespaced by
// their origin, and source_url names the origin directly.
function sceneSource(profile) {
  const id = String(profile.id || "");
  if (id.startsWith("wd-")) return "wikidata";
  if (id.startsWith("osm-")) return "openstreetmap";
  const host = hostnameOf(profile.source_url);
  if (host.endsWith("wikidata.org")) return "wikidata";
  if (host.endsWith("openstreetmap.org")) return "openstreetmap";
  return "dizko";
}

function isCanonicalProfile(profile) {
  return sceneSource(profile) === "dizko";
}

function hostnameOf(value) {
  try {
    return new URL(String(value)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

async function getEntityProfile(kind, id, input, options) {
  if (kind === "promoter") {
    if (!String(input.city || "").trim()) {
      return entityError("Promoter lookup requires a city", "missing_city");
    }
    const profile = await getPromoter(input.city, id, options);
    const config = { ...getConfig(options.env), ...(options.config || {}) };
    return {
      mode: "profile",
      kind,
      entity: {
        ...promoterSummary(profile, profile.city || input.city),
        past_count: profile.past_count ?? 0,
        venues: profile.venues || [],
        external_url: profile.external_url || null,
        claimed: Boolean(profile.claimed)
      },
      upcoming_events: (profile.events || []).map((event) => summarizeEvent(event, {
        webBaseUrl: config.webBaseUrl,
        linkBaseUrl: config.mcpUrl
      }))
    };
  }

  const profile = await getSceneProfile(SCENE_KIND[kind], id, options);
  const entity = sceneProfileSummary(profile, kind);
  if (kind === "collective") {
    return {
      mode: "profile",
      kind,
      entity,
      data_note: "Dizko has no verified collective-to-event links for this profile."
    };
  }

  if (kind === "artist") {
    const [insights, calendar] = await Promise.all([
      getDjInsights(id, options),
      getArtistEvents({
        artists: [profile.name],
        city: input.city,
        date_from: input.date_from,
        date_to: input.date_to,
        limit_per_artist: boundedLimit(input.limit, 8, 10)
      }, options)
    ]);
    return {
      mode: "profile",
      kind,
      entity,
      insights: {
        indexed_events: insights.indexed_events ?? 0,
        upcoming_events: insights.upcoming_events ?? 0,
        first_event_at: insights.first_event_at || null,
        latest_event_at: insights.latest_event_at || null,
        top_venues: insights.top_venues || [],
        related_artists: insights.related_djs || [],
        modified_at: insights.modified_at || null
      },
      upcoming_events: calendar.artists?.[0]?.events || []
    };
  }

  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const city = input.city || profile.cities?.[0];
  // The events API matches `venue` as a substring of venue_name, and scene
  // profile names rarely spell a venue the way its listings do ("Berghain /
  // Panorama Bar" vs "Berghain | Panorama Bar | Saule"). Query the full name
  // first, then fall back to the profile name's distinctive lead segment.
  let matchedQuery = null;
  let events = [];
  for (const venueQuery of venueQueryTerms(profile.name)) {
    const response = await searchEvents({
      city,
      venue: venueQuery,
      date_from: input.date_from,
      date_to: input.date_to,
      limit: 50
    }, { ...options, config });
    const candidates = (response.events || []).filter((event) => venueNameMatches(profile.name, event.venue_name));
    if (candidates.length) {
      matchedQuery = venueQuery;
      events = candidates;
      break;
    }
  }
  const upcomingEvents = events
    .slice(0, boundedLimit(input.limit, 10, 20))
    .map((event) => summarizeEvent(event, {
      webBaseUrl: config.webBaseUrl,
      linkBaseUrl: config.mcpUrl
    }));
  const matchedVenueNames = [...new Set(events.map((event) => event.venue_name).filter(Boolean))];
  return compactObject({
    mode: "profile",
    kind,
    entity,
    returned_event_count: upcomingEvents.length,
    // Listing venue strings the join accepted, so a caller can see which
    // real-world spelling backs the count instead of trusting it blind.
    matched_venue_names: matchedVenueNames,
    venue_query: matchedQuery,
    upcoming_events: upcomingEvents,
    data_note: upcomingEvents.length
      ? undefined
      : "Dizko has no upcoming indexed events matching this venue profile."
  });
}

// Query terms to try against the events API's substring `venue` filter, most
// specific first: the full profile name, then each separator-delimited
// segment that still carries a distinctive token.
export function venueQueryTerms(name) {
  const full = String(name || "").trim();
  if (!full) return [];
  const terms = [full];
  for (const segment of full.split(VENUE_SEGMENT_SEPARATOR)) {
    const trimmed = segment.trim();
    if (!trimmed || normalizeText(trimmed) === normalizeText(full)) continue;
    if (!distinctiveTokens(trimmed).length) continue;
    if (!terms.some((term) => normalizeText(term) === normalizeText(trimmed))) terms.push(trimmed);
  }
  return terms;
}

// True when a scene profile name and an event's venue_name denote the same
// room. Venue strings differ across sources by separator, diacritics, and how
// many rooms they enumerate, so compare them a room at a time: "Berghain /
// Panorama Bar" and "Berghain | Panorama Bar | Saule" share rooms, while
// "Berghain" and "Berghain Kantine" are one string apart but two venues.
export function venueNameMatches(profileName, eventVenueName) {
  const profileSegments = venueSegmentKeys(profileName);
  const eventSegments = new Set(venueSegmentKeys(eventVenueName));
  if (!profileSegments.length || !eventSegments.size) return false;
  return profileSegments.some((segment) => eventSegments.has(segment));
}

// Room separators. Venue strings enumerate rooms with these; a plain space
// does not separate rooms, which is why "Berghain Kantine" stays one segment.
// Commas are deliberately excluded: they qualify a venue rather than list its
// rooms, so "Kantine, Berghain" must not match the Berghain profile.
const VENUE_SEGMENT_SEPARATOR = /\s*[/|·•\-\u2013\u2014]+\s*/;

// Each room in a venue string reduced to its distinctive tokens, so that
// equal rooms compare equal across spellings. Segments that carry no
// distinctive token ("Bar", "Berlin") are dropped rather than matched on.
function venueSegmentKeys(value) {
  const keys = [];
  for (const segment of String(value || "").split(VENUE_SEGMENT_SEPARATOR)) {
    const key = distinctiveTokens(segment).join(" ");
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

// Words that carry no venue identity on their own. Dropping them keeps
// "Tresor" matching its "Tresor Berlin" listings without letting a profile
// called "The Loft Bar" match every other bar in the city.
const GENERIC_VENUE_TOKENS = new Set([
  "the", "a", "an", "and", "bar", "club", "venue", "room", "rooms", "hall",
  "lounge", "stage", "floor", "space", "berlin", "london", "nyc"
]);

function distinctiveTokens(value) {
  return [...new Set(
    normalizeVenueText(value)
      .split(" ")
      .filter((token) => token.length > 1 && !GENERIC_VENUE_TOKENS.has(token))
  )];
}

// Case-, accent-, and punctuation-insensitive form used for venue comparison
// only; normalizeText stays the plain lowercase/whitespace helper.
function normalizeVenueText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sceneProfileSummary(profile, kind) {
  const links = compactObject({
    profile: profile.profile_url,
    website: profile.website_url,
    soundcloud: profile.soundcloud_url,
    resident_advisor: profile.resident_advisor_url,
    instagram: profile.instagram_url,
    source: profile.source_url
  });
  const dizkoUrl = kind === "artist"
    ? `https://www.dizko.app/djs/${encodeURIComponent(profile.id)}`
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
    image_url: profile.image_url,
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

function boundedLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function entityError(error, code) {
  return { error, code };
}
