const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function weekdayName(isoDateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDateString || "")) return null;
  const date = new Date(`${isoDateString}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return WEEKDAY_NAMES[date.getUTCDay()];
}

// The single YYYY-MM-DD day a request targets (today/tonight/tomorrow, an
// explicit date, or date_from === date_to); null for multi-day or
// open-ended ranges. Used to pick which day_filters entry applies.
export function resolveSingleDay(input = {}, now = new Date()) {
  if (input.date_from && input.date_to) {
    return input.date_from === input.date_to && /^\d{4}-\d{2}-\d{2}$/.test(input.date_from)
      ? input.date_from
      : null;
  }
  if (input.date_from || input.date_to) return null;
  try {
    const range = resolveDateRange(input.when, now);
    if (range.date_from && range.date_from === range.date_to) return range.date_from;
  } catch {
    return null;
  }
  return null;
}

export function resolveDateRange(preset, now = new Date()) {
  const local = new Date(now);
  const today = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));

  switch ((preset || "").toLowerCase().trim()) {
    case "":
    case "any":
      return {};
    case "today":
    case "tonight":
    case "this evening":
      return { date_from: isoDate(today), date_to: isoDate(today) };
    case "tomorrow": {
      const tomorrow = new Date(today.getTime() + ONE_DAY_MS);
      return { date_from: isoDate(tomorrow), date_to: isoDate(tomorrow) };
    }
    case "weekend":
    case "this weekend":
    case "this-weekend": {
      const day = today.getUTCDay();
      const fridayOffset = (5 - day + 7) % 7;
      const friday = new Date(today.getTime() + fridayOffset * ONE_DAY_MS);
      const sunday = new Date(friday.getTime() + 2 * ONE_DAY_MS);
      return { date_from: isoDate(friday), date_to: isoDate(sunday) };
    }
    case "week":
    case "this week":
    case "this-week": {
      const end = new Date(today.getTime() + 6 * ONE_DAY_MS);
      return { date_from: isoDate(today), date_to: isoDate(end) };
    }
    default:
      if (/^\d{4}-\d{2}-\d{2}$/.test(preset)) {
        return { date_from: preset, date_to: preset };
      }
      throw new Error(`Unsupported date preset: ${preset}`);
  }
}
