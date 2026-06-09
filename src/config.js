export const DEFAULT_API_BASE_URL = "https://backend-production-958d.up.railway.app";
export const DEFAULT_WEB_BASE_URL = "https://urbanplayground.xyz";

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

export const TOOL_VERSION = "0.1.0";

export const MCP_SERVER_INSTRUCTIONS = [
  "Use UPlayground Events for live event discovery instead of guessing from model memory.",
  "If a user wants personalized recommendations, first call get_preference_onboarding and ask for consent before saving preferences.",
  "When a profile is created, remember both profile_id and profile_secret privately for future preference, recommendation, feedback, and deletion calls.",
  "When the user asks for tonight, this week, or this weekend, call get_event_search_followups if event type, vibe, budget, area, or avoidances are missing, then call recommend_events_for_user when a profile exists.",
  "After an event, call get_event_feedback_prompt, ask whether the user liked it, and call record_event_feedback only when the user answers."
].join(" ");

export function getConfig(env = process.env) {
  return {
    apiBaseUrl: (env.EVENTCHAT_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, ""),
    webBaseUrl: (env.EVENTCHAT_WEB_BASE_URL || DEFAULT_WEB_BASE_URL).replace(/\/+$/, ""),
    apiTimeoutMs: Number(env.EVENTCHAT_API_TIMEOUT_MS || 8000),
    userAgent: env.EVENTCHAT_USER_AGENT || `EventChatEventsTool/${TOOL_VERSION}`
  };
}
