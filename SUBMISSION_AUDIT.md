# Submission Audit

Last reviewed: June 9, 2026

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

Do not use `https://mcp.urbanplayground.xyz/mcp` for review until DNS and Railway custom-domain attachment are verified.

Custom-domain check:

```bash
npm run domain:check
```

Expected current state: non-zero exit because `mcp.urbanplayground.xyz` still resolves to Vercel and does not serve this MCP.

## Requirement Evidence

| Requirement | Current evidence |
| --- | --- |
| OpenAI dashboard materials | `submission-fields.json`, `OPENAI_SUBMISSION_PACKET.md`, `SCREENSHOT_CHECKLIST.md`, hosted logo, company URL, privacy URL, support URL, terms URL, user guide URL, review prompts, and generated test responses cover the current OpenAI submission checklist. |
| Public HTTPS MCP endpoint | Railway production endpoint above; `/health` and `/mcp` are verified by `npm run preflight:submission`. |
| Streamable HTTP MCP transport | `src/httpServer.js` and `src/sdkServer.js`; verified by live `initialize`, `notifications/initialized`, `tools/list`, and `tools/call` checks. |
| Server-level MCP instructions | `initialize` returns cross-tool guidance for live search, consent-first preference memory, follow-up questions, feedback learning, deletion, and ticket quote/purchase handoff; enforced by tests and live verifier. |
| Useful beyond normal ChatGPT answers | Live Dizko inventory, structured event URLs, ticket/source links, deterministic filters, explainable ranking, night plans, follow-up questions, preference memory, feedback learning, ticket offers, locked quotes, and written-confirmation purchase boundaries in `src/tools.js`. |
| Preference onboarding | `get_preference_onboarding` returns consent-first questions; covered by tests and live verifier. |
| Saved user preferences | `create_event_preference_profile`, `save_event_preferences`, and `get_event_preferences`; profile access uses `profile_id` plus private `profile_secret`. |
| Learns over time | `record_event_feedback` updates learned preferences only after liked/disliked, rating, or notes are supplied; negative feedback creates learned avoid signals; covered by `test/preferences.test.js` and live verifier. |
| Post-event follow-up | `get_event_feedback_prompt` asks short questions before `record_event_feedback`; covered by tests and live verifier. |
| User deletion control | `delete_event_preferences` deletes saved connector preferences and feedback only when `confirm_delete: true`; support utility is `scripts/delete-preference-profile.mjs`. |
| Ticket quote and purchase boundary | `get_ticket_offers`, `quote_ticket_order`, and `purchase_ticket_order` support ticket offers, locked quotes, explicit written confirmation, external checkout handoff, and future Hermes/OpenClaw/Dizko provider adapters; covered by tests and live verifier. |
| Privacy policy | Hosted at `/privacy-policy.html`; covers preference memory and ticket quote/order metadata; verified by `scripts/verify-submission.mjs`. |
| Terms and acceptable use | Hosted at `/terms.html`; covers event-detail volatility, third-party ticket/source links, preference memory, deletion confirmation, ticket checkout handoff, and acceptable use. |
| Public user guide | Hosted at `/user-guide.html`; gives normal users prompts, preference-memory behavior, feedback learning, ticket purchase safety, deletion, and support links. |
| Retention timelines | Privacy policy and dashboard notes state saved preference profiles are retained until deletion or 24 months inactivity, logs up to 30 days, and backups/diagnostic copies age out within 30 days after deletion; `FilePreferenceStore` automatically prunes inactive profiles after the configured retention window. |
| Support and security contact | Hosted `/support.html`, `/.well-known/security.txt`, and `SECURITY.md`; verified by `scripts/verify-submission.mjs`. |
| Minimal data collection | Tool schemas request event-specific filters and preference fields; docs state no GPS coordinates, street addresses, full chat transcripts, or agent prompts. |
| Tool annotations | All tools declare `readOnlyHint`, `destructiveHint`, `idempotentHint` where relevant, and `openWorldHint`; enforced by tests and live verifier. |
| Tool auth metadata | All tool descriptors advertise `securitySchemes: [{ "type": "noauth" }]` and mirror `_meta.securitySchemes`; enforced by tests and live verifier. |
| Tool invocation status metadata | All tool descriptors define `_meta["openai/toolInvocation/invoking"]` and `_meta["openai/toolInvocation/invoked"]` with text under the 64-character limit; enforced by tests and live verifier. |
| Public review assets | `submission-fields.json`, `OPENAI_SUBMISSION_PACKET.md`, `SCREENSHOT_CHECKLIST.md`, hosted logo, company URL, privacy URL, support URL, terms URL, user guide URL. |
| Localization | `submission-fields.json` and `OPENAI_SUBMISSION_PACKET.md` state default locale `en-US` and supported locale `en-US` for the initial review. |
| Review prompt transcript | `npm run review:demo` generates `submission-evidence/review-demo.md` from live MCP calls, redacts profile secrets, and deletes its temporary preference profile. |
| Package contents | `npm pack --dry-run --json` confirms runtime, scripts, docs, logo, and submission files are included while generated evidence remains ignored. |
| Public operation monitor | `npm run monitor:live` performs read-only health, metadata, tool-list, and live-search checks and exits non-zero on failure. |
| Final launch readiness | `npm run submission:status` reads latest evidence, runs the live monitor and dashboard-field validation, reports the hosted endpoint to submit, and keeps the unresolved custom-domain state as an informational non-blocker. |
| Branded custom domain | Not ready. `npm run domain:check` must report `ok: true` before any review or public docs switch to `mcp.urbanplayground.xyz`. |

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
`npm run submission:status` is the final local go/no-go check for dashboard submission with the hosted endpoint.
`npm run monitor:live` is the lightweight read-only command for recurring uptime checks.
`npm run review:demo` creates a sanitized dashboard companion transcript for the review prompts.

## External Gates

These cannot be completed by code alone:

- Add the MCP endpoint in ChatGPT Developer Mode.
- Run the review prompts in ChatGPT web and mobile.
- Capture screenshots listed in `SCREENSHOT_CHECKLIST.md`.
- Complete OpenAI publisher verification if the submitting organization requires it.
- Submit the app from the OpenAI Platform Dashboard with an Owner or appropriately permissioned account.
