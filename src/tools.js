import { getEvent, listCities, MAX_SEARCH_LIMIT, SORT_OPTIONS, searchEvents } from "./api.js";
import { getConfig } from "./config.js";
import { buildCalendarEvent } from "./calendar.js";
import { cityDisplayName, cityTimezone, nearestCoveredCity, resolveCity } from "./cities.js";
import { assertIsoDate, resolveSingleDay, WHEN_PRESETS, weekdayName, zonedParts } from "./dateRange.js";
import { isToolInputError, ToolInputError } from "./errors.js";
import { EVENT_FIELD_OPTIONS, summarizeEvent } from "./format.js";
import { describeNetworkError, isRetryableStatus } from "./netError.js";
import { planNight, rankingHintsFromRequest, recommendEvents } from "./planner.js";
import { baselineSearchInput, buildNoResults, hasNarrowingFilters } from "./relaxations.js";
import { dailyRoundup, resolveRoundupDay } from "./roundup.js";
import { dedupeSameShow, getArtistEvents } from "./artistEvents.js";
import { getArtistPage } from "./artistPage.js";
import { cityPulse } from "./cityPulse.js";
import { findArtist, findPromoter, findSceneEntities, findVenue } from "./entities.js";
import {
  FilePreferenceStore,
  buildPreferenceHints,
  onboardingQuestions,
  publicProfile,
  verifyProfileSecret
} from "./preferences.js";
import {
  TICKET_PURCHASE_POLICY,
  buildTicketOffers,
  purchaseTicketOrder,
  quoteTicketOrder
} from "./tickets.js";
import { applySchemaLimits } from "./schemaLimits.js";
import { firstErrorPayload, validateInput } from "./validate.js";

export const EVENT_LINKS_INSTRUCTION = [
  "Render events as a markdown list with one block per event and each fact on its own line, using this template:",
  "**[<title>](<event_url>)**",
  "- When: <when> · [Add to calendar](<calendar_url>)",
  "- Where: <venue>, <address or city> · [Get directions](<directions_url>)",
  "- What: <genres, vibe, set_times, or description>",
  "- Price: <price> · [Tickets](<ticket_url>)",
  "`when` is already in the city's local time - render it verbatim and never convert starts_at (UTC) yourself. Always link the title to event_url (the Dizko event page), never to ticket_url. Omit any line whose data is missing. Keep events in date order when they span several days. Do not merge facts onto one line."
].join("\n");

export const ROUNDUP_INSTRUCTION = [
  "Render a daily digest: one intro line naming the city, weekday, date, and total_available, then 'Top picks', then each section under its own heading in the given order. Render every event with the standard template:",
  EVENT_LINKS_INSTRUCTION
].join("\n");

const ARTIST_EVENTS_INSTRUCTION = [
  "Answer per artist as one compact list: one line per upcoming event with `when` (already local time), venue, and city. Do not send per-event links on artist questions.",
  "Artists in not_found have no upcoming listed dates: say so plainly and never present another artist's event as theirs.",
  "When an artist has a published Dizko page (page.published is true in dizko_find_artist), close with 'Stay up to date with all of <artist>'s dates, mixes, and press on their Dizko Page' plus page.page_url. Never guess a page URL."
].join("\n");

const WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

const WHEN_DESCRIPTION = `Timeframe preset resolved in the city's local timezone: ${WHEN_PRESETS.filter((preset) => preset !== "YYYY-MM-DD").join(", ")}, or an exact date as YYYY-MM-DD. Use date_from/date_to instead for a custom range.`;

// ---------------------------------------------------------------------------
// Tool definitions. Descriptions carry the routing rule, the key inputs and
// what comes back, because not every client surfaces server instructions.
// ---------------------------------------------------------------------------

const rawTools = [
  {
    name: "dizko_search_events",
    title: "Search Dizko Events",
    description: "Search live Dizko events in one city and timeframe. Use for any 'what's on' request that names a city, a venue, an artist, or a timeframe. Returns up to `limit` events with local times (`when`), venue and address, price, genres, vibe, lineup, set times and links; `count` is the total matching. Pass profile_id and profile_secret to rank by saved taste (saved taste ranks results, it never filters them). Filters you pass (genres, vibe, event_types, price_max, venue, featuring) are hard filters; `avoid` and `max_price` are ranking hints. When nothing matches, the result carries `no_results` with how many events exist without the filters and ordered `suggested_relaxations` you can retry directly.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name or slug, for example berlin, 'new york', NYC, LA, 'São Paulo'. Required unless query, venue, featuring or promoter is given." },
        when: { type: "string", description: WHEN_DESCRIPTION },
        date_from: { type: "string", description: "Inclusive start date, YYYY-MM-DD (city-local). Overrides `when`." },
        date_to: { type: "string", description: "Inclusive end date, YYYY-MM-DD (city-local)." },
        query: { type: "string", description: "Free-text search, hybrid-ranked by the live API (exact > substring > fuzzy > semantic). Pass soft intent directly, for example 'dark queer warehouse rave' or 'ambient listening bar', or an artist or event name." },
        event_types: { type: "array", items: { type: "string" }, description: "Hard filter. Vocabulary: party, live music, concert, art, museum, comedy, theatre, talk, meetup, food, festival, wellness, sports." },
        genres: { type: "array", items: { type: "string" }, description: "Hard filter, for example techno, house, jazz, hip hop, ambient." },
        vibe: { type: "array", items: { type: "string" }, description: "Hard filter, for example underground, intimate, high-energy, queer-friendly, outdoors, free-entry." },
        neighborhoods: { type: "array", items: { type: "string" }, description: "Hard filter on neighborhood names, for example kreuzberg, bushwick." },
        venue: { type: "string", description: "Hard filter on venue name (text match), for example Berghain." },
        featuring: { type: "string", description: "Hard filter on an artist or performer on the lineup." },
        promoter: { type: "string", description: "Hard filter on promoter slug or display name." },
        free: { type: "boolean", description: "Only free-entry events." },
        pride: { type: "boolean", description: "Only Pride / LGBTQ+ flagged events." },
        price_min: { type: "number", description: "Hard filter: minimum ticket price." },
        price_max: { type: "number", description: "Hard filter: maximum ticket price. Events without a listed price are excluded when set." },
        max_price: { type: "number", description: "Soft budget used for ranking (over-budget events drop, they are not hidden). Use price_max for a hard cap." },
        avoid: { type: "array", items: { type: "string" }, description: "Ranking penalties, for example mainstream, huge crowds, expensive tickets, or any word to avoid in titles and tags." },
        sort_by: { type: "string", enum: SORT_OPTIONS, description: "soonest (chronological), popular (default for multi-day ranges), cost, event_type, or distance (needs origin_lat/origin_lng). Single-day requests default to soonest." },
        origin_lat: { type: "number", description: "Latitude for sort_by=distance ('near me'). Only pass coordinates the user gave you." },
        origin_lng: { type: "number", description: "Longitude for sort_by=distance." },
        rank: { type: "string", enum: ["relevance", "taste"], description: "relevance (default) keeps the API order; taste ranks the page by genres, vibe, avoid and budget from this request and from the profile when given. Defaults to taste when a profile is given." },
        profile_id: { type: "string", description: "Optional Dizko preference profile id; pass with profile_secret to rank by saved and learned taste." },
        profile_secret: { type: "string", description: "Private profile secret returned when the profile was created." },
        fields: { type: "array", items: { type: "string", enum: EVENT_FIELD_OPTIONS }, description: "Extra per-event fields to include: description, images, coordinates, socials, promoters, source. Omit for the compact default." },
        limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_LIMIT, default: 12, description: `Events to return per page (1-${MAX_SEARCH_LIMIT}, default 12). count is the total available; page with offset.` },
        offset: { type: "integer", minimum: 0, default: 0, description: "Pagination offset." }
      },
      dependentRequired: { profile_id: ["profile_secret"], profile_secret: ["profile_id"] }
    }
  },
  {
    name: "dizko_plan_night",
    title: "Plan a Night Out",
    description: "Build a night plan for one city and date: a primary event plus a nearby fallback (best taste fit within 6 km), a later-starting fallback, and alternates. Use when the user wants a plan with backups rather than a list. Accepts the same filters as dizko_search_events and an optional profile for saved taste. An empty plan carries the same `no_results` guidance as search.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name or slug." },
        when: { type: "string", description: WHEN_DESCRIPTION },
        date_from: { type: "string", description: "Inclusive start date, YYYY-MM-DD." },
        date_to: { type: "string", description: "Inclusive end date, YYYY-MM-DD." },
        query: { type: "string", description: "Free-text intent, for example 'concert first then a late party'." },
        event_types: { type: "array", items: { type: "string" } },
        genres: { type: "array", items: { type: "string" } },
        vibe: { type: "array", items: { type: "string" } },
        neighborhoods: { type: "array", items: { type: "string" } },
        venue: { type: "string" },
        featuring: { type: "string" },
        free: { type: "boolean" },
        price_max: { type: "number", description: "Hard price cap." },
        max_price: { type: "number", description: "Soft budget for ranking." },
        avoid: { type: "array", items: { type: "string" }, description: "Ranking penalties." },
        result_limit: { type: "integer", minimum: 1, maximum: 6, default: 4, description: "Plan size including the primary (1-6)." },
        profile_id: { type: "string", description: "Optional profile id; pass with profile_secret." },
        profile_secret: { type: "string" },
        fields: { type: "array", items: { type: "string", enum: EVENT_FIELD_OPTIONS } }
      },
      dependentRequired: { profile_id: ["profile_secret"], profile_secret: ["profile_id"] }
    }
  },
  {
    name: "dizko_daily_roundup",
    title: "Daily City Roundup",
    description: "One-day digest for a city: top picks plus sections for parties, live music, art, comedy and theatre, talks, food, and more. Use for 'what's happening today/tomorrow', morning briefings and scheduled check-ins. With a profile, saved, learned and per-weekday taste rank the picks. Pass compact=true for a short push-style digest.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name or slug." },
        date: { type: "string", description: "Target day, YYYY-MM-DD (city-local). Defaults to today." },
        when: { type: "string", description: "Single-day preset: today, tonight, tomorrow, or a weekday name. Ranges are rejected; use dizko_search_events for those." },
        profile_id: { type: "string", description: "Optional profile id; pass with profile_secret to personalize." },
        profile_secret: { type: "string" },
        event_types: { type: "array", items: { type: "string" }, description: "Hard filter." },
        genres: { type: "array", items: { type: "string" }, description: "Hard filter." },
        vibe: { type: "array", items: { type: "string" }, description: "Hard filter." },
        neighborhoods: { type: "array", items: { type: "string" } },
        free: { type: "boolean" },
        price_max: { type: "number" },
        avoid: { type: "array", items: { type: "string" }, description: "Ranking penalties." },
        compact: { type: "boolean", default: false, description: "Short digest: title, when, venue, price and link only; 3 picks, up to 4 sections of 3." },
        limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_LIMIT, default: 100, description: "How many of the day's events to fetch and rank." },
        top_limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
        section_limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
        fields: { type: "array", items: { type: "string", enum: EVENT_FIELD_OPTIONS } }
      },
      required: ["city"],
      dependentRequired: { profile_id: ["profile_secret"], profile_secret: ["profile_id"] }
    }
  },
  {
    name: "dizko_city_pulse",
    title: "City Pulse",
    description: "Aggregate read of a city's scene over the coming days: busiest nights (city-local dates), top venues (attendance-weighted), genre mix, headline events and free-event count, every stat with evidence counts. Use for 'what's hot', 'how busy is Berlin this week', or trend questions. Public inventory only.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        city: { type: "string", description: "City name or slug." },
        days: { type: "integer", minimum: 1, maximum: 14, default: 7, description: "Window length in days from date_from (1-14)." },
        date_from: { type: "string", description: "Inclusive start date, YYYY-MM-DD. Defaults to today in the city." },
        event_types: { type: "array", items: { type: "string" }, description: "Optional event-type filter, for example party." }
      },
      required: ["city"]
    }
  },
  {
    name: "dizko_get_event",
    title: "Get Event",
    description: "Full detail for one Dizko event id: local times, venue and address, price, lineup, set times, artist socials, image, coordinates and links. Only call it for an id the user gave you or for extra detail on an event not in the current results; search results already contain what the template needs.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Event id (UUID) from any Dizko result." }
      },
      required: ["id"]
    }
  },
  {
    name: "dizko_list_cities",
    title: "List Covered Cities",
    description: "Live coverage: every city Dizko serves with status (live, unlocking, early), event count, timezone and freshness. Use when a user asks where Dizko works, whether a city is covered, or how fresh the data is. Unlocking and early cities are searchable but thin.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: { type: "object", properties: {} }
  },
  {
    name: "dizko_find_artist",
    title: "Find Artist or DJ",
    description: "Look up a DJ, artist, or performer. Search by name (query) to get candidates with a best_match; pass an id from a result for the full profile: bio, cities, genres, links, upcoming events (deduplicated, date-ordered), insights (top venues, related artists), mixes, press, and the artist's published Dizko page with deep-linkable mixes when one exists. Use for 'who is X', 'what does X play', 'X's Dizko page' and 'X's latest mix'.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Artist name to search for." },
        id: { type: "string", description: "Artist id from a previous result (for example nina-kraviz) for the full profile." },
        city: { type: "string", description: "Optional city to bias search and scope upcoming events." },
        genre: { type: "string", description: "Optional genre filter for search." },
        date_from: { type: "string", description: "Inclusive start date for upcoming events, YYYY-MM-DD." },
        date_to: { type: "string", description: "Inclusive end date for upcoming events, YYYY-MM-DD." },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10, description: "Search candidates or upcoming events to return." },
        fields: { type: "array", items: { type: "string", enum: EVENT_FIELD_OPTIONS } }
      },
      anyOf: [{ required: ["query"] }, { required: ["id"] }]
    }
  },
  {
    name: "dizko_find_venue",
    title: "Find Venue",
    description: "Look up a club, venue or space. Search by name (query) for candidates with a best_match; pass an id for the profile: neighborhood, capacity, genres, bio, links, and upcoming events at that venue (date-ordered). Use for 'what's on at Berghain', 'where is Nowadays', 'tell me about fabric'.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Venue name to search for." },
        id: { type: "string", description: "Venue id from a previous result (for example berghain) for the profile and its events." },
        city: { type: "string", description: "Optional city to disambiguate." },
        genre: { type: "string" },
        date_from: { type: "string", description: "Inclusive start date for upcoming events, YYYY-MM-DD." },
        date_to: { type: "string", description: "Inclusive end date for upcoming events, YYYY-MM-DD." },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
        fields: { type: "array", items: { type: "string", enum: EVENT_FIELD_OPTIONS } }
      },
      anyOf: [{ required: ["query"] }, { required: ["id"] }]
    }
  },
  {
    name: "dizko_find_promoter",
    title: "Find Promoter or Collective",
    description: "Look up a promoter, collective or party crew. Search by name (query); pass city to include promoters with upcoming Dizko listings (collectives are searched worldwide). Pass an id for the profile: genres, venues they use, upcoming events. Use for 'who runs Gegen', 'what does Cocktail d'Amore have coming up'.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Promoter or collective name." },
        id: { type: "string", description: "Promoter slug or collective id from a previous result." },
        city: { type: "string", description: "City slug. Needed to list promoter events; promoter ids are per city." },
        kind: { type: "string", enum: ["promoter", "collective"], description: "Restrict to one kind. Omit to search both." },
        genre: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
        fields: { type: "array", items: { type: "string", enum: EVENT_FIELD_OPTIONS } }
      },
      anyOf: [{ required: ["query"] }, { required: ["id"] }]
    }
  },
  {
    name: "dizko_artist_events",
    title: "Upcoming Events by Artist",
    description: "Upcoming shows grouped by artist for up to 8 named DJs, performers or comedians, deduplicated across sources and date-ordered, optionally scoped to a city. Use for 'when does X play next' or 'is X playing in Berlin this month'. With a profile and no artists named, tracks the profile's saved featuring list.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        artists: { type: "array", items: { type: "string" }, maxItems: 8, description: "Artist names to look up (max 8 per call)." },
        city: { type: "string", description: "Optional city to scope the search; omit for all cities." },
        date_from: { type: "string", description: "Inclusive start date, YYYY-MM-DD. Defaults to today." },
        date_to: { type: "string", description: "Optional inclusive end date, YYYY-MM-DD." },
        limit_per_artist: { type: "integer", minimum: 1, maximum: 10, default: 5 },
        profile_id: { type: "string", description: "Optional profile id; with no artists given, the saved featuring list is used." },
        profile_secret: { type: "string" },
        fields: { type: "array", items: { type: "string", enum: EVENT_FIELD_OPTIONS } }
      },
      dependentRequired: { profile_id: ["profile_secret"], profile_secret: ["profile_id"] }
    }
  },
  {
    name: "dizko_create_profile",
    title: "Create Preference Profile",
    description: "Create a private Dizko preference profile after the user explicitly agrees to save their taste. Returns profile_id and a one-time profile_secret to keep for future personalized calls. Ask the onboarding questions (prompt dizko_onboarding) and get consent first; consent must be true.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      ...preferenceInputDefinitions(),
      type: "object",
      properties: {
        consent: { type: "boolean", description: "Must be true only after the user agreed to save preferences." },
        preferences: { $ref: "#/$defs/preferences", description: "Initial taste: cities, event_types, genres, vibe, neighborhoods, venues, promoters, featuring, avoid, max_price, free, nightlife, day_filters." }
      },
      required: ["consent"]
    }
  },
  {
    name: "dizko_update_profile",
    title: "Update Preference Profile",
    description: "Add to or replace saved preferences on an existing profile (mode merge or replace). Needs profile_id, profile_secret and consent=true. Use when the user shares new taste, favorite artists to track (featuring), venues, budget, or per-weekday rules (day_filters).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      ...preferenceInputDefinitions(),
      type: "object",
      properties: {
        profile_id: { type: "string" },
        profile_secret: { type: "string" },
        consent: { type: "boolean", description: "Must be true only after the user agreed to save preferences." },
        mode: { type: "string", enum: ["merge", "replace"], default: "merge", description: "merge adds to existing lists; replace overwrites everything." },
        preferences: { $ref: "#/$defs/preferences" }
      },
      required: ["profile_id", "profile_secret", "consent", "preferences"]
    }
  },
  {
    name: "dizko_get_profile",
    title: "Get Preference Profile",
    description: "Read a profile's saved preferences, learned taste (with scores) and feedback count. Use when the user asks what Dizko remembers about them.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: profileSchema()
  },
  {
    name: "dizko_delete_profile",
    title: "Delete Preference Profile",
    description: "Delete a profile's saved preferences and feedback history. Only after the user confirms they want their Dizko connector data deleted; confirm_delete must be true. Scoped to Dizko only.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        profile_id: { type: "string" },
        profile_secret: { type: "string" },
        confirm_delete: { type: "boolean", description: "Must be true only after the user confirms deletion." }
      },
      required: ["profile_id", "profile_secret", "confirm_delete"]
    }
  },
  {
    name: "dizko_record_feedback",
    title: "Record Event Feedback",
    description: "Store post-event feedback (liked, 1-5 rating, notes) for a profile and update learned taste. A like promotes the event's genres, vibe and venue; a dislike marks the venue and promoter, and only penalizes genres when the notes blame the music. Call only after the user answers (prompt dizko_post_event_feedback has the questions).",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        profile_id: { type: "string" },
        profile_secret: { type: "string" },
        event_id: { type: "string", description: "Event id from any Dizko result." },
        liked: { type: "boolean" },
        rating: { type: "number", minimum: 1, maximum: 5 },
        notes: { type: "string", description: "Free text; mentions of music, crowd, venue, price or timing become learned signals." },
        attended_at: { type: "string", description: "ISO date/time or YYYY-MM-DD." }
      },
      required: ["profile_id", "profile_secret", "event_id"],
      anyOf: [{ required: ["liked"] }, { required: ["rating"] }, { required: ["notes"] }]
    }
  },
  {
    name: "dizko_ticket_offers",
    title: "Ticket Offers",
    description: "Ticket options for one event: provider, checkout link, estimated price, whether entry is free, and whether autonomous purchase is supported (it is not on the hosted connector; third-party links are a checkout handoff). Includes the purchase policy. Call before quoting.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "Event id from any Dizko result." }
      },
      required: ["event_id"]
    }
  },
  {
    name: "dizko_quote_tickets",
    title: "Quote Tickets",
    description: "Create a signed, time-limited quote for an event: quantity, ticket type, max total, currency, refund terms, delivery email and stop conditions. Returns a quote_token to pass unchanged to dizko_purchase_tickets and the exact confirmation text to ask the user for.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        offer_id: { type: "string", description: "Optional offer_id from dizko_ticket_offers." },
        quantity: { type: "integer", minimum: 1, maximum: 12, default: 1 },
        ticket_type: { type: "string", description: "For example GA, balcony, seated, VIP, or best available." },
        max_total: { type: "number", minimum: 0, description: "Maximum all-in total the user authorizes." },
        currency: { type: "string", description: "Currency for max_total, for example EUR." },
        refund_terms: { type: "string", description: "Minimum refund/transfer terms the user accepts." },
        delivery_email: { type: "string", description: "Where tickets should be delivered, when a provider supports it." },
        add_to_calendar: { type: "boolean", default: true }
      },
      required: ["event_id"]
    }
  },
  {
    name: "dizko_purchase_tickets",
    title: "Purchase Tickets",
    description: "Execute a quoted ticket order after the user's explicit written confirmation (must say buy/purchase and repeat the quantity and max total). With a third-party link this returns status requires_external_checkout and the checkout_url for the user to pay directly; never claim a purchase unless status is purchased. Only an integrated purchase provider can buy autonomously. Each quote_token can be submitted once: a repeat returns status quote_already_used and must never be retried.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        quote_token: { type: "string", description: "The signed quote_token from dizko_quote_tickets, unchanged." },
        confirmation_text: { type: "string", description: "The user's own words confirming the purchase, including buy/purchase, the quantity and the max total." },
        user_payment_profile_id: { type: "string", description: "Provider-specific saved payment profile id, when an integrated provider supports autonomous purchase." },
        delivery_email: { type: "string" },
        add_to_calendar: { type: "boolean" }
      },
      required: ["quote_token", "confirmation_text"]
    }
  },
  {
    name: "dizko_calendar_file",
    title: "Calendar File",
    description: "Build an importable .ics calendar entry for one event (local time, venue address, lineup, set times, links). Use when the user wants the event in Apple Calendar, Google Calendar or Outlook as a file; the per-event calendar_url is the one-click alternative.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        status: { type: "string", enum: ["CONFIRMED", "TENTATIVE"], default: "CONFIRMED" }
      },
      required: ["event_id"]
    }
  }
];

const TOOL_STATUS = {
  dizko_search_events: ["Searching live events", "Live events found"],
  dizko_plan_night: ["Planning the night", "Night plan ready"],
  dizko_daily_roundup: ["Building today's roundup", "Roundup ready"],
  dizko_city_pulse: ["Reading the city pulse", "City pulse ready"],
  dizko_get_event: ["Loading event", "Event loaded"],
  dizko_list_cities: ["Checking city coverage", "City coverage ready"],
  dizko_find_artist: ["Looking up artist", "Artist found"],
  dizko_find_venue: ["Looking up venue", "Venue found"],
  dizko_find_promoter: ["Looking up promoter", "Promoter found"],
  dizko_artist_events: ["Checking artist dates", "Artist dates ready"],
  dizko_create_profile: ["Creating preference profile", "Preference profile created"],
  dizko_update_profile: ["Saving preferences", "Preferences saved"],
  dizko_get_profile: ["Loading preferences", "Preferences loaded"],
  dizko_delete_profile: ["Deleting preferences", "Preferences deleted"],
  dizko_record_feedback: ["Saving event feedback", "Event feedback saved"],
  dizko_ticket_offers: ["Checking ticket options", "Ticket options ready"],
  dizko_quote_tickets: ["Preparing ticket quote", "Ticket quote ready"],
  dizko_purchase_tickets: ["Processing ticket order", "Ticket order processed"],
  dizko_calendar_file: ["Creating calendar file", "Calendar file ready"]
};

// Every tool schema gets a string and array cap before it is published or
// validated against, so an oversized argument is refused at the door instead
// of being handed to a ranking loop or written to a profile file.
for (const tool of rawTools) applySchemaLimits(tool.inputSchema);

export const tools = rawTools.map(publicToolDefinition);
const toolsByName = new Map(rawTools.map((tool) => [tool.name, tool]));

function publicToolDefinition(tool) {
  const securitySchemes = [{ type: "noauth" }];
  const [invoking, invoked] = TOOL_STATUS[tool.name] || ["Working", "Ready"];
  return {
    ...tool,
    securitySchemes,
    _meta: {
      ...(tool._meta || {}),
      securitySchemes,
      "openai/toolInvocation/invoking": invoking,
      "openai/toolInvocation/invoked": invoked
    }
  };
}

// ---------------------------------------------------------------------------
// Legacy tool names (pre-0.8) keep working so existing connectors and
// scripts do not break. They are not listed in tools/list.
// ---------------------------------------------------------------------------

export const LEGACY_TOOL_ALIASES = {
  search_events: { name: "dizko_search_events" },
  recommend_events: { name: "dizko_search_events", adapt: (input) => ({ ...input, rank: "taste", limit: input.result_limit ?? input.limit ?? 10 }) },
  recommend_events_for_user: { name: "dizko_search_events", adapt: (input) => ({ ...input, rank: "taste", limit: input.result_limit ?? 10 }) },
  plan_night: { name: "dizko_plan_night" },
  get_daily_roundup: { name: "dizko_daily_roundup" },
  get_city_pulse: { name: "dizko_city_pulse" },
  get_event: { name: "dizko_get_event" },
  list_cities: { name: "dizko_list_cities" },
  get_artist_events: { name: "dizko_artist_events" },
  create_event_preference_profile: { name: "dizko_create_profile" },
  save_event_preferences: { name: "dizko_update_profile" },
  get_event_preferences: { name: "dizko_get_profile" },
  delete_event_preferences: { name: "dizko_delete_profile" },
  record_event_feedback: { name: "dizko_record_feedback" },
  get_ticket_offers: { name: "dizko_ticket_offers" },
  quote_ticket_order: { name: "dizko_quote_tickets" },
  purchase_ticket_order: { name: "dizko_purchase_tickets" },
  create_event_calendar_file: { name: "dizko_calendar_file" }
};

// ---------------------------------------------------------------------------
// Prompts: conversational scaffolding that used to be tools.
// ---------------------------------------------------------------------------

export const prompts = [
  {
    name: "dizko_onboarding",
    title: "Preference onboarding",
    description: "Consent-first questions to ask before saving a user's event preferences with dizko_create_profile.",
    arguments: []
  },
  {
    name: "dizko_search_followups",
    title: "Search follow-up questions",
    description: "The clarifying questions worth asking before a broad 'what's on' search: event type, vibe, budget, area, things to avoid.",
    arguments: [
      { name: "city", description: "City already known, if any.", required: false },
      { name: "when", description: "Timeframe already known, if any.", required: false }
    ]
  },
  {
    name: "dizko_post_event_feedback",
    title: "Post-event feedback questions",
    description: "Short follow-up questions to ask after an event before calling dizko_record_feedback.",
    arguments: [{ name: "event_id", description: "The event the user picked or attended.", required: true }]
  },
  {
    name: "dizko_ticket_policy",
    title: "Ticket purchase policy",
    description: "How ticket quoting, confirmation, checkout handoff and autonomous purchase work, and the hard safety rules.",
    arguments: []
  }
];

export async function getPrompt(name, args = {}, options = {}) {
  switch (name) {
    case "dizko_onboarding":
      return promptResult("Ask these questions conversationally, then ask whether Dizko may save the answers. Only if the user agrees, call dizko_create_profile with consent=true and remember the returned profile_id and profile_secret privately.", onboardingQuestions());
    case "dizko_search_followups": {
      const followups = buildSearchFollowups(args);
      return promptResult(followups.assistant_instruction, followups.questions);
    }
    case "dizko_post_event_feedback": {
      if (!args.event_id) throw new ToolInputError("event_id is required.", { field: "event_id" });
      const event = summarizeEvent(await getEvent(args.event_id, options));
      return promptResult(`Ask these naturally about ${event.title}${event.when ? ` (${event.when})` : ""}. If the user has a Dizko profile and answers, call dizko_record_feedback with profile_id, profile_secret, event_id, liked, rating, notes, and attended_at when available.`, feedbackQuestions(event));
    }
    case "dizko_ticket_policy":
      return promptResult("Explain the ticket flow honestly.", [
        `Autonomous purchase available on this server: ${TICKET_PURCHASE_POLICY.autonomous_purchase_available ? "yes" : "no"}.`,
        `Default behavior: ${TICKET_PURCHASE_POLICY.current_default_behavior}`,
        ...TICKET_PURCHASE_POLICY.hard_rules.map((rule) => `Rule: ${rule}`),
        `Provider contract: ${TICKET_PURCHASE_POLICY.provider_contract}`
      ]);
    default:
      throw new ToolInputError(`Unknown prompt: ${name}.`, { field: "name", allowed: prompts.map((prompt) => prompt.name) });
  }
}

function promptResult(description, lines) {
  return {
    description,
    messages: [{ role: "user", content: { type: "text", text: [description, "", ...lines.map((line, index) => `${index + 1}. ${line}`)].join("\n") } }]
  };
}

function feedbackQuestions(event) {
  return [
    `Did you end up going to ${event.title}?`,
    "Did you like it overall?",
    "What should I remember for future recommendations: music, crowd, venue, price, timing, or anything to avoid?",
    "If you want, give it a 1-5 rating."
  ];
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export async function callTool(name, input = {}, options = {}) {
  const store = options.preferenceStore || new FilePreferenceStore(options.preferencesPath);
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  const context = { store, config, options };

  try {
    // Plain-object lookup would resolve "toString" or "constructor" to an
    // inherited function and hand the SDK something that is not a tool result.
    if (Object.hasOwn(legacyHandlers, name)) {
      return await legacyHandlers[name](input || {}, context);
    }
    const alias = Object.hasOwn(LEGACY_TOOL_ALIASES, name) ? LEGACY_TOOL_ALIASES[name] : undefined;
    const toolName = alias ? alias.name : name;
    const tool = toolsByName.get(toolName);
    if (!tool) {
      return toolJson({
        error: `Unknown tool: ${name}.`,
        code: "unknown_tool",
        allowed: rawTools.map((candidate) => candidate.name)
      }, true);
    }
    const rawInput = alias?.adapt ? alias.adapt(input || {}) : (input || {});
    const { value, errors } = validateInput(tool.inputSchema, rawInput);
    if (errors.length) return toolJson(firstErrorPayload(errors, toolName), true);
    const result = await handlers[toolName](value, context);
    return result?.structuredContent ? result : toolJson(result, false);
  } catch (error) {
    return toolJson(await errorPayload(error, name, input, context), true);
  }
}

const handlers = {
  async dizko_search_events(input, context) {
    const { config, options } = context;
    const hasScope = [input.city, input.query, input.venue, input.featuring, input.promoter].some((value) => value !== undefined && value !== null && String(value).trim() !== "")
      || (input.neighborhoods || []).length;
    const profileAccess = await optionalProfile(context, input);
    if (profileAccess.error) return profileAccess.error;
    const profile = profileAccess.profile;

    const city = input.city || profile?.preferences?.cities?.[0];
    if (!hasScope && !city) {
      throw new ToolInputError("Pass a city (or a query, venue, featuring or promoter) so the search has a scope.", {
        field: "city",
        hint: "Example: { city: 'berlin', when: 'weekend' }. Use dizko_list_cities to see coverage."
      });
    }
    const timezone = cityTimezone(city) || "UTC";
    const singleDay = resolveSingleDay(input, options.now, timezone);
    const sortBy = input.sort_by || (singleDay ? "soonest" : undefined);
    const rank = input.rank || (profile ? "taste" : "relevance");
    const searchInput = { ...input, city, sort_by: sortBy };
    const summaryOptions = { ...options, config, webBaseUrl: config.webBaseUrl, linkBaseUrl: config.mcpUrl, fields: input.fields };

    if (rank === "taste") {
      const hints = profile
        ? buildPreferenceHints(profile, rankingHintsFromRequest(input), { weekday: weekdayName(singleDay) })
        : rankingHintsFromRequest(input);
      const response = await recommendEvents({ ...searchInput, preferences: hints, result_limit: input.limit ?? 12 }, { ...options, config });
      const emptyTaste = response.events.length ? null : await noResultsPayload(searchInput, cityDisplayName(city), { ...options, config });
      // Taste ranks a candidate window rather than walking the inventory in
      // order, so there is no stable cursor to hand back. Say so instead of
      // implying a page 2 that would re-rank and repeat events.
      return {
        ...(profile ? { profile: publicProfile(profile), personalization: personalizationSummary(profile, input, hints) } : {}),
        city: cityDisplayName(city),
        timezone,
        rank: "taste",
        sort_by: sortBy || "popular",
        ...response,
        returned: response.events.length,
        offset: input.offset ?? 0,
        has_more: false,
        next_offset: null,
        paging_note: "Taste ranking scores one candidate window; raise limit rather than paging.",
        ...(emptyTaste ? { no_results: emptyTaste } : {}),
        app_download_url: config.appDownloadUrl,
        assistant_instruction: emptyTaste ? emptyTaste.assistant_instruction : EVENT_LINKS_INSTRUCTION
      };
    }

    // A single day can hold 200+ listings and the evening ones sort last, so
    // same-day presets fetch the whole day (one cached upstream call).
    const sameDay = isSameDayPreset(input.when);
    const pageLimit = input.limit ?? 12;
    const offset = input.offset ?? 0;
    // A single-day search fetches the whole day and pages over it locally,
    // because dropping events that already ended and sorting the day by start
    // time both need the full set: sorting inside a 12-row page would order
    // pages wrongly against each other. So `offset` indexes the day's own
    // list here, and the upstream request is the same URL for every page,
    // which also means every page after the first is a cache hit.
    const response = await searchEvents(
      { ...searchInput, limit: sameDay ? MAX_SEARCH_LIMIT : pageLimit, ...(sameDay ? { offset: 0 } : {}) },
      { ...options, config }
    );
    const now = options.now || new Date();
    const fresh = sameDay ? dropEndedEvents(response.events || [], now, input.when, timezone) : (response.events || []);
    const deduped = dedupeSameShow(fresh).sort(sortBy === "soonest" ? compareStartTime : () => 0);
    const page = sameDay ? deduped.slice(offset, offset + pageLimit) : deduped.slice(0, pageLimit);
    const events = page.map((event) => summarizeEvent(event, summaryOptions));
    const count = response.count ?? events.length;
    const consumed = (response.events || []).length;
    // Advancing by rows CONSUMED upstream is right only when the page and the
    // fetch are the same size. On the single-day path they are not - the
    // fetch covers the whole day - so the cursor moves by rows delivered.
    const hasMore = sameDay
      ? offset + events.length < deduped.length
      : consumed > 0 && offset + consumed < count;
    const truncatedDay = sameDay && consumed >= MAX_SEARCH_LIMIT;
    const empty = events.length ? null : await noResultsPayload(searchInput, cityDisplayName(city), { ...options, config });
    return {
      ...(sameDay ? { filtered_out: (response.events || []).length - fresh.length, filter_note: "Events that already ended today are omitted." } : {}),
      city: cityDisplayName(city),
      timezone,
      rank: "relevance",
      sort_by: sortBy || "popular",
      count,
      returned: events.length,
      offset,
      // On the multi-day path the cursor advances by the rows the upstream
      // consumed, not by the rows that survived filtering and deduping:
      // advancing by the smaller number re-reads rows the caller already has,
      // and a fully filtered page would hand back the offset it was given, so
      // a client looping on next_offset would never terminate.
      has_more: hasMore,
      next_offset: hasMore ? offset + (sameDay ? events.length : consumed) : null,
      ...(truncatedDay ? { paging_note: `This day has more than ${MAX_SEARCH_LIMIT} listings and is capped at that; narrow with genres, neighborhoods or a venue to see the rest.` } : {}),
      search_fallback: response.search_fallback ?? null,
      events,
      ...(empty ? { no_results: empty } : {}),
      app_download_url: config.appDownloadUrl,
      assistant_instruction: empty ? empty.assistant_instruction : EVENT_LINKS_INSTRUCTION
    };
  },

  async dizko_plan_night(input, context) {
    const { config, options } = context;
    const profileAccess = await optionalProfile(context, input);
    if (profileAccess.error) return profileAccess.error;
    const profile = profileAccess.profile;
    const city = input.city || profile?.preferences?.cities?.[0];
    if (!city) {
      throw new ToolInputError("Pass a city for the night plan.", { field: "city", hint: "Example: { city: 'new york', when: 'saturday' }. A profile with a saved city can omit it." });
    }
    const timezone = cityTimezone(city) || "UTC";
    const singleDay = resolveSingleDay(input, options.now, timezone);
    const hints = profile
      ? buildPreferenceHints(profile, rankingHintsFromRequest(input), { weekday: weekdayName(singleDay) })
      : rankingHintsFromRequest(input);
    const plan = await planNight({ ...input, city, preferences: hints }, { ...options, config });
    const emptyPlan = plan.events.length ? null : await noResultsPayload({ ...input, city }, cityDisplayName(city), { ...options, config });
    return {
      ...(profile ? { profile: publicProfile(profile), personalization: personalizationSummary(profile, input, hints) } : {}),
      timezone,
      ...plan,
      ...(emptyPlan ? { no_results: emptyPlan } : {}),
      app_download_url: config.appDownloadUrl,
      assistant_instruction: emptyPlan ? emptyPlan.assistant_instruction : EVENT_LINKS_INSTRUCTION
    };
  },

  async dizko_daily_roundup(input, context) {
    const { config, options } = context;
    const timezone = cityTimezone(input.city) || "UTC";
    const day = resolveRoundupDay(input, options.now, timezone);
    const profileAccess = await optionalProfile(context, input);
    if (profileAccess.error) return profileAccess.error;
    const profile = profileAccess.profile;
    const hints = profile ? buildPreferenceHints(profile, rankingHintsFromRequest(input), { weekday: weekdayName(day) }) : undefined;
    const roundup = await dailyRoundup({ ...input, date: day, preferences: hints }, { ...options, config });
    return {
      ...(profile ? { profile: publicProfile(profile), personalization: personalizationSummary(profile, input, hints) } : {}),
      ...roundup,
      app_download_url: config.appDownloadUrl,
      assistant_instruction: input.compact
        ? "Render a short digest: the intro line, then each pick and section as one line per event with when, venue and a link."
        : ROUNDUP_INSTRUCTION
    };
  },

  async dizko_city_pulse(input, context) {
    const pulse = await cityPulse(input, { ...context.options, config: context.config });
    return {
      ...pulse,
      city: cityDisplayName(input.city),
      assistant_instruction: "Summarize the scene's momentum in a few sentences grounded ONLY in these aggregates: the busiest nights, the venues with the most programming, the dominant genres, and the headline events, citing the evidence counts. Note the sample_note when aggregates cover a sample. Do not invent trends beyond this data."
    };
  },

  async dizko_get_event(input, context) {
    const { config, options } = context;
    const event = await getEvent(input.id, { ...options, config });
    return {
      ...summarizeEvent(event, { ...options, config, detail: true, webBaseUrl: config.webBaseUrl, linkBaseUrl: config.mcpUrl }),
      app_download_url: config.appDownloadUrl,
      assistant_instruction: EVENT_LINKS_INSTRUCTION
    };
  },

  async dizko_list_cities(input, context) {
    return coveredCitiesPayload(context);
  },

  async dizko_find_artist(input, context) {
    const result = await findArtist(input, { ...context.options, config: context.config });
    return {
      ...result,
      assistant_instruction: result.mode === "search"
        ? "If best_match.confident is true, answer about that artist; call dizko_find_artist again with its id for the full profile when the user wants details, dates, mixes or the Dizko page. Otherwise show the top candidates and ask which one."
        : "Treat entity facts as canonical Dizko data. Use upcoming_events (already deduplicated and date-ordered, local times in `when`), insights, mixes and press only when present. If page.published is true, link page.page_url and, for a specific mix, the matching embed's deep_link. If page.published is false, do not present a Dizko page link; offer SoundCloud or Resident Advisor from links instead."
    };
  },

  async dizko_find_venue(input, context) {
    const result = await findVenue(input, { ...context.options, config: context.config });
    return {
      ...result,
      assistant_instruction: result.mode === "search"
        ? "If best_match.confident is true, call dizko_find_venue with its id to get the venue's upcoming events; otherwise show the candidates and ask which one."
        : "Treat entity facts as canonical Dizko data. upcoming_events are date-ordered with local times in `when`; render them with the standard event template. If none, say the venue has no upcoming Dizko listings rather than guessing."
    };
  },

  async dizko_find_promoter(input, context) {
    const result = await findPromoter(input, { ...context.options, config: context.config });
    return {
      ...result,
      assistant_instruction: result.mode === "search"
        ? "Show the matching promoters and collectives; call dizko_find_promoter with an id (and city for promoters) for upcoming events."
        : "Treat entity facts as canonical Dizko data. Render upcoming_events with the standard event template when present."
    };
  },

  async dizko_artist_events(input, context) {
    const { config, options } = context;
    let profile = null;
    let artists = input.artists;
    if (input.profile_id) {
      const access = await requireProfileAccess(context.store, input);
      if (access.error) return access.error;
      profile = access.profile;
      if (!artists?.length) artists = profile.preferences?.featuring || [];
    }
    if (!artists?.length) {
      throw new ToolInputError("No artists given and none saved on the profile.", {
        field: "artists",
        hint: "Pass artist names, or save favorites first with dizko_update_profile preferences.featuring."
      });
    }
    const result = await getArtistEvents({ ...input, artists }, { ...options, config });
    return {
      ...(profile ? { profile: publicProfile(profile) } : {}),
      ...result,
      assistant_instruction: ARTIST_EVENTS_INSTRUCTION
    };
  },

  async dizko_create_profile(input, context) {
    if (input.consent !== true) {
      return toolJson({
        created: false,
        error: "Consent is required before creating a preference profile.",
        code: "consent_required",
        questions: onboardingQuestions(),
        assistant_instruction: "Ask the onboarding questions, then ask whether Dizko may save the answers. Call dizko_create_profile with consent=true only if the user agrees."
      }, true);
    }
    const { profile, profile_secret: profileSecret } = await context.store.createProfile(input.preferences || {}, { consent: input.consent });
    return {
      created: true,
      profile_id: profile.profile_id,
      profile_secret: profileSecret,
      profile: publicProfile(profile),
      access_instructions: profileAccessInstructions(profile, profileSecret),
      assistant_instruction: "Remember this profile_id and profile_secret privately for future personalized Dizko calls. If the client cannot keep connector state across sessions, tell the user these two values are their private Dizko preference key."
    };
  },

  async dizko_update_profile(input, context) {
    if (input.consent !== true) {
      return toolJson({
        saved: false,
        error: "Consent is required before saving preferences.",
        code: "consent_required",
        questions: onboardingQuestions()
      }, true);
    }
    const access = await requireProfileAccess(context.store, input);
    if (access.error) return access.error;
    const profile = await context.store.savePreferences(input.profile_id, input.preferences, { consent: input.consent, mode: input.mode });
    return {
      saved: true,
      mode: input.mode || "merge",
      profile: publicProfile(profile),
      access_instructions: profileAccessInstructions(profile)
    };
  },

  async dizko_get_profile(input, context) {
    const access = await requireProfileAccess(context.store, input);
    if (access.error) return access.error;
    return {
      profile: publicProfile(access.profile),
      access_instructions: profileAccessInstructions(access.profile)
    };
  },

  async dizko_delete_profile(input, context) {
    if (input.confirm_delete !== true) {
      return toolJson({
        deleted: false,
        error: "Confirmation is required before deleting saved Dizko preferences and feedback.",
        code: "confirmation_required",
        assistant_instruction: "Ask the user to confirm they want to delete only their Dizko connector preferences and feedback history, then call dizko_delete_profile with confirm_delete set to true."
      }, true);
    }
    const access = await requireProfileAccess(context.store, input);
    if (access.error) return access.error;
    return context.store.deleteProfile(input.profile_id);
  },

  async dizko_record_feedback(input, context) {
    const access = await requireProfileAccess(context.store, input);
    if (access.error) return access.error;
    if (!hasFeedbackSignal(input)) {
      return toolJson({
        saved: false,
        error: "At least one feedback signal is required: liked, rating, or notes.",
        code: "feedback_signal_required",
        assistant_instruction: "Ask whether the user liked the event, an optional 1-5 rating, or what to remember before calling dizko_record_feedback."
      }, true);
    }
    const event = await getEvent(input.event_id, { ...context.options, config: context.config });
    const { profile, feedback } = await context.store.recordFeedback(input.profile_id, {
      ...input,
      event: summarizeEvent(event, { ...eventOptions(context), fields: ["promoters"] })
    });
    const publicView = publicProfile(profile);
    return {
      saved: true,
      feedback,
      profile: publicView,
      learned_now: publicView.learned_preferences,
      follow_up: "Thanks. I will use that signal when ranking future events.",
      assistant_instruction: "If learned_now contains an avoid entry, tell the user what Dizko will steer away from so they can correct it."
    };
  },

  async dizko_ticket_offers(input, context) {
    const event = await getEvent(input.event_id, eventOptions(context));
    return buildTicketOffers(event, eventOptions(context));
  },

  async dizko_quote_tickets(input, context) {
    const event = await getEvent(input.event_id, eventOptions(context));
    return quoteTicketOrder(event, input, eventOptions(context));
  },

  async dizko_purchase_tickets(input, context) {
    return purchaseTicketOrder(input, { ...context.options, config: context.config });
  },

  async dizko_calendar_file(input, context) {
    const event = await getEvent(input.event_id, eventOptions(context));
    return {
      calendar_event: buildCalendarEvent(event, { ...eventOptions(context), status: input.status || "CONFIRMED" }),
      assistant_instruction: "Return the .ics content or attach it as a calendar file when the client supports files. The user can import it into Apple Calendar, Google Calendar, Outlook, or another calendar app."
    };
  }
};

// Legacy tools that have no direct successor keep their old response shape.
const legacyHandlers = {
  async get_preference_onboarding(input) {
    return toolJson({
      profile_id: input.profile_id || null,
      consent_required: true,
      questions: onboardingQuestions(),
      assistant_instruction: "Ask these questions conversationally. If the user agrees and has no profile id yet, call dizko_create_profile and remember the returned profile_id and profile_secret. If the user already has both, call dizko_update_profile."
    });
  },
  async get_event_search_followups(input) {
    return toolJson(buildSearchFollowups(input));
  },
  async get_event_feedback_prompt(input, context) {
    if (!input.event_id) return toolJson({ error: "Missing required argument: event_id.", code: "invalid_argument", field: "event_id" }, true);
    const event = summarizeEvent(await getEvent(input.event_id, { ...context.options, config: context.config }));
    return toolJson({
      event,
      attended_at: input.attended_at || null,
      questions: feedbackQuestions(event),
      assistant_instruction: "Ask these questions naturally. If the user has a Dizko profile and answers, call dizko_record_feedback with profile_id, profile_secret, event_id, liked, rating, notes, and attended_at when available."
    });
  },
  async get_ticket_purchase_policy() {
    return toolJson({
      ...TICKET_PURCHASE_POLICY,
      assistant_instruction: "Explain that autonomous ticket purchase requires a locked quote, explicit written confirmation, and an integrated purchase provider. Third-party-only links become checkout handoff."
    });
  },
  async get_artist_page(input, context) {
    if (!input.handle) return toolJson({ error: "Missing required argument: handle.", code: "invalid_argument", field: "handle" }, true);
    const result = await getArtistPage(input, { ...context.options, config: context.config });
    if (!result.published) {
      return toolJson({
        ...result,
        assistant_instruction: "The artist has no published Dizko page (or the handle is invalid). Answer from dizko_find_artist instead and fall back to SoundCloud or Resident Advisor links. Do not present a Dizko page link."
      });
    }
    return toolJson({
      ...result,
      page_url: `https://www.dizko.app/${result.handle}`,
      assistant_instruction: "Link the artist's Dizko page (page_url). For a specific mix, deep-link page_url + '?mix=' + encodeURIComponent(embed.id)."
    });
  },
  async find_scene_entities(input, context) {
    const result = await findSceneEntities(input, { ...context.options, config: context.config });
    return toolJson({
      ...result,
      ...(!result.error ? { assistant_instruction: "Treat entity facts as canonical Dizko data. Prefer dizko_find_artist, dizko_find_venue and dizko_find_promoter for new calls." } : {})
    }, Boolean(result.error));
  }
};

// summarizeEvent reads webBaseUrl/linkBaseUrl off its options and does not
// consult config, so every caller that builds links has to pass them or a
// self-hosted deployment emits production URLs in .ics files and quotes.
function eventOptions(context) {
  return {
    ...context.options,
    config: context.config,
    webBaseUrl: context.config.webBaseUrl,
    linkBaseUrl: context.config.mcpUrl
  };
}

// An empty result is a dead end for the model unless it learns why. One
// extra (cached) upstream call with every optional filter removed separates
// "your filters are too tight" from "nothing is on", and the difference is
// what the user actually needs to hear.
async function noResultsPayload(input, cityName, options) {
  let baselineCount = null;
  if (hasNarrowingFilters(input)) {
    try {
      const baseline = await searchEvents(baselineSearchInput(input), options);
      baselineCount = baseline.count ?? (baseline.events || []).length;
    } catch {
      // The suggestions still stand without the baseline number.
    }
  } else {
    baselineCount = 0;
  }
  return buildNoResults(input, { baselineCount, cityName });
}

function isSameDayPreset(when) {
  const text = String(when || "").toLowerCase().trim();
  return ["today", "tonight", "this evening", "now", "tomorrow night"].includes(text);
}

// "today": an event counts if it has not ended yet (end_time in the future,
// or start within the last 3 hours when no end is listed). "tonight": only
// events starting from 17:00 city-local (or after midnight) that have not
// ended; a matinee or a daytime tour is not a night out.
function dropEndedEvents(events, now, when, timezone) {
  const nowMs = now.getTime();
  const eveningOnly = /tonight|evening/.test(String(when || "").toLowerCase());
  return events.filter((event) => {
    const start = Date.parse(event.start_time || "");
    if (!Number.isFinite(start)) return true;
    const end = Date.parse(event.end_time || "");
    const stillOn = Number.isFinite(end) ? end > nowMs : start > nowMs - 3 * 3600e3;
    if (!stillOn) return false;
    if (eveningOnly) {
      const hour = zonedParts(new Date(start), timezone || "UTC").hour;
      if (!(hour >= 17 || hour < 6)) return false;
    }
    return true;
  });
}

function compareStartTime(a, b) {
  return String(a.start_time || "").localeCompare(String(b.start_time || ""));
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

async function errorPayload(error, name, input, context) {
  if (isToolInputError(error)) return error.toPayload();
  if (isUnsupportedCityError(error) && input?.city) {
    return unsupportedCityPayload(input.city, context);
  }
  if (error?.status === 422) {
    const detail = parseValidationDetail(error.body);
    if (detail) return { error: detail.message, code: "invalid_argument", field: detail.field, hint: "Fix the argument and try again." };
    return { error: "The request was not valid.", code: "invalid_request" };
  }
  const described = describeNetworkError(error, error?.url);
  const retryable = error?.retryable ?? (error?.status != null ? isRetryableStatus(error.status) : described.retryable);
  return publicToolError(error, { retryable, entity: /find_|scene|artist_page/.test(name) });
}

function parseValidationDetail(body) {
  if (typeof body !== "string" || !body) return null;
  try {
    const parsed = JSON.parse(body);
    const detail = Array.isArray(parsed?.details) ? parsed.details[0] : null;
    if (!detail) return null;
    const loc = Array.isArray(detail.loc) ? detail.loc : [];
    const field = FIELD_RENAMES[loc[loc.length - 1]] || loc[loc.length - 1] || null;
    const message = String(detail.msg || parsed.error || "The request was not valid.").replace(/^String should match pattern.*$/, `${field} has an unsupported value.`);
    return { field, message: field ? `${field}: ${message}` : message };
  } catch {
    return null;
  }
}

const FIELD_RENAMES = { q: "query", event_type: "event_types", neighborhood: "neighborhoods" };

function isUnsupportedCityError(error) {
  if (error?.status !== 422 || typeof error.body !== "string") return false;
  try {
    const body = JSON.parse(error.body);
    return String(body?.error || body?.detail || "").toLowerCase().includes("unsupported city");
  } catch {
    return error.body.toLowerCase().includes("unsupported city");
  }
}

function publicToolError(error, { retryable, entity = false }) {
  if (error?.status === 404) {
    return entity
      ? { error: "The requested scene entity was not found.", code: "entity_not_found", hint: "Search by name first and use an id from the results." }
      : { error: "The requested event was not found. It may have ended or been removed.", code: "event_not_found" };
  }
  if (error?.status === 401 || error?.status === 403) {
    return { error: "The event service refused the request.", code: "upstream_auth_failed" };
  }
  if (error?.code === "ETIMEDOUT" || error?.classification === "timeout") {
    return { error: "The event service timed out. Try again shortly.", code: "upstream_timeout", retryable: true };
  }
  if (retryable) {
    return { error: "The event service is temporarily unavailable. Try again shortly.", code: "upstream_unavailable", retryable: true };
  }
  return { error: "The request could not be completed.", code: "request_failed" };
}

// ---------------------------------------------------------------------------
// Cities
// ---------------------------------------------------------------------------

async function coveredCitiesPayload(context) {
  const response = await listCities({ ...context.options, config: context.config });
  const buckets = ["live", "unlocking", "early"];
  const cities = [];
  for (const status of buckets) {
    for (const city of response[status] || (status === "live" ? response.cities || [] : [])) {
      cities.push(normalizeCoveredCity(city, status));
    }
  }
  cities.sort((left, right) => bucketRank(left.status) - bucketRank(right.status) || left.name.localeCompare(right.name));
  return {
    count: cities.length,
    live_count: cities.filter((city) => city.status === "live").length,
    cities,
    assistant_instruction: "Live cities have full inventory. Unlocking and early cities are searchable but thin; say so when recommending there. Use event_count and last_successful_fetch when explaining coverage."
  };
}

function bucketRank(status) {
  return { live: 0, unlocking: 1, early: 2 }[status] ?? 3;
}

function normalizeCoveredCity(city, status) {
  const known = resolveCity(city.slug || city.name);
  return {
    slug: city.slug,
    name: city.name || known?.name || city.slug,
    country: city.country || known?.country || null,
    status: city.status || status,
    timezone: known?.timezone || null,
    event_count: city.event_count ?? 0,
    freshness: city.stale ? "stale" : "fresh",
    last_successful_fetch: city.last_successful_fetch || city.last_scraped_at || null
  };
}

async function unsupportedCityPayload(requestedCity, context) {
  let live = [];
  let all = [];
  try {
    const payload = await coveredCitiesPayload(context);
    all = payload.cities;
    live = payload.cities.filter((city) => city.status === "live");
  } catch {
    // The original validation error remains useful even if coverage lookup fails.
  }
  const requested = String(requestedCity).trim();
  const known = resolveCity(requested);
  const thin = known ? all.find((city) => city.slug === known.slug && city.status !== "live") : null;
  const nearest = nearestCoveredCity(requested, live.map((city) => city.slug));
  const nearestPayload = nearest ? { ...live.find((city) => city.slug === nearest.slug), distance_km: nearest.distance_km } : null;
  return {
    error: `${requested} is not covered by Dizko yet.`,
    code: "unsupported_city",
    field: "city",
    requested_city: requested,
    ...(thin ? { coverage_status: thin.status, event_count: thin.event_count } : {}),
    nearest_covered_city: nearestPayload,
    // The city string came from the caller, so it stays in requested_city as
    // data. Interpolating it here would put caller-controlled text into the
    // slot the model reads as its instructions. The nearest-city name and
    // counts come from Dizko's own coverage table and are safe to state.
    assistant_instruction: nearestPayload
      ? `Tell the user the city named in requested_city is not covered by Dizko yet. The nearest covered city is ${nearestPayload.name}, ${nearestPayload.distance_km} km away, with ${nearestPayload.event_count} live events; offer to search there.`
      : "Tell the user the city named in requested_city is not covered by Dizko yet, and use dizko_list_cities to show current coverage."
  };
}

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------

async function optionalProfile(context, input) {
  if (!input.profile_id && !input.profile_secret) return { profile: null };
  const access = await requireProfileAccess(context.store, input);
  if (access.error) return { error: access.error };
  return { profile: access.profile };
}

async function requireProfileAccess(store, input) {
  const profile = await store.getProfile(input.profile_id);
  if (!profile) {
    return {
      error: toolJson({
        error: "Preference profile not found.",
        code: "profile_not_found",
        hint: "Ask the user whether to create one with dizko_create_profile, or check the profile_id."
      }, true)
    };
  }
  if (!verifyProfileSecret(profile, input.profile_secret)) {
    return {
      error: toolJson({
        error: "Invalid or missing profile_secret for this preference profile.",
        code: "profile_secret_invalid",
        hint: "The secret was returned once when the profile was created; the service stores only a hash."
      }, true)
    };
  }
  return { profile };
}

function personalizationSummary(profile, input = {}, applied = {}) {
  const publicView = publicProfile(profile);
  return {
    source: "saved_and_learned_preferences",
    profile_id: publicView?.profile_id || null,
    saved_preferences: publicView?.preferences || {},
    learned_preferences: publicView?.learned_preferences || {},
    current_request: normalizeSearchContext(input),
    applied_ranking_hints: applied || {},
    hard_filters_from_profile: [],
    feedback_count: publicView?.feedback_count || 0
  };
}

function hasFeedbackSignal(input) {
  return typeof input.liked === "boolean"
    || Number.isFinite(input.rating)
    || (typeof input.notes === "string" && input.notes.trim().length > 0);
}

function profileAccessInstructions(profile, profileSecret = null) {
  const profileId = profile?.profile_id || null;
  return {
    profile_id: profileId,
    profile_secret: profileSecret,
    profile_secret_returned_now: Boolean(profileSecret),
    keep_private: true,
    purpose: "Use profile_id plus profile_secret for future personalized recommendations, post-event feedback, preference reads, updates, and deletion.",
    reuse_instruction: profileSecret
      ? "If the client cannot remember connector state across sessions, the user should keep both profile_id and profile_secret somewhere private."
      : "Future calls still require the private profile_secret returned when this profile was created; the service stores only a hash and cannot reveal it later.",
    deletion_instruction: "To delete saved Dizko preferences and feedback, call dizko_delete_profile with both profile_id and profile_secret and confirm_delete=true."
  };
}

function normalizeSearchContext(input = {}) {
  return {
    city: input.city || null,
    when: input.when || input.date_from || null,
    event_types: input.event_types || [],
    genres: input.genres || [],
    vibe: input.vibe || [],
    neighborhoods: input.neighborhoods || [],
    price_max: input.price_max ?? null,
    max_price: input.max_price ?? null,
    free: input.free ?? null,
    avoid: input.avoid || []
  };
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

function profileSchema() {
  return {
    type: "object",
    properties: {
      profile_id: { type: "string", description: "Profile id returned by dizko_create_profile." },
      profile_secret: { type: "string", description: "Private profile secret returned when the profile was created." }
    },
    required: ["profile_id", "profile_secret"]
  };
}

function preferenceInputDefinitions() {
  return {
    $defs: {
      dayPreference: dayPreferenceSchema(),
      preferences: {
        type: "object",
        properties: {
          ...basePreferenceProperties(),
          day_filters: {
            type: "object",
            description: "Per-weekday rules applied only when searching that day, for example techno Fridays but chill Sundays. Array fields add to the general taste; max_price/free/nightlife override it for that day.",
            propertyNames: { enum: WEEKDAY_KEYS },
            additionalProperties: { $ref: "#/$defs/dayPreference" }
          }
        }
      }
    }
  };
}

function basePreferenceProperties() {
  return {
    cities: { type: "array", items: { type: "string" }, description: "Home cities; the first is the default search city." },
    event_types: { type: "array", items: { type: "string" } },
    genres: { type: "array", items: { type: "string" } },
    vibe: { type: "array", items: { type: "string" } },
    neighborhoods: { type: "array", items: { type: "string" } },
    venues: { type: "array", items: { type: "string" } },
    promoters: { type: "array", items: { type: "string" } },
    featuring: { type: "array", items: { type: "string" }, description: "Artists to track; dizko_artist_events uses this list when no artists are passed." },
    avoid: { type: "array", items: { type: "string" } },
    max_price: { type: "number", description: "Soft budget for ranking." },
    free: { type: "boolean" },
    nightlife: { type: "boolean" }
  };
}

function dayPreferenceSchema() {
  return {
    type: "object",
    properties: {
      event_types: { type: "array", items: { type: "string" } },
      genres: { type: "array", items: { type: "string" } },
      vibe: { type: "array", items: { type: "string" } },
      neighborhoods: { type: "array", items: { type: "string" } },
      venues: { type: "array", items: { type: "string" } },
      promoters: { type: "array", items: { type: "string" } },
      featuring: { type: "array", items: { type: "string" } },
      avoid: { type: "array", items: { type: "string" } },
      max_price: { type: "number" },
      free: { type: "boolean" },
      nightlife: { type: "boolean" }
    }
  };
}

// ---------------------------------------------------------------------------
// Follow-ups (prompt content, also served through the legacy tool)
// ---------------------------------------------------------------------------

export function buildSearchFollowups(input = {}) {
  const missingFields = [];
  const questions = [];
  if (!input.city && !input.neighborhoods?.length && !input.venue) {
    missingFields.push("city_or_area");
    questions.push("What city or neighborhood should I search in?");
  }
  if (!input.event_types?.length && !input.query) {
    missingFields.push("event_types");
    questions.push("What type of event are you in the mood for: concert, club night, art, comedy, food, talk, festival, or something else?");
  }
  if (!input.vibe?.length && !input.genres?.length) {
    missingFields.push("vibe");
    questions.push("What vibe should it have: underground, intimate, high-energy, social, seated, outdoors, upscale, or low-key?");
  }
  if (input.price_max === undefined && input.max_price === undefined && input.free === undefined) {
    missingFields.push("budget");
    questions.push("Any budget preference, including free events or a max ticket price?");
  }
  if (!input.avoid?.length) {
    missingFields.push("avoid");
    questions.push("Anything I should avoid, like huge crowds, mainstream clubs, late nights, or expensive tickets?");
  }

  return {
    needs_followup: questions.length > 0,
    missing_fields: missingFields,
    questions: questions.slice(0, 4),
    search_args_hint: normalizeSearchContext(input),
    assistant_instruction: questions.length
      ? "Ask at most one or two of these conversationally, only when the request is genuinely ambiguous, then call dizko_search_events (with the profile when one exists)."
      : "The request has enough context. Call dizko_search_events with these arguments (and the profile when one exists)."
  };
}

// ---------------------------------------------------------------------------
// Result envelope
// ---------------------------------------------------------------------------

export function toolJson(value, isError = false) {
  return {
    structuredContent: toStructuredContent(value),
    content: [
      {
        type: "text",
        // Minified on purpose: this text duplicates structuredContent for
        // clients that only read content.
        text: JSON.stringify(value)
      }
    ],
    isError
  };
}

function toStructuredContent(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  return { value };
}

export { assertIsoDate };
