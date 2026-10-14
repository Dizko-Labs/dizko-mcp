import { cityDisplayName, cityTimezone, haversineKm, resolveCity } from "./cities.js";
import { zonedParts } from "./dateRange.js";

// Defensive data-honesty checks on upstream listings. The backend is where
// these get fixed at the root; the connector still refuses to pass a wrong
// currency symbol, a placeholder end time, or the same party twice to an
// assistant that will repeat it to a user as fact.

// Local currency per country in CITY_TABLE. A listing priced in another
// currency is not necessarily wrong, but it is not something Dizko can stand
// behind either, so it is shown without the symbol and flagged.
export const COUNTRY_CURRENCY = {
  Argentina: "ARS",
  Austria: "EUR",
  Brazil: "BRL",
  Canada: "CAD",
  Colombia: "COP",
  Czechia: "CZK",
  Denmark: "DKK",
  France: "EUR",
  Germany: "EUR",
  Greece: "EUR",
  "Hong Kong": "HKD",
  Hungary: "HUF",
  India: "INR",
  Ireland: "EUR",
  Italy: "EUR",
  Japan: "JPY",
  Mexico: "MXN",
  Netherlands: "EUR",
  Nigeria: "NGN",
  Poland: "PLN",
  Portugal: "EUR",
  Singapore: "SGD",
  "South Korea": "KRW",
  Spain: "EUR",
  Sweden: "SEK",
  Thailand: "THB",
  "Türkiye": "TRY",
  "United Arab Emirates": "AED",
  "United Kingdom": "GBP",
  "United States": "USD"
};

export function cityCurrency(value) {
  const city = resolveCity(value);
  return city ? COUNTRY_CURRENCY[city.country] || null : null;
}

// Currencies a source in that country legitimately prices in besides the
// local one: dollar pricing is common for festivals and tourist nights in
// these markets. EUR is never on this list, because EUR was the backend's
// old universal fallback and is the signature of a guessed code.
export const ACCEPTED_SECONDARY_CURRENCIES = {
  Argentina: ["USD"],
  Colombia: ["USD"],
  Mexico: ["USD"],
  "Türkiye": ["USD"]
};

function acceptedCurrencies(value) {
  const city = resolveCity(value);
  if (!city) return null;
  const local = COUNTRY_CURRENCY[city.country];
  return local ? [local, ...(ACCEPTED_SECONDARY_CURRENCIES[city.country] || [])] : null;
}

// Sources that relist other sites' listings rather than publish their own.
// A show known only from one of these is often stale (moved, cancelled, or a
// recurring placeholder), so it is flagged and ranked lower, never hidden.
// Kept deliberately short: a city's main listings site is not an aggregator.
export const AGGREGATOR_SOURCES = new Set(["allevents", "allevents_in", "10times", "eventsfy", "happeningnext", "eventbu", "evvnt"]);

export function isAggregatorSource(source) {
  return AGGREGATOR_SOURCES.has(String(source || "").trim().toLowerCase().replace(/[\s.-]+/g, "_"));
}

// The known flags and what each means. A backend flag that is not one of
// these is unknown to the connector and costs UNKNOWN_FLAG_PENALTY in
// ranking, which is never more than a known flag costs.
export const QUALITY_FLAG_NOTES = {
  zero_duration_aggregator: "A re-listing site gives the same start and end time, which usually means a stale or misdated listing.",
  start_time_assumed: "The source gives only the date; the start time is not confirmed, so only the date is shown.",
  currency_unverified: "The listed currency does not match the city, so the amount is shown without a currency.",
  currency_inferred: "The currency was inferred from the city, not stated by the source.",
  start_equals_end: "The source lists the same start and end time, which usually means an incomplete or stale listing.",
  start_time_conflict: "Sources disagree on the start time.",
  aggregator_only: "Only an aggregator lists this event; confirm on the organizer's page."
};

// Flags that lower a listing's rank in recommend, plan and roundup flows.
// An unknown end time alone is common and harmless, so it costs nothing.
const RANK_PENALTIES = {
  zero_duration_aggregator: 8,
  start_equals_end: 8,
  aggregator_only: 8,
  currency_unverified: 4,
  start_time_conflict: 3,
  // A dated listing with a made-up clock time (AgendaLX's 12:00) is a real
  // event; only its hour is unknown.
  start_time_assumed: 2
};
const UNKNOWN_FLAG_PENALTY = 2;
const LOW_CONFIDENCE_PENALTY = 10;
const MAX_PENALTY = 25;

function timezoneOf(event) {
  return cityTimezone(event?.venue_city) || (event?.timezone && String(event.timezone)) || "UTC";
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// An end time is only real when it is after the start and is not the 23:59
// a scraper writes when the source gave none. 23:59 is checked in the
// city's own time, which is why the city table has to know every city.
// A multi-day placeholder keeps its local end date, because the dates of a
// festival are still worth showing even when its closing hour is not.
export function assessEndTime(event) {
  const start = parseDate(event?.start_time);
  const end = parseDate(event?.end_time);
  if (!end) return { end: null, flag: null, endDateLocal: null };
  if (!start) return { end, flag: null, endDateLocal: null };
  if (end.getTime() === start.getTime()) return { end: null, flag: "start_equals_end", endDateLocal: null };
  if (end.getTime() < start.getTime()) return { end: null, flag: "end_time_unknown", endDateLocal: null };
  const zone = timezoneOf(event);
  const parts = zonedParts(end, zone);
  if (parts.hour === 23 && parts.minute === 59) {
    const startDay = localDay(start, zone);
    const endDay = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
    return { end: null, flag: "end_time_unknown", endDateLocal: endDay !== startDay ? endDay : null };
  }
  return { end, flag: null, endDateLocal: null };
}

// The currency the summary may state.
//
// When the backend says whether it inferred the code (`currency_inferred`,
// a boolean on every event once its ingest quality pass is deployed), that
// is the answer: its ingest guard already relabels or drops a guessed code,
// and a code the source stated is kept whatever it says, so a festival in Goa
// that really sells in EUR is not second-guessed here. Only an inferred code
// that still disagrees with the city falls back to the city's currency,
// labelled as inferred.
//
// Without that field (older backends), a code that disagrees with the city's
// country is dropped unless it is one of the country's accepted secondary
// currencies.
export function assessCurrency(event) {
  const listed = currencyCode(event?.currency);
  const expected = cityCurrency(event?.venue_city);
  if (!listed) return { currency: null, status: null, flag: null };
  if (typeof event?.currency_inferred === "boolean") {
    if (!event.currency_inferred) return { currency: listed, status: null, flag: null };
    return { currency: expected && listed !== expected ? expected : listed, status: "inferred", flag: "currency_inferred" };
  }
  const inferred = backendInferredCurrency(event);
  const accepted = acceptedCurrencies(event?.venue_city);
  if (!expected || !accepted || accepted.includes(listed)) {
    return inferred ? { currency: listed === expected || !expected ? listed : expected, status: "inferred", flag: "currency_inferred" } : { currency: listed, status: null, flag: null };
  }
  if (inferred) return { currency: expected, status: "inferred", flag: "currency_inferred" };
  // With no amount there is nothing to misprice: the code is dropped quietly.
  const priced = [event?.price_min, event?.price_max].some((value) => Number(value) > 0);
  if (!priced) return { currency: null, status: null, flag: null };
  return { currency: null, status: "unverified", flag: "currency_unverified" };
}

// Legacy provenance hints some payloads carry instead of the boolean.
function backendInferredCurrency(event) {
  if (event?.currency_inferred === true) return true;
  const source = String(event?.currency_source || event?.currency_provenance || "").trim().toLowerCase();
  return ["inferred", "city_default", "default", "guessed"].includes(source);
}

function currencyCode(value) {
  const code = String(value || "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

// Backend flags pass through by name. Strings and { code } objects are both
// accepted. `hasBackendFlags` is true whenever the backend sent the field at
// all, even as an empty list: that is the backend saying it checked.
function rawBackendFlags(event) {
  if (Array.isArray(event?.quality_flags)) return event.quality_flags;
  if (Array.isArray(event?.data_quality?.flags)) return event.data_quality.flags;
  if (event?.quality_flags != null) return [event.quality_flags];
  return null;
}

export function hasBackendFlags(event) {
  return rawBackendFlags(event) !== null;
}

function backendFlags(event) {
  const raw = rawBackendFlags(event) || [];
  return raw
    .map((item) => typeof item === "string" ? item : item?.code || item?.flag || null)
    .filter((item) => typeof item === "string" && /^[a-z0-9_]{1,48}$/i.test(item))
    .map((item) => item.toLowerCase())
    .slice(0, 8);
}

// The backend's own listing confidence, when it sends one: a 0-1 number or
// low/medium/high. Anything else is ignored rather than guessed at.
export function backendConfidence(event) {
  const raw = event?.confidence ?? event?.quality_confidence ?? event?.data_quality?.confidence;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1) return Math.round(raw * 100) / 100;
  const text = String(raw ?? "").trim().toLowerCase();
  return ["low", "medium", "high"].includes(text) ? text : null;
}

// Every flag for one raw upstream event, backend flags first.
//
// When the backend sent quality_flags it is the authority on listing-level
// flags (its ingest pass sees every source and clears placeholder ends at
// the root), so the connector's own start/end and aggregator inference is
// skipped. Two kinds of flag are still added here because only the
// connector can know them: the currency status of what it is about to show,
// and start_time_conflict from merging two sources in one response.
//
// Without backend flags (older backends) the connector infers its own. The
// near-duplicate pass may already have attached start_time_conflict and
// also_listed_by; an event corroborated by a non-aggregator source is not
// aggregator-only.
export function qualityFlags(event) {
  const flags = new Set(backendFlags(event));
  const fromBackend = hasBackendFlags(event);
  if (!fromBackend) {
    // An unknown end time is common and is handled by omitting it, so it is
    // not a flag the assistant needs to talk about.
    const end = assessEndTime(event);
    if (end.flag && end.flag !== "end_time_unknown") flags.add(end.flag);
    const sources = [event?.source, ...(event?.also_listed_by || [])].filter(Boolean);
    if (sources.length && sources.every(isAggregatorSource)) flags.add("aggregator_only");
  }
  const currency = assessCurrency(event);
  if (currency.flag) flags.add(currency.flag);
  if (event?.start_time_conflict) flags.add("start_time_conflict");
  return [...flags];
}

export function startTimeAssumed(event) {
  return qualityFlags(event).includes("start_time_assumed");
}

export function qualityPenalty(event) {
  let penalty = 0;
  for (const flag of qualityFlags(event)) {
    penalty += RANK_PENALTIES[flag] ?? (QUALITY_FLAG_NOTES[flag] ? 0 : UNKNOWN_FLAG_PENALTY);
  }
  const confidence = backendConfidence(event);
  if (confidence === "low" || (typeof confidence === "number" && confidence < 0.5)) penalty += LOW_CONFIDENCE_PENALTY;
  return Math.min(MAX_PENALTY, penalty);
}

// Appended to assistant_instruction only when a returned event carries a
// flag, so clean results keep the short instruction.
export const QUALITY_INSTRUCTION = "Some events carry quality_flags: mention the uncertainty in a few words (currency unconfirmed, start time not confirmed or disputed, listing may be stale) and never fill in a missing time or currency.";

export function withQualityNote(instruction, events = []) {
  const flagged = events.some((event) => Array.isArray(event?.quality_flags) && event.quality_flags.length);
  return flagged ? `${instruction} ${QUALITY_INSTRUCTION}` : instruction;
}

// ---------------------------------------------------------------------------
// Near-duplicate guard
// ---------------------------------------------------------------------------

const TITLE_STOP_WORDS = new Set([
  "the", "a", "an", "at", "in", "on", "of", "and", "with", "by", "for", "to", "x",
  "feat", "ft", "presents", "pres", "live", "night", "party", "event", "edition", "vol", "dj", "djs"
]);
const NEAR_START_MS = 90 * 60 * 1000;
const NEAR_VENUE_KM = 0.3;
const TITLE_OVERLAP = 0.75;

// Two sources listing one party collapse to the better listing. All of these
// must hold: same city-local date, the same or an adjacent venue, titles that
// share most of their meaningful words, starts within 90 minutes, and two
// different sources. Two shows at one venue from one source survive, as do
// an early and a late session hours apart.
export function collapseNearDuplicates(events = []) {
  const kept = [];
  for (const event of events) {
    const index = kept.findIndex((candidate) => isNearDuplicate(candidate, event));
    if (index === -1) {
      kept.push(event);
      continue;
    }
    kept[index] = mergeListings(kept[index], event);
  }
  return kept;
}

export function isNearDuplicate(a, b) {
  if (!a || !b || a.id === b.id) return false;
  const sourceA = String(a.source || "").toLowerCase();
  const sourceB = String(b.source || "").toLowerCase();
  if (!sourceA || !sourceB || sourceA === sourceB) return false;
  const startA = parseDate(a.start_time);
  const startB = parseDate(b.start_time);
  if (!startA || !startB || Math.abs(startA.getTime() - startB.getTime()) > NEAR_START_MS) return false;
  const zone = timezoneOf(a);
  if (localDay(startA, zone) !== localDay(startB, timezoneOf(b))) return false;
  if (!sameVenue(a, b)) return false;
  const overlap = titleOverlap(a, b);
  return overlap.coefficient >= TITLE_OVERLAP && (overlap.shared >= 2 || overlap.jaccard >= 0.5);
}

// Words that name the kind of room, not the room: two venues that share only
// one of these ("Jazz Cafe" and "Jazz Bar") are not the same venue.
const GENERIC_VENUE_WORDS = new Set([
  "club", "bar", "cafe", "café", "pub", "lounge", "room", "rooms", "hall", "house", "studio", "gallery",
  "theatre", "theater", "arena", "stage", "garden", "terrace", "rooftop", "beach", "space", "venue",
  "centre", "center", "museum", "kitchen", "restaurant", "hotel", "cinema", "jazz", "music", "live",
  "nightclub", "disco", "warehouse", "basement", "loft", "shack", "academy"
]);
const FAR_VENUE_KM = 1;

function sameVenue(a, b) {
  const cityA = resolveCity(a.venue_city)?.slug;
  const cityB = resolveCity(b.venue_city)?.slug;
  if (cityA && cityB && cityA !== cityB) return false;
  const lat1 = Number(a.lat);
  const lng1 = Number(a.lng);
  const lat2 = Number(b.lat);
  const lng2 = Number(b.lng);
  const hasCoordinates = [a.lat, a.lng, b.lat, b.lng].every((value) => value !== null && value !== undefined && value !== "")
    && [lat1, lng1, lat2, lng2].every(Number.isFinite);
  if (hasCoordinates) {
    const km = haversineKm(lat1, lng1, lat2, lng2);
    if (km <= NEAR_VENUE_KM) return true;
    // Coordinates a kilometre or more apart are two rooms, whatever the
    // names share. In between, the names decide.
    if (km >= FAR_VENUE_KM) return false;
  }
  const tokensA = venueTokens(a.venue_name);
  const tokensB = venueTokens(b.venue_name);
  if (!tokensA.size || !tokensB.size) {
    // A name made only of generic words ("The Jazz Cafe") has to match in full.
    const fullA = nameTokens(a.venue_name);
    const fullB = nameTokens(b.venue_name);
    return fullA.size > 0 && fullA.size === fullB.size && [...fullA].every((token) => fullB.has(token));
  }
  return overlapCoefficient(tokensA, tokensB) >= 0.5;
}

// The distinctive words of a venue name: no generic room words and no city
// names, so "Qilla Goa, Vagator" meets "Qilla" on "qilla" alone.
function venueTokens(value) {
  return new Set([...nameTokens(value)].filter((token) => !GENERIC_VENUE_WORDS.has(token) && resolveCity(token)?.slug !== token));
}

// Venue, city and lineup words are left out of the title comparison, so
// "Qilla Fridays ft. DJ Nyx" and "Friday Night at Qilla" compare on what the
// night is called, and a venue's name in both titles cannot make two
// different nights look alike.
function titleOverlap(a, b) {
  const placeWords = new Set([
    ...nameTokens(a.venue_name), ...nameTokens(b.venue_name),
    ...nameTokens(cityDisplayName(a.venue_city)), ...nameTokens(cityDisplayName(b.venue_city)),
    ...[...(Array.isArray(a.lineup) ? a.lineup : []), ...(Array.isArray(b.lineup) ? b.lineup : [])].flatMap((name) => [...nameTokens(name)])
  ]);
  const strip = (title) => new Set([...nameTokens(title)].filter((token) => !placeWords.has(token)));
  let left = strip(a.title);
  let right = strip(b.title);
  if (!left.size || !right.size) {
    // A title that is only the artist or the venue ("Joyce Candido" against
    // "Joyce Cândido @ A Voz do Operário") is compared on its full words.
    left = nameTokens(a.title);
    right = nameTokens(b.title);
    if (!left.size || !right.size) return { coefficient: 0, jaccard: 0, shared: 0 };
  }
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return {
    coefficient: shared / Math.min(left.size, right.size),
    jaccard: shared / (left.size + right.size - shared),
    shared
  };
}

function overlapCoefficient(left, right) {
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

function nameTokens(value) {
  return new Set(normalized(value)
    .split(/[^\p{L}\p{N}]+/u)
    .map(stem)
    .filter((token) => token.length > 1 && !TITLE_STOP_WORDS.has(token)));
}

// Plural and possessive endings only; enough for "Saturdays" to meet
// "Saturday" without merging different words.
function stem(token) {
  if (token.length > 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

function normalized(value) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

// The kept listing is the one with more verifiable detail; the other
// source is recorded, and a start-time disagreement is surfaced instead of
// silently picking one.
function mergeListings(existing, incoming) {
  const [winner, loser] = listingScore(incoming) > listingScore(existing) ? [incoming, existing] : [existing, incoming];
  const alsoListedBy = [...new Set([
    ...(winner.also_listed_by || []),
    ...[loser.source, ...(loser.also_listed_by || [])].filter(Boolean)
  ].filter((source) => source !== winner.source))];
  const startsDiffer = Date.parse(winner.start_time) !== Date.parse(loser.start_time);
  return {
    ...winner,
    also_listed_by: alsoListedBy,
    duplicate_ids: [...new Set([...(winner.duplicate_ids || []), loser.id, ...(loser.duplicate_ids || [])])],
    ...(startsDiffer || winner.start_time_conflict || loser.start_time_conflict
      ? { start_time_conflict: true, alternate_start_times: [...new Set([...(winner.alternate_start_times || []), loser.start_time, ...(loser.alternate_start_times || [])])].filter((value) => value && value !== winner.start_time) }
      : {})
  };
}

function listingScore(event) {
  let score = 0;
  if (!isAggregatorSource(event.source)) score += 4;
  if (Array.isArray(event.lineup) && event.lineup.length) score += 2;
  if (event.price_min != null || event.price_max != null) score += 1;
  if (event.ticket_url) score += 1;
  if (assessEndTime(event).end) score += 1;
  if (assessCurrency(event).flag === "currency_unverified") score -= 1;
  score += Math.min(3, Math.log10(Number(event.attendance_count || 0) + 1));
  return score;
}

function localDay(date, zone) {
  const parts = zonedParts(date, zone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}
