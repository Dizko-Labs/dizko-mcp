# ChatGPT Screenshot Checklist

Capture these screenshots from the actual ChatGPT Developer Mode connector flow before submitting UPlayground Events for review.

Use the production MCP endpoint:

```text
https://eventchat-events-mcp-production.up.railway.app/mcp
```

Do not use:

```text
https://mcp.urbanplayground.xyz/mcp
```

## Required Screenshots

1. `01-connector-connected.png`
   - Show the connector setup screen with UPlayground Events connected.
   - The Railway MCP endpoint should be visible if the UI exposes it.

2. `02-tool-list.png`
   - Show tool list or tool-call details.
   - It should be clear that UPlayground Events exposes 13 tools.

3. `03-live-event-search.png`
   - Prompt:

```text
Find five techno events in Berlin this weekend.
```

   - Expected: live events with UPlayground event URLs and ticket/source links when available.

4. `04-current-context-followups.png`
   - Prompt:

```text
Find something good tonight in Berlin, but ask me what kind of event and vibe first.
```

   - Expected: concise follow-up questions before search, using `get_event_search_followups`.

5. `05-consent-onboarding.png`
   - Prompt:

```text
Ask what kind of events I generally like, then ask whether UPlayground may save my preferences.
```

   - Expected: onboarding questions and explicit consent request before profile creation.

6. `06-personalized-recommendation.png`
   - Prompt:

```text
Save my preferences after I consent, then recommend events for this weekend.
```

   - Expected: personalized recommendations using saved preferences and current request context.

7. `07-post-event-feedback.png`
   - Prompt after choosing an event:

```text
Ask me a follow-up about whether I liked that event and remember my answer for future recommendations.
```

   - Expected: `get_event_feedback_prompt` before `record_event_feedback`, plus an explanation of learned positive or negative signals.

8. `08-delete-preferences.png`
   - Prompt:

```text
Delete my UPlayground saved event preferences and feedback history.
```

   - Expected: `delete_event_preferences` and an explanation that deletion is scoped to UPlayground connector preferences and feedback.

## Optional Mobile Screenshots

OpenAI review may ask for web and mobile coverage. Capture these on mobile if possible:

- `mobile-01-live-event-search.png`
- `mobile-02-preference-onboarding.png`
- `mobile-03-delete-preferences.png`

## Review Notes

- Do not include real private `profile_secret` values in public-facing screenshots unless the dashboard explicitly requires proof of creation-time behavior.
- If a profile secret appears, crop or redact it before sharing outside the private OpenAI submission workflow.
- Use `submission-evidence/latest-summary.md` as the technical evidence companion for these screenshots.
