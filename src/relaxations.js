// When a search comes back empty, the model needs to know WHY and what to
// try next, not an empty list plus a render template. This builds an ordered
// set of concrete retry arguments from the filters the caller actually sent.
//
// Order matters: the filters listed first are the ones most likely to be the
// blocker, not simply the ones that are set.

const LIST_FILTERS = ["genres", "vibe", "event_types", "neighborhoods"];

export function describeFilters(input = {}) {
  const active = [];
  for (const key of LIST_FILTERS) {
    const values = Array.isArray(input[key]) ? input[key].filter(Boolean) : [];
    if (values.length) active.push({ key, values });
  }
  for (const key of ["venue", "featuring", "promoter", "query"]) {
    if (input[key]) active.push({ key, values: [input[key]] });
  }
  if (input.price_max != null) active.push({ key: "price_max", values: [input.price_max] });
  if (input.price_min != null) active.push({ key: "price_min", values: [input.price_min] });
  if (input.free === true) active.push({ key: "free", values: [true] });
  if (input.pride === true) active.push({ key: "pride", values: [true] });
  return active;
}

// Filters the caller can drop, ranked by how often each one is the real
// reason a search is empty rather than by how narrow it looks.
const RELAXATION_ORDER = [
  {
    key: "price_max",
    why: "A price cap also removes every event whose price is not published, which is a large share of listings."
  },
  {
    key: "free",
    why: "Free-only keeps just events explicitly marked free entry; many low-cost or unpriced events are excluded."
  },
  {
    key: "vibe",
    why: "Vibe tags are sparse; most events carry none, so a vibe filter hides them."
  },
  {
    key: "neighborhoods",
    why: "Neighborhood is only set on events whose venue has been geocoded to one."
  },
  {
    key: "venue",
    why: "Venue is matched as text against the listing's venue name, which varies between sources."
  },
  {
    key: "featuring",
    why: "The artist may not be on any listed lineup in this city and timeframe."
  },
  {
    key: "promoter",
    why: "The promoter may have nothing listed in this window."
  },
  {
    key: "genres",
    why: "Genre tags come from the source listing and are often missing."
  },
  {
    key: "event_types",
    why: "The type vocabulary is coarse; the event may be typed differently."
  },
  {
    key: "pride",
    why: "The Pride flag is only set on explicitly tagged events."
  },
  {
    key: "query",
    why: "Free-text search narrows by relevance on top of the other filters."
  }
];

// `baselineCount` is how many events exist for the same city and dates with
// no other filter. It separates "your filters are too tight" from "there is
// nothing on that day", which need different answers.
export function buildNoResults(input = {}, { baselineCount = null, cityName = null, maxSuggestions = 3 } = {}) {
  const active = describeFilters(input);
  const activeKeys = new Set(active.map((item) => item.key));
  const label = cityName || input.city || "this city";
  const timeframe = describeTimeframe(input);

  const suggestions = [];
  for (const candidate of RELAXATION_ORDER) {
    if (suggestions.length >= maxSuggestions) break;
    if (!activeKeys.has(candidate.key)) continue;
    suggestions.push({
      relax: candidate.key,
      why: candidate.why,
      retry_with: withoutKeys(input, [candidate.key])
    });
  }

  // Dropping one filter at a time may not be enough when several are set.
  const droppable = active.map((item) => item.key).filter((key) => key !== "query");
  if (droppable.length > 1 && suggestions.length < maxSuggestions + 1) {
    suggestions.push({
      relax: droppable.join(" + "),
      why: "Several filters are combined; dropping all of them shows everything on in the timeframe.",
      retry_with: withoutKeys(input, droppable)
    });
  }

  if (!active.length || baselineCount === 0) {
    suggestions.push({
      relax: "when",
      why: "Widen the timeframe: a single evening is a small sample, a week is not.",
      retry_with: { ...withoutKeys(input, []), when: "week" }
    });
  }

  return {
    reason: baselineCount === 0
      ? "empty_timeframe"
      : active.length
        ? "filters_too_narrow"
        : "no_inventory",
    baseline_count: baselineCount,
    active_filters: active.map((item) => ({ filter: item.key, values: item.values })),
    suggested_relaxations: suggestions.slice(0, maxSuggestions + 1),
    assistant_instruction: buildInstruction({ baselineCount, active, label, timeframe, suggestions })
  };
}

function buildInstruction({ baselineCount, active, label, timeframe, suggestions }) {
  if (baselineCount === 0) {
    return `Tell the user Dizko has nothing listed in ${label} ${timeframe}. Offer a wider timeframe, and use dizko_list_cities if they may be asking about a city with thin coverage. Do not invent events.`;
  }
  if (!active.length) {
    return `Tell the user nothing came back for ${label} ${timeframe} and offer a wider timeframe. Do not invent events.`;
  }
  const names = active.map((item) => item.filter ?? item.key).join(", ");
  const first = suggestions[0];
  const total = baselineCount == null ? "other events" : `${baselineCount} other event${baselineCount === 1 ? "" : "s"}`;
  return [
    `Do not say Dizko has nothing on. Say that ${total} are listed in ${label} ${timeframe}, but none match these filters: ${names}.`,
    first ? `Offer to drop ${first.relax} first (${first.why}) and call dizko_search_events again with retry_with.` : "",
    "Never invent events to fill the gap."
  ].filter(Boolean).join(" ");
}

function describeTimeframe(input = {}) {
  if (input.when) return `for "${input.when}"`;
  if (input.date_from && input.date_to && input.date_from !== input.date_to) return `between ${input.date_from} and ${input.date_to}`;
  if (input.date_from) return `on ${input.date_from}`;
  return "in the requested window";
}

function withoutKeys(input, keys) {
  const drop = new Set([...keys, "profile_id", "profile_secret", "offset"]);
  return Object.fromEntries(Object.entries(input).filter(([key, value]) => {
    if (drop.has(key)) return false;
    if (value === undefined || value === null || value === "") return false;
    if (Array.isArray(value) && !value.length) return false;
    return true;
  }));
}

// The baseline probe: same city and dates, every optional filter removed.
export function baselineSearchInput(input = {}) {
  return {
    city: input.city,
    when: input.when,
    date_from: input.date_from,
    date_to: input.date_to,
    limit: 1
  };
}

export function hasNarrowingFilters(input = {}) {
  return describeFilters(input).length > 0;
}
