# ChatGPT Screenshot Checklist

Capture these screenshots from the actual ChatGPT Developer Mode connector flow before submitting Dizko Events for review.

Use the production MCP endpoint:

```text
https://mcp.dizko.app/mcp
```

## Required Screenshots

1. `01-connector-connected.png`
   - Show the connector setup screen with Dizko Events connected.
   - The hosted MCP endpoint should be visible if the UI exposes it.

2. `02-tool-list.png`
   - Show tool list or tool-call details.
   - It should be clear that Dizko Events exposes all 19 `dizko_*` tools (the count comes from `tools.length` in `src/tools.js`).

3. `03-live-event-search.png`
   - Prompt:

```text
Find five techno events in Berlin this weekend.
```

   - Expected: a single `dizko_search_events` call; live events with local times, Dizko event URLs and ticket/source links when available.

4. `04-clarifying-questions.png`
   - Prompt:

```text
Find something good tonight in Berlin, but ask me what kind of event and vibe first.
```

   - Expected: one or two clarifying questions asked conversationally (the optional `dizko_search_followups` prompt lists them), then one `dizko_search_events` call.

5. `05-consent-onboarding.png`
   - Prompt:

```text
Ask what kind of events I generally like, then ask whether Dizko may save my preferences.
```

   - Expected: the `dizko_onboarding` questions and an explicit consent request before `dizko_create_profile`.

6. `06-personalized-recommendation.png`
   - Prompt:

```text
Save my preferences after I consent, then recommend events for this weekend.
```

   - Expected: `dizko_search_events` with the profile attached; personalized ranking using saved preferences and the current request.

7. `07-post-event-feedback.png`
   - Prompt after choosing an event:

```text
Ask me a follow-up about whether I liked that event and remember my answer for future recommendations.
```

   - Expected: the `dizko_post_event_feedback` questions before `dizko_record_feedback`, plus an explanation of learned positive or negative signals.

8. `08-delete-preferences.png`
   - Prompt:

```text
Delete my Dizko saved event preferences and feedback history.
```

   - Expected: `dizko_delete_profile` and an explanation that deletion is scoped to Dizko connector preferences and feedback.

## Optional Mobile Screenshots

OpenAI review may ask for web and mobile coverage. Capture these on mobile if possible:

- `mobile-01-live-event-search.png`
- `mobile-02-preference-onboarding.png`
- `mobile-03-delete-preferences.png`

## Review Notes

- Do not include real private `profile_secret` values (`dzs_...`) in public-facing screenshots unless the dashboard explicitly requires proof of creation-time behavior.
- If a profile secret appears, crop or redact it before sharing outside the private OpenAI submission workflow.
- Use `submission-evidence/latest-summary.md` as the technical evidence companion for these screenshots.
