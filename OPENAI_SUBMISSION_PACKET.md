# OpenAI Submission Packet

Use this file as the final handoff when submitting Dizko Events through the OpenAI dashboard.

## Submit These URLs

MCP endpoint (the only hosted endpoint):

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
Dizko Events is Dizko's connector for ChatGPT, Claude, and MCP-compatible agents. It connects users to live event listings across 47 cities, supports structured search by city, date, genre, vibe, neighborhood, venue, artist, promoter, price, and event type, then returns verifiable event links, ticket URLs, and local times. It also looks up DJs, venues, and promoters with their upcoming dates, and gives daily city roundups and city trend reads. Recommendation tools include explainable taste ranking, compact night plans with fallbacks, consent-based saved preferences with per-weekday day filters, and post-event feedback learning. Ticket tools can show offers, create signed quotes, require explicit written confirmation, and either hand off third-party checkout or use an integrated provider such as Hermes, OpenClaw, Dizko Checkout, a partner API, or delegated payment when configured.
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

- Searches live Dizko event inventory across 47 cities instead of relying on model memory.
- Makes Dizko event data available through MCP-compatible assistants, with every time already in the city's local timezone.
- Filters events by city, date, event type, genre, vibe, venue, artist, promoter, neighborhood, price, and avoid signals.
- Returns event links, ticket/source links, and one-click calendar and directions links.
- Looks up DJs, venues and promoters and their upcoming dates; reads a city's momentum with evidence counts.
- Recommends events with explainable ranking reasons.
- Plans nights out with primary and fallback options; builds daily roundups.
- Asks clarifying questions conversationally, and only when a broad request is genuinely ambiguous.
- Saves event preferences only after explicit consent.
- Learns over time from post-event feedback that includes liked/disliked, rating, or notes, including note-derived signals for music, crowd, price, timing, and venue.
- Converts negative feedback into learned avoid signals that rank, never hide, results.
- Lets users delete saved Dizko connector preferences and feedback.

## Authentication

Submission auth type:

```text
noauth
```

Basic event search is public and does not require a personal account. Saved preference, feedback, personalized recommendation, read, update, and deletion tools require the connector `profile_id` plus the private `profile_secret` returned when the user opts in to preference memory. Ticket purchase tools require an event-specific signed quote and explicit written confirmation; third-party-only offers return external checkout handoff unless an integrated provider is configured.

All 19 tool descriptors advertise `securitySchemes: [{ "type": "noauth" }]` and mirror the same value in `_meta.securitySchemes` for ChatGPT compatibility. The count is served by `tools/list` and validated against the package's tool registry by `npm run verify:submission:fields`.

Tool descriptors also include ChatGPT invocation status text in `_meta["openai/toolInvocation/invoking"]` and `_meta["openai/toolInvocation/invoked"]`, with verifier-enforced strings under the 64-character limit. No descriptor serves an `outputSchema`; results are returned as `structuredContent`.

## Privacy And Preference Memory

Basic event search does not require a personal account.

Search location is limited to user-provided city, neighborhood, venue, or event-area filters. The connector does not request GPS coordinates, street addresses, or full chat transcripts; `origin_lat`/`origin_lng` are accepted only for distance sorting when the user supplies them.

Preference learning is opt-in. The assistant must ask whether Dizko may save event preferences before creating or updating a profile.

When a profile is created:

- The user receives an opaque `profile_id` (`dzk_...`).
- The user receives a one-time private `profile_secret` (`dzs_...`).
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

Deletion is handled by `dizko_delete_profile` and is scoped to Dizko connector preferences and feedback history. The tool requires `confirm_delete: true`, which should only be sent after the user confirms that scope.

## Review Prompts

Use these in ChatGPT Developer Mode on web and mobile and capture screenshots.

1. Find five techno events in Berlin this weekend.
2. Find something good tonight in Berlin, but ask me what kind of event and vibe first.
3. Who is Nina Kraviz and when does she play next?
4. Ask what kind of events I generally like, save my preferences after I consent, ask what type/vibe I want this weekend, and recommend events.
5. Ask me a follow-up about whether I liked a returned event, record my answer, and explain how future recommendations changed.
6. Show ticket options for a returned event, quote 2 tickets with a max total, and ask me for written confirmation before purchase.
7. Delete my Dizko saved event preferences and feedback history.

Expected behavior:

- A prompt that names a city and a timeframe is one `dizko_search_events` call; events render with local `when`, Dizko event URLs and ticket/source links when available.
- Broad prompts get one or two clarifying questions asked conversationally (the `dizko_search_followups` prompt lists them; it is optional), then one search call.
- Artist prompts use `dizko_find_artist` (and `dizko_artist_events` for "when next").
- Preference creation uses consent-first onboarding (`dizko_onboarding`, then `dizko_create_profile`).
- Personalized recommendations pass `profile_id` and `profile_secret` to `dizko_search_events`; saved and learned taste rank results without hiding them.
- Post-event learning asks the `dizko_post_event_feedback` questions before `dizko_record_feedback`; empty feedback is rejected.
- Ticket-purchase prompts use `dizko_ticket_offers`, `dizko_quote_tickets`, and written confirmation before `dizko_purchase_tickets`; third-party-only offers return checkout handoff rather than a false purchase claim.
- Deletion calls `dizko_delete_profile` only after explicit confirmation and explains the Dizko-only deletion scope.

## Screenshot Checklist

Capture these from the actual ChatGPT connector flow:

- Connector setup screen showing the hosted MCP endpoint connected.
- Tool list or tool-call details showing all 19 Dizko Events tools.
- Live event search result with at least one event URL.
- Clarifying questions before a broad tonight/week/weekend search.
- Consent-first preference onboarding.
- Personalized recommendation after profile creation or reuse.
- Post-event feedback questions and successful feedback recording.
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

Preflight verifies:

- health endpoint
- metadata endpoint
- MCP `server/discover` (protocol revision `2026-07-28`)
- MCP `initialize` (2025-era backward-compatibility fallback)
- MCP `notifications/initialized`
- privacy page
- support page
- terms page and user guide
- logo asset
- security.txt
- 19 tool descriptors
- tool annotations
- no output schemas (results are `structuredContent`)
- rate-limit headers
- live search
- search follow-up prompt (`dizko_search_followups`)
- feedback prompt (`dizko_post_event_feedback`)
- preference profile creation
- private access-card behavior
- wrong-secret rejection
- feedback learning
- empty feedback rejection
- preference deletion
- Railway deployment metadata
- dashboard field validation

Current production deployment and image digest: read `latest_verified_deployment` from `npm run submission:status` (sourced from `submission-evidence/latest.json`) after deploying 0.8.0. The ids recorded in earlier revisions of this packet (deployment `771149dc-039d-4fc1-aeef-7d7db59c15eb`, image `sha256:93e2471aee3607d423ffd33d74acb3407786c3c3fd7cc8bc5b22c27800106e93`) predate the 0.8.0 tool rename and must not be submitted.

## Before Clicking Submit

Run:

```bash
npm run preflight:submission
npm run submission:status
```

Confirm both commands report `ok: true`. In `submission:status`, confirm `ready_for_openai_dashboard_submission` is `true` and `submit_endpoint` is `https://mcp.dizko.app/mcp`.

Then complete these external-only steps:

- Add the MCP endpoint in ChatGPT Developer Mode.
- Run the review prompts on ChatGPT web and mobile.
- Capture screenshots from the actual ChatGPT UI.
- Complete individual or business publisher verification if the OpenAI dashboard requires it.
- Submit using the hosted MCP endpoint `https://mcp.dizko.app/mcp`.
