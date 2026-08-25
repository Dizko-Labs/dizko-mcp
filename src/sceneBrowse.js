import { listPromoters, searchEvents } from "./api.js";
import { getConfig } from "./config.js";
import { isoDate } from "./dateRange.js";

// Browse mode: "who's big in Sao Paulo" with no entity named. The scene
// index cannot answer this - /scene/search requires a query and ranks by
// similarity to it, not by standing in a city. Standing comes from the
// event inventory instead, aggregated the same way get_city_pulse does it.
const SAMPLE_LIMIT = 200;

// Placeholder venue strings that are not venues. The city guard is dynamic:
// listings frequently use the city or a neighbourhood as the venue name.
const PLACEHOLDER_VENUES = new Set([
  "tba", "tbd", "secret location", "various locations", "undisclosed location", "online"
]);

export async function browseSceneEntities(kind, input = {}, options = {}) {
  const city = String(input.city || "").trim();
  if (!city) {
    return { error: "Browsing top entities requires a city", code: "missing_city" };
  }
  if (kind === "collective") {
    // Events carry no collective field, and collective names do not match
    // event text reliably enough to rank on. Better to say so than to rank
    // noise - see the collective data_note in profile mode.
    return {
      error: "Dizko cannot rank collectives by city; collectives have no verified event links. Search by name instead.",
      code: "browse_unavailable"
    };
  }

  const limit = boundedLimit(input.limit, 10, 20);
  if (kind === "promoter") return browsePromoters(city, limit, input, options);

  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const dateFrom = input.date_from || isoDate(options.now || new Date());
  const response = await searchEvents({
    city,
    event_types: input.event_types,
    genres: input.genre ? [input.genre] : undefined,
    date_from: dateFrom,
    date_to: input.date_to,
    limit: SAMPLE_LIMIT
  }, { ...options, config });

  const events = response.events || [];
  const totalAvailable = response.count ?? events.length;
  const entities = kind === "venue"
    ? rankVenues(events, city)
    : rankArtists(events);

  return {
    mode: "browse",
    kind,
    city,
    date_from: dateFrom,
    date_to: input.date_to || null,
    count: Math.min(entities.length, limit),
    entities: entities.slice(0, limit).map((entity) => ({ kind, ...entity })),
    evidence: {
      sample_size: events.length,
      total_available: totalAvailable,
      // The API orders by attendance when unranked, so a truncated sample is
      // the busiest slice rather than an arbitrary one - worth stating,
      // because it is a real bias in the ranking below.
      note: events.length < totalAvailable
        ? `Ranked over the ${events.length} highest-attendance events of ${totalAvailable} in this window, not the full inventory.`
        : "Ranked over the full inventory for this window."
    },
    data_note: "Browse ranks by counted appearances in the event inventory, not by a curated list. These are names, not profiles - call find_scene_entities again with query set to one of them for its full profile."
  };
}

async function browsePromoters(city, limit, input, options) {
  const response = await listPromoters(city, SAMPLE_LIMIT, options);
  const genre = normalize(input.genre);
  const promoters = (response.promoters || [])
    .filter((item) => !genre || (item.genres || []).some((value) => normalize(value).includes(genre)))
    .sort((a, b) => (b.upcoming_count ?? 0) - (a.upcoming_count ?? 0));
  const city_slug = response.city_slug || response.city || city;
  return {
    mode: "browse",
    kind: "promoter",
    city: response.city || city,
    count: Math.min(promoters.length, limit),
    entities: promoters.slice(0, limit).map((item) => ({
      id: item.slug,
      kind: "promoter",
      name: item.name,
      city: item.city || response.city || city,
      genres: item.genres || [],
      upcoming_count: item.upcoming_count ?? 0,
      next_event_at: item.next_event_at || null,
      dizko_url: city_slug && item.slug
        ? `https://www.dizko.app/promoters/${encodeURIComponent(city_slug)}/${encodeURIComponent(item.slug)}`
        : null
    })),
    evidence: {
      sample_size: (response.promoters || []).length,
      note: "Ranked by count of upcoming indexed events per promoter."
    }
  };
}

function rankVenues(events, city) {
  const cityKey = normalize(city);
  const venues = new Map();
  for (const event of events) {
    const name = event.venue_name;
    if (!name) continue;
    const key = normalize(name);
    // A listing that uses the city itself as its venue is a placeholder,
    // not the city's top venue.
    if (!key || key === cityKey || PLACEHOLDER_VENUES.has(key)) continue;
    const entry = venues.get(key) || { name, event_count: 0, total_attendance: 0, genres: new Map() };
    entry.event_count += 1;
    entry.total_attendance += Number(event.attendance_count || 0);
    for (const genre of event.genres || []) entry.genres.set(genre, (entry.genres.get(genre) || 0) + 1);
    venues.set(key, entry);
  }
  return [...venues.values()]
    .sort((a, b) => b.event_count - a.event_count || b.total_attendance - a.total_attendance)
    .map((entry) => ({
      name: entry.name,
      event_count: entry.event_count,
      total_attendance: entry.total_attendance || undefined,
      genres: topKeys(entry.genres, 4)
    }));
}

function rankArtists(events) {
  const artists = new Map();
  for (const event of events) {
    for (const name of event.lineup || []) {
      const key = normalize(name);
      if (!key) continue;
      const entry = artists.get(key) || { name, event_count: 0, total_attendance: 0, venues: new Set(), genres: new Map() };
      entry.event_count += 1;
      entry.total_attendance += Number(event.attendance_count || 0);
      if (event.venue_name) entry.venues.add(event.venue_name);
      for (const genre of event.genres || []) entry.genres.set(genre, (entry.genres.get(genre) || 0) + 1);
      artists.set(key, entry);
    }
  }
  return [...artists.values()]
    // Bookings first, then draw: in a short window most artists play once,
    // so attendance is what separates them.
    .sort((a, b) => b.event_count - a.event_count || b.total_attendance - a.total_attendance)
    .map((entry) => ({
      name: entry.name,
      event_count: entry.event_count,
      total_attendance: entry.total_attendance || undefined,
      venues: [...entry.venues].slice(0, 3),
      genres: topKeys(entry.genres, 4)
    }));
}

function topKeys(counts, max) {
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([key]) => key);
}

// Accent-folded so the city guard catches "Sao Paulo" listings that spell
// the venue "Sao Paulo" with the diacritics.
function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function boundedLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}
