export const DEFAULT_API_BASE_URL = "https://backend-production-958d.up.railway.app";
export const DEFAULT_WEB_BASE_URL = "https://urbanplayground.xyz";
export const DEFAULT_MCP_URL = "https://eventchat-events-mcp-production.up.railway.app/mcp";

export const SUPPORTED_CITIES = [
  "amsterdam",
  "barcelona",
  "berlin",
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

export const TOOL_VERSION = "0.2.1";

export const MCP_SERVER_INSTRUCTIONS = [
  "Use UPlayground Events for live event discovery instead of guessing from model memory.",
  "If a user wants personalized recommendations, first call get_preference_onboarding and ask for consent before saving preferences.",
  "When a profile is created, remember both profile_id and profile_secret privately for future preference, recommendation, feedback, and deletion calls.",
  "When the user asks for tonight, this week, or this weekend, call get_event_search_followups if event type, vibe, budget, area, or avoidances are missing, then call recommend_events_for_user when a profile exists.",
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
