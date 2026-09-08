import { DEFAULT_MCP_URL, DEFAULT_WEB_BASE_URL } from "./config.js";
import { cityDisplayName, cityTimezone } from "./cities.js";
import { zonedParts } from "./dateRange.js";

export function eventUrl(event, webBaseUrl = DEFAULT_WEB_BASE_URL) {
  return `${webBaseUrl.replace(/\/+$/, "")}/events/${encodeURIComponent(event.id)}`;
}

// Base for the short /e/<id>/cal|map|ics redirect links served by the
// hosted HTTP MCP service. Short links keep tool payloads small.
export function shortLinkBase(options = {}) {
  const env = options.env || process.env;
  const mcpUrl = options.linkBaseUrl
    || env.DIZKO_MCP_URL
    || env.EVENTCHAT_MCP_URL
    || env.UPLAYGROUND_MCP_URL
    || DEFAULT_MCP_URL;
  return mcpUrl.replace(/\/mcp\/?$/, "").replace(/\/+$/, "");
}

// Optional extras a caller can ask for on list results. Detail lookups
// (get_event) include all of them.
export const EVENT_FIELD_OPTIONS = ["description", "images", "coordinates", "socials", "promoters", "source"];

const LINEUP_CAP = 8;
const SET_TIMES_CAP = 10;
const SHORT_DESCRIPTION = 160;
const DETAIL_DESCRIPTION = 600;

// Event summary sent to the model. Compact by default: local times, venue,
// address, price, tags, a capped lineup, set times, and links. Everything
// the render template never uses (images, coordinates, source, promoter
// objects) is opt-in through `fields` or `detail: true`.
export function summarizeEvent(event, options = {}) {
  const webBaseUrl = options.webBaseUrl || DEFAULT_WEB_BASE_URL;
  const detail = Boolean(options.detail);
  const fields = new Set(detail ? EVENT_FIELD_OPTIONS : normalizeFields(options.fields));
  const timezone = eventTimezone(event);
  const local = localTimes(event, timezone);
  const lineup = Array.isArray(event.lineup) ? event.lineup.filter(Boolean) : [];
  const description = pickDescription(event, { detail, wantDescription: fields.has("description") });

  const summary = {
    id: event.id,
    title: event.title_en && options.preferEnglish ? event.title_en : event.title,
    when: local.when,
    starts_at: event.start_time || null,
    ends_at: event.end_time || null,
    starts_at_local: local.starts_at_local,
    ends_at_local: local.ends_at_local,
    timezone: local.timezone,
    venue: event.venue_name || null,
    address: event.venue_address || null,
    city: cityDisplayName(event.venue_city) || null,
    city_slug: event.venue_city || null,
    price: formatPrice(event),
    currency: fields.has("source") || detail ? event.currency || null : null,
    genres: event.genres || [],
    vibe: event.vibe || [],
    event_types: event.event_types || [],
    lineup: detail ? lineup : lineup.slice(0, LINEUP_CAP),
    lineup_count: lineup.length && (lineup.length > LINEUP_CAP || detail) ? lineup.length : null,
    set_times: setTimesFromBilling(event.billing),
    featured: Boolean(event.ra_pick || event.featured_at) || null,
    price_trend: event.price_trend || null,
    sound_tags: detail ? event.sound_tags || [] : [],
    promoters: fields.has("promoters") ? event.promoters || [] : promoterNames(event.promoters),
    image_url: fields.has("images") ? event.image_url || null : null,
    lat: fields.has("coordinates") ? event.lat ?? null : null,
    lng: fields.has("coordinates") ? event.lng ?? null : null,
    artist_socials: fields.has("socials") ? compactSocials(event.artist_socials) : [],
    attendance_count: event.attendance_count || null,
    source: fields.has("source") ? event.source_display || event.source || null : null,
    description,
    ticket_url: event.ticket_url || null,
    event_url: eventUrl(event, webBaseUrl)
  };
  const targets = eventLinkTargets(event, options);
  const idPath = `${shortLinkBase(options)}/e/${encodeURIComponent(event.id)}`;
  summary.calendar_url = targets.cal ? `${idPath}/cal` : null;
  summary.directions_url = targets.map ? `${idPath}/map` : null;
  return compactSummary(summary);
}

export function normalizeFields(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  return list.map((item) => String(item || "").trim().toLowerCase()).filter((item) => EVENT_FIELD_OPTIONS.includes(item));
}

export function eventTimezone(event) {
  return cityTimezone(event?.venue_city) || (event?.timezone && String(event.timezone)) || null;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Local wall-clock rendering. When the city is unknown the times stay UTC
// and `timezone` says so, so the model can at least label them honestly.
export function localTimes(event, timezone) {
  const zone = timezone || "UTC";
  const start = parseDate(event?.start_time);
  const end = parseDate(event?.end_time);
  const startLocal = start ? zonedIso(start, zone) : null;
  const endLocal = end ? zonedIso(end, zone) : null;
  let when = null;
  if (start) {
    when = formatWhen(start, zone);
    if (end && endLocal.slice(0, 10) !== startLocal.slice(0, 10) && end.getTime() - start.getTime() > 24 * 3600e3) {
      when += ` → ${formatWhen(end, zone, { timeOnly: false })}`;
    }
  }
  return {
    when,
    starts_at_local: startLocal,
    ends_at_local: endLocal,
    timezone: start ? zone : null
  };
}

export function formatWhen(date, timezone = "UTC") {
  const parts = zonedParts(date, timezone);
  return `${WEEKDAY_SHORT[parts.weekday]} ${parts.day} ${MONTH_SHORT[parts.month - 1]}, ${pad(parts.hour)}:${pad(parts.minute)}`;
}

function zonedIso(date, timezone) {
  const parts = zonedParts(date, timezone);
  const offsetMinutes = Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - (date.getTime() - date.getTime() % 60000)) / 60000);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Upstream `billing` is [{ parts: [{ text: "19:00" }, { artist: "Name" }] }].
export function setTimesFromBilling(billing) {
  if (!Array.isArray(billing)) return [];
  const rows = [];
  for (const line of billing) {
    const parts = Array.isArray(line?.parts) ? line.parts : [];
    const time = parts.map((part) => String(part?.text || "").trim()).find((text) => /^\d{1,2}[:.h]\d{2}/.test(text));
    const artists = parts.map((part) => part?.artist).filter(Boolean);
    if (!time || !artists.length) continue;
    for (const artist of artists) rows.push({ artist, at: time.replace(".", ":") });
    if (rows.length >= SET_TIMES_CAP) break;
  }
  return rows.slice(0, SET_TIMES_CAP);
}

function promoterNames(promoters) {
  if (!Array.isArray(promoters)) return [];
  return promoters.map((item) => typeof item === "string" ? item : item?.name).filter(Boolean);
}

function compactSocials(socials) {
  if (!Array.isArray(socials)) return [];
  return socials.slice(0, 12).map((item) => compactObject({
    name: item?.name,
    soundcloud: item?.soundcloud,
    instagram: item?.instagram,
    bandcamp: item?.bandcamp,
    spotify: item?.spotify
  })).filter((item) => item.name);
}

// Upstream descriptions are usually a generated sentence that repeats the
// title, venue, date, lineup and genre - fields the summary already has.
// Those are dropped; a real description is kept, shortened.
export function isBoilerplateDescription(text) {
  const value = String(text || "");
  if (!value) return false;
  const opener = /\b(takes place at|lands at|happens at|is happening at)\b/.test(value.slice(0, 200));
  const filler = /(on the lineup|The listed genres? (is|are)|Entry is free|^Tickets:|\nTickets:)/.test(value);
  return opener && (filler || value.length < 400);
}

function pickDescription(event, { detail, wantDescription }) {
  const raw = typeof event.description === "string" ? event.description : null;
  if (!raw) return null;
  if (isBoilerplateDescription(raw) && !(wantDescription || detail)) return null;
  if (isBoilerplateDescription(raw)) {
    // Keep only sentences that add something beyond the structured fields.
    const extra = raw.split(/(?<=[.!?])\s+/).filter((sentence) => !/(takes place at|lands at|on the lineup|The listed genre|Entry is free|^Tickets:)/.test(sentence)).join(" ").trim();
    return shortDescription(extra, detail ? DETAIL_DESCRIPTION : SHORT_DESCRIPTION);
  }
  return shortDescription(raw, detail ? DETAIL_DESCRIPTION : SHORT_DESCRIPTION);
}

// Full redirect targets for the /e/<id>/cal|map short links.
export function eventLinkTargets(event, options = {}) {
  const webBaseUrl = options.webBaseUrl || DEFAULT_WEB_BASE_URL;
  const fields = {
    title: event.title,
    starts_at: event.start_time || null,
    ends_at: event.end_time || null,
    venue: event.venue_name || null,
    address: event.venue_address || null,
    city: cityDisplayName(event.venue_city) || null,
    event_url: eventUrl(event, webBaseUrl),
    ticket_url: event.ticket_url || null
  };
  return {
    cal: googleCalendarUrl(fields),
    map: directionsUrl(event, fields)
  };
}

// Drops null, empty-array and empty-string fields. id/title/event_url
// always survive.
const ALWAYS_KEEP = new Set(["id", "title", "event_url"]);

function compactSummary(summary) {
  const compact = {};
  for (const [key, value] of Object.entries(summary)) {
    if (!ALWAYS_KEEP.has(key)) {
      if (value === null || value === undefined || value === "") continue;
      if (Array.isArray(value) && value.length === 0) continue;
    }
    compact[key] = value;
  }
  return compact;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ""));
}

export function googleCalendarUrl(summary) {
  const start = toCalendarDate(summary.starts_at);
  if (!start) return null;
  const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;
  const end = toCalendarDate(summary.ends_at) || toCalendarDate(new Date(Date.parse(summary.starts_at) + DEFAULT_DURATION_MS).toISOString());
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: summary.title || "Dizko Event",
    dates: `${start}/${end}`
  });
  const location = [summary.venue, summary.address || summary.city].filter(Boolean).join(", ");
  if (location) params.set("location", location);
  const details = [
    summary.event_url ? `Event: ${summary.event_url}` : null,
    summary.ticket_url ? `Tickets: ${summary.ticket_url}` : null
  ].filter(Boolean).join("\n");
  if (details) params.set("details", details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

const UNMAPPABLE_VENUES = new Set(["tba", "tbd", "secret location", "various locations", "undisclosed location", "multiple locations", "online"]);

export function directionsUrl(event, summary = {}) {
  let destination = null;
  if (event.lat != null && event.lng != null) {
    destination = `${event.lat},${event.lng}`;
  } else {
    const venue = summary.venue ?? event.venue_name ?? null;
    const address = summary.address ?? event.venue_address ?? null;
    const city = summary.city ?? cityDisplayName(event.venue_city) ?? null;
    if (venue && !UNMAPPABLE_VENUES.has(venue.trim().toLowerCase())) {
      destination = [venue, address || city].filter(Boolean).join(", ");
    }
  }
  if (!destination) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export function shortDescription(value, maxLength = SHORT_DESCRIPTION) {
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

const CURRENCY_SYMBOLS = { EUR: "€", USD: "$", GBP: "£", JPY: "¥", BRL: "R$", MXN: "MX$", CAD: "CA$", AUD: "A$", KRW: "₩", TRY: "₺", NGN: "₦", THB: "฿", SGD: "S$", HKD: "HK$", AED: "AED ", COP: "COP ", ARS: "ARS ", CZK: "CZK ", HUF: "HUF ", PLN: "PLN ", SEK: "SEK ", DKK: "DKK ", CHF: "CHF " };

export function formatPrice(event) {
  const code = String(event.currency || "").toUpperCase();
  const symbol = code ? (CURRENCY_SYMBOLS[code] ?? `${code} `) : "";
  const min = event.price_min;
  const max = event.price_max;
  if (min == null && max == null) return null;
  const money = (value) => `${symbol}${Number.isInteger(value) ? value : Number(value).toFixed(2)}`;
  if ((min === 0 || min == null) && (max == null || max === 0)) return "free";
  if (min != null && max != null && min !== max) {
    return min === 0 ? `free-${money(max)}` : `${money(min)}-${money(max)}`;
  }
  return money(min ?? max);
}

export function formatEventList(events, options = {}) {
  if (!events.length) return "No matching events found.";
  return events.map((event, index) => {
    const summary = summarizeEvent(event, options);
    const parts = [
      `${index + 1}. ${summary.title}`,
      summary.when ? `   When: ${summary.when}${summary.timezone ? ` (${summary.timezone})` : ""}` : null,
      summary.venue ? `   Where: ${summary.venue}${summary.address ? `, ${summary.address}` : summary.city ? `, ${summary.city}` : ""}` : null,
      summary.price ? `   Price: ${summary.price}` : null,
      summary.lineup?.length ? `   Lineup: ${summary.lineup.join(", ")}${summary.lineup_count > summary.lineup.length ? ` +${summary.lineup_count - summary.lineup.length} more` : ""}` : null,
      summary.set_times?.length ? `   Set times: ${summary.set_times.map((row) => `${row.at} ${row.artist}`).join(", ")}` : null,
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

function pad(value) {
  return String(value).padStart(2, "0");
}
