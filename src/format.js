import { DEFAULT_WEB_BASE_URL } from "./config.js";

export function eventUrl(event, webBaseUrl = DEFAULT_WEB_BASE_URL) {
  return `${webBaseUrl.replace(/\/+$/, "")}/events/${encodeURIComponent(event.id)}`;
}

export function summarizeEvent(event, options = {}) {
  const webBaseUrl = options.webBaseUrl || DEFAULT_WEB_BASE_URL;
  return {
    id: event.id,
    title: event.title,
    starts_at: event.start_time || null,
    ends_at: event.end_time || null,
    venue: event.venue_name || null,
    city: event.venue_city || null,
    price: formatPrice(event),
    genres: event.genres || [],
    vibe: event.vibe || [],
    event_types: event.event_types || [],
    lineup: event.lineup || [],
    attendance_count: event.attendance_count || null,
    source: event.source_display || event.source || null,
    ticket_url: event.ticket_url || null,
    event_url: eventUrl(event, webBaseUrl)
  };
}

export function formatPrice(event) {
  const currency = event.currency || "";
  if (event.price_min == null && event.price_max == null) return null;
  if (event.price_min === 0 && (event.price_max == null || event.price_max === 0)) return "free";
  if (event.price_min != null && event.price_max != null && event.price_min !== event.price_max) {
    return `${currency}${event.price_min}-${currency}${event.price_max}`;
  }
  return `${currency}${event.price_min ?? event.price_max}`;
}

export function formatEventList(events, options = {}) {
  if (!events.length) return "No matching events found.";
  return events.map((event, index) => {
    const summary = summarizeEvent(event, options);
    const parts = [
      `${index + 1}. ${summary.title}`,
      summary.starts_at ? `   When: ${summary.starts_at}` : null,
      summary.venue ? `   Where: ${summary.venue}${summary.city ? `, ${summary.city}` : ""}` : null,
      summary.price ? `   Price: ${summary.price}` : null,
      summary.lineup.length ? `   Lineup: ${summary.lineup.slice(0, 6).join(", ")}` : null,
      summary.genres.length || summary.vibe.length ? `   Tags: ${[...summary.genres, ...summary.vibe].slice(0, 8).join(", ")}` : null,
      summary.ticket_url ? `   Tickets: ${summary.ticket_url}` : null,
      `   Event: ${summary.event_url}`
    ].filter(Boolean);
    return parts.join("\n");
  }).join("\n\n");
}
