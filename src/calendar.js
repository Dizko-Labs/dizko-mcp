import { summarizeEvent } from "./format.js";

export function buildCalendarEvent(event, options = {}) {
  const summary = options.alreadySummarized ? event : summarizeEvent(event, options);
  const uid = `uplayground-${summary.id}@urbanplayground.xyz`;
  const description = [
    summary.event_url ? `Event: ${summary.event_url}` : null,
    summary.ticket_url ? `Tickets: ${summary.ticket_url}` : null,
    options.order_id ? `Order: ${options.order_id}` : null,
    options.receipt_url ? `Receipt: ${options.receipt_url}` : null
  ].filter(Boolean).join("\\n");

  return {
    uid,
    title: summary.title,
    starts_at: summary.starts_at,
    ends_at: summary.ends_at,
    venue: summary.venue,
    city: summary.city,
    event_url: summary.event_url,
    ticket_url: summary.ticket_url,
    status: options.status || "CONFIRMED",
    ics_filename: sanitizeFilename(`${summary.title || "event"}.ics`),
    ics_content: buildIcs({
      uid,
      title: summary.title,
      starts_at: summary.starts_at,
      ends_at: summary.ends_at,
      location: [summary.venue, summary.city].filter(Boolean).join(", "),
      description,
      url: summary.event_url,
      status: options.status || "CONFIRMED"
    })
  };
}

export function buildIcs({ uid, title, starts_at, ends_at, location, description, url, status }) {
  const start = toIcsDate(starts_at);
  const end = toIcsDate(ends_at) || start;
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Dizko//Dizko Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${toIcsDate(new Date().toISOString())}`,
    start ? `DTSTART:${start}` : null,
    end ? `DTEND:${end}` : null,
    `SUMMARY:${escapeIcs(title || "Dizko Event")}`,
    location ? `LOCATION:${escapeIcs(location)}` : null,
    description ? `DESCRIPTION:${escapeIcs(description)}` : null,
    url ? `URL:${escapeIcs(url)}` : null,
    `STATUS:${escapeIcs(status || "CONFIRMED")}`,
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter(Boolean).join("\r\n") + "\r\n";
}

function toIcsDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function sanitizeFilename(value) {
  return String(value || "event.ics")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "event.ics";
}
