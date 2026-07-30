import { searchEvents } from "./api.js";
import { getConfig } from "./config.js";
import { isoDate, resolveDateRange, weekdayName } from "./dateRange.js";
import { summarizeEvent } from "./format.js";
import { rankEvents } from "./rank.js";

// Display grouping over the canonical event_types vocabulary
// (backend/pipeline/event_types.py). Order is presentation order; "more"
// catches typed-but-unmapped and untyped events.
const SECTION_ORDER = [
  { key: "parties", title: "Parties & club nights", types: ["party"] },
  { key: "live_music", title: "Live music", types: ["live music", "live-music", "concert"] },
  { key: "art_and_museums", title: "Art & museums", types: ["art", "museum"] },
  { key: "comedy_and_theatre", title: "Comedy & theatre", types: ["comedy", "theatre"] },
  { key: "talks_and_meetups", title: "Talks & meetups", types: ["talk", "meetup"] },
  { key: "food_and_drink", title: "Food & drink", types: ["food"] },
  { key: "more", title: "More that day", types: null }
];

export function resolveRoundupDay(input = {}, now = new Date()) {
  if (typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date.trim())) {
    return input.date.trim();
  }
  const range = resolveDateRange(input.when || "today", now);
  return range.date_from || isoDate(now);
}

// One-day digest: fetch a generous page for the target day, rank it with
// whatever preference hints the caller assembled, then slice into top
// picks plus deduped category sections.
export async function dailyRoundup(input = {}, options = {}) {
  const config = options.config || getConfig(options.env);
  const day = resolveRoundupDay(input, options.now);
  const response = await searchEvents({
    ...input,
    when: undefined,
    date: undefined,
    date_from: day,
    date_to: day,
    limit: input.limit ?? 100,
    offset: 0
  }, { ...options, config });

  const ranked = rankEvents(response.events || [], input.preferences || input, options.now);
  const summaryOptions = { ...options, webBaseUrl: config.webBaseUrl };
  const topLimit = boundedLimit(input.top_limit, 5, 10);
  const sectionLimit = boundedLimit(input.section_limit, 5, 10);

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
      events: matches.map((event) => toRankedSummary(event, summaryOptions))
    });
  }

  return {
    city: input.city || null,
    date: day,
    weekday: weekdayName(day),
    total_available: response.count ?? (response.events || []).length,
    top_picks: topPicks.map((event) => toRankedSummary(event, summaryOptions)),
    sections
  };
}

function matchesSection(section, event) {
  if (!section.types) return true;
  const types = (event.event_types || []).map((type) => String(type).toLowerCase());
  return section.types.some((type) => types.includes(type));
}

function toRankedSummary(event, options) {
  return {
    ...summarizeEvent(event, options),
    recommendation_score: event.recommendation_score,
    recommendation_reasons: event.recommendation_reasons
  };
}

function boundedLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}
