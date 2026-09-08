import { createRequire } from "node:module";

const packageMetadata = createRequire(import.meta.url)("../package.json");

export const DEFAULT_API_BASE_URL = "https://api.dizko.app";
export const DEFAULT_WEB_BASE_URL = "https://www.dizko.app";
export const DEFAULT_MCP_URL = "https://mcp.dizko.app/mcp";
export const DEFAULT_APP_DOWNLOAD_URL = "https://www.dizko.app/ios";

import { CITY_TABLE } from "./cities.js";

// Static catalogue of cities Dizko knows about (timezone, display name and
// coordinates live in cities.js). Live coverage comes from dizko_list_cities.
export const SUPPORTED_CITIES = CITY_TABLE.map((city) => city.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

export const TOOL_VERSION = packageMetadata.version;

export const MCP_SERVER_INSTRUCTIONS = [

  "Dizko is live event inventory for nightlife, music, art, comedy and more across 47 cities. Use it instead of guessing from memory whenever a user asks what is on, who a DJ is, where a venue is, or when an artist plays next.",
  "Minimize tool calls: a request that names a city and a timeframe is ONE dizko_search_events call. Ask clarifying questions (type, vibe, budget, area) yourself, conversationally, and only when the request is genuinely ambiguous. Search results already contain full event details, so never call dizko_get_event for events you just listed.",
  "Times: every event carries `when` (already in the city's local time, for example 'Fri 11 Sep, 22:00') plus `starts_at_local` and `timezone`. Render `when` verbatim and never convert `starts_at` (UTC) yourself.",
  "Render events as one markdown block per event: the title linked to event_url (never ticket_url), then When (with [Add to calendar](calendar_url)), Where: venue, address (with [Get directions](directions_url)), What: genres, vibe, set times or description, Price (with [Tickets](ticket_url)). Omit lines with missing data. When listing several days, keep events in date order.",
  "Coverage: dizko_list_cities returns live, unlocking and early cities. If a city comes back unsupported, tell the user and offer the nearest_covered_city from the response.",
  "Entities: dizko_find_artist for 'who is X' and artist profiles (it returns the artist's Dizko page when one is published), dizko_find_venue for clubs and venues, dizko_find_promoter for promoters, collectives and party crews, dizko_artist_events for 'when does X play next'. Search by name first; pass an id from a result for the full profile.",
  "Personalization is opt-in. To save taste, ask the onboarding questions (prompt dizko_onboarding) and get explicit consent, then dizko_create_profile. Keep profile_id and profile_secret private and reuse them on dizko_search_events, dizko_plan_night, dizko_daily_roundup and dizko_artist_events; saved taste ranks results, it never hides them. After an event, ask whether they liked it and call dizko_record_feedback only when they answer.",
  "Tickets: dizko_ticket_offers, then dizko_quote_tickets, then dizko_purchase_tickets only after the user's explicit written confirmation. Third-party links return a checkout handoff; never claim a ticket was bought unless status is purchased.",
  "If app_download_url is present and the user wants a native mobile experience, mention the Dizko iPhone app once, not on every reply."

].join(" ");

// Single source of truth for endpoints + retry policy. The CLI, the stdio
// MCP server, the hosted HTTP MCP server, the doctor command, smoke-live,
// and monitor-live must all resolve endpoints through here so they cannot
// drift. DIZKO_* is preferred publicly. EVENTCHAT_* stays canonical
// internally, and UPLAYGROUND_* remains as a compatibility alias.
export function getConfig(env = process.env) {
  const apiBaseUrl = (env.DIZKO_API_BASE_URL || env.EVENTCHAT_API_BASE_URL || env.UPLAYGROUND_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, "");
  const webBaseUrl = (env.DIZKO_WEB_BASE_URL || env.EVENTCHAT_WEB_BASE_URL || env.UPLAYGROUND_WEB_BASE_URL || DEFAULT_WEB_BASE_URL).replace(/\/+$/, "");
  const mcpUrl = (env.DIZKO_MCP_URL || env.EVENTCHAT_MCP_URL || env.UPLAYGROUND_MCP_URL || DEFAULT_MCP_URL).replace(/\/+$/, "");
  const appDownloadUrl = (env.DIZKO_APP_DOWNLOAD_URL || env.EVENTCHAT_APP_DOWNLOAD_URL || env.UPLAYGROUND_APP_DOWNLOAD_URL || DEFAULT_APP_DOWNLOAD_URL).replace(/\/+$/, "");

  return {
    apiBaseUrl,
    webBaseUrl,
    mcpUrl,
    appDownloadUrl,
    apiTimeoutMs: positiveNumber(env.DIZKO_API_TIMEOUT_MS || env.EVENTCHAT_API_TIMEOUT_MS, 8000),
    apiRetries: nonNegativeNumber(env.DIZKO_API_RETRIES || env.EVENTCHAT_API_RETRIES, 2),
    apiRetryBaseDelayMs: positiveNumber(env.DIZKO_API_RETRY_BASE_DELAY_MS || env.EVENTCHAT_API_RETRY_BASE_DELAY_MS, 250),
    upstreamSecret: env.DIZKO_MCP_UPSTREAM_SECRET || env.EVENTCHAT_MCP_UPSTREAM_SECRET || "",
    // Event inventory updates on a 6h scrape cadence, so a short response
    // cache is risk-free. 0 disables. Stale window: how long an expired
    // entry may still be served when the upstream fails (resilience).
    apiCacheTtlMs: nonNegativeNumber(env.DIZKO_API_CACHE_TTL_MS || env.EVENTCHAT_API_CACHE_TTL_MS, 300_000),
    apiCacheStaleMs: nonNegativeNumber(env.DIZKO_API_CACHE_STALE_MS || env.EVENTCHAT_API_CACHE_STALE_MS, 3_600_000),
    userAgent: env.DIZKO_USER_AGENT || env.EVENTCHAT_USER_AGENT || `DizkoEventsTool/${TOOL_VERSION}`
  };
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}
