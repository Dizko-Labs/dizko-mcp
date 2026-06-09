import { getConfig } from "./config.js";
import { searchEvents } from "./api.js";
import { summarizeEvent } from "./format.js";
import { rankEvents } from "./rank.js";

export async function recommendEvents(input = {}, options = {}) {
  const config = options.config || getConfig(options.env);
  const response = await searchEvents({ ...input, limit: input.limit ?? 50 }, { ...options, config });
  const ranked = rankEvents(response.events || [], input.preferences || input, options.now);
  const limit = input.result_limit ?? input.limit ?? 10;
  return {
    count: ranked.length,
    events: ranked.slice(0, limit).map((event) => ({
      ...summarizeEvent(event, { webBaseUrl: config.webBaseUrl }),
      recommendation_score: event.recommendation_score,
      recommendation_reasons: event.recommendation_reasons
    }))
  };
}

export async function planNight(input = {}, options = {}) {
  const config = options.config || getConfig(options.env);
  const response = await searchEvents({ ...input, limit: input.limit ?? 75 }, { ...options, config });
  const ranked = rankEvents(response.events || [], input.preferences || input, options.now);
  const plan = buildPlan(ranked, input);

  return {
    city: input.city || null,
    when: input.when || input.date_from || null,
    strategy: "Start with the earliest strong fit, keep a nearby or later fallback, and include a ticket/source link for verification.",
    events: plan.map((event) => ({
      ...summarizeEvent(event, { webBaseUrl: config.webBaseUrl }),
      recommendation_score: event.recommendation_score,
      recommendation_reasons: event.recommendation_reasons
    }))
  };
}

function buildPlan(events, input) {
  const max = input.result_limit ?? 4;
  const withDates = events
    .filter((event) => event.start_time)
    .sort((a, b) => Date.parse(a.start_time) - Date.parse(b.start_time));

  const selected = [];
  for (const event of withDates) {
    if (selected.length >= max) break;
    if (!selected.some((chosen) => chosen.id === event.id)) selected.push(event);
  }

  for (const event of events) {
    if (selected.length >= max) break;
    if (!selected.some((chosen) => chosen.id === event.id)) selected.push(event);
  }

  return selected;
}
