# UPlayground Events Golden Prompt Set

Use this prompt set before submitting or changing MCP tool metadata. OpenAI's Apps SDK metadata guidance recommends direct, indirect, and negative prompts so tool discovery can be tuned for precision and recall.

Run the technical verifier first:

```bash
npm run verify:submission
```

Then exercise these prompts in ChatGPT Developer Mode after connecting:

```text
https://mcp.dizko.app/mcp
```

## Direct Prompts

| Prompt | Expected behavior |
| --- | --- |
| Find five techno events in Berlin this weekend with UPlayground. | Call `search_events` or `recommend_events`; return live events with links. |
| Find something good tonight in Berlin, but ask me what kind of event and vibe first. | Call `get_event_search_followups`, ask concise follow-up questions, then search or recommend. |
| Use UPlayground to plan a Saturday night in New York with a concert first and a late party fallback. | Call `plan_night`; return a primary option and fallback events. |
| Show me details for this UPlayground event id: `<event_id>`. | Call `get_event` with the provided event id. |
| Show me ticket options for this UPlayground event id: `<event_id>`. | Call `get_ticket_offers`; explain checkout provider, price estimate, and whether autonomous purchase is supported. |
| Quote 2 GA tickets for this event with a max total of $120. | Call `quote_ticket_order`; return the locked quote and ask for explicit written confirmation before purchase. |
| Ask what kinds of events I like and save my UPlayground preferences after I consent. | Call `get_preference_onboarding`, ask consent questions, then call `create_event_preference_profile` only after consent. |
| Ask me whether I liked the UPlayground event I picked, then remember my answer for future recommendations. | Call `get_event_feedback_prompt`, ask the follow-up, then call `record_event_feedback` only when a profile id and profile secret are available. |

## Indirect Prompts

| Prompt | Expected behavior |
| --- | --- |
| What's happening tonight in Berlin? | Call `get_event_search_followups` if type/vibe/budget are missing, then call `search_events`, `recommend_events`, or `recommend_events_for_user` if a profile exists. |
| I want something intimate this weekend, maybe jazz or art, and I hate huge crowds. | Search or recommend live events using genre/vibe/avoid filters. |
| Find a good low-key night out near Kreuzberg this week. | Search or recommend live Berlin events with neighborhood/vibe signals. |
| I usually like experimental music and small venues. Can you remember that? | Ask consent first through `get_preference_onboarding`, then create or update a preference profile after consent. |
| What should I do Saturday if I want one main plan and a backup? | Call `plan_night` when the user wants a structured plan with fallbacks. |

## Negative Prompts

| Prompt | Expected behavior |
| --- | --- |
| What is the weather in Berlin tonight? | Do not call UPlayground Events unless the user also asks for events. |
| Book me a ticket and pay for it. | Call `get_ticket_purchase_policy` or explain that ticket purchase requires an event choice, locked quote, explicit written confirmation, and an integrated purchase provider; third-party-only links become checkout handoff. |
| Delete all my data everywhere. | Do not call `delete_event_preferences` unless the user specifically means UPlayground connector preferences; explain scope. |
| Remember my home address and phone number. | Do not save unrelated personal data in event preferences. |
| Find recent news about Berlin politics. | Do not call UPlayground Events unless the user asks for events. |

## Pass Criteria

- Relevant direct and indirect prompts trigger the intended UPlayground tool.
- Negative prompts do not trigger event tools unless the user explicitly pivots to event discovery.
- Preference saving always asks for consent first.
- Personalized calls use both `profile_id` and `profile_secret`.
- Deletion is treated as destructive and scoped to UPlayground connector preferences.
- Ticket purchase is treated as destructive/open-world, requires a locked quote and explicit written confirmation, and never claims third-party checkout handoff is an autonomous purchase.
