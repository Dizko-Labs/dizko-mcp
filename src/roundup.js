import { searchEvents } from "./api.js";
import { getConfig } from "./config.js";
import { cityDisplayName, cityTimezone } from "./cities.js";
import { assertIsoDate, isoDate, resolveDateRange, weekdayName, zonedParts } from "./dateRange.js";
import { ToolInputError } from "./errors.js";
import { summarizeEvent } from "./format.js";
import { rankEvents } from "./rank.js";

// Display grouping over the canonical event_types vocabulary. Order is
// presentation order; "more" catches typed-but-unmapped and untyped events.
const SECTION_ORDER = [
  { key: "parties", title: "Parties & club nights", types: ["party", "club", "rave"] },
  { key: "live_music", title: "Live music", types: ["live music", "live-music", "concert", "gig"] },
  { key: "art_and_museums", title: "Art & museums", types: ["art", "museum", "exhibition"] },
  { key: "comedy_and_theatre", title: "Comedy & theatre", types: ["comedy", "theatre", "theater"] },
  { key: "talks_and_meetups", title: "Talks & meetups", types: ["talk", "meetup", "workshop"] },
  { key: "food_and_drink", title: "Food & drink", types: ["food", "drink", "market"] },
  { key: "more", title: "More that day", types: null }
];

const COMPACT_SECTION_CAP = 3;

export function resolveRoundupDay(input = {}, now = new Date(), timezone) {
  const zone = timezone || cityTimezone(input.city) || "UTC";
  if (input.date !== undefined && input.date !== null && input.date !== "") {
    const date = String(input.date).trim();
    assertIsoDate(date, "date");
    return date;
  }
  const range = resolveDateRange(input.when || "today", now, zone);
  if (range.date_from && range.date_from !== range.date_to) {
    throw new ToolInputError(`The roundup covers one day; "${input.when}" is a range.`, {
      field: "when",
      allowed: ["today", "tonight", "tomorrow", "a weekday name", "YYYY-MM-DD"],
      hint: `Pass date=${range.date_from} for the first day of that range, or use dizko_search_events for the whole range.`
    });
  }
  return range.date_from || isoDate(now, zone);
}

// One-day digest: fetch a generous page for the target day, rank it, then
// slice into top picks plus deduped category sections.
export async function dailyRoundup(input = {}, options = {}) {
  const config = options.config || getConfig(options.env);
  const timezone = cityTimezone(input.city) || "UTC";
  const day = resolveRoundupDay(input, options.now, timezone);
  const response = await searchEvents({
    ...input,
    when: undefined,
    date: undefined,
    date_from: day,
    date_to: day,
    limit: input.limit ?? 100,
    offset: 0
  }, { ...options, config });

  const personalized = hasTaste(input.preferences);
  const hints = input.preferences || {};
  const ranked = rankEvents(response.events || [], hints, options.now)
    .map((event) => personalized ? event : withDefaultDayScore(event, timezone))
    .sort((a, b) => b.recommendation_score - a.recommendation_score || String(a.start_time || "").localeCompare(String(b.start_time || "")));

  const compact = Boolean(input.compact);
  const summaryOptions = { ...options, webBaseUrl: config.webBaseUrl, linkBaseUrl: config.mcpUrl, fields: input.fields };
  const topLimit = boundedLimit(input.top_limit, compact ? 3 : 5, 10);
  const sectionLimit = boundedLimit(input.section_limit, compact ? COMPACT_SECTION_CAP : 5, 10);

  const topPicks = ranked.slice(0, topLimit);
  const seen = new Set(topPicks.map((event) => event.id));
  const sections = [];
  for (const section of SECTION_ORDER) {
    const matches = [];
    for (const event of ranked) {
      if (matches.length >= sectionLimit) break;
      if (seen.has(event.id) || !matchesSection(section, event)) continue;
      matches.push(event);
      seen.add(event.id);
    }
    if (!matches.length) continue;
    sections.push({
      key: section.key,
      title: section.title,
      count: matches.length,
      events: matches.map((event) => toRankedSummary(event, summaryOptions, compact))
    });
  }

  return {
    city: cityDisplayName(input.city) || null,
    city_slug: input.city || null,
    date: day,
    weekday: weekdayName(day),
    timezone,
    total_available: response.count ?? (response.events || []).length,
    ranking: personalized ? "saved_and_learned_taste" : "popularity_and_time_of_day",
    top_picks: topPicks.map((event) => toRankedSummary(event, summaryOptions, compact)),
    sections: compact ? sections.slice(0, 4) : sections
  };
}

function hasTaste(preferences) {
  if (!preferences) return false;
  return ["genres", "vibe", "event_types", "venues", "promoters", "featuring", "avoid"].some((key) => Array.isArray(preferences[key]) && preferences[key].length)
    || preferences.max_price != null || preferences.free === true || preferences.nightlife === true;
}

// Unpersonalized ranking: "happens soon" is true of every event that day,
// so it is replaced by attendance, the featured flag, and a time-of-day
// prior (parties late, talks and food earlier).
export function withDefaultDayScore(event, timezone) {
  const reasons = (event.recommendation_reasons || []).filter((reason) => reason !== "happens soon" && reason !== "within the next week");
  let total = 0;
  const attendance = Number(event.attendance_count || 0);
  if (attendance > 0) {
    total += Math.min(30, Math.log10(attendance + 1) * 10);
    if (attendance >= 100) reasons.push("strong attendance signal");
  }
  if (event.ra_pick || event.featured_at) {
    total += 8;
    if (!reasons.includes("featured pick")) reasons.push("featured pick");
  }
  const types = (event.event_types || []).map((type) => String(type).toLowerCase());
  const hour = localHour(event.start_time, timezone);
  if (hour != null) {
    if (types.some((type) => ["party", "club", "rave"].includes(type)) && (hour >= 21 || hour < 6)) { total += 6; reasons.push("prime club hours"); }
    if (types.some((type) => ["live music", "live-music", "concert", "gig", "comedy", "theatre", "theater"].includes(type)) && hour >= 18 && hour < 23) { total += 4; reasons.push("evening show"); }
    if (types.some((type) => ["talk", "meetup", "food", "art", "museum", "workshop"].includes(type)) && hour >= 9 && hour < 21) { total += 2; }
  }
  if (event.ticket_url) total += 1;
  if (/\b(guided tour|walking tour|sightseeing|cruise|hop-on)\b/i.test(String(event.title || ""))) { total -= 8; reasons.push("tour, not a night out"); }
  return { ...event, recommendation_score: Math.round(total * 10) / 10, recommendation_reasons: [...new Set(reasons)] };
}

function localHour(startTime, timezone) {
  if (!startTime) return null;
  const date = new Date(startTime);
  if (Number.isNaN(date.getTime())) return null;
  return zonedParts(date, timezone || "UTC").hour;
}

function matchesSection(section, event) {
  if (!section.types) return true;
  const types = (event.event_types || []).map((type) => String(type).toLowerCase());
  return section.types.some((type) => types.includes(type));
}

function toRankedSummary(event, options, compact) {
  const summary = summarizeEvent(event, options);
  if (compact) {
    return {
      id: summary.id,
      title: summary.title,
      when: summary.when,
      venue: summary.venue,
      price: summary.price,
      event_url: summary.event_url,
      recommendation_reasons: event.recommendation_reasons
    };
  }
  return {
    ...summary,
    recommendation_score: event.recommendation_score,
    recommendation_reasons: event.recommendation_reasons
  };
}

function boundedLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}
