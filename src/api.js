import { getConfig } from "./config.js";
import { resolveDateRange } from "./dateRange.js";

const REPEATED_PARAMS = new Set(["event_type", "genres", "vibe", "neighborhood"]);

export class EventChatAPIError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "EventChatAPIError";
    this.status = status;
    this.body = body;
  }
}

export function buildEventQuery(input = {}, now = new Date()) {
  const params = new URLSearchParams();
  const dateRange = {
    ...resolveDateRange(input.when, now),
    ...(input.date_from ? { date_from: input.date_from } : {}),
    ...(input.date_to ? { date_to: input.date_to } : {})
  };

  const mapping = {
    city: input.city,
    date_from: dateRange.date_from,
    date_to: dateRange.date_to,
    free: input.free,
    pride: input.pride,
    price_min: input.price_min,
    price_max: input.price_max,
    sort_by: input.sort_by,
    origin_lat: input.origin_lat,
    origin_lng: input.origin_lng,
    min_attendance: input.min_attendance,
    max_attendance: input.max_attendance,
    q: input.query,
    featuring: input.featuring,
    venue: input.venue,
    limit: input.limit ?? 25,
    offset: input.offset ?? 0
  };

  for (const [key, value] of Object.entries(mapping)) {
    appendParam(params, key, value);
  }
  appendParam(params, "event_type", input.event_type || input.event_types);
  appendParam(params, "genres", input.genres);
  appendParam(params, "vibe", input.vibe);
  appendParam(params, "neighborhood", input.neighborhood || input.neighborhoods);

  return params;
}

export async function searchEvents(input = {}, options = {}) {
  const config = options.config || getConfig(options.env);
  const url = new URL("/events", config.apiBaseUrl);
  url.search = buildEventQuery(input, options.now).toString();

  const response = await fetchApi(url, config, options, "Event search");

  if (!response.ok) {
    throw new EventChatAPIError(`Event search failed with HTTP ${response.status}`, {
      status: response.status,
      body: await safeText(response)
    });
  }

  return response.json();
}

export async function getEvent(id, options = {}) {
  const config = options.config || getConfig(options.env);
  const url = new URL(`/events/${encodeURIComponent(id)}`, config.apiBaseUrl);

  const response = await fetchApi(url, config, options, "Event lookup");

  if (!response.ok) {
    throw new EventChatAPIError(`Event lookup failed with HTTP ${response.status}`, {
      status: response.status,
      body: await safeText(response)
    });
  }

  return response.json();
}

async function fetchApi(url, config, options, label) {
  const timeoutMs = options.timeoutMs ?? config.apiTimeoutMs ?? 8000;
  try {
    return await (options.fetch || fetch)(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Accept: "application/json",
        "User-Agent": config.userAgent
      }
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new EventChatAPIError(`${label} timed out after ${timeoutMs}ms`, {
        status: 504,
        body: ""
      });
    }
    throw error;
  }
}

function appendParam(params, key, value) {
  if (value === undefined || value === null || value === "") return;
  if (Array.isArray(value)) {
    for (const item of value) appendParam(params, key, item);
    return;
  }
  if (REPEATED_PARAMS.has(key)) {
    params.append(key, String(value));
  } else {
    params.set(key, String(value));
  }
}

async function safeText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
