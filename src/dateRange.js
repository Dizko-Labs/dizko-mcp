import { ToolInputError } from "./errors.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_SHORT = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };

export const WHEN_PRESETS = [
  "today", "tonight", "tomorrow", "weekend", "next weekend", "week", "next week", "month",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "any", "YYYY-MM-DD"
];

// YYYY-MM-DD for `date` as seen in `timezone` (IANA name). Defaults to UTC,
// never the server's local clock: a hosted server in UTC must not decide
// what "tonight" means for someone in Los Angeles.
export function isoDate(date, timezone = "UTC") {
  const parts = zonedParts(date, timezone);
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function zonedParts(date, timezone = "UTC") {
  const formatter = getFormatter(timezone);
  const map = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const weekday = WEEKDAY_NAMES.indexOf(String(map.weekday || "").toLowerCase());
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour === "24" ? 0 : map.hour),
    minute: Number(map.minute),
    weekday: weekday >= 0 ? weekday : new Date(date).getUTCDay()
  };
}

const formatters = new Map();
function getFormatter(timezone) {
  const key = timezone || "UTC";
  if (!formatters.has(key)) {
    try {
      formatters.set(key, new Intl.DateTimeFormat("en-US", {
        timeZone: key, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hour12: false, weekday: "long"
      }));
    } catch {
      formatters.set(key, getFormatter("UTC"));
    }
  }
  return formatters.get(key);
}

export function isValidTimezone(timezone) {
  if (!timezone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function weekdayName(isoDateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDateString || "")) return null;
  const date = new Date(`${isoDateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return WEEKDAY_NAMES[date.getUTCDay()];
}

// The single YYYY-MM-DD day a request targets, or null for multi-day or
// open-ended ranges. Used to pick which day_filters entry applies.
export function resolveSingleDay(input = {}, now = new Date(), timezone = "UTC") {
  if (input.date_from && input.date_to) {
    return input.date_from === input.date_to && /^\d{4}-\d{2}-\d{2}$/.test(input.date_from)
      ? input.date_from
      : null;
  }
  if (input.date_from || input.date_to) return null;
  try {
    const range = resolveDateRange(input.when, now, timezone);
    if (range.date_from && range.date_from === range.date_to) return range.date_from;
  } catch {
    return null;
  }
  return null;
}

export function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function assertIsoDate(value, field) {
  if (value === undefined || value === null || value === "") return;
  if (!isIsoDate(value)) {
    throw new ToolInputError(`${field} must be a calendar date in YYYY-MM-DD format.`, {
      field,
      hint: `Received ${JSON.stringify(value)}. Example: 2026-09-12.`
    });
  }
}

// Resolves a preset to an inclusive date range in the given timezone. Throws
// ToolInputError (field "when") for anything it does not understand so the
// model sees the accepted presets instead of a generic failure.
// Whether `when` is a value this grammar accepts. The grammar is closed - an
// unmatched value throws - so asking it directly is both safer and more
// complete than restating its vocabulary somewhere else, where the copy goes
// stale the moment a preset is added.
export function isSupportedWhen(value) {
  if (value === undefined || value === null || String(value).trim() === "") return false;
  try {
    resolveDateRange(value, new Date(), "UTC");
    return true;
  } catch {
    return false;
  }
}

export function resolveDateRange(preset, now = new Date(), timezone = "UTC") {
  const raw = String(preset ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    assertIsoDate(raw, "when");
    return { date_from: raw, date_to: raw };
  }
  const text = raw.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const todayParts = zonedParts(now, timezone);
  const today = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
  const day = todayParts.weekday;
  const addDays = (base, days) => new Date(base.getTime() + days * ONE_DAY_MS);
  const range = (from, to) => ({ date_from: isoDate(from), date_to: isoDate(to) });
  const weekendStart = () => (day === 0 || day === 6) ? today : addDays(today, (5 - day + 7) % 7);
  const weekendEnd = (friday) => (day === 0 ? today : addDays(friday, day === 6 ? 1 : 2));

  switch (text) {
    case "":
    case "any":
    case "anytime":
    case "upcoming":
      return {};
    case "today":
    case "tonight":
    case "this evening":
    case "now":
      return range(today, today);
    case "tomorrow":
    case "tomorrow night":
      return range(addDays(today, 1), addDays(today, 1));
    case "weekend":
    case "this weekend":
    case "the weekend": {
      const friday = weekendStart();
      return range(friday, weekendEnd(friday));
    }
    case "next weekend": {
      // weekendStart() returns TODAY on a Saturday or Sunday (the weekend is
      // already running), so it cannot anchor "next". Derive this calendar
      // week's Friday instead - behind us on Sat/Sun, ahead on Mon-Fri - and
      // add seven days, so the answer is always a Friday-to-Sunday block.
      const thisWeekFriday = addDays(today, day === 0 ? -2 : 5 - day);
      const friday = addDays(thisWeekFriday, 7);
      return range(friday, addDays(friday, 2));
    }
    case "week":
    case "this week":
    case "next 7 days":
    case "7 days":
      return range(today, addDays(today, 6));
    case "next week": {
      const monday = addDays(today, ((8 - day) % 7) || 7);
      return range(monday, addDays(monday, 6));
    }
    case "month":
    case "this month": {
      const end = new Date(Date.UTC(todayParts.year, todayParts.month, 0));
      return range(today, end);
    }
    default: {
      const weekday = parseWeekday(text);
      if (weekday) {
        let offset = (weekday.index - day + 7) % 7;
        if (weekday.next && offset === 0) offset = 7;
        if (weekday.next && offset > 0 && offset < 7 && weekday.strictNext) offset += 7;
        const target = addDays(today, offset);
        return range(target, target);
      }
      throw new ToolInputError(`Unsupported "when" value: ${JSON.stringify(preset)}.`, {
        field: "when",
        allowed: WHEN_PRESETS,
        hint: "Use a preset like tonight, weekend, next weekend, week, a weekday name, or an exact YYYY-MM-DD date. For a custom range pass date_from and date_to."
      });
    }
  }
}

// "friday", "fri", "this friday", "next friday", "friday night".
function parseWeekday(text) {
  const match = text.match(/^(?:(this|next|coming|on)\s+)?([a-z]+)(?:\s+(night|evening|day))?$/);
  if (!match) return null;
  const [, qualifier, name] = match;
  let index = WEEKDAY_NAMES.indexOf(name);
  if (index < 0 && name in WEEKDAY_SHORT) index = WEEKDAY_SHORT[name];
  if (index < 0) return null;
  // "next friday" said on a Monday usually means this coming Friday in
  // casual speech, but said on a Thursday means eight days out. We keep the
  // simplest defensible rule: "next" skips today, otherwise nearest.
  return { index, next: qualifier === "next", strictNext: false };
}

function pad(value) {
  return String(value).padStart(2, "0");
}
