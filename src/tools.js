import { getEvent, listCities, searchEvents } from "./api.js";
import { getConfig } from "./config.js";
import { buildCalendarEvent } from "./calendar.js";
import { summarizeEvent } from "./format.js";
import { describeNetworkError, isRetryableStatus } from "./netError.js";
import { planNight, recommendEvents } from "./planner.js";
import { dailyRoundup, resolveRoundupDay } from "./roundup.js";
import { getArtistEvents } from "./artistEvents.js";
import { cityPulse } from "./cityPulse.js";
import { findSceneEntities } from "./entities.js";
import { resolveSingleDay, weekdayName } from "./dateRange.js";
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

export const EVENT_LINKS_INSTRUCTION = [
  "Render events as a markdown list with one block per event and each fact on its own line, using this template:",
  "**[<title>](<event_url>)**",
  "- When: <weekday, date, start time> · [Add to calendar](<calendar_url>)",
  "- Where: <venue>, <city> · [Get directions](<directions_url>)",
  "- What: <description, or genres/vibe tags if no description>",
  "- Price: <price> · [Tickets](<ticket_url>)",
  "Always link the event title to event_url (the Dizko event page), never to ticket_url. Make every link clickable markdown. Omit any line whose data is missing. Do not merge facts onto one line."
].join("\n");

const WEEKDAY_KEYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export const ROUNDUP_INSTRUCTION = [
  "Render a daily digest: one intro line naming the city, weekday, date, and total_available, then 'Top picks', then each section under its own heading in the given order. Render every event with the standard template:",
  EVENT_LINKS_INSTRUCTION
].join("\n");

const rawTools = [
  {
    name: "get_preference_onboarding",
    title: "Get Preference Onboarding",
    description: "Use this when a user wants consent-first questions before saving event preferences.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        profile_id: { type: "string", description: "Stable user/profile id if already known." }
      }
    },
    outputSchema: onboardingOutputSchema()
  },
  {
    name: "create_event_preference_profile",
    title: "Create Event Preference Profile",
    description: "Use this when a user agrees to create a saved Dizko preference profile.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      ...preferenceInputDefinitions(),
      type: "object",
      properties: {
        consent: { type: "boolean", description: "Must be true only after the user agreed to save preferences." },
        preferences: { $ref: "#/$defs/preferences" }
      },
      required: ["consent"]
    },
    outputSchema: profileCreateOutputSchema()
  },
  {
    name: "save_event_preferences",
    title: "Save Event Preferences",
    description: "Use this when a user wants to update a saved Dizko preference profile.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      ...preferenceInputDefinitions(),
      type: "object",
      properties: {
        profile_id: { type: "string", description: "Stable user/profile id." },
        profile_secret: { type: "string", description: "Private profile secret returned when the profile was created." },
        consent: { type: "boolean", description: "Must be true only after the user agreed to save preferences." },
        mode: { type: "string", enum: ["merge", "replace"], default: "merge" },
        preferences: { $ref: "#/$defs/preferences" }
      },
      required: ["profile_id", "profile_secret", "consent", "preferences"]
    },
    outputSchema: profileSaveOutputSchema()
  },
  {
    name: "get_event_preferences",
    title: "Get Event Preferences",
    description: "Use this when a user wants to view saved and learned event preferences.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: profileSchema(),
    outputSchema: profileReadOutputSchema()
  },
  {
    name: "delete_event_preferences",
    title: "Delete Event Preferences",
    description: "Use this only when a user asks to delete their Dizko saved event preferences and feedback history.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: deletePreferencesInputSchema(),
    outputSchema: deletePreferencesOutputSchema()
  },
  {
    name: "record_event_feedback",
    title: "Record Event Feedback",
    description: "Use this when a user wants Dizko to learn from their rating or notes about an event.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        profile_id: { type: "string" },
        profile_secret: { type: "string", description: "Private profile secret returned when the profile was created." },
        event_id: { type: "string" },
        liked: { type: "boolean" },
        rating: { type: "number", minimum: 1, maximum: 5 },
        notes: { type: "string" },
        attended_at: { type: "string", description: "ISO date/time or YYYY-MM-DD." }
      },
      required: ["profile_id", "profile_secret", "event_id"],
      anyOf: [
        { required: ["liked"] },
        { required: ["rating"] },
        { required: ["notes"] }
      ]
    },
    outputSchema: feedbackOutputSchema()
  },
  {
    name: "get_event_feedback_prompt",
    title: "Get Event Feedback Prompt",
    description: "Use this when a user needs a short post-event feedback prompt.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string" },
        attended_at: { type: "string", description: "Optional ISO date/time or YYYY-MM-DD the user attended or planned to attend." }
      },
      required: ["event_id"]
    },
    outputSchema: feedbackPromptOutputSchema()
  },
  {
    name: "get_event_search_followups",
    title: "Get Event Search Followups",
    description: "Use this when an event search needs follow-up questions.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: searchFollowupsInputSchema(),
    outputSchema: searchFollowupsOutputSchema()
  },
  {
    name: "list_cities",
    title: "List Covered Cities",
    description: "Use this when a user asks about Dizko city coverage or freshness.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "find_scene_entities",
    title: "Find Scene Entities",
    description: "Use this when a user asks who a DJ is or about a venue, collective, or promoter.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: sceneEntityInputSchema()
  },
  {
    name: "search_events",
    title: "Search Events",
    description: "Use this when a user wants live events matching filters, listed in backend order with no taste ranking. query is hybrid-ranked over event embeddings, so pass natural-language intent directly. Prefer recommend_events when the user wants advice on what to pick.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: eventSearchSchema(),
    outputSchema: eventsOutputSchema()
  },
  {
    name: "recommend_events",
    title: "Recommend Events",
    description: "Use this when a user wants search_events results reordered by taste stated in this conversation - genres, vibe, budget, avoidances - each returned with a recommendation_score and reasons. Prefer recommend_events_for_user when a saved profile exists.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: eventSearchSchema(),
    outputSchema: rankedEventsOutputSchema()
  },
  {
    name: "recommend_events_for_user",
    title: "Recommend Events For User",
    description: "Use this when a saved Dizko profile should rank the results, applying stored preferences and feedback learned across past sessions rather than only this conversation. Requires profile_id and profile_secret; without both, use recommend_events.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        profile_id: { type: "string" },
        profile_secret: { type: "string", description: "Private profile secret returned when the profile was created." },
        city: { type: "string" },
        when: { type: "string" },
        date_from: { type: "string" },
        date_to: { type: "string" },
        query: { type: "string" },
        event_types: { type: "array", items: { type: "string" } },
        genres: { type: "array", items: { type: "string" } },
        vibe: { type: "array", items: { type: "string" } },
        neighborhoods: { type: "array", items: { type: "string" } },
        venue: { type: "string" },
        featuring: { type: "string" },
        free: { type: "boolean" },
        nightlife: { type: "boolean" },
        avoid: { type: "array", items: { type: "string" } },
        max_price: { type: "number" },
        price_max: { type: "number" },
        limit: { type: "number", default: 50 },
        result_limit: { type: "number", default: 10 }
      },
      required: ["profile_id", "profile_secret"]
    },
    outputSchema: userRecommendationsOutputSchema()
  },
  {
    name: "plan_night",
    title: "Plan Night",
    description: "Use this when a user wants one night's itinerary rather than a list to browse: one primary event plus fallbacks that are nearby or later, each tagged with plan_role and distance_from_primary_km.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: planNightInputSchema(),
    outputSchema: planOutputSchema()
  },
  {
    name: "get_daily_roundup",
    title: "Get Daily Roundup",
    description: "Use this when a user wants a whole day surveyed rather than a query answered - a briefing, morning update or scheduled check-in - returned as ranked top_picks plus events grouped into typed sections.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: roundupInputSchema(),
    outputSchema: roundupOutputSchema()
  },
  {
    name: "get_artist_events",
    title: "Get Artist Events",
    description: "Use this when a user wants upcoming events for named artists or artists saved in a Dizko profile.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: artistEventsInputSchema(),
    outputSchema: artistEventsOutputSchema()
  },
  {
    name: "get_city_pulse",
    title: "Get City Pulse",
    description: "Use this when a user wants a city's busiest nights, top venues, genre mix, and headline events.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: cityPulseInputSchema(),
    outputSchema: cityPulseOutputSchema()
  },
  {
    name: "get_event",
    title: "Get Event",
    description: "Use this when a user asks for details about a Dizko event id.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Event id." }
      },
      required: ["id"]
    },
    outputSchema: withError({
      ...eventSummarySchema(),
      properties: {
        ...eventSummarySchema().properties,
        app_download_url: { type: "string", description: "Dizko iPhone app landing page." },
        assistant_instruction: { type: "string" }
      }
    })
  },
  {
    name: "get_ticket_purchase_policy",
    title: "Get Ticket Purchase Policy",
    description: "Use this when a user asks how Dizko agents can buy tickets.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {}
    },
    outputSchema: ticketPolicyOutputSchema()
  },
  {
    name: "get_ticket_offers",
    title: "Get Ticket Offers",
    description: "Use this when a user wants ticket options for a specific Dizko event before quoting or buying.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "Event id returned by search, recommendations, plan_night, or get_event." }
      },
      required: ["event_id"]
    },
    outputSchema: ticketOffersOutputSchema()
  },
  {
    name: "quote_ticket_order",
    title: "Quote Ticket Order",
    description: "Use this when a user wants a locked ticket quote before purchase.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    },
    inputSchema: ticketQuoteInputSchema(),
    outputSchema: ticketQuoteOutputSchema()
  },
  {
    name: "purchase_ticket_order",
    title: "Purchase Ticket Order",
    description: "Use this when a user confirms a locked quote for purchase or checkout handoff.",
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    },
    inputSchema: ticketPurchaseInputSchema(),
    outputSchema: ticketPurchaseOutputSchema()
  },
  {
    name: "create_event_calendar_file",
    title: "Create Event Calendar File",
    description: "Use this when a user wants to add a Dizko event to their calendar after choosing or buying tickets.",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    },
    inputSchema: {
      type: "object",
      properties: {
        event_id: { type: "string", description: "Event id returned by search, recommendations, plan_night, get_event, or a ticket quote." },
        status: { type: "string", description: "Calendar status, for example CONFIRMED or TENTATIVE." }
      },
      required: ["event_id"]
    },
    outputSchema: calendarEventOutputSchema()
  }
];

export const tools = rawTools.map(publicToolDefinition);

function publicToolDefinition(tool) {
  const { outputSchema: _outputSchema, ...definition } = tool;
  return withNoAuthSecurity({
    ...definition,
    inputSchema: compactInputSchema(definition.inputSchema)
  });
}

function compactInputSchema(value) {
  if (Array.isArray(value)) return value.map(compactInputSchema);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== "description" && key !== "default")
    .map(([key, child]) => [key, compactInputSchema(child)]));
}

function withNoAuthSecurity(tool) {
  const securitySchemes = [{ type: "noauth" }];
  const {
    idempotentHint: _idempotentHint,
    destructiveHint,
    ...baseAnnotations
  } = tool.annotations || {};
  const annotations = {
    ...baseAnnotations,
    ...(!baseAnnotations.readOnlyHint ? { destructiveHint } : {})
  };
  return {
    ...tool,
    annotations,
    securitySchemes,
    _meta: {
      ...(tool._meta || {}),
      securitySchemes,
      "openai/toolInvocation/invoking": "Working",
      "openai/toolInvocation/invoked": "Ready"
    }
  };
}

export async function callTool(name, input = {}, options = {}) {
  const validationError = validateRequiredArguments(name, input);
  if (validationError) return toolJson(validationError, true);
  const store = options.preferenceStore || new FilePreferenceStore(options.preferencesPath);
  try {
    switch (name) {
    case "get_preference_onboarding":
      return toolJson({
        profile_id: input.profile_id || null,
        consent_required: true,
        questions: onboardingQuestions(),
        assistant_instruction: "Ask these questions conversationally. If the user agrees and has no profile id yet, call create_event_preference_profile and remember the returned profile_id and profile_secret. If the user already has both, call save_event_preferences."
      });
    case "create_event_preference_profile": {
      if (input.consent !== true) {
        return toolJson({
          created: false,
          error: "Consent is required before creating a preference profile.",
          questions: onboardingQuestions()
        }, true);
      }
      const { profile, profile_secret: profileSecret } = await store.createProfile(input.preferences || {}, { consent: input.consent });
      return toolJson({
        created: true,
        profile: publicProfile(profile),
        profile_secret: profileSecret,
        access_instructions: profileAccessInstructions(profile, profileSecret),
        assistant_instruction: "Remember this profile_id and profile_secret for future Dizko personalized event recommendations. Tell the user these credentials are their private Dizko preference key if their client cannot remember connector state across sessions."
      });
    }
    case "save_event_preferences": {
      if (input.consent !== true) {
        return toolJson({
          saved: false,
          error: "Consent is required before saving preferences.",
          questions: onboardingQuestions()
        }, true);
      }
      const access = await requireProfileAccess(store, input);
      if (access.error) return access.error;
      const profile = await store.savePreferences(input.profile_id, input.preferences, {
        consent: input.consent,
        mode: input.mode
      });
      return toolJson({
        saved: true,
        profile: publicProfile(profile),
        access_instructions: profileAccessInstructions(profile)
      });
    }
    case "get_event_preferences": {
      const access = await requireProfileAccess(store, input);
      if (access.error) return access.error;
      return toolJson({
        profile: publicProfile(access.profile),
        access_instructions: profileAccessInstructions(access.profile)
      });
    }
    case "delete_event_preferences": {
      if (input.confirm_delete !== true) {
        return toolJson({
          deleted: false,
          error: "Confirmation is required before deleting saved Dizko preferences and feedback.",
          assistant_instruction: "Ask the user to confirm they want to delete only their Dizko connector preferences and feedback history, then call delete_event_preferences with confirm_delete set to true."
        }, true);
      }
      const access = await requireProfileAccess(store, input);
      if (access.error) return access.error;
      return toolJson(await store.deleteProfile(input.profile_id));
    }
    case "record_event_feedback": {
      const access = await requireProfileAccess(store, input);
      if (access.error) return access.error;
      if (!hasFeedbackSignal(input)) {
        return toolJson({
          saved: false,
          error: "At least one feedback signal is required: liked, rating, or notes.",
          assistant_instruction: "Ask whether the user liked the event, an optional 1-5 rating, or what to remember before calling record_event_feedback."
        }, true);
      }
      const event = await getEvent(input.event_id, options);
      const { profile, feedback } = await store.recordFeedback(input.profile_id, {
        ...input,
        event: summarizeEvent(event)
      });
      return toolJson({
        saved: true,
        feedback,
        profile: publicProfile(profile),
        follow_up: "Thanks. I will use that signal when ranking future events."
      });
    }
    case "get_event_feedback_prompt": {
      const event = summarizeEvent(await getEvent(input.event_id, options));
      return toolJson({
        event,
        attended_at: input.attended_at || null,
        questions: [
          `Did you end up going to ${event.title}?`,
          "Did you like it overall?",
          "What should I remember for future recommendations: music, crowd, venue, price, timing, or anything to avoid?",
          "If you want, give it a 1-5 rating."
        ],
        assistant_instruction: "Ask these questions naturally. If the user has a Dizko profile and answers, call record_event_feedback with profile_id, profile_secret, event_id, liked, rating, notes, and attended_at when available."
      });
    }
    case "get_event_search_followups":
      return toolJson(buildSearchFollowups(input));
    case "list_cities":
      return toolJson(await coveredCitiesPayload(options));
    case "find_scene_entities": {
      const result = await findSceneEntities(input, options);
      return toolJson({
        ...result,
        ...(!result.error ? {
          assistant_instruction: "Treat entity facts as canonical Dizko data. For profile results, mention upcoming events and related entities only when those fields are present."
        } : {})
      }, Boolean(result.error));
    }
    case "search_events": {
      const config = { ...getConfig(options.env), ...(options.config || {}) };
      const response = await searchEvents(input, { ...options, config });
      return toolJson({
        count: response.count ?? response.events?.length ?? 0,
        events: (response.events || []).map((event) => summarizeEvent(event, { webBaseUrl: config.webBaseUrl, linkBaseUrl: config.mcpUrl })),
        app_download_url: config.appDownloadUrl,
        assistant_instruction: EVENT_LINKS_INSTRUCTION
      });
    }
    case "recommend_events": {
      const config = { ...getConfig(options.env), ...(options.config || {}) };
      return toolJson({
        ...await recommendEvents(input, { ...options, config }),
        app_download_url: config.appDownloadUrl,
        assistant_instruction: EVENT_LINKS_INSTRUCTION
      });
    }
    case "recommend_events_for_user": {
      const access = await requireProfileAccess(store, input);
      if (access.error) return access.error;
      const profile = access.profile;
      if (!profile?.consent) {
        return toolJson({
          onboarding_needed: true,
          questions: onboardingQuestions(),
          message: "Ask the user about their general event preferences and whether Dizko may save them before personalized recommendations can learn over time."
        });
      }
      const config = { ...getConfig(options.env), ...(options.config || {}) };
      const preferences = buildPreferenceHints(profile, input, {
        weekday: weekdayName(resolveSingleDay(input, options.now))
      });
      const response = await recommendEvents(personalizedSearchInput(input, preferences), { ...options, config });
      return toolJson({
        profile: publicProfile(profile),
        personalization: personalizationSummary(profile, input, preferences),
        ...response,
        app_download_url: config.appDownloadUrl,
        assistant_instruction: EVENT_LINKS_INSTRUCTION
      });
    }
    case "plan_night": {
      const config = { ...getConfig(options.env), ...(options.config || {}) };
      if (input.profile_id || input.profile_secret) {
        const access = await requireProfileAccess(store, input);
        if (access.error) return access.error;
        const profile = access.profile;
        const preferences = buildPreferenceHints(profile, input, {
          weekday: weekdayName(resolveSingleDay(input, options.now))
        });
        return toolJson({
          profile: publicProfile(profile),
          personalization: personalizationSummary(profile, input, preferences),
          ...await planNight(personalizedSearchInput(input, preferences), { ...options, config }),
          app_download_url: config.appDownloadUrl,
          assistant_instruction: EVENT_LINKS_INSTRUCTION
        });
      }
      return toolJson({
        ...await planNight(input, { ...options, config }),
        app_download_url: config.appDownloadUrl,
        assistant_instruction: EVENT_LINKS_INSTRUCTION
      });
    }
    case "get_daily_roundup": {
      const day = resolveRoundupDay(input, options.now);
      if (input.profile_id || input.profile_secret) {
        const access = await requireProfileAccess(store, input);
        if (access.error) return access.error;
        const profile = access.profile;
        const preferences = buildPreferenceHints(profile, input, { weekday: weekdayName(day) });
        const roundup = await dailyRoundup({ ...input, date: day, preferences }, options);
        return toolJson({
          profile: publicProfile(profile),
          personalization: personalizationSummary(profile, input, preferences),
          ...roundup,
          assistant_instruction: ROUNDUP_INSTRUCTION
        });
      }
      return toolJson({
        ...await dailyRoundup({ ...input, date: day }, options),
        assistant_instruction: ROUNDUP_INSTRUCTION
      });
    }
    case "get_artist_events": {
      let profile = null;
      let artists = input.artists;
      if (input.profile_id || input.profile_secret) {
        const access = await requireProfileAccess(store, input);
        if (access.error) return access.error;
        profile = access.profile;
        if (!artists?.length) artists = profile.preferences?.featuring || [];
      }
      if (!artists?.length) {
        return toolJson({
          artists: [],
          not_found: [],
          error: "No artists given and none saved. Pass artists, or save favorites first via save_event_preferences featuring.",
          assistant_instruction: "Ask which DJs, performers, or comedians to track, then call get_artist_events with those names. Offer to save them to the profile's featuring list for future automatic tracking."
        }, true);
      }
      const result = await getArtistEvents({ ...input, artists }, options);
      const payload = profile
        ? { profile: publicProfile(profile), ...result }
        : result;
      return toolJson({
        ...payload,
        assistant_instruction: [
          "Group the answer by artist, one heading per artist with their upcoming events under it. Mention artists in not_found as having no upcoming listed dates. Render every event with the standard template:",
          EVENT_LINKS_INSTRUCTION
        ].join("\n")
      });
    }
    case "get_city_pulse":
      return toolJson({
        ...await cityPulse(input, options),
        assistant_instruction: "Summarize the scene's momentum in a few sentences grounded ONLY in these aggregates: name the busiest nights, the venues with the most programming, the dominant genres, and the headline events, citing the evidence counts. Note the sample_note when aggregates cover a sample. Do not invent trends beyond this data."
      });
    case "get_event": {
      const config = { ...getConfig(options.env), ...(options.config || {}) };
      return toolJson({
        ...summarizeEvent(await getEvent(input.id, { ...options, config }), { webBaseUrl: config.webBaseUrl, linkBaseUrl: config.mcpUrl }),
        app_download_url: config.appDownloadUrl,
        assistant_instruction: EVENT_LINKS_INSTRUCTION
      });
    }
    case "get_ticket_purchase_policy":
      return toolJson({
        ...TICKET_PURCHASE_POLICY,
        assistant_instruction: "Explain that autonomous ticket purchase requires a locked quote, explicit written confirmation, and an integrated purchase provider such as Hermes, OpenClaw, Dizko Checkout, a partner API, or delegated payment. Third-party-only links become checkout handoff."
      });
    case "get_ticket_offers": {
      const event = await getEvent(input.event_id, options);
      return toolJson(buildTicketOffers(event, options));
    }
    case "quote_ticket_order": {
      const event = await getEvent(input.event_id, options);
      return toolJson(quoteTicketOrder(event, input, options));
    }
    case "purchase_ticket_order":
      return toolJson(await purchaseTicketOrder(input, options));
    case "create_event_calendar_file": {
      const event = await getEvent(input.event_id, options);
      return toolJson({
        calendar_event: buildCalendarEvent(event, { ...options, status: input.status || "CONFIRMED" }),
        assistant_instruction: "Return the .ics content or attach it as a calendar file when the client supports files. The user can import it into Apple Calendar, Google Calendar, Outlook, or another calendar app."
      });
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    if (isUnsupportedCityError(error) && input.city) {
      return toolJson(await unsupportedCityPayload(input.city, options), true);
    }
    const described = describeNetworkError(error, error.url);
    const retryable = error.retryable ?? (error.status != null ? isRetryableStatus(error.status) : described.retryable);
    return toolJson(publicToolError(error, { retryable, described, entity: name === "find_scene_entities" }), true);
  }
}

function validateRequiredArguments(name, input) {
  const tool = rawTools.find((candidate) => candidate.name === name);
  if (!tool) return { error: "The requested tool does not exist.", code: "unknown_tool" };
  const missing = (tool.inputSchema.required || []).filter((key) => {
    const value = input?.[key];
    return value === undefined || value === null || (typeof value === "string" && !value.trim());
  });
  if (!missing.length) return null;
  return {
    error: `Missing required argument${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    code: "missing_required_argument"
  };
}

function isUnsupportedCityError(error) {
  if (error?.status !== 422 || typeof error.body !== "string") return false;
  try {
    const body = JSON.parse(error.body);
    return String(body?.error || body?.detail || "").toLowerCase().includes("unsupported city");
  } catch {
    return error.body.toLowerCase().includes("unsupported city");
  }
}

async function coveredCitiesPayload(options = {}) {
  const response = await listCities(options);
  const cities = (response.live || response.cities || [])
    .map(normalizeCoveredCity)
    .sort((left, right) => left.name.localeCompare(right.name));
  return {
    count: cities.length,
    cities,
    assistant_instruction: "Use these live counts and freshness timestamps when explaining Dizko coverage."
  };
}

function normalizeCoveredCity(city) {
  const lastSuccessfulFetch = city.last_successful_fetch || city.last_scraped_at || null;
  return {
    slug: city.slug,
    name: city.name,
    country: city.country,
    event_count: city.event_count ?? 0,
    freshness: city.stale ? "stale" : "fresh",
    last_successful_fetch: lastSuccessfulFetch
  };
}

const NEAREST_COVERED_CITY = {
  birmingham: "london",
  brighton: "london",
  bristol: "london",
  cambridge: "london",
  edinburgh: "london",
  glasgow: "london",
  leeds: "london",
  liverpool: "london",
  manchester: "london",
  oxford: "london",
  potsdam: "berlin"
};

async function unsupportedCityPayload(requestedCity, options = {}) {
  let cities = [];
  try {
    cities = (await coveredCitiesPayload(options)).cities;
  } catch {
    // The original validation error remains useful even if coverage lookup fails.
  }
  const requested = String(requestedCity).trim();
  const preferredSlug = NEAREST_COVERED_CITY[requested.toLowerCase()];
  const nearest = cities.find((city) => city.slug === preferredSlug) || null;
  return {
    error: `${requested} is not covered by Dizko.`,
    code: "unsupported_city",
    requested_city: requested,
    nearest_covered_city: nearest,
    assistant_instruction: nearest
      ? `Tell the user ${requested} is not covered. The nearest covered city is ${nearest.name}, with ${nearest.event_count} live events.`
      : `Tell the user ${requested} is not covered and use list_cities to show current coverage.`
  };
}

function publicToolError(error, { retryable, entity = false }) {
  if (error?.status === 404) {
    return entity
      ? { error: "The requested scene entity was not found.", code: "entity_not_found" }
      : { error: "The requested event was not found.", code: "event_not_found" };
  }
  if (error?.status === 422) {
    return { error: "The request was not valid.", code: "invalid_request" };
  }
  if (error?.status === 401 || error?.status === 403) {
    return { error: "The event service refused the request.", code: "upstream_auth_failed" };
  }
  if (error?.code === "ETIMEDOUT" || error?.classification === "timeout") {
    return { error: "The event service timed out. Try again shortly.", code: "upstream_timeout" };
  }
  if (retryable) {
    return { error: "The event service is temporarily unavailable. Try again shortly.", code: "upstream_unavailable" };
  }
  return { error: "The request could not be completed.", code: "request_failed" };
}

export function toolJson(value, isError = false) {
  return {
    structuredContent: toStructuredContent(value),
    content: [
      {
        type: "text",
        // Minified on purpose: this text duplicates structuredContent for
        // clients that only read content, and pretty-printing a 25-event
        // result costs the model thousands of wasted tokens.
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

function profileSchema() {
  return {
    type: "object",
    properties: {
      profile_id: { type: "string", description: "Stable user/profile id." },
      profile_secret: { type: "string", description: "Private profile secret returned when the profile was created." }
    },
    required: ["profile_id", "profile_secret"]
  };
}

function deletePreferencesInputSchema() {
  return {
    type: "object",
    properties: {
      profile_id: { type: "string", description: "Stable user/profile id." },
      profile_secret: { type: "string", description: "Private profile secret returned when the profile was created." },
      confirm_delete: { type: "boolean", description: "Must be true only after the user confirms deletion of Dizko connector preferences and feedback history." }
    },
    required: ["profile_id", "profile_secret", "confirm_delete"]
  };
}

async function requireProfileAccess(store, input) {
  const profile = await store.getProfile(input.profile_id);
  if (!profile) {
    return {
      error: toolJson({
        error: "Preference profile not found. Ask the user whether to create one with create_event_preference_profile."
      }, true)
    };
  }
  if (!verifyProfileSecret(profile, input.profile_secret)) {
    return {
      error: toolJson({
        error: "Invalid or missing profile_secret for this preference profile."
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
    applied_preferences: applied || {},
    feedback_count: publicView?.feedback_count || 0
  };
}

function personalizedSearchInput(input, preferences) {
  const maxPrice = input.max_price ?? input.price_max ?? preferences.max_price;
  return {
    ...input,
    city: input.city || preferences.cities?.[0],
    genres: input.genres?.length ? input.genres : preferences.genres,
    vibe: input.vibe?.length ? input.vibe : preferences.vibe,
    event_types: input.event_types?.length ? input.event_types : preferences.event_types,
    neighborhoods: input.neighborhoods?.length ? input.neighborhoods : preferences.neighborhoods,
    venue: input.venue,
    featuring: input.featuring,
    max_price: maxPrice,
    price_max: maxPrice,
    free: input.free ?? preferences.free,
    nightlife: input.nightlife ?? preferences.nightlife,
    preferences
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
    deletion_instruction: "To delete saved Dizko preferences and feedback, call delete_event_preferences with both profile_id and profile_secret."
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
    price_max: input.price_max ?? input.max_price ?? null,
    free: input.free ?? null,
    avoid: input.avoid || []
  };
}

function preferenceSchema() {
  return {
    type: "object",
    properties: {
      cities: { type: "array", items: { type: "string" } },
      event_types: { type: "array", items: { type: "string" } },
      genres: { type: "array", items: { type: "string" } },
      vibe: { type: "array", items: { type: "string" } },
      neighborhoods: { type: "array", items: { type: "string" } },
      venues: { type: "array", items: { type: "string" } },
      featuring: { type: "array", items: { type: "string" } },
      avoid: { type: "array", items: { type: "string" } },
      max_price: { type: "number" },
      free: { type: "boolean" },
      nightlife: { type: "boolean" },
      day_filters: {
        type: "object",
        description: "Optional per-weekday filters applied only when searching that day, for example techno Fridays but chill Sundays. Array fields add to the user's general taste; max_price/free/nightlife override it for that day.",
        properties: Object.fromEntries(WEEKDAY_KEYS.map((day) => [day, dayPreferenceSchema()]))
      }
    }
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
    cities: { type: "array", items: { type: "string" } },
    event_types: { type: "array", items: { type: "string" } },
    genres: { type: "array", items: { type: "string" } },
    vibe: { type: "array", items: { type: "string" } },
    neighborhoods: { type: "array", items: { type: "string" } },
    venues: { type: "array", items: { type: "string" } },
    featuring: { type: "array", items: { type: "string" } },
    avoid: { type: "array", items: { type: "string" } },
    max_price: { type: "number" },
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
      featuring: { type: "array", items: { type: "string" } },
      avoid: { type: "array", items: { type: "string" } },
      max_price: { type: "number" },
      free: { type: "boolean" },
      nightlife: { type: "boolean" }
    }
  };
}

function eventSearchSchema() {
  return {
    type: "object",
    properties: {
      city: { type: "string", description: "City name, for example berlin or new york." },
      when: { type: "string", description: "Date preset: today, tonight, tomorrow, weekend, week, this week, any, or YYYY-MM-DD." },
      date_from: { type: "string", description: "Inclusive start date in YYYY-MM-DD format." },
      date_to: { type: "string", description: "Inclusive end date in YYYY-MM-DD format." },
      query: { type: "string", description: "Free-text search, hybrid-ranked by the live API: exact prefix > substring > fuzzy > semantic similarity over event embeddings. Handles soft natural-language intent ('dark queer warehouse rave', 'ambient listening bar') as well as literal names, and recognizes date phrases." },
      event_types: { type: "array", items: { type: "string" } },
      genres: { type: "array", items: { type: "string" } },
      vibe: { type: "array", items: { type: "string" } },
      neighborhoods: { type: "array", items: { type: "string" } },
      free: { type: "boolean" },
      pride: { type: "boolean" },
      price_min: { type: "number" },
      price_max: { type: "number" },
      max_price: { type: "number", description: "Preference hint used by recommend_events and plan_night." },
      featuring: { type: "string", description: "Artist or performer name." },
      venue: { type: "string" },
      promoter: { type: "string", description: "Promoter slug or display name." },
      avoid: { type: "array", items: { type: "string" }, description: "Terms to penalize in recommendations." },
      limit: { type: "number", default: 12, description: "Results per page (default 12). The response's count field is the TOTAL matching events. Raise limit or use offset to page through more." },
      offset: { type: "number", default: 0 },
      result_limit: { type: "number", default: 10 }
    }
  };
}

function sceneEntityInputSchema() {
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["dj", "artist", "venue", "collective", "promoter"] },
      id: { type: "string" },
      query: { type: "string" },
      city: { type: "string" },
      genre: { type: "string" },
      date_from: { type: "string" },
      date_to: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: 20 }
    },
    required: ["kind"],
    anyOf: [
      { required: ["id"] },
      { required: ["query"] }
    ]
  };
}

function searchFollowupsInputSchema() {
  const stringList = { type: "array", items: { type: "string" } };
  return {
    type: "object",
    properties: {
      city: { type: "string" },
      when: { type: "string" },
      date_from: { type: "string" },
      query: { type: "string" },
      event_types: stringList,
      genres: stringList,
      vibe: stringList,
      neighborhoods: stringList,
      venue: { type: "string" },
      free: { type: "boolean" },
      price_max: { type: "number" },
      max_price: { type: "number" },
      avoid: stringList
    }
  };
}

function planNightInputSchema() {
  const search = eventSearchSchema();
  return {
    ...search,
    properties: {
      ...search.properties,
      profile_id: {
        type: "string",
        description: "Optional Dizko preference profile id. Supply it with profile_secret to apply saved and learned taste."
      },
      profile_secret: {
        type: "string",
        description: "Private profile secret returned when the profile was created."
      }
    },
    dependentRequired: {
      profile_id: ["profile_secret"],
      profile_secret: ["profile_id"]
    }
  };
}

function roundupInputSchema() {
  return {
    type: "object",
    properties: {
      city: { type: "string", description: "City name, for example berlin or new york." },
      date: { type: "string", description: "Target day in YYYY-MM-DD format. Defaults to today." },
      when: { type: "string", description: "Alternative date preset: today, tonight, or tomorrow." },
      profile_id: {
        type: "string",
        description: "Optional Dizko preference profile id. Supply it with profile_secret to personalize the picks with saved, learned, and per-day preferences."
      },
      profile_secret: {
        type: "string",
        description: "Private profile secret returned when the profile was created."
      },
      event_types: { type: "array", items: { type: "string" } },
      genres: { type: "array", items: { type: "string" } },
      vibe: { type: "array", items: { type: "string" } },
      neighborhoods: { type: "array", items: { type: "string" } },
      free: { type: "boolean" },
      price_max: { type: "number" },
      avoid: { type: "array", items: { type: "string" }, description: "Terms to penalize in the ranking." },
      limit: { type: "number", default: 100, description: "How many of the day's events to fetch and rank." },
      top_limit: { type: "number", default: 5, description: "Top picks to feature (max 10)." },
      section_limit: { type: "number", default: 5, description: "Events per category section (max 10)." }
    },
    required: ["city"],
    dependentRequired: {
      profile_id: ["profile_secret"],
      profile_secret: ["profile_id"]
    }
  };
}

function artistEventsInputSchema() {
  return {
    type: "object",
    properties: {
      artists: {
        type: "array",
        items: { type: "string" },
        description: "Artist, DJ, performer, or comedian names to look up (max 8 per call)."
      },
      city: { type: "string", description: "Optional city to scope the search; omit to search all cities." },
      date_from: { type: "string", description: "Inclusive start date in YYYY-MM-DD format. Defaults to today." },
      date_to: { type: "string", description: "Optional inclusive end date in YYYY-MM-DD format." },
      limit_per_artist: { type: "number", default: 5, description: "Upcoming events per artist (max 10)." },
      profile_id: {
        type: "string",
        description: "Optional Dizko preference profile id. When artists is omitted, the profile's saved featuring list is used."
      },
      profile_secret: {
        type: "string",
        description: "Private profile secret returned when the profile was created."
      }
    },
    dependentRequired: {
      profile_id: ["profile_secret"],
      profile_secret: ["profile_id"]
    }
  };
}

function artistEventsOutputSchema() {
  return withError({
    type: "object",
    properties: {
      profile: profileOutputSchema(),
      city: nullableString(),
      date_from: { type: "string" },
      date_to: nullableString(),
      artists: {
        type: "array",
        items: {
          type: "object",
          properties: {
            artist: { type: "string" },
            count: { type: "number" },
            events: { type: "array", items: eventSummarySchema() }
          },
          required: ["artist", "count", "events"]
        }
      },
      not_found: stringArray(),
      dropped_artists: stringArray(),
      assistant_instruction: { type: "string" }
    },
    required: ["artists", "not_found"]
  });
}

function cityPulseInputSchema() {
  return {
    type: "object",
    properties: {
      city: { type: "string", description: "City name, for example berlin or new york." },
      days: { type: "number", default: 7, description: "Window length in days starting from date_from (max 14)." },
      date_from: { type: "string", description: "Inclusive start date in YYYY-MM-DD format. Defaults to today." },
      event_types: { type: "array", items: { type: "string" }, description: "Optional event-type filter, for example party." }
    },
    required: ["city"]
  };
}

function cityPulseOutputSchema() {
  return withError({
    type: "object",
    properties: {
      city: nullableString(),
      date_from: { type: "string" },
      date_to: { type: "string" },
      days: { type: "number" },
      total_available: { type: "number" },
      sample_size: { type: "number" },
      sample_note: { type: "string" },
      busiest_nights: {
        type: "array",
        items: {
          type: "object",
          properties: {
            date: { type: "string" },
            weekday: nullableString(),
            events: { type: "number" }
          },
          required: ["date", "events"]
        }
      },
      top_venues: {
        type: "array",
        items: {
          type: "object",
          properties: {
            venue: { type: "string" },
            events: { type: "number" },
            total_attendance: { type: "number" }
          },
          required: ["venue", "events"]
        }
      },
      top_genres: {
        type: "array",
        items: {
          type: "object",
          properties: {
            genre: { type: "string" },
            events: { type: "number" }
          },
          required: ["genre", "events"]
        }
      },
      headliners: { type: "array", items: eventSummarySchema() },
      free_events_in_sample: { type: "number" },
      assistant_instruction: { type: "string" }
    },
    required: ["date_from", "date_to", "total_available", "sample_size", "busiest_nights", "top_venues", "top_genres", "headliners"]
  });
}

function roundupOutputSchema() {
  return withError({
    type: "object",
    properties: {
      profile: profileOutputSchema(),
      personalization: personalizationOutputSchema(),
      city: nullableString(),
      date: { type: "string" },
      weekday: nullableString(),
      total_available: { type: "number" },
      top_picks: { type: "array", items: rankedEventSchema() },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            title: { type: "string" },
            count: { type: "number" },
            events: { type: "array", items: rankedEventSchema() }
          },
          required: ["key", "title", "count", "events"]
        }
      },
      assistant_instruction: { type: "string" }
    },
    required: ["date", "total_available", "top_picks", "sections"]
  });
}

function onboardingOutputSchema() {
  return withError({
    type: "object",
    properties: {
      profile_id: nullableString(),
      consent_required: { type: "boolean" },
      questions: stringArray(),
      assistant_instruction: { type: "string" }
    },
    required: ["consent_required", "questions", "assistant_instruction"]
  });
}

function profileCreateOutputSchema() {
  return withError({
    type: "object",
    properties: {
      created: { type: "boolean" },
      profile: profileOutputSchema(),
      profile_secret: { type: "string", description: "Returned once when a profile is created. The service stores only a hash." },
      access_instructions: profileAccessInstructionsOutputSchema(),
      assistant_instruction: { type: "string" }
    },
    required: ["created"]
  });
}

function profileSaveOutputSchema() {
  return withError({
    type: "object",
    properties: {
      saved: { type: "boolean" },
      profile: profileOutputSchema(),
      access_instructions: profileAccessInstructionsOutputSchema()
    },
    required: ["saved"]
  });
}

function profileReadOutputSchema() {
  return withError({
    type: "object",
    properties: {
      profile: profileOutputSchema(),
      access_instructions: profileAccessInstructionsOutputSchema()
    },
    required: ["profile"]
  });
}

function deletePreferencesOutputSchema() {
  return withError({
    type: "object",
    properties: {
      deleted: { type: "boolean" }
    },
    required: ["deleted"]
  });
}

function feedbackOutputSchema() {
  return withError({
    type: "object",
    properties: {
      saved: { type: "boolean" },
      feedback: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          liked: nullableBoolean(),
          rating: nullableNumber(),
          notes: nullableString(),
          attended_at: nullableString(),
          event: eventSummarySchema(),
          created_at: { type: "string" }
        }
      },
      profile: profileOutputSchema(),
      follow_up: { type: "string" }
    },
    required: ["saved", "feedback", "profile"]
  });
}

function feedbackPromptOutputSchema() {
  return withError({
    type: "object",
    properties: {
      event: eventSummarySchema(),
      attended_at: nullableString(),
      questions: stringArray(),
      assistant_instruction: { type: "string" }
    },
    required: ["event", "attended_at", "questions", "assistant_instruction"]
  });
}

function searchFollowupsOutputSchema() {
  return withError({
    type: "object",
    properties: {
      needs_followup: { type: "boolean" },
      missing_fields: stringArray(),
      questions: stringArray(),
      search_args_hint: searchArgsHintOutputSchema(),
      assistant_instruction: { type: "string" }
    },
    required: ["needs_followup", "missing_fields", "questions", "search_args_hint", "assistant_instruction"]
  });
}

function eventsOutputSchema() {
  return withError({
    type: "object",
    properties: {
      count: { type: "number" },
      events: {
        type: "array",
        items: eventSummarySchema()
      },
      app_download_url: { type: "string", description: "Dizko iPhone app landing page." },
      assistant_instruction: { type: "string" }
    },
    required: ["count", "events"]
  });
}

function rankedEventsOutputSchema() {
  return withError({
    type: "object",
    properties: {
      count: { type: "number" },
      events: {
        type: "array",
        items: rankedEventSchema()
      },
      app_download_url: { type: "string", description: "Dizko iPhone app landing page." },
      assistant_instruction: { type: "string" }
    },
    required: ["count", "events"]
  });
}

function userRecommendationsOutputSchema() {
  return withError({
    type: "object",
    properties: {
      profile: profileOutputSchema(),
      personalization: personalizationOutputSchema(),
      count: { type: "number" },
      events: {
        type: "array",
        items: rankedEventSchema()
      },
      onboarding_needed: { type: "boolean" },
      questions: stringArray(),
      message: { type: "string" },
      app_download_url: { type: "string", description: "Dizko iPhone app landing page." },
      assistant_instruction: { type: "string" }
    }
  });
}

function planOutputSchema() {
  return withError({
    type: "object",
    properties: {
      profile: profileOutputSchema(),
      personalization: personalizationOutputSchema(),
      city: nullableString(),
      when: nullableString(),
      strategy: { type: "string" },
      events: {
        type: "array",
        items: planEventSchema()
      },
      app_download_url: { type: "string", description: "Dizko iPhone app landing page." },
      assistant_instruction: { type: "string" }
    },
    required: ["city", "when", "strategy", "events"]
  });
}

function planEventSchema() {
  return {
    ...rankedEventSchema(),
    properties: {
      ...rankedEventSchema().properties,
      plan_role: {
        type: "string",
        enum: ["primary", "nearby_fallback", "later_fallback", "alternate"]
      },
      plan_note: { type: "string" },
      distance_from_primary_km: nullableNumber()
    }
  };
}

function ticketPolicyOutputSchema() {
  return withError({
    type: "object",
    properties: {
      autonomous_purchase_available: { type: "boolean" },
      supported_modes: stringArray(),
      provider_contract: { type: "string" },
      hard_rules: stringArray(),
      current_default_behavior: { type: "string" },
      assistant_instruction: { type: "string" }
    },
    required: ["autonomous_purchase_available", "supported_modes", "hard_rules", "current_default_behavior"]
  });
}

function ticketOffersOutputSchema() {
  return withError({
    type: "object",
    properties: {
      event: eventSummarySchema(),
      count: { type: "number" },
      offers: {
        type: "array",
        items: ticketOfferSchema()
      },
      policy: ticketPolicyShape(),
      assistant_instruction: { type: "string" }
    },
    required: ["event", "count", "offers", "policy"]
  });
}

function ticketQuoteInputSchema() {
  return {
    type: "object",
    properties: {
      event_id: { type: "string", description: "Event id returned by search, recommendations, plan_night, or get_event." },
      offer_id: { type: "string", description: "Optional offer_id returned by get_ticket_offers." },
      quantity: { type: "number", minimum: 1, maximum: 12, default: 1 },
      ticket_type: { type: "string", description: "Requested ticket type, for example GA, balcony, seated, VIP, or best available." },
      max_total: { type: "number", description: "Maximum all-in total the user authorizes before the agent must stop and ask again." },
      currency: { type: "string", description: "Preferred currency for max_total, for example USD." },
      refund_terms: { type: "string", description: "Minimum refund/transfer terms the user accepts." }
    },
    required: ["event_id"]
  };
}

function ticketQuoteOutputSchema() {
  return withError({
    type: "object",
    properties: {
      quoted: { type: "boolean" },
      quote: ticketQuoteSchema(),
      quote_token: { type: "string" },
      confirmation_required: { type: "boolean" },
      confirmation_prompt: { type: "string" },
      assistant_instruction: { type: "string" },
      error: { type: "string" },
      event: eventSummarySchema(),
      policy: ticketPolicyShape()
    },
    required: ["quoted"]
  });
}

function ticketPurchaseInputSchema() {
  return {
    type: "object",
    properties: {
      quote_token: { type: "string", description: "Opaque quote token returned by quote_ticket_order." },
      confirmation_text: { type: "string", description: "User's explicit written confirmation, including buy/purchase, quantity, and max_total when present." },
      user_payment_profile_id: { type: "string", description: "Provider-specific saved payment profile id, when an integrated provider supports autonomous purchase." },
      idempotency_key: { type: "string", description: "Optional idempotency key for integrated purchase providers." }
    },
    required: ["quote_token", "confirmation_text"]
  };
}

function ticketPurchaseOutputSchema() {
  return withError({
    type: "object",
    properties: {
      purchased: { type: "boolean" },
      status: { type: "string" },
      error: { type: "string" },
      order_id: nullableString(),
      receipt_url: nullableString(),
      ticket_delivery_status: nullableString(),
      checkout_url: nullableString(),
      quote: ticketQuoteSchema(),
      confirmation_prompt: { type: "string" },
      assistant_instruction: { type: "string" },
      delivery_email: nullableString(),
      calendar_event: calendarEventSchema(),
      provider_response: {
        type: ["object", "null"],
        additionalProperties: true
      }
    },
    required: ["purchased", "status"]
  });
}

function calendarEventSchema() {
  return {
    type: ["object", "null"],
    properties: {
      uid: { type: "string" },
      title: nullableString(),
      starts_at: nullableString(),
      ends_at: nullableString(),
      venue: nullableString(),
      city: nullableString(),
      event_url: nullableString(),
      ticket_url: nullableString(),
      status: { type: "string" },
      ics_filename: { type: "string" },
      ics_content: { type: "string" }
    },
    required: ["uid", "ics_filename", "ics_content"]
  };
}

function calendarEventOutputSchema() {
  return withError({
    type: "object",
    properties: {
      calendar_event: calendarEventSchema(),
      assistant_instruction: { type: "string" }
    },
    required: ["calendar_event"]
  });
}

function profileOutputSchema() {
  return {
    type: "object",
    properties: {
      profile_id: { type: "string" },
      consent: { type: "boolean" },
      preferences: preferenceSchema(),
      learned_preferences: preferenceSchema(),
      feedback_count: { type: "number" },
      updated_at: { type: "string" }
    },
    required: ["profile_id", "consent", "preferences", "feedback_count", "updated_at"]
  };
}

function profileAccessInstructionsOutputSchema() {
  return {
    type: "object",
    properties: {
      profile_id: nullableString(),
      profile_secret: nullableString(),
      profile_secret_returned_now: { type: "boolean" },
      keep_private: { type: "boolean" },
      purpose: { type: "string" },
      reuse_instruction: { type: "string" },
      deletion_instruction: { type: "string" }
    },
    required: ["profile_id", "profile_secret", "profile_secret_returned_now", "keep_private", "purpose", "reuse_instruction", "deletion_instruction"]
  };
}

function personalizationOutputSchema() {
  return {
    type: "object",
    properties: {
      source: { type: "string" },
      profile_id: nullableString(),
      saved_preferences: preferenceSchema(),
      learned_preferences: preferenceSchema(),
      current_request: searchArgsHintOutputSchema(),
      applied_preferences: preferenceSchema(),
      feedback_count: { type: "number" }
    }
  };
}

function rankedEventSchema() {
  return {
    ...eventSummarySchema(),
    properties: {
      ...eventSummarySchema().properties,
      recommendation_score: { type: "number" },
      recommendation_reasons: stringArray()
    }
  };
}

function eventSummarySchema() {
  return {
    type: "object",
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      starts_at: nullableString(),
      ends_at: nullableString(),
      venue: nullableString(),
      city: nullableString(),
      price: nullableString(),
      genres: stringArray(),
      vibe: stringArray(),
      event_types: stringArray(),
      lineup: stringArray(),
      attendance_count: nullableNumber(),
      source: nullableString(),
      description: { ...nullableString(), description: "Short one-line event description for display." },
      ticket_url: nullableString(),
      event_url: { type: "string" },
      calendar_url: { ...nullableString(), description: "Prefilled Google Calendar link. Offer as 'Add to calendar'." },
      directions_url: { ...nullableString(), description: "Google Maps directions link. Offer as 'Get directions'." }
    },
    required: ["id", "title", "event_url"]
  };
}

function ticketPolicyShape() {
  return {
    type: "object",
    properties: {
      autonomous_purchase_available: { type: "boolean" },
      supported_modes: stringArray(),
      provider_contract: { type: "string" },
      hard_rules: stringArray(),
      current_default_behavior: { type: "string" }
    }
  };
}

function ticketOfferSchema() {
  return {
    type: "object",
    properties: {
      offer_id: { type: "string" },
      event: eventSummarySchema(),
      provider: nullableString(),
      purchase_mode: { type: "string" },
      autonomous_purchase_supported: { type: "boolean" },
      availability_status: { type: "string" },
      ticket_url: nullableString(),
      estimated_price: nullableString(),
      currency: nullableString(),
      price_guaranteed: { type: "boolean" },
      fees_included: { type: "boolean" },
      notes: stringArray()
    },
    required: ["offer_id", "event", "purchase_mode", "autonomous_purchase_supported", "availability_status"]
  };
}

function ticketQuoteSchema() {
  return {
    type: ["object", "null"],
    properties: {
      quote_id: { type: "string" },
      event: eventSummarySchema(),
      offer_id: { type: "string" },
      provider: nullableString(),
      purchase_mode: { type: "string" },
      autonomous_purchase_supported: { type: "boolean" },
      availability_status: { type: "string" },
      checkout_url: nullableString(),
      quantity: { type: "number" },
      ticket_type: { type: "string" },
      max_total: nullableNumber(),
      currency: nullableString(),
      estimated_price: nullableString(),
      price_guaranteed: { type: "boolean" },
      fees_included: { type: "boolean" },
      refund_terms: { type: "string" },
      expires_at: { type: "string" },
      stop_conditions: stringArray()
    }
  };
}

function withError(successSchema) {
  return {
    type: "object",
    anyOf: [
      successSchema,
      {
        type: "object",
        properties: {
          error: { type: "string" },
          type: { type: "string" },
          code: nullableString(),
          status: nullableNumber(),
          hostname: nullableString(),
          url: nullableString(),
          classification: nullableString(),
          cause: nullableString(),
          retryable: { type: "boolean" },
          assistant_instruction: { type: "string" }
        },
        required: ["error"]
      }
    ]
  };
}

function buildSearchFollowups(input = {}) {
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
    search_args_hint: {
      city: input.city || null,
      when: input.when || input.date_from || null,
      event_types: input.event_types || [],
      genres: input.genres || [],
      vibe: input.vibe || [],
      neighborhoods: input.neighborhoods || [],
      price_max: input.price_max ?? input.max_price ?? null,
      free: input.free ?? null,
      avoid: input.avoid || []
    },
    assistant_instruction: questions.length
      ? "Ask one or two of these follow-up questions conversationally, then call recommend_events_for_user when a profile exists or search_events/recommend_events with the user's answers."
      : "The request has enough context. Call recommend_events_for_user when a profile exists or search_events/recommend_events with these arguments."
  };
}

function searchArgsHintOutputSchema() {
  return {
    type: "object",
    properties: {
      city: nullableString(),
      when: nullableString(),
      event_types: stringArray(),
      genres: stringArray(),
      vibe: stringArray(),
      neighborhoods: stringArray(),
      price_max: nullableNumber(),
      free: { type: ["boolean", "null"] },
      avoid: stringArray()
    }
  };
}

function stringArray() {
  return { type: "array", items: { type: "string" } };
}

function nullableString() {
  return { type: ["string", "null"] };
}

function nullableNumber() {
  return { type: ["number", "null"] };
}

function nullableBoolean() {
  return { type: ["boolean", "null"] };
}
