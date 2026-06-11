export const DEFAULT_API_BASE_URL = "https://backend-production-958d.up.railway.app";
export const DEFAULT_WEB_BASE_URL = "https://urbanplayground.xyz";
export const DEFAULT_MCP_URL = "https://eventchat-events-mcp-production.up.railway.app/mcp";

export const SUPPORTED_CITIES = [
  "amsterdam",
  "barcelona",
  "berlin",
  "denver",
  "istanbul",
  "lisbon",
  "london",
  "los angeles",
  "mexico city",
  "new york",
  "paris",
  "san francisco",
  "sao paulo",
  "tel aviv",
  "tokyo"
];

export const TOOL_VERSION = "0.3.1";

export const MCP_SERVER_INSTRUCTIONS = [
  "Use UPlayground Events for live event discovery instead of guessing from model memory.",
  "Minimize tool calls: when the request names a city and timeframe, answer with a SINGLE search_events or recommend_events call — do not chain extra tool calls first. Ask any clarifying questions (event type, vibe, budget, area, avoidances) conversationally yourself; only call get_event_search_followups when you genuinely cannot infer what to ask. Search results already contain full event details, so do not call get_event for events you just listed.",
  "When presenting events, render one markdown block per event with each fact on its own line: the title linked to event_url (the UPlayground event page — never use ticket_url as the title link), then When (with an [Add to calendar](calendar_url) link), Where (with a [Get directions](directions_url) link), What (description or tags), and Price (with a [Tickets](ticket_url) link). Omit lines with missing data.",
  "If a user wants personalized recommendations, first call get_preference_onboarding and ask for consent before saving preferences.",
  "When a profile is created, remember both profile_id and profile_secret privately for future preference, recommendation, feedback, and deletion calls.",
  "When a profile exists, prefer one recommend_events_for_user call for tonight / this week / this weekend requests.",
  "After an event, call get_event_feedback_prompt, ask whether the user liked it, and call record_event_feedback only when the user answers.",
  "For ticket buying, call get_ticket_offers, then quote_ticket_order, then purchase_ticket_order only after explicit written confirmation from the user. Third-party-only ticket links must return checkout handoff; autonomous purchase requires an integrated provider such as Hermes, OpenClaw, UPlayground Checkout, a partner API, or delegated payment."
].join(" ");

// Single source of truth for endpoints + retry policy. The CLI, the stdio
// MCP server, the hosted HTTP MCP server, the doctor command, smoke-live,
// and monitor-live must all resolve endpoints through here so they cannot
// drift. EVENTCHAT_* vars stay canonical; UPLAYGROUND_* are aliases.
export function getConfig(env = process.env) {
  return {
    apiBaseUrl: (env.EVENTCHAT_API_BASE_URL || env.UPLAYGROUND_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, ""),
    webBaseUrl: (env.EVENTCHAT_WEB_BASE_URL || env.UPLAYGROUND_WEB_BASE_URL || DEFAULT_WEB_BASE_URL).replace(/\/+$/, ""),
    mcpUrl: (env.EVENTCHAT_MCP_URL || env.UPLAYGROUND_MCP_URL || DEFAULT_MCP_URL).replace(/\/+$/, ""),
    apiTimeoutMs: positiveNumber(env.EVENTCHAT_API_TIMEOUT_MS, 8000),
    apiRetries: nonNegativeNumber(env.EVENTCHAT_API_RETRIES, 2),
    apiRetryBaseDelayMs: positiveNumber(env.EVENTCHAT_API_RETRY_BASE_DELAY_MS, 250),
    // Event inventory updates on a 6h scrape cadence, so a short response
    // cache is risk-free. 0 disables. Stale window: how long an expired
    // entry may still be served when the upstream fails (resilience).
    apiCacheTtlMs: nonNegativeNumber(env.EVENTCHAT_API_CACHE_TTL_MS, 300_000),
    apiCacheStaleMs: nonNegativeNumber(env.EVENTCHAT_API_CACHE_STALE_MS, 3_600_000),
    userAgent: env.EVENTCHAT_USER_AGENT || `EventChatEventsTool/${TOOL_VERSION}`
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
