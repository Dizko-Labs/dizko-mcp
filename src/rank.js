const NIGHTLIFE_TYPES = new Set(["party", "club", "rave", "dj", "nightlife"]);
const CROWD_AVOIDANCE_TERMS = new Set(["crowded", "huge crowd", "huge crowds", "packed"]);
const MAINSTREAM_AVOIDANCE_TERMS = new Set(["mainstream", "commercial", "mainstream clubs"]);
const EXPENSIVE_AVOIDANCE_TERMS = new Set(["expensive", "expensive tickets", "overpriced", "pricey"]);

export function rankEvents(events, preferences = {}, now = new Date()) {
  return [...events]
    .map((event) => ({ event, score: scoreEvent(event, preferences, now) }))
    .sort((a, b) => b.score.total - a.score.total || compareStart(a.event, b.event))
    .map(({ event, score }) => ({ ...event, recommendation_score: score.total, recommendation_reasons: score.reasons }));
}

export function scoreEvent(event, preferences = {}, now = new Date()) {
  const reasons = [];
  let total = 0;

  const desiredGenres = normalizeList(preferences.genres);
  const desiredVibes = normalizeList(preferences.vibe);
  const desiredTypes = normalizeList(preferences.event_types || preferences.event_type);
  const desiredVenues = normalizeList(preferences.venues || preferences.venue);
  const desiredArtists = normalizeList(preferences.featuring);
  const disliked = normalizeList(preferences.avoid);
  const eventText = normalizeList([
    event.title,
    event.description,
    event.venue_name,
    ...(event.genres || []),
    ...(event.vibe || []),
    ...(event.event_types || []),
    ...(event.lineup || [])
  ]).join(" ");

  total += addMatches(reasons, "genre match", desiredGenres, event.genres, 18);
  total += addMatches(reasons, "vibe match", desiredVibes, event.vibe, 14);
  total += addMatches(reasons, "event type match", desiredTypes, event.event_types, 12);
  total += addTextMatches(reasons, "venue match", desiredVenues, event.venue_name, 16);
  total += addMatches(reasons, "artist match", desiredArtists, event.lineup, 20);

  const start = event.start_time ? new Date(event.start_time) : null;
  if (start && !Number.isNaN(start.valueOf())) {
    const hoursAway = (start.getTime() - now.getTime()) / (60 * 60 * 1000);
    if (hoursAway >= 0 && hoursAway <= 48) {
      total += 10;
      reasons.push("happens soon");
    } else if (hoursAway > 48 && hoursAway <= 168) {
      total += 5;
      reasons.push("within the next week");
    }
  }

  if (event.attendance_count >= 100) {
    total += Math.min(12, Math.log10(event.attendance_count) * 4);
    reasons.push("strong attendance signal");
  }

  if (event.ra_pick || event.featured_at) {
    total += 8;
    reasons.push("featured pick");
  }

  if (preferences.free === true && event.price_min === 0) {
    total += 12;
    reasons.push("free entry");
  }

  if (preferences.max_price != null && event.price_min != null && event.price_min <= preferences.max_price) {
    total += 7;
    reasons.push("within budget");
  } else if (preferences.max_price != null && event.price_min != null && event.price_min > preferences.max_price) {
    total -= 30;
    reasons.push("over budget");
  }

  if (preferences.nightlife === true && normalizeList(event.event_types).some((type) => NIGHTLIFE_TYPES.has(type))) {
    total += 8;
    reasons.push("nightlife fit");
  }

  for (const term of disliked) {
    if (matchesAvoidance(term, event, eventText, preferences)) {
      total -= 25;
      reasons.push(`penalized: ${term}`);
    }
  }

  return { total: Math.round(total * 10) / 10, reasons };
}

function addTextMatches(reasons, label, desired, actual, points) {
  const text = String(actual || "").trim().toLowerCase();
  const matches = desired.filter((item) => text.includes(item));
  if (!matches.length) return 0;
  reasons.push(`${label}: ${matches.join(", ")}`);
  return matches.length * points;
}

function matchesAvoidance(term, event, eventText, preferences) {
  if (eventText.includes(term)) return true;

  const attendance = Number(event.attendance_count || 0);
  if (CROWD_AVOIDANCE_TERMS.has(term) && attendance >= 350) return true;
  if (MAINSTREAM_AVOIDANCE_TERMS.has(term) && attendance >= 750) return true;

  if (EXPENSIVE_AVOIDANCE_TERMS.has(term) && event.price_min != null) {
    const threshold = preferences.max_price ?? 40;
    return event.price_min > threshold;
  }

  return false;
}

function addMatches(reasons, label, desired, actual, points) {
  const actualSet = new Set(normalizeList(actual));
  const matches = desired.filter((item) => actualSet.has(item));
  if (!matches.length) return 0;
  reasons.push(`${label}: ${matches.join(", ")}`);
  return matches.length * points;
}

function normalizeList(value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .flatMap((item) => String(item || "").split(","))
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function compareStart(a, b) {
  const aTime = a.start_time ? Date.parse(a.start_time) : Number.MAX_SAFE_INTEGER;
  const bTime = b.start_time ? Date.parse(b.start_time) : Number.MAX_SAFE_INTEGER;
  return aTime - bTime;
}
