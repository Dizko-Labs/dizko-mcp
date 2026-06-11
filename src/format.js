import { DEFAULT_MCP_URL, DEFAULT_WEB_BASE_URL } from "./config.js";

export function eventUrl(event, webBaseUrl = DEFAULT_WEB_BASE_URL) {
  return `${webBaseUrl.replace(/\/+$/, "")}/events/${encodeURIComponent(event.id)}`;
}

// Base for the short /e/<id>/cal|map|ics redirect links served by the
// hosted HTTP MCP service. Short links keep tool payloads small — a full
// Google Calendar URL is ~370 bytes per event.
export function shortLinkBase(options = {}) {
  const mcpUrl = options.linkBaseUrl
    || (options.env || process.env).EVENTCHAT_MCP_URL
    || (options.env || process.env).UPLAYGROUND_MCP_URL
    || DEFAULT_MCP_URL;
  return mcpUrl.replace(/\/mcp\/?$/, "").replace(/\/+$/, "");
}

export function summarizeEvent(event, options = {}) {
  const webBaseUrl = options.webBaseUrl || DEFAULT_WEB_BASE_URL;
  const summary = {
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
    description: shortDescription(event.description),
    ticket_url: event.ticket_url || null,
    event_url: eventUrl(event, webBaseUrl)
  };
  // Emit short redirect links only when the underlying full link exists,
  // so "calendar_url present" still means "this event has a start time".
  const targets = eventLinkTargets(event, options);
  const idPath = `${shortLinkBase(options)}/e/${encodeURIComponent(event.id)}`;
  summary.calendar_url = targets.cal ? `${idPath}/cal` : null;
  summary.directions_url = targets.map ? `${idPath}/map` : null;
  return compactSummary(summary);
}

// Full redirect targets for the /e/<id>/cal|map short links served by the
// HTTP MCP service.
export function eventLinkTargets(event, options = {}) {
  const webBaseUrl = options.webBaseUrl || DEFAULT_WEB_BASE_URL;
  const fields = {
    title: event.title,
    starts_at: event.start_time || null,
    ends_at: event.end_time || null,
    venue: event.venue_name || null,
    city: event.venue_city || null,
    event_url: eventUrl(event, webBaseUrl),
    ticket_url: event.ticket_url || null
  };
  return {
    cal: googleCalendarUrl(fields),
    map: directionsUrl(event, fields)
  };
}

// Drops null and empty-array fields so 25-event payloads don't ship
// hundreds of useless tokens. id/title/event_url always survive.
const ALWAYS_KEEP = new Set(["id", "title", "event_url"]);

function compactSummary(summary) {
  const compact = {};
  for (const [key, value] of Object.entries(summary)) {
    if (!ALWAYS_KEEP.has(key)) {
      if (value === null || value === undefined) continue;
      if (Array.isArray(value) && value.length === 0) continue;
    }
    compact[key] = value;
  }
  return compact;
}

// Clickable "Add to calendar" link — opens a prefilled Google Calendar
// event in the browser, no .ics download needed. The MCP tool
// create_event_calendar_file still produces a real .ics for imports.
export function googleCalendarUrl(summary) {
  const start = toCalendarDate(summary.starts_at);
  if (!start) return null;
  const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000; // typical club night when no end time
  const end = toCalendarDate(summary.ends_at) || toCalendarDate(new Date(Date.parse(summary.starts_at) + DEFAULT_DURATION_MS).toISOString());
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: summary.title || "UPlayground Event",
    dates: `${start}/${end}`
  });
  const location = [summary.venue, summary.city].filter(Boolean).join(", ");
  if (location) params.set("location", location);
  const details = [
    summary.event_url ? `Event: ${summary.event_url}` : null,
    summary.ticket_url ? `Tickets: ${summary.ticket_url}` : null
  ].filter(Boolean).join("\n");
  if (details) params.set("details", details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Venue placeholders that can't be navigated to — no directions link.
const UNMAPPABLE_VENUES = new Set(["tba", "tbd", "secret location", "various locations", "undisclosed location"]);

// Clickable "Get directions" link. Prefers exact coordinates when the
// event has them; falls back to a venue + city text query.
export function directionsUrl(event, summary = {}) {
  let destination = null;
  if (event.lat != null && event.lng != null) {
    destination = `${event.lat},${event.lng}`;
  } else {
    const venue = summary.venue ?? event.venue_name ?? null;
    const city = summary.city ?? event.venue_city ?? null;
    if (venue && !UNMAPPABLE_VENUES.has(venue.trim().toLowerCase())) {
      destination = [venue, city].filter(Boolean).join(", ");
    }
  }
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

// One-line description for chat rendering — keeps tool payloads small
// while giving the assistant something better than a tag soup.
function shortDescription(value, maxLength = 200) {
  if (!value || typeof value !== "string") return null;
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).replace(/\s+\S*$/, "")}…`;
}

function toCalendarDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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
      summary.lineup?.length ? `   Lineup: ${summary.lineup.slice(0, 6).join(", ")}` : null,
      summary.genres?.length || summary.vibe?.length ? `   Tags: ${[...(summary.genres || []), ...(summary.vibe || [])].slice(0, 8).join(", ")}` : null,
      summary.description ? `   About: ${summary.description}` : null,
      summary.ticket_url ? `   Tickets: ${summary.ticket_url}` : null,
      `   Event: ${summary.event_url}`,
      summary.directions_url ? `   Directions: ${summary.directions_url}` : null,
      summary.calendar_url ? `   Add to calendar: ${summary.calendar_url}` : null
    ].filter(Boolean);
    return parts.join("\n");
  }).join("\n\n");
}
