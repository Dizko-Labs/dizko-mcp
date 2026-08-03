import { searchEvents } from "./api.js";
import { getConfig } from "./config.js";
import { isoDate, weekdayName } from "./dateRange.js";
import { summarizeEvent } from "./format.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Aggregate cultural-momentum read over the public event inventory:
// busiest nights, top venues, genre mix, and headline events for the
// next N days, every stat carrying its evidence counts. Public data
// only - no user behavior feeds this.
export async function cityPulse(input = {}, options = {}) {
  const config = options.config || getConfig(options.env);
  const days = boundedLimit(input.days, 7, 14);
  const dateFrom = input.date_from || isoDate(options.now || new Date());
  const dateTo = isoDate(new Date(Date.parse(`${dateFrom}T00:00:00Z`) + (days - 1) * ONE_DAY_MS));
  // The API caps limit at 200; unauthenticated default ordering is
  // attendance DESC, so this sample is the highest-signal slice.
  const response = await searchEvents({
    city: input.city,
    event_types: input.event_types,
    date_from: dateFrom,
    date_to: dateTo,
    limit: 200
  }, { ...options, config });

  const events = response.events || [];
  const totalAvailable = response.count ?? events.length;
  const summaryOptions = { ...options, webBaseUrl: config.webBaseUrl };

  const nights = new Map();
  const venues = new Map();
  const genres = new Map();
  let freeCount = 0;
  for (const event of events) {
    const date = String(event.start_time || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      nights.set(date, (nights.get(date) || 0) + 1);
    }
    if (event.venue_name) {
      const entry = venues.get(event.venue_name) || { venue: event.venue_name, events: 0, total_attendance: 0 };
      entry.events += 1;
      entry.total_attendance += Number(event.attendance_count || 0);
      venues.set(event.venue_name, entry);
    }
    for (const genre of event.genres || []) {
      genres.set(genre, (genres.get(genre) || 0) + 1);
    }
    if (event.price_min === 0) freeCount += 1;
  }

  const headliners = [...events]
    .filter((event) => Number(event.attendance_count || 0) > 0)
    .sort((a, b) => Number(b.attendance_count || 0) - Number(a.attendance_count || 0))
    .slice(0, 6)
    .map((event) => summarizeEvent(event, summaryOptions));

  return {
    city: input.city || null,
    date_from: dateFrom,
    date_to: dateTo,
    days,
    total_available: totalAvailable,
    sample_size: events.length,
    sample_note: events.length < totalAvailable
      ? `Aggregates cover the ${events.length} highest-attendance events; total_available reflects the full inventory.`
      : "Aggregates cover the full inventory for this window.",
    busiest_nights: [...nights.entries()]
      .map(([date, count]) => ({ date, weekday: weekdayName(date), events: count }))
      .sort((a, b) => b.events - a.events || a.date.localeCompare(b.date))
      .slice(0, days),
    top_venues: [...venues.values()]
      .sort((a, b) => b.events - a.events || b.total_attendance - a.total_attendance)
      .slice(0, 8),
    top_genres: [...genres.entries()]
      .map(([genre, count]) => ({ genre, events: count }))
      .sort((a, b) => b.events - a.events)
      .slice(0, 10),
    headliners,
    free_events_in_sample: freeCount
  };
}

function boundedLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}
