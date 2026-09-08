import { summarizeEvent } from "./format.js";

const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;
const FOLD_OCTETS = 75;

export function buildCalendarEvent(event, options = {}) {
  const summary = options.alreadySummarized ? event : summarizeEvent(event, { ...options, detail: true });
  const uid = `dizko-${summary.id}@dizko.app`;
  const descriptionLines = [
    summary.when ? `When: ${summary.when}${summary.timezone ? ` (${summary.timezone})` : ""}` : null,
    summary.lineup?.length ? `Lineup: ${summary.lineup.join(", ")}` : null,
    summary.set_times?.length ? `Set times: ${summary.set_times.map((row) => `${row.at} ${row.artist}`).join(", ")}` : null,
    summary.event_url ? `Event: ${summary.event_url}` : null,
    summary.ticket_url ? `Tickets: ${summary.ticket_url}` : null,
    options.order_id ? `Order: ${options.order_id}` : null,
    options.receipt_url ? `Receipt: ${options.receipt_url}` : null
  ].filter(Boolean);
  const location = [summary.venue, summary.address || summary.city].filter(Boolean).join(", ");
  const endsAt = summary.ends_at || (summary.starts_at ? new Date(Date.parse(summary.starts_at) + DEFAULT_DURATION_MS).toISOString() : null);

  return {
    uid,
    title: summary.title,
    starts_at: summary.starts_at,
    ends_at: endsAt,
    starts_at_local: summary.starts_at_local || null,
    timezone: summary.timezone || null,
    venue: summary.venue,
    address: summary.address || null,
    city: summary.city,
    event_url: summary.event_url,
    ticket_url: summary.ticket_url,
    status: options.status || "CONFIRMED",
    ics_filename: sanitizeFilename(`${summary.title || "event"}.ics`),
    ics_content: buildIcs({
      uid,
      title: summary.title,
      starts_at: summary.starts_at,
      ends_at: endsAt,
      location,
      description: descriptionLines.join("\n"),
      url: summary.event_url,
      status: options.status || "CONFIRMED",
      now: options.now
    })
  };
}

export function buildIcs({ uid, title, starts_at, ends_at, location, description, url, status, now }) {
  const start = toIcsDate(starts_at);
  const end = toIcsDate(ends_at) || start;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dizko//Dizko Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${toIcsDate((now || new Date()).toISOString())}`,
    start ? `DTSTART:${start}` : null,
    end ? `DTEND:${end}` : null,
    `SUMMARY:${escapeIcs(title || "Dizko Event")}`,
    location ? `LOCATION:${escapeIcs(location)}` : null,
    description ? `DESCRIPTION:${escapeIcs(description)}` : null,
    url ? `URL:${escapeIcs(url)}` : null,
    `STATUS:${escapeIcs(status || "CONFIRMED")}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean);
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

// RFC 5545 section 3.1: content lines are folded at 75 octets; continuation
// lines begin with a single space. Folding happens on character boundaries
// so multi-byte characters are never split.
export function foldLine(line) {
  const out = [];
  let current = "";
  let currentBytes = 0;
  let limit = FOLD_OCTETS;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, "utf8");
    if (currentBytes + bytes > limit) {
      out.push(current);
      current = " ";
      currentBytes = 1;
      limit = FOLD_OCTETS;
    }
    current += char;
    currentBytes += bytes;
  }
  out.push(current);
  return out.join("\r\n");
}

function toIcsDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\;");
}

function sanitizeFilename(value) {
  return String(value || "event.ics")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+\.ics$/, ".ics")
    .slice(0, 120) || "event.ics";
}
