import { tools } from "./tools.js";

// A surface is a reviewed subset of the tool catalog served at its own
// endpoint. /mcp keeps the full catalog for Claude, Muse, and stdio clients.
// /openai/mcp serves the ChatGPT and Codex plugin directory listing: read-only
// public discovery with no sign-in, no profile secrets, no ticket purchase
// flow, and no app promotion, so review needs no test credentials.

const OPENAI_TOOL_DESCRIPTIONS = {
  list_cities: "Use this when a user asks which cities Dizko covers or how fresh a city's listings are. Returns covered city slugs with event counts. Takes no input.",
  find_scene_entities: "Use this when a user asks who a DJ or artist is, or about a venue, collective, or promoter in a city's music scene. Returns matching Dizko profiles with upcoming event context. Ambiguous names return choices rather than a guess.",
  get_artist: "Use this when a user wants one artist's Dizko profile, published links, and upcoming events. Pass an artist id or a name. It does not list the full artist catalog; an ambiguous name returns choices.",
  get_venue: "Use this when a user wants one venue's Dizko profile and upcoming events. Pass a venue id or a name. It does not list the full venue catalog; an ambiguous name returns choices.",
  search_events: "Use this when a user wants current live events in a covered city, filtered by date or timeframe, genre, event type, vibe, neighborhood, venue, artist, price, or things to avoid. Returns events with Dizko event pages, ticket source links, and calendar and directions links when known. Prices and availability come from listings and may be unverified.",
  recommend_events: "Use this when a user wants a short ranked list of live events matched to a described taste, vibe, budget, or exclusions in a covered city. Each recommendation includes the reasons it ranked. Ranking uses only what the user states in this request; nothing is saved.",
  plan_night: "Use this when a user wants a night-out plan in a covered city: one primary event plus fallback options nearby or later in the night. Uses only the preferences stated in this request; nothing is saved.",
  get_daily_roundup: "Use this when a user wants a digest of what is happening in a covered city on one day, such as today or tomorrow. Returns top picks and category sections. Uses only filters stated in this request.",
  get_artist_events: "Use this when a user asks when or where specific named artists play next. Pass one or more artist names, optionally a city and date range. Returns upcoming Dizko-listed events per artist.",
  get_artist_page: "Use this when a user wants an artist's published Dizko page, including their linked mixes or sets. Pass the artist's Dizko handle. Returns the page's published blocks and links.",
  get_city_pulse: "Use this when a user asks what is busy or popular in a covered city over the coming days. Returns the busiest nights, top venues, genre mix, and headline events, grounded in listing counts. These counts describe programming, not live door or ticket status.",
  get_event: "Use this when a user asks for full details of one event already returned by another Dizko tool, using its event id. Do not call it for events you just listed, since search results already include their details.",
  create_event_calendar_file: "Use this when a user wants to add one Dizko event to their own calendar. Returns an .ics file for that event id. It does not write to any calendar account."
};

export const OPENAI_SERVER_INSTRUCTIONS = [
  "Use Dizko Events for current live event listings in Dizko's covered cities instead of guessing from model memory.",
  "When the request names a city and timeframe, answer with a single search_events or recommend_events call. Ask clarifying questions about event type, vibe, budget, area, or avoidances conversationally before searching when they are missing and matter.",
  "Search results already include full event details, so do not call get_event for events you just listed.",
  "When presenting events, use three scannable lines plus one action row: title linked to dizko_url; venue_name with local start-end time; lineup_artists with genre/vibe tags, going_count and price; then Tickets, Calendar and Directions links when their URLs are present. Omit missing facts and actions rather than inventing them.",
  "Ticket links point to the original ticket source. Tell the user prices and availability may have changed and must be confirmed there. Dizko Events does not buy tickets.",
  "For a daily digest call get_daily_roundup once. For who a DJ, venue, collective, or promoter is, call find_scene_entities. For when named performers play next, call get_artist_events. For what is busy in a city, call get_city_pulse and ground the summary in its evidence counts."
].join(" ");

// Inputs that identify a stored preference profile. They stay on /mcp, but
// the plugin surface never asks the model for them.
const PROFILE_INPUTS = ["profile_id", "profile_secret"];

// Response fields that promote a separate product rather than answer the
// user's request.
const PROMOTIONAL_FIELDS = ["app_download_url"];

// Without saved profiles, these inputs are the only way the tool can work.
const OPENAI_REQUIRED_INPUTS = {
  get_artist_events: ["artists"]
};

export const SURFACES = {
  full: null,
  openai: {
    id: "openai",
    instructions: OPENAI_SERVER_INSTRUCTIONS,
    descriptions: OPENAI_TOOL_DESCRIPTIONS,
    required: OPENAI_REQUIRED_INPUTS
  }
};

export function surfaceTools(surfaceId = "full") {
  const surface = SURFACES[surfaceId];
  if (!surface) return tools;
  return tools
    .filter((tool) => Object.hasOwn(surface.descriptions, tool.name))
    .map((tool) => ({
      ...tool,
      description: surface.descriptions[tool.name],
      inputSchema: withRequired(withoutProperties(tool.inputSchema, PROFILE_INPUTS), surface.required[tool.name])
    }));
}

export function surfaceAllowsTool(surfaceId, name) {
  const surface = SURFACES[surfaceId];
  return !surface || Object.hasOwn(surface.descriptions, name);
}

export function surfaceInput(surfaceId, input = {}) {
  if (!SURFACES[surfaceId]) return input;
  return Object.fromEntries(Object.entries(input).filter(([key]) => !PROFILE_INPUTS.includes(key)));
}

export function surfaceResult(surfaceId, result) {
  if (!SURFACES[surfaceId] || !result?.structuredContent) return result;
  const structuredContent = withoutKeys(result.structuredContent, PROMOTIONAL_FIELDS);
  return {
    ...result,
    structuredContent,
    content: (result.content || []).map((item, index) => (
      index === 0 && item.type === "text" ? { ...item, text: JSON.stringify(structuredContent) } : item
    ))
  };
}

function withoutProperties(schema, names) {
  if (!schema?.properties) return schema;
  const properties = Object.fromEntries(Object.entries(schema.properties).filter(([key]) => !names.includes(key)));
  const required = (schema.required || []).filter((key) => !names.includes(key));
  const { required: _required, ...rest } = schema;
  return { ...rest, properties, ...(required.length ? { required } : {}) };
}

function withRequired(schema, names = []) {
  if (!names.length) return schema;
  return { ...schema, required: [...new Set([...(schema.required || []), ...names])] };
}

function withoutKeys(value, names) {
  if (Array.isArray(value)) return value.map((item) => withoutKeys(item, names));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !names.includes(key))
    .map(([key, child]) => [key, withoutKeys(child, names)]));
}
