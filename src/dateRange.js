const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function isoDate(date) {
  return date.toISOString().slice(0, 10);
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
    case "weekend": {
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
