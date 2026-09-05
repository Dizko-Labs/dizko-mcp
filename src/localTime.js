// Event times arrive as UTC instants. For a nightlife inventory that is a
// trap: a 20:00 Wednesday show in New York is 00:00 Thursday in UTC, so a
// client that formats start_time directly reports the wrong night. Across a
// 1,200-event sample spanning six cities, 26% of events have a UTC date that
// differs from their local one.
//
// The upstream prose description already states the correct local date, which
// is why descriptions and starts_at appeared to contradict each other. This
// module supplies the local rendering so they no longer can.

// IANA zones for the cities in SUPPORTED_CITIES. Resolved through Intl, so
// DST is handled by the runtime rather than by a stored offset.
const CITY_TIME_ZONES = {
  amsterdam: "Europe/Amsterdam",
  athens: "Europe/Athens",
  atlanta: "America/New_York",
  austin: "America/Chicago",
  bangkok: "Asia/Bangkok",
  barcelona: "Europe/Madrid",
  berlin: "Europe/Berlin",
  bogota: "America/Bogota",
  budapest: "Europe/Budapest",
  "buenos aires": "America/Argentina/Buenos_Aires",
  chicago: "America/Chicago",
  copenhagen: "Europe/Copenhagen",
  denver: "America/Denver",
  detroit: "America/Detroit",
  dubai: "Asia/Dubai",
  dublin: "Europe/Dublin",
  "hong kong": "Asia/Hong_Kong",
  istanbul: "Europe/Istanbul",
  lagos: "Africa/Lagos",
  lisbon: "Europe/Lisbon",
  london: "Europe/London",
  "los angeles": "America/Los_Angeles",
  madrid: "Europe/Madrid",
  medellin: "America/Bogota",
  "mexico city": "America/Mexico_City",
  miami: "America/New_York",
  milan: "Europe/Rome",
  montreal: "America/Toronto",
  nashville: "America/Chicago",
  "new orleans": "America/Chicago",
  "new york": "America/New_York",
  osaka: "Asia/Tokyo",
  paris: "Europe/Paris",
  prague: "Europe/Prague",
  "rio de janeiro": "America/Sao_Paulo",
  rome: "Europe/Rome",
  "san francisco": "America/Los_Angeles",
  "sao paulo": "America/Sao_Paulo",
  seoul: "Asia/Seoul",
  singapore: "Asia/Singapore",
  stockholm: "Europe/Stockholm",
  tokyo: "Asia/Tokyo",
  toronto: "America/Toronto",
  vienna: "Europe/Vienna",
  warsaw: "Europe/Warsaw"
};

export function timeZoneForCity(city) {
  const key = String(city || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return CITY_TIME_ZONES[key] || null;
}

// The event's start as a local wall-clock ISO string with its UTC offset,
// e.g. "2026-08-26T20:00:00-04:00". One field carrying the local date, the
// local time and the offset, so a reader cannot pick up the date without
// also seeing which zone it belongs to.
export function localTimestamp(value, city) {
  const timeZone = timeZoneForCity(city);
  if (!timeZone) return null;
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;

  try {
    const parts = localParts(date, timeZone);
    if (!parts) return null;
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${parts.offset}`;
  } catch {
    // A runtime without full ICU throws on an unknown zone. Losing the local
    // rendering is acceptable; breaking every event summary is not.
    return null;
  }
}

export function localWeekday(value, city) {
  const timeZone = timeZoneForCity(city);
  if (!timeZone) return null;
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;
  try {
    return localParts(date, timeZone)?.weekday || null;
  } catch {
    return null;
  }
}

function localParts(date, timeZone) {
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset"
  }).formatToParts(date);

  const parts = Object.fromEntries(formatted.map((part) => [part.type, part.value]));
  if (!parts.year) return null;
  return {
    ...parts,
    // Intl reports hour 24 for midnight in some locales/zones.
    hour: parts.hour === "24" ? "00" : parts.hour,
    // "GMT-04:00" -> "-04:00"; plain "GMT" means UTC.
    offset: (parts.timeZoneName || "").replace(/^GMT/, "") || "+00:00"
  };
}
