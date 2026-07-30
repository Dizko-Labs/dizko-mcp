# OpenAI Submission Packet

Use this file as the final handoff when submitting Dizko Events through the OpenAI dashboard.

## Submit These URLs

MCP endpoint:

```text
https://mcp.dizko.app/mcp
```

Privacy policy:

```text
https://mcp.dizko.app/privacy-policy.html
```

Support:

```text
https://mcp.dizko.app/support.html
```

Terms:

```text
https://mcp.dizko.app/terms.html
```

User guide:

```text
https://mcp.dizko.app/user-guide.html
```

Company:

```text
https://www.dizko.app
```

Logo:

```text
https://mcp.dizko.app/logo-512.png
```

Security contact metadata:

```text
https://mcp.dizko.app/.well-known/security.txt
```

## Dashboard Copy

App name:

```text
Dizko Events
```

Short description:

```text
Find current concerts, parties, nightlife, festivals, and cultural events from Dizko's live event inventory.
```

Long description:

```text
Dizko Events is Dizko's connector for ChatGPT, Claude, and MCP-compatible agents. It connects users to live event listings across major cities, supports structured search by city, date, genre, vibe, neighborhood, venue, artist, price, attendance, and event type, then returns verifiable event links and ticket URLs. Recommendation tools include explainable taste matching, compact night plans with fallbacks, daily city roundups with top picks and category sections, consent-based saved preferences with per-weekday day filters, current-context follow-up questions, and post-event feedback learning. Ticket tools can show offers, create locked quotes, require explicit written confirmation, and either hand off third-party checkout or use an integrated provider such as Hermes, OpenClaw, Dizko Checkout, a partner API, or delegated payment when configured.
```

Localization:

```text
Default locale: en-US
Supported locales: en-US
Submit English (United States) copy for the initial review. Event results may include venue, artist, or event names in their original language from the live inventory.
```

Machine-readable copy is in:

```text
submission-fields.json
```

Requirement-to-evidence audit:

```text
SUBMISSION_AUDIT.md
```

## What The App Does

- Searches live Dizko event inventory instead of relying on model memory.
- Makes Dizko event data available through MCP-compatible assistants.
- Filters events by city, date, event type, genre, vibe, venue, artist, neighborhood, price, and avoid signals.
- Returns event links and ticket/source links when available.
- Recommends events with explainable ranking reasons.
- Plans nights out with primary and fallback options.
- Asks current-context follow-up questions before broad tonight/week/weekend searches.
- Saves event preferences only after explicit consent.
- Learns over time from post-event feedback that includes liked/disliked, rating, or notes, including note-derived signals for music, crowd, price, timing, and venue.
- Converts negative feedback into learned avoid signals.
- Lets users delete saved Dizko connector preferences and feedback.

## Authentication

Submission auth type:

```text
noauth
```

Basic event search is public and does not require a personal account. Saved preference, feedback, personalized recommendation, read, update, and deletion tools require the connector `profile_id` plus the private `profile_secret` returned when the user opts in to preference memory. Ticket purchase tools require an event-specific locked quote and explicit written confirmation; third-party-only offers return external checkout handoff unless an integrated provider is configured.

All 21 tool descriptors advertise `securitySchemes: [{ "type": "noauth" }]` and mirror the same value in `_meta.securitySchemes` for ChatGPT compatibility.

Tool descriptors also include ChatGPT invocation status text in `_meta["openai/toolInvocation/invoking"]` and `_meta["openai/toolInvocation/invoked"]`, with verifier-enforced strings under the 64-character limit.

## Privacy And Preference Memory

Basic event search does not require a personal account.

Search location is limited to user-provided city, neighborhood, venue, or event-area filters. The connector does not request GPS coordinates, street addresses, or full chat transcripts.

Preference learning is opt-in. The assistant must ask whether Dizko may save event preferences before creating or updating a profile.

When a profile is created:

- The user receives an opaque `profile_id`.
- The user receives a one-time private `profile_secret`.
- The raw secret is returned once.
- The service stores only a hash of the secret.
- The response includes `access_instructions` for clients that cannot persist connector state.

Stored connector data can include:

- saved event preferences
- event feedback
- ratings and notes
- event ids and timestamps
- derived taste signals
- learned avoid signals
- personalization summaries

Retention:

- Saved preference profiles and feedback are retained until user deletion or 24 months of profile inactivity, whichever comes first.
- The preference store automatically prunes inactive profiles after the configured retention window, defaulting to 730 days.
- Technical logs and diagnostics are normally retained for up to 30 days unless needed longer for abuse, security, fraud, reliability, or support investigations.
- Operational backups or derived diagnostic copies, if any, are scheduled to age out within 30 days after deletion.

Deletion is handled by `delete_event_preferences` and is scoped to Dizko connector preferences and feedback history. The tool requires `confirm_delete: true`, which should only be sent after the user confirms that scope.

## Review Prompts

Use these in ChatGPT Developer Mode on web and mobile and capture screenshots.

1. Find five techno events in Berlin this weekend.
2. Find something good tonight in Berlin, but ask me what kind of event and vibe first.
3. Ask what kind of events I generally like, save my preferences after I consent, ask what type/vibe I want this weekend, and recommend events.
4. Ask me a follow-up about whether I liked a returned event, record my answer, and explain how future recommendations changed.
5. Show ticket options for a returned event, quote 2 tickets with a max total, and ask me for written confirmation before purchase.
6. Delete my Dizko saved event preferences and feedback history.

Expected behavior:

- Event prompts return live events with event URLs and ticket/source links when available.
- Current-context prompts use `get_event_search_followups` before search when type, vibe, budget, area, or avoidances are missing.
- Preference creation uses consent-first onboarding.
- Personalized recommendations use saved preferences plus learned feedback.
- Post-event learning uses `get_event_feedback_prompt` before `record_event_feedback`; empty feedback is rejected.
- Ticket-purchase prompts use `get_ticket_offers`, `quote_ticket_order`, and written confirmation before `purchase_ticket_order`; third-party-only offers return checkout handoff rather than a false purchase claim.
- Deletion calls `delete_event_preferences` only after explicit confirmation and explains the Dizko-only deletion scope.

## Screenshot Checklist

Capture these from the actual ChatGPT connector flow:

- Connector setup screen showing the hosted MCP endpoint connected.
- Tool list or tool-call details showing 17 Dizko Events tools.
- Live event search result with at least one event URL.
- Current-context follow-up questions before a broad tonight/week/weekend search.
- Consent-first preference onboarding.
- Personalized recommendation after profile creation or reuse.
- Post-event feedback prompt and successful feedback recording.
- Preference deletion scoped to Dizko connector data.

Use `SCREENSHOT_CHECKLIST.md` for exact filenames, prompts, and expected evidence.

## Verified Technical State

Latest local evidence summary:

```text
submission-evidence/latest-summary.md
```

Live-generated review prompt transcript:

```bash
npm run review:demo
```

Output:

```text
submission-evidence/review-demo.md
```

The demo transcript is generated from live MCP tool calls, redacts `profile_secret`, and deletes its temporary preference profile at the end of the run.

Latest preflight passed with:

- health endpoint
- metadata endpoint
- MCP `initialize`
- MCP `notifications/initialized`
- privacy page
- support page
- logo asset
- security.txt
- 21 tool descriptors
- tool annotations
- output schemas
- rate-limit headers
- live search
- current-context follow-ups
- feedback prompt
- preference profile creation
- private access-card behavior
- wrong-secret rejection
- feedback learning
- preference deletion
- Railway deployment metadata
- dashboard field validation

Current production deployment:

```text
771149dc-039d-4fc1-aeef-7d7db59c15eb
```

Current production image:

```text
sha256:93e2471aee3607d423ffd33d74acb3407786c3c3fd7cc8bc5b22c27800106e93
```

## Before Clicking Submit

Run:

```bash
npm run preflight:submission
npm run submission:status
```

Confirm both commands report `ok: true`. In `submission:status`, confirm `ready_for_openai_dashboard_submission` is `true` and `submit_endpoint` is the hosted MCP endpoint.

Then complete these external-only steps:

- Add the MCP endpoint in ChatGPT Developer Mode.
- Run the review prompts on ChatGPT web and mobile.
- Capture screenshots from the actual ChatGPT UI.
- Complete individual or business publisher verification if the OpenAI dashboard requires it.
- Submit using the hosted MCP endpoint, not the unresolved custom domain.
