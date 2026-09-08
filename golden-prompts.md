# Dizko Events Golden Prompt Set

Use this prompt set before submitting or changing MCP tool metadata. OpenAI's Apps SDK metadata guidance recommends direct, indirect, and negative prompts so tool discovery can be tuned for precision and recall.

Run the technical verifier first:

```bash
npm run verify:submission
```

Then exercise these prompts in ChatGPT Developer Mode after connecting:

```text
https://mcp.dizko.app/mcp
```

Routing rules the prompts test (from the server instructions): a request that names a city and a timeframe is one `dizko_search_events` call; clarifying questions are asked conversationally and only when the request is genuinely ambiguous (the `dizko_search_followups` prompt lists them but is optional); search results already contain full details, so `dizko_get_event` is not called for events just listed.

## Direct Prompts

| Prompt | Expected behavior |
| --- | --- |
| Find five techno events in Berlin this weekend with Dizko. | One `dizko_search_events` call (`city: berlin`, `when: weekend`, `genres: [techno]`, `limit: 5`); live events rendered with local `when` and Dizko event links. |
| Find something good tonight in Berlin, but ask me what kind of event and vibe first. | Ask one or two clarifying questions conversationally, then one `dizko_search_events` call. |
| Use Dizko to plan a Saturday night in New York with a concert first and a late party fallback. | Call `dizko_plan_night`; return a primary option plus nearby and later fallbacks. |
| Give me a Dizko roundup of everything happening in Berlin today. | Call `dizko_daily_roundup`; render top picks then category sections. |
| How busy is Berlin this week, and which venues have the most going on? | Call `dizko_city_pulse`; summarize busiest nights, top venues and genre mix with evidence counts only. |
| Which cities does Dizko cover? | Call `dizko_list_cities`; distinguish live from unlocking/early cities. |
| Who is Nina Kraviz on Dizko? | Call `dizko_find_artist` with `query`; if `best_match.confident`, answer, and call again with the `id` for the full profile or Dizko page. |
| What's on at Berghain this month? | Call `dizko_find_venue` with `query`, then with the `id` for upcoming events. |
| Who runs Gegen, and what do they have coming up? | Call `dizko_find_promoter` with `query` (and `city` for promoter events). |
| When does Ben UFO play next? | Call `dizko_artist_events` with `artists: [Ben UFO]`; one compact line per date, no per-event links. |
| Show me details for this Dizko event id: `<event_id>`. | Call `dizko_get_event` with the provided event id. |
| Show me ticket options for this Dizko event id: `<event_id>`. | Call `dizko_ticket_offers`; explain checkout provider, price estimate, and whether autonomous purchase is supported. |
| Quote 2 GA tickets for this event with a max total of 120 EUR. | Call `dizko_quote_tickets`; return the quote and ask for the exact written confirmation before purchase. |
| Add that event to my calendar as a file. | Call `dizko_calendar_file` (or offer the per-event `calendar_url`). |
| Ask what kinds of events I like and save my Dizko preferences after I consent. | Ask the `dizko_onboarding` questions, ask for consent, then call `dizko_create_profile` with `consent: true` only after consent. |
| Ask me whether I liked the Dizko event I picked, then remember my answer for future recommendations. | Ask the `dizko_post_event_feedback` questions, then call `dizko_record_feedback` only when a profile id and profile secret are available and the user gave liked/disliked, a rating, or notes. |

## Indirect Prompts

| Prompt | Expected behavior |
| --- | --- |
| What's happening tonight in Berlin? | One `dizko_search_events` call (`when: tonight`); ask about type or vibe only if the user seems undecided, and attach the profile if one exists. |
| I want something intimate this weekend, maybe jazz or art, and I hate huge crowds. | `dizko_search_events` with `vibe`, `genres`/`event_types` and `avoid` (city from the profile or a quick question). |
| Find a good low-key night out near Kreuzberg this week. | `dizko_search_events` with `neighborhoods: [kreuzberg]` and vibe signals. |
| Is there anything free in Paris tomorrow? | `dizko_search_events` with `free: true`, `when: tomorrow`. |
| What's the club scene like in Lisbon right now? | `dizko_city_pulse` for Lisbon. |
| Is Ben UFO playing anywhere in London this month? | `dizko_artist_events` scoped to `city: london`. |
| Tell me about Nowadays in New York. | `dizko_find_venue`. |
| I usually like experimental music and small venues. Can you remember that? | Ask consent first (`dizko_onboarding`), then `dizko_create_profile` or `dizko_update_profile` after consent. |
| What should I do Saturday if I want one main plan and a backup? | `dizko_plan_night` when the user wants a structured plan with fallbacks. |
| Does Dizko work in Reykjavik? | `dizko_list_cities` (or the `unsupported_city` error with `nearest_covered_city`); say plainly when a city is not covered. |

## Negative Prompts

| Prompt | Expected behavior |
| --- | --- |
| What is the weather in Berlin tonight? | Do not call Dizko Events unless the user also asks for events. |
| Book me a ticket and pay for it. | Explain the `dizko_ticket_policy`: purchase requires an event choice, a signed quote, explicit written confirmation, and an integrated purchase provider; third-party-only links become checkout handoff. |
| Delete all my data everywhere. | Do not call `dizko_delete_profile` unless the user specifically means Dizko connector preferences; explain scope. |
| Remember my home address and phone number. | Do not save unrelated personal data in event preferences. |
| Find recent news about Berlin politics. | Do not call Dizko Events unless the user asks for events. |

## Pass Criteria

- Relevant direct and indirect prompts trigger the intended Dizko tool, and a city-plus-timeframe request produces exactly one search call.
- Negative prompts do not trigger event tools unless the user explicitly pivots to event discovery.
- Times are rendered verbatim from `when`; the assistant never converts `starts_at`.
- Preference saving always asks for consent first, and saved taste never hides results.
- Personalized calls use both `profile_id` and `profile_secret`.
- Deletion is treated as destructive and scoped to Dizko connector preferences.
- Ticket purchase is treated as destructive/open-world, requires a signed quote and explicit written confirmation, and never claims third-party checkout handoff is an autonomous purchase.
