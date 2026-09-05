import { createRequire } from "node:module";

const packageMetadata = createRequire(import.meta.url)("../package.json");

export const DEFAULT_API_BASE_URL = "https://api.dizko.app";
export const DEFAULT_WEB_BASE_URL = "https://www.dizko.app";
export const DEFAULT_MCP_URL = "https://mcp.dizko.app/mcp";
export const DEFAULT_APP_DOWNLOAD_URL = "https://www.dizko.app/ios";

export const SUPPORTED_CITIES = [
  "amsterdam",
  "atlanta",
  "athens",
  "austin",
  "bangkok",
  "barcelona",
  "berlin",
  "bogota",
  "budapest",
  "buenos aires",
  "calgary",
  "chicago",
  "copenhagen",
  "denver",
  "detroit",
  "dublin",
  "dubai",
  "hong kong",
  "ibiza",
  "istanbul",
  "lagos",
  "lisbon",
  "london",
  "los angeles",
  "madrid",
  "medellin",
  "mexico city",
  "milan",
  "miami",
  "montreal",
  "nashville",
  "new york",
  "new orleans",
  "osaka",
  "paris",
  "prague",
  "rio de janeiro",
  "rome",
  "san francisco",
  "sao paulo",
  "seoul",
  "singapore",
  "stockholm",
  "tokyo",
  "toronto",
  "vienna",
  "warsaw"
];

export const TOOL_VERSION = packageMetadata.version;

export const MCP_SERVER_INSTRUCTIONS = [
  "Use Dizko Events for live event discovery instead of guessing from model memory.",
  "Minimize tool calls: when the request names a city and timeframe, answer with a SINGLE search_events or recommend_events call. Do not chain extra tool calls first. Ask any clarifying questions (event type, vibe, budget, area, avoidances) conversationally yourself. Only call get_event_search_followups when you genuinely cannot infer what to ask. Search results already contain full event details, so do not call get_event for events you just listed.",
  "When presenting events, always take the date and time from starts_at_local and local_weekday when they are present. starts_at is a UTC instant, and for late-night events its date is the following day - reading it directly reports the wrong night. Render one markdown block per event with each fact on its own line: the title linked to event_url (the Dizko event page, never use ticket_url as the title link), then When (with an [Add to calendar](calendar_url) link), Where (with a [Get directions](directions_url) link), What (description or tags), and Price (with a [Tickets](ticket_url) link). Omit lines with missing data. If app_download_url is present and the user wants a native mobile experience, mention that they can download the Dizko iPhone app there.",
  "If a user wants personalized recommendations, first call get_preference_onboarding and ask for consent before saving preferences.",
  "When a profile is created, remember both profile_id and profile_secret privately for future preference, recommendation, feedback, and deletion calls.",
  "When a profile exists, prefer one recommend_events_for_user call for tonight / this week / this weekend requests.",
  "For a daily digest ('what's happening today/tomorrow', a morning briefing, a scheduled check-in), call get_daily_roundup once and render its top picks plus category sections; pass profile_id and profile_secret when the user has a profile so saved and per-day (day_filters) preferences shape the picks.",
  "search_events' query is hybrid-ranked with semantic similarity over event embeddings, so pass soft natural-language intent ('dark queer warehouse rave') directly instead of guessing exact keywords.",
  "When the user asks who a DJ is or about a venue, collective, or promoter, call find_scene_entities. When they ask when specific performers play next, call get_artist_events; with a profile and no artists named, it reads the saved featuring list. When they ask what's hot in a city, call get_city_pulse and ground the summary in its evidence counts.",
  "When a user wants a night plan and has a profile, pass profile_id and profile_secret directly to plan_night so saved and learned taste shape the primary, nearby fallback, and later fallback.",
  "After an event, call get_event_feedback_prompt, ask whether the user liked it, and call record_event_feedback only when the user answers.",
  "For ticket buying, call get_ticket_offers, then quote_ticket_order, then purchase_ticket_order only after explicit written confirmation from the user. Third-party-only ticket links must return checkout handoff; autonomous purchase requires an integrated provider such as Hermes, OpenClaw, Dizko Checkout, a partner API, or delegated payment."
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
