import { getConfig } from "./config.js";
import { assertIsoDate, resolveDateRange } from "./dateRange.js";
import { cityTimezone, upstreamCityValue } from "./cities.js";
import { ToolInputError } from "./errors.js";
import { describeNetworkError, hostnameFromUrl, isRetryableStatus } from "./netError.js";

const REPEATED_PARAMS = new Set(["event_type", "genres", "vibe", "neighborhood"]);
export const MAX_SEARCH_LIMIT = 200;
export const DEFAULT_SEARCH_LIMIT = 12;
export const SORT_OPTIONS = ["soonest", "popular", "distance", "cost", "event_type"];

export class EventChatAPIError extends Error {
  constructor(message, { status = null, body = null, url = null, code = null, hostname = null, classification = null, retryable, cause } = {}) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "EventChatAPIError";
    this.status = status;
    this.body = body;
    this.url = url;
    this.code = code;
    this.hostname = hostname ?? hostnameFromUrl(url);
    this.classification = classification ?? (status !== null ? "http_error" : null);
    this.retryable = retryable ?? (status !== null && isRetryableStatus(status));
  }
}

export class EventChatNetworkError extends EventChatAPIError {
  constructor(message, props = {}) {
    super(message, props);
    this.name = "EventChatNetworkError";
  }
}

// Comma-separated strings are accepted wherever an array is expected: models
// and CLI users both send "techno,house".
export function toList(value) {
  if (value === undefined || value === null || value === "") return [];
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap((item) => String(item ?? "").split(",")).map((item) => item.trim()).filter(Boolean);
}

export function clampLimit(value, fallback = DEFAULT_SEARCH_LIMIT, max = MAX_SEARCH_LIMIT) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ToolInputError("limit must be a number.", { field: "limit", hint: `Use 1 to ${max}.` });
  }
  return Math.min(max, Math.max(1, Math.floor(parsed)));
}

// Date presets resolve in the target city's timezone when the city is
// known, otherwise UTC. Explicit date_from/date_to always win over `when`.
export function resolveQueryDates(input = {}, now = new Date(), timezone) {
  const zone = timezone || cityTimezone(input.city) || "UTC";
  assertIsoDate(input.date_from, "date_from");
  assertIsoDate(input.date_to, "date_to");
  if (input.date_from || input.date_to) {
    if (input.date_from && input.date_to && input.date_from > input.date_to) {
      throw new ToolInputError("date_from must be on or before date_to.", { field: "date_to" });
    }
    return {
      ...(input.date_from ? { date_from: input.date_from } : {}),
      ...(input.date_to ? { date_to: input.date_to } : {})
    };
  }
  return resolveDateRange(input.when, now, zone);
}

export function buildEventQuery(input = {}, now = new Date(), options = {}) {
  const params = new URLSearchParams();
  const dateRange = resolveQueryDates(input, now, options.timezone);
  const sortBy = normalizeSort(input.sort_by, input);

  const mapping = {
    city: input.city ? upstreamCityValue(input.city) : undefined,
    date_from: dateRange.date_from,
    date_to: dateRange.date_to,
    free: input.free,
    pride: input.pride,
    price_min: input.price_min,
    price_max: input.price_max,
    sort_by: sortBy,
    origin_lat: input.origin_lat,
    origin_lng: input.origin_lng,
    min_attendance: input.min_attendance,
    max_attendance: input.max_attendance,
    q: input.query,
    featuring: input.featuring,
    venue: input.venue,
    promoter: input.promoter,
    limit: clampLimit(input.limit),
    offset: Math.max(0, Math.floor(Number(input.offset) || 0))
  };

  for (const [key, value] of Object.entries(mapping)) {
    appendParam(params, key, value);
  }
  appendParam(params, "event_type", toList(input.event_type ?? input.event_types));
  appendParam(params, "genres", toList(input.genres));
  appendParam(params, "vibe", toList(input.vibe));
  appendParam(params, "neighborhood", toList(input.neighborhood ?? input.neighborhoods));

  return params;
}

function normalizeSort(value, input) {
  if (value === undefined || value === null || value === "") return undefined;
  const sort = String(value).toLowerCase().trim();
  if (!SORT_OPTIONS.includes(sort)) {
    throw new ToolInputError(`Unsupported sort_by value: ${JSON.stringify(value)}.`, { field: "sort_by", allowed: SORT_OPTIONS });
  }
  if (sort === "distance" && (input.origin_lat == null || input.origin_lng == null)) {
    throw new ToolInputError("sort_by=distance needs origin_lat and origin_lng.", { field: "origin_lat", hint: "Pass the user's coordinates, or use a neighborhood filter instead." });
  }
  return sort;
}

export async function searchEvents(input = {}, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const url = new URL("/events", config.apiBaseUrl);
  url.search = buildEventQuery(input, options.now, { timezone: options.timezone }).toString();
  return fetchJsonCached(url, config, options, "Event search");
}

export async function getEvent(id, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const url = new URL(`/events/${encodeURIComponent(id)}`, config.apiBaseUrl);
  return fetchJsonCached(url, config, options, "Event lookup");
}

export async function listCities(options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const url = new URL("/cities", config.apiBaseUrl);
  return fetchJsonCached(url, config, options, "City coverage");
}

export async function searchScene(input = {}, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const url = new URL("/scene/search", config.apiBaseUrl);
  url.search = new URLSearchParams(Object.entries({
    q: input.query,
    kind: input.kind,
    city: input.city ? upstreamCityValue(input.city) : undefined,
    genre: input.genre,
    limit: input.limit ?? 10
  }).filter(([, value]) => value !== undefined && value !== null && value !== "")).toString();
  return fetchJsonCached(url, config, options, "Scene search");
}

export async function getSceneProfile(kind, id, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const url = new URL(`/scene/profiles/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, config.apiBaseUrl);
  return fetchJsonCached(url, config, options, "Scene profile");
}

export async function getDjDirectoryProfile(id, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const url = new URL(`/scene/directory/djs/${encodeURIComponent(id)}`, config.apiBaseUrl);
  return fetchJsonCached(url, config, options, "DJ directory profile");
}

export async function getPublicArtistPage(handle, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const url = new URL(`/artist-pages/public/for-artist/${encodeURIComponent(handle)}`, config.apiBaseUrl);
  const response = await fetchApi(url, config, options, "Public artist page");
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new EventChatAPIError(`Public artist page failed with HTTP ${response.status}`, {
      status: response.status,
      body: await safeText(response),
      url: String(url)
    });
  }
  return response.json();
}

export async function getDjInsights(id, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const url = new URL(`/scene/profiles/dj/${encodeURIComponent(id)}/insights`, config.apiBaseUrl);
  return fetchJsonCached(url, config, options, "DJ insights");
}

export async function listPromoters(city, limit = 200, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const url = new URL(`/promoters/${encodeURIComponent(upstreamCityValue(city))}`, config.apiBaseUrl);
  url.searchParams.set("limit", String(limit));
  return fetchJsonCached(url, config, options, "Promoter search");
}

export async function getPromoter(city, slug, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const url = new URL(`/promoters/${encodeURIComponent(upstreamCityValue(city))}/${encodeURIComponent(slug)}`, config.apiBaseUrl);
  return fetchJsonCached(url, config, options, "Promoter profile");
}

// In-memory response cache. Fresh entries short-circuit the network;
// expired entries are kept for a stale window and served only when the
// upstream fails with a retryable (network/5xx) error. Concurrent
// identical requests share one in-flight fetch.
const responseCache = new Map();
const inFlight = new Map();
const CACHE_MAX_ENTRIES = 200;

export function clearEventCache() {
  responseCache.clear();
  inFlight.clear();
}

async function fetchJsonCached(url, config, options, label) {
  const key = String(url);
  const ttlMs = options.cacheTtlMs ?? config.apiCacheTtlMs ?? 300_000;
  const staleMs = options.cacheStaleMs ?? config.apiCacheStaleMs ?? 3_600_000;
  const clock = options.clock || Date.now;
  const now = clock();
  const entry = ttlMs > 0 ? responseCache.get(key) : undefined;

  if (entry && now - entry.storedAt < ttlMs) {
    return structuredClone(entry.body);
  }

  try {
    if (ttlMs > 0 && inFlight.has(key)) {
      return structuredClone(await inFlight.get(key));
    }

    const request = (async () => {
      const response = await fetchApi(url, config, options, label);
      if (!response.ok) {
        throw new EventChatAPIError(`${label} failed with HTTP ${response.status}`, {
          status: response.status,
          body: await safeText(response),
          url: key
        });
      }
      return response.json();
    })();

    if (ttlMs > 0) inFlight.set(key, request);
    try {
      const body = await request;
      if (ttlMs > 0) {
        responseCache.delete(key);
        responseCache.set(key, { body: structuredClone(body), storedAt: now });
        if (responseCache.size > CACHE_MAX_ENTRIES) {
          responseCache.delete(responseCache.keys().next().value);
        }
      }
      return body;
    } finally {
      if (ttlMs > 0) inFlight.delete(key);
    }
  } catch (error) {
    if (entry && error.retryable === true && now - entry.storedAt < staleMs) {
      return structuredClone(entry.body);
    }
    throw error;
  }
}

// GET with a bounded retry: transient network failures and retryable HTTP
// statuses (408/429/5xx) are retried with exponential backoff + jitter.
async function fetchApi(url, config, options, label) {
  const timeoutMs = options.timeoutMs ?? config.apiTimeoutMs ?? 8000;
  const maxRetries = options.retries ?? config.apiRetries ?? 2;
  const baseDelayMs = options.retryDelayMs ?? config.apiRetryBaseDelayMs ?? 250;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = options.random || Math.random;
  const doFetch = options.fetch || fetch;

  let lastError = null;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      await sleep(baseDelayMs * 2 ** (attempt - 1) + random() * baseDelayMs);
    }
    let response;
    try {
      response = await doFetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Accept: "application/json",
          "User-Agent": config.userAgent,
          ...(config.upstreamSecret ? { "X-Dizko-MCP-Secret": config.upstreamSecret } : {})
        }
      });
    } catch (error) {
      lastError = toRequestError(error, url, label, timeoutMs);
      if (!lastError.retryable || attempt >= maxRetries) throw lastError;
      continue;
    }
    if (isRetryableStatus(response.status) && attempt < maxRetries) {
      await safeText(response);
      lastError = new EventChatAPIError(`${label} failed with HTTP ${response.status}`, {
        status: response.status,
        url: String(url)
      });
      continue;
    }
    return response;
  }
  throw lastError;
}

function toRequestError(error, url, label, timeoutMs) {
  if (error instanceof EventChatAPIError) return error;
  if (error.name === "TimeoutError" || error.name === "AbortError") {
    return new EventChatAPIError(`${label} timed out after ${timeoutMs}ms (${hostnameFromUrl(url) || "unknown host"})`, {
      status: 504,
      body: "",
      url: String(url),
      code: "ETIMEDOUT",
      classification: "timeout",
      retryable: true,
      cause: error
    });
  }
  const described = describeNetworkError(error, url);
  return new EventChatNetworkError(`${label} failed: ${described.message}`, {
    url: described.url,
    code: described.code,
    hostname: described.hostname,
    classification: described.classification,
    retryable: described.retryable,
    cause: error
  });
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
