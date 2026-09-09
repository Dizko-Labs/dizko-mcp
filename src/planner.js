import { getConfig } from "./config.js";
import { searchEvents } from "./api.js";
import { dedupeSameShow } from "./artistEvents.js";
import { summarizeEvent } from "./format.js";
import { rankEvents } from "./rank.js";

// Ranked search. Explicit request fields are upstream filters (they are in
// `input`); `input.preferences` carries saved and learned taste as ranking
// hints only. Fetches a wider candidate page than it returns so the ranker
// has something to rank.
export async function recommendEvents(input = {}, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const resultLimit = Math.max(1, Math.min(Number(input.result_limit ?? input.limit ?? 10) || 10, 50));
  const candidates = Math.min(200, Math.max(Number(input.candidate_limit) || 0, resultLimit * 4, 60));
  const response = await searchEvents({ ...input, limit: candidates, offset: input.offset ?? 0 }, { ...options, config });
  const hints = input.preferences || rankingHintsFromRequest(input);
  // Two sources listing one show would otherwise both survive ranking and
  // appear as separate recommendations.
  const ranked = rankEvents(dedupeSameShow(response.events || []), hints, options.now);
  const summaryOptions = { ...options, webBaseUrl: config.webBaseUrl, linkBaseUrl: config.mcpUrl, fields: input.fields };
  return {
    count: response.count ?? ranked.length,
    ranked_count: ranked.length,
    search_fallback: response.search_fallback ?? null,
    events: ranked.slice(0, resultLimit).map((event) => ({
      ...summarizeEvent(event, summaryOptions),
      recommendation_score: event.recommendation_score,
      recommendation_reasons: event.recommendation_reasons
    }))
  };
}

// Without a profile, the request itself is the taste: genres, vibe, avoid
// terms, and a soft budget (max_price) rank; price_max is the hard cap.
export function rankingHintsFromRequest(input = {}) {
  return {
    genres: input.genres,
    vibe: input.vibe,
    event_types: input.event_types,
    venues: input.venue,
    featuring: input.featuring,
    avoid: input.avoid,
    max_price: input.max_price ?? input.budget ?? input.price_max,
    free: input.free,
    nightlife: input.nightlife
  };
}

export async function planNight(input = {}, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const response = await searchEvents({ ...input, limit: input.candidate_limit ?? 75 }, { ...options, config });
  const hints = input.preferences || rankingHintsFromRequest(input);
  // Without this the same party can be both the primary option and its own
  // "alternate", because two sources list it under slightly different venues.
  const ranked = rankEvents(dedupeSameShow(response.events || []), hints, options.now);
  const plan = buildPlan(ranked, input);
  const summaryOptions = { ...options, webBaseUrl: config.webBaseUrl, linkBaseUrl: config.mcpUrl, fields: input.fields };

  return {
    city: input.city || null,
    when: input.when || input.date_from || null,
    strategy: "Lead with the strongest taste match, then keep a nearby fallback and a later fallback when the inventory supports them.",
    count: response.count ?? ranked.length,
    search_fallback: response.search_fallback ?? null,
    events: plan.map((event) => ({
      ...summarizeEvent(event, summaryOptions),
      recommendation_score: event.recommendation_score,
      recommendation_reasons: event.recommendation_reasons,
      plan_role: event.plan_role,
      plan_note: event.plan_note,
      distance_from_primary_km: event.distance_from_primary_km
    }))
  };
}

export function buildPlan(events, input = {}) {
  const max = Math.max(1, Math.min(input.result_limit ?? 4, 6));
  if (!events.length) return [];

  const primary = events[0];
  const selected = [{
    ...primary,
    plan_role: "primary",
    plan_note: "Strongest overall match for the request.",
    distance_from_primary_km: 0
  }];
  if (max === 1) return selected;

  const remaining = events.slice(1);
  const nearby = bestNearbyFallback(primary, remaining);
  if (nearby) {
    selected.push(withPlanRole(nearby.event, "nearby_fallback", nearby.distance));
  }

  if (selected.length < max) {
    const later = bestLaterFallback(primary, remaining, selected);
    if (later) {
      selected.push(withPlanRole(later, "later_fallback", distanceBetween(primary, later)));
    }
  }

  for (const event of remaining) {
    if (selected.length >= max) break;
    if (selected.some((chosen) => chosen.id === event.id)) continue;
    selected.push(withPlanRole(event, "alternate", distanceBetween(primary, event)));
  }

  return selected;
}

// Best-scoring event within walking or short-ride distance, not merely
// the closest one: a 1.7 km option that fits the taste beats a 0.6 km one
// that does not.
function bestNearbyFallback(primary, events) {
  const candidates = events
    .filter((event) => hasCoordinates(primary) && hasCoordinates(event))
    .map((event) => ({ event, distance: distanceBetween(primary, event) }))
    .filter(({ distance }) => distance != null && distance <= 6)
    .sort((a, b) => scoreOf(b.event) - scoreOf(a.event) || a.distance - b.distance);
  return candidates[0] || null;
}

function bestLaterFallback(primary, events, selected) {
  const primaryStart = Date.parse(primary.start_time || "");
  if (!Number.isFinite(primaryStart)) return null;

  return events
    .filter((event) => !selected.some((chosen) => chosen.id === event.id))
    .map((event) => ({ event, start: Date.parse(event.start_time || "") }))
    .filter(({ start }) => Number.isFinite(start) && start > primaryStart)
    .sort((a, b) => scoreOf(b.event) - scoreOf(a.event) || a.start - b.start)[0]?.event || null;
}

function withPlanRole(event, role, distance) {
  const notes = {
    nearby_fallback: distance == null
      ? "Fallback with a similar taste fit."
      : `Fallback ${formatDistance(distance)} from the primary option.`,
    later_fallback: "Later-starting fallback if the first option does not work out.",
    alternate: "Additional ranked option."
  };
  return {
    ...event,
    plan_role: role,
    plan_note: notes[role],
    distance_from_primary_km: distance == null ? null : roundedDistance(distance)
  };
}

function scoreOf(event) {
  return Number(event.recommendation_score || 0);
}

function hasCoordinates(event) {
  return event.lat != null
    && event.lng != null
    && Number.isFinite(Number(event.lat))
    && Number.isFinite(Number(event.lng));
}

export function distanceBetween(a, b) {
  if (!hasCoordinates(a) || !hasCoordinates(b)) return null;
  const earthRadiusKm = 6371;
  const lat1 = toRadians(Number(a.lat));
  const lat2 = toRadians(Number(b.lat));
  const deltaLat = toRadians(Number(b.lat) - Number(a.lat));
  const deltaLng = toRadians(Number(b.lng) - Number(a.lng));
  const haversine = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function toRadians(value) {
  return value * Math.PI / 180;
}

function roundedDistance(value) {
  return Math.round(value * 10) / 10;
}

function formatDistance(value) {
  return `${roundedDistance(value)} km`;
}
