# Dizko Events User Guide

This guide is for ChatGPT, Claude, and other MCP-compatible clients that can connect to a remote MCP server.

## Connect

Use the verified production MCP endpoint:

```text
https://mcp.dizko.app/mcp
```

Do not use this custom domain yet:

```text
https://mcp.dizko.app/mcp
```

That domain is reserved for later, but it is not verified for review traffic.

## What Users Can Ask

Event search:

```text
Find five techno events in Berlin this weekend.
```

Current-context search:

```text
Find something good tonight, but ask me what type of event and vibe I want first.
```

Night planning:

```text
Plan a Saturday night in New York with a concert first and a late party fallback.
```

Personalized recommendations:

```text
Ask what kind of events I generally like, save my preferences after I consent, then recommend events for this weekend.
```

Post-event learning:

```text
Ask whether I liked the event I picked and remember my answer for future recommendations.
```

Deletion:

```text
Delete my Dizko saved event preferences and feedback history.
```

## Preference Memory Flow

Preference learning is opt-in.

1. The assistant asks onboarding questions about event types, genres, vibe, budget, locations, and avoidances.
2. The assistant asks whether Dizko may save those preferences.
3. If the user consents, the MCP creates a private preference profile.
4. The MCP returns an access card with a `profile_id` and one-time `profile_secret`.
5. The assistant privately remembers both values when the client supports connector state.
6. If the client cannot remember connector state across sessions, the user should keep both values somewhere private so future sessions can continue learning.
7. Future personalized searches use saved preferences plus the user's current request.
8. After events, the assistant can ask follow-up questions and record feedback.
9. Positive feedback promotes matching genres, vibes, event types, and venues.
10. Notes such as "liked the music," "too crowded," "too expensive," or "too late" can become learned preference or avoid signals.
11. Negative feedback becomes learned avoid signals for future ranking.

The MCP service stores only a hash of the `profile_secret`. The raw secret is returned once when the profile is created.

## What The Assistant Should Do

- Ask current-context follow-ups before broad tonight, week, or weekend searches when type, vibe, budget, or avoidances are missing.
- Ask for explicit consent before creating or saving a preference profile.
- Keep the `profile_secret` private and use it only for preference, feedback, recommendation, or deletion tools.
- If the client cannot persist connector state, tell the user the creation-time access card is their private Dizko preference key.
- Ask post-event feedback questions before recording feedback.
- Explain why recommendations match saved or learned preferences.
- Scope deletion to Dizko connector preferences and feedback history.

## What The MCP Cannot Do

- It cannot autonomously buy tickets from arbitrary third-party checkout pages.
- It can prepare ticket offers and locked quotes, then either return third-party checkout handoff or use an integrated provider such as Hermes, OpenClaw, Dizko Checkout, a partner API, or delegated payment when configured.
- It cannot guarantee event availability after returning a link.
- It should not save unrelated personal data such as home address, phone number, or non-event notes.
- It should not answer weather, news, travel, or restaurant requests unless the user also asks for events.

## Ticket Purchase Safety

- Ask for ticket options with an event id.
- Ask for a locked quote with quantity, ticket type, max total, and refund constraints.
- Give explicit written confirmation only if the event, venue, date, quantity, ticket type, and max total are correct.
- If the tool returns `requires_external_checkout`, complete payment directly with the linked provider.
- If an integrated provider is available, the agent can purchase only inside the confirmed quote limits.

## Support, Privacy, And Security

Privacy policy:

```text
https://mcp.dizko.app/privacy-policy.html
```

Support:

```text
https://mcp.dizko.app/support.html
```

Security contact metadata:

```text
https://mcp.dizko.app/.well-known/security.txt
```
