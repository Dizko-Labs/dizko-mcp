# Submission Audit

Last reviewed: September 8, 2026 (0.8.0 tool rename)

This audit maps the Dizko Events MCP submission requirements to current evidence. Use it with `OPENAI_SUBMISSION_PACKET.md` when doing the final ChatGPT dashboard handoff.

Official OpenAI guidance checked on June 9, 2026:

- App submission flow and required dashboard materials: https://developers.openai.com/apps-sdk/deploy/submission
- Tool planning, metadata, and model-side guardrails: https://developers.openai.com/apps-sdk/plan/tools
- Tool annotations and review expectations: https://developers.openai.com/apps-sdk/app-submission-guidelines
- Metadata optimization guidance: https://developers.openai.com/apps-sdk/guides/optimize-metadata
- MCP authentication guidance: https://developers.openai.com/apps-sdk/build/auth

## Current Endpoint

```text
https://mcp.dizko.app/mcp
```

Custom-domain check:

```bash
npm run domain:check
```

Expected current state: success for `mcp.dizko.app`.

## Requirement Evidence

| Requirement | Current evidence |
| --- | --- |
| OpenAI dashboard materials | `submission-fields.json`, `OPENAI_SUBMISSION_PACKET.md`, `SCREENSHOT_CHECKLIST.md`, hosted logo, company URL, privacy URL, support URL, terms URL, user guide URL, review prompts, and generated test responses cover the current OpenAI submission checklist. |
| Public HTTPS MCP endpoint | Railway production endpoint above; `/health` and `/mcp` are verified by `npm run preflight:submission`. |
| Streamable HTTP MCP transport | `src/httpServer.js` and `src/sdkServer.js` serve protocol revision `2026-07-28` (stateless, no sessions) with a 2025-era fallback from the same definition; verified by live `server/discover`, `initialize`, `notifications/initialized`, `tools/list`, `prompts/get`, and `tools/call` checks. |
| Server-level MCP instructions | `server/discover` (and `initialize` for 2025-era clients) returns cross-tool guidance: one `dizko_search_events` call per city-plus-timeframe request, conversational clarifying questions, local-time rendering, coverage and `nearest_covered_city`, entity lookups, consent-first preference memory, feedback learning, and ticket quote/purchase handoff; enforced by tests and the live verifier. |
| Useful beyond normal ChatGPT answers | Live Dizko inventory across 47 cities, local times, structured event URLs, ticket/source links, calendar and directions links, deterministic filters, explainable ranking, night plans, daily roundups, city pulse, artist/venue/promoter lookups, preference memory, feedback learning, ticket offers, signed quotes, and written-confirmation purchase boundaries in `src/tools.js`. |
| Tool surface | 19 tools: `dizko_search_events`, `dizko_plan_night`, `dizko_daily_roundup`, `dizko_city_pulse`, `dizko_get_event`, `dizko_list_cities`, `dizko_find_artist`, `dizko_find_venue`, `dizko_find_promoter`, `dizko_artist_events`, `dizko_create_profile`, `dizko_update_profile`, `dizko_get_profile`, `dizko_delete_profile`, `dizko_record_feedback`, `dizko_ticket_offers`, `dizko_quote_tickets`, `dizko_purchase_tickets`, `dizko_calendar_file`. Pre-0.8 names still answer `tools/call` as hidden aliases but are not listed. |
| Prompts | `prompts/list` serves `dizko_onboarding`, `dizko_search_followups`, `dizko_post_event_feedback`, and `dizko_ticket_policy`; `dizko_search_followups` and `dizko_post_event_feedback` are exercised by the live verifier. |
| Preference onboarding | The `dizko_onboarding` prompt returns consent-first questions; `dizko_create_profile` refuses without `consent: true` (`consent_required`). Covered by tests and live verifier. |
| Saved user preferences | `dizko_create_profile`, `dizko_update_profile`, and `dizko_get_profile`; profile access uses `profile_id` (`dzk_...`) plus private `profile_secret` (`dzs_...`); saved taste ranks results and never filters them. |
| Learns over time | `dizko_record_feedback` updates learned preferences only after liked/disliked, rating, or notes are supplied; a like promotes genres, vibe, types, venue and promoters, a dislike marks venue and promoter and penalizes genres only when the notes blame the music; negative note signals create learned avoid signals; covered by `test/preferences.test.js` and live verifier. |
| Post-event follow-up | The `dizko_post_event_feedback` prompt asks short questions before `dizko_record_feedback`; covered by tests and live verifier. |
| User deletion control | `dizko_delete_profile` deletes saved connector preferences and feedback only when `confirm_delete: true`; support utility is `scripts/delete-preference-profile.mjs`. |
| Ticket quote and purchase boundary | `dizko_ticket_offers`, `dizko_quote_tickets`, and `dizko_purchase_tickets` support ticket offers, HMAC-signed quotes (`DIZKO_QUOTE_SIGNING_SECRET`), explicit written confirmation (buy/purchase plus quantity and max total), external checkout handoff, and future Hermes/OpenClaw/Dizko provider adapters; covered by tests and live verifier. |
| Privacy policy | Hosted at `/privacy-policy.html`; covers preference memory and ticket quote/order metadata; verified by `scripts/verify-submission.mjs`. |
| Terms and acceptable use | Hosted at `/terms.html`; covers event-detail volatility, third-party ticket/source links, preference memory, deletion confirmation, ticket checkout handoff, and acceptable use. |
| Public user guide | Hosted at `/user-guide.html`; gives normal users prompts, preference-memory behavior, feedback learning, ticket purchase safety, deletion, and support links. |
| Retention timelines | Privacy policy and dashboard notes state saved preference profiles are retained until deletion or 24 months inactivity, logs up to 30 days, and backups/diagnostic copies age out within 30 days after deletion; `FilePreferenceStore` automatically prunes inactive profiles after the configured retention window. |
| Support and security contact | Hosted `/support.html`, `/.well-known/security.txt`, and `SECURITY.md`; verified by `scripts/verify-submission.mjs`. |
| Minimal data collection | Tool schemas request event-specific filters and preference fields; docs state no GPS coordinates, street addresses, full chat transcripts, or agent prompts. `origin_lat`/`origin_lng` are accepted only for user-supplied distance sorting. |
| Tool annotations | All tools declare `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`; `dizko_delete_profile` is destructive, `dizko_purchase_tickets` is destructive and open-world; enforced by tests and live verifier. |
| Output schemas | None are served on purpose; every result is `structuredContent` plus a JSON text block. The verifier asserts `outputSchema` is absent. |
| Tool auth metadata | All tool descriptors advertise `securitySchemes: [{ "type": "noauth" }]` and mirror `_meta.securitySchemes`; enforced by tests and live verifier. |
| Tool invocation status metadata | All tool descriptors define `_meta["openai/toolInvocation/invoking"]` and `_meta["openai/toolInvocation/invoked"]` with text under the 64-character limit; enforced by tests and live verifier. |
| Public review assets | `submission-fields.json`, `OPENAI_SUBMISSION_PACKET.md`, `SCREENSHOT_CHECKLIST.md`, hosted logo, company URL, privacy URL, support URL, terms URL, user guide URL. |
| Localization | `submission-fields.json` and `OPENAI_SUBMISSION_PACKET.md` state default locale `en-US` and supported locale `en-US` for the initial review. |
| Review prompt transcript | `npm run review:demo` generates `submission-evidence/review-demo.md` from live MCP calls, redacts profile secrets, and deletes its temporary preference profile. |
| Package contents | `npm pack --dry-run --json` confirms runtime, scripts, docs, logo, and submission files are included while generated evidence remains ignored. |
| Public operation monitor | `npm run monitor:live` performs read-only health, metadata, tool-list (count from the package registry), and live-search checks and exits non-zero on failure. |
| Final launch readiness | `npm run submission:status` reads latest evidence, runs the live monitor and dashboard-field validation, and reports the single Dizko endpoint to submit. |
| Branded custom domain | `mcp.dizko.app`; `npm run domain:check` must report `ok: true` before review or release. |

## Verification Commands

Run immediately before dashboard submission:

```bash
npm run preflight:submission
npm run submission:status
npm run monitor:live
npm run review:demo
npm pack --dry-run --json
```

`npm run preflight:submission` runs local tests, live smoke checks, live submission evidence generation, summary generation, and dashboard-field validation.
`npm run submission:status` is the final local go/no-go check for dashboard submission with the Dizko endpoint.
`npm run monitor:live` is the lightweight read-only command for recurring uptime checks.
`npm run review:demo` creates a sanitized dashboard companion transcript for the review prompts.

## External Gates

These cannot be completed by code alone:

- Add the MCP endpoint in ChatGPT Developer Mode.
- Run the review prompts in ChatGPT web and mobile.
- Capture screenshots listed in `SCREENSHOT_CHECKLIST.md`.
- Complete OpenAI publisher verification if the submitting organization requires it.
- Submit the app from the OpenAI Platform Dashboard with an Owner or appropriately permissioned account.
