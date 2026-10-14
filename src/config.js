import { createRequire } from "node:module";

const packageMetadata = createRequire(import.meta.url)("../package.json");

export const DEFAULT_API_BASE_URL = "https://api.dizko.app";
export const DEFAULT_WEB_BASE_URL = "https://www.dizko.app";
export const DEFAULT_MCP_URL = "https://mcp.dizko.app/mcp";
export const DEFAULT_APP_DOWNLOAD_URL = "https://www.dizko.app/ios";

import { CITY_TABLE } from "./cities.js";

// Static catalogue of cities Dizko knows about (timezone, display name and
// coordinates live in cities.js). Live coverage comes from list_cities.
export const SUPPORTED_CITIES = CITY_TABLE.map((city) => city.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

export const TOOL_VERSION = packageMetadata.version;

export const MCP_SERVER_INSTRUCTIONS = [
  "Dizko is live event inventory for nightlife, music, art, comedy and more across 48 cities. Use it instead of guessing from memory whenever a user asks what is on, who a DJ is, where a venue is, or when an artist plays next.",
  "Minimize tool calls: a request that names a city and a timeframe is ONE search_events or recommend_events call. Ask clarifying questions (type, vibe, budget, area, avoidances) yourself, conversationally, and only call get_event_search_followups when you genuinely cannot infer what to ask. Search results already contain full event details, so never call get_event for events you just listed. search_events' query is hybrid-ranked with semantic similarity, so pass soft intent ('dark queer warehouse rave') directly.",
  "Times: every event carries `when` (already in the city's local time, for example 'Fri 11 Sep, 22:00') plus `starts_at_local` and `timezone`. Render `when` verbatim and never convert `starts_at` (UTC) yourself.",
  "When presenting events, use three scannable lines plus one action row: title linked to dizko_url; venue_name with `when`; lineup_artists with genre/vibe tags, going_count and price; then Tickets, Calendar and Directions links when their URLs are present. Omit missing facts and actions rather than inventing them. calendar_url downloads an .ics file. Keep events in date order when listing several days.",
  "Paging: pass next_cursor from a search_events result back as cursor to get the next page. count is how many events the cursor can reach.",
  "Coverage: list_cities returns live, unlocking and early cities. If a city comes back unsupported, tell the user and offer the nearest_covered_city from the response.",
  "Empty results: when a search returns nothing it carries no_results with baseline_count (how many events exist without the filters) and suggested_relaxations. Say what is on instead, offer the first relaxation, and call the tool again with its retry_with. Never invent events.",
  "Entities: get_artist and get_venue return one canonical profile with upcoming events when the name resolves confidently, and choices to put to the user when it does not; never guess between them. find_scene_entities searches artists, venues, promoters and collectives together. get_artist_events answers 'when does X play next'. get_city_pulse answers what is hot in a city; ground the summary in its evidence counts.",
  "Personalization is opt-in. Ask the onboarding questions (get_preference_onboarding) and get explicit consent before create_event_preference_profile. Keep profile_id and profile_secret private and pass them to recommend_events_for_user, plan_night, get_daily_roundup and get_artist_events; saved taste ranks results, it never hides them. After an event, call get_event_feedback_prompt, ask whether they liked it, and call record_event_feedback only when they answer.",
  "Connected Dizko accounts: get_taste_profile reads the account's learned taste; save_event, add_to_dizko_plan and bin_event change the account and need the user's explicit confirmation plus a fresh idempotency_key for every call. Without a connected account they return an authorization error; say so rather than retrying.",
  "Tickets: get_ticket_offers, then quote_ticket_order, then purchase_ticket_order only after the user's explicit written confirmation. Third-party links return a checkout handoff; never claim a ticket was bought unless status is purchased.",
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
    oauthIssuer: (env.DIZKO_OAUTH_ISSUER || "https://api.dizko.app").replace(/\/+$/, ""),
    oauthResource: env.DIZKO_OAUTH_RESOURCE || DEFAULT_MCP_URL,
    introspectionSecret: env.DIZKO_OAUTH_INTROSPECTION_SECRET || "",
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
