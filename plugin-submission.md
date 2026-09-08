# Dizko Events Plugin Submission Draft

Use this as the working copy for ChatGPT Apps Directory / Codex Plugin Directory submission fields.

Machine-readable dashboard copy is also available in `submission-fields.json`. Validate it against the latest live evidence with:

```bash
npm run verify:submission:bundle
npm run verify:submission:fields
```

Full local-plus-live preflight before dashboard submission:

```bash
npm run preflight:submission
```

Normal-user setup, prompt examples, and preference-memory behavior are summarized in `USER_GUIDE.md`.
Final dashboard handoff is summarized in `OPENAI_SUBMISSION_PACKET.md`.

## Name

Dizko Events

## Short Description

Find current concerts, parties, nightlife, festivals, and cultural events from Dizko's live event inventory.

## Long Description

Dizko Events is Dizko's connector for ChatGPT, Claude, and MCP-compatible agents. It connects users to live event listings across 47 cities, supports structured search by city, date, genre, vibe, neighborhood, venue, artist, promoter, price, and event type, then returns verifiable event links, ticket URLs, and local times. It also looks up DJs, venues, and promoters with their upcoming dates, and gives daily city roundups and city trend reads. Recommendation tools include explainable taste ranking, compact night plans with fallbacks, consent-based saved preferences with per-weekday day filters, and post-event feedback learning. Ticket tools can show offers, create signed quotes, require explicit written confirmation, and either hand off third-party checkout or use an integrated provider such as Hermes, OpenClaw, Dizko Checkout, a partner API, or delegated payment when configured.

## Discovery Phrases

- Find events this weekend in Berlin.
- Use Dizko to find live events this weekend.
- What techno events are happening tonight near me?
- Plan a night out in New York with underground music.
- Find free cultural events in Paris.
- Show events at a specific venue.
- Who is this DJ and when do they play next?
- Remember what kind of events I like and recommend something for this weekend.
- I went to that event yesterday; I liked the music but not the crowd.
- Give me a Dizko roundup of everything happening in Berlin today.

## MCP Endpoint

Production:

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

Security contact metadata:

```text
https://mcp.dizko.app/.well-known/security.txt
```

Logo:

```text
https://mcp.dizko.app/logo-512.png
```

Local logo file:

```text
public/submission-assets/dizko-events-logo-512.png
```

Local development:

```text
http://127.0.0.1:8787/mcp
```

## Tools

All 19 tools, in `tools/list` order (descriptions summarize `src/tools.js`):

- `dizko_search_events`: Search live Dizko events in one city and timeframe; the call for any "what's on" request. Filters are hard; `avoid` and `max_price` are ranking hints; a profile ranks by saved taste without filtering.
- `dizko_plan_night`: Build a night plan for one city and date: a primary event, a nearby fallback, a later fallback, and alternates.
- `dizko_daily_roundup`: One-day digest for a city: top picks plus category sections, personalized with a profile, `compact` for push-style digests.
- `dizko_city_pulse`: Aggregate read of a city's scene over 1-14 days: busiest nights, top venues, genre mix, headline events, free-event count, all with evidence counts.
- `dizko_get_event`: Full detail for one event id.
- `dizko_list_cities`: Live coverage with status (live, unlocking, early), event count, timezone and freshness.
- `dizko_find_artist`: Look up a DJ or artist by name, or by id for the full profile including upcoming events and the published Dizko page.
- `dizko_find_venue`: Look up a club or venue by name or id, with upcoming events at that venue.
- `dizko_find_promoter`: Look up a promoter, collective or party crew, with upcoming events.
- `dizko_artist_events`: Upcoming shows grouped by artist for up to 8 named artists, optionally scoped to a city; tracks the profile's saved artists when none are named.
- `dizko_create_profile`: Create a private preference profile after explicit consent; returns `profile_id` and a one-time `profile_secret`.
- `dizko_update_profile`: Add to or replace saved preferences with `profile_id`, `profile_secret` and consent.
- `dizko_get_profile`: Read saved preferences, learned taste and feedback count.
- `dizko_delete_profile`: Delete saved preferences and feedback history with `confirm_delete: true` after user confirmation.
- `dizko_record_feedback`: Store post-event feedback (liked, 1-5 rating, notes) and update learned taste; rejects empty feedback.
- `dizko_ticket_offers`: Ticket options for one event, including checkout link and whether autonomous purchase is supported, plus the purchase policy.
- `dizko_quote_tickets`: Create a signed, time-limited quote and the exact confirmation text to ask for.
- `dizko_purchase_tickets`: Execute a quoted order after explicit written confirmation, or return the external checkout handoff.
- `dizko_calendar_file`: Build an importable `.ics` calendar entry for one event.

Prompts (`prompts/list`): `dizko_onboarding` (consent-first questions before `dizko_create_profile`), `dizko_search_followups` (optional clarifying questions for a broad search), `dizko_post_event_feedback` (questions before `dizko_record_feedback`), `dizko_ticket_policy` (the ticket safety rules).

## Privacy Notes

The public version does not require personal accounts for basic event search. Preference learning is opt-in: the assistant asks whether Dizko may save preferences before calling `dizko_create_profile` or `dizko_update_profile`. New users receive an opaque `dzk_...` profile id and a private `dzs_...` profile secret that the assistant can remember for future recommendations. The creation response also returns `access_instructions`, a user-facing access card for clients that cannot persist connector state across sessions. The raw secret is returned once and stored only as a hash by the MCP service. Stored data can include a profile id, hashed profile secret, event preferences, liked/disliked event feedback, ratings, notes, event ids, timestamps, and derived learned taste signals. Users can request deletion through `dizko_delete_profile`, which requires `confirm_delete: true` after the user confirms the Dizko-only deletion scope. Search location is limited to user-provided city, neighborhood, venue, or event-area filters; `origin_lat`/`origin_lng` are only accepted for distance sorting when the user supplies them. Do not collect GPS coordinates on the user's behalf, street addresses, full chat transcripts, or agent prompts unless the tool schemas, privacy policy, and submission packet are explicitly updated and re-reviewed.

Saved preference profiles and feedback are retained until user deletion or 24 months of inactivity, whichever comes first. The preference store automatically prunes inactive profiles after the configured retention window, defaulting to 730 days. Technical logs and diagnostics are normally retained for up to 30 days unless needed longer for abuse, security, fraud, reliability, or support investigations.

Learning rules: a like promotes the event's genres, vibe, event types, venue and promoters. A dislike marks the venue and promoter and only penalizes genres when the notes blame the music; genres need two negative signals before becoming an avoid rule. Notes such as "liked the music," "too crowded," "too expensive," or "too late" become learned preference or avoid signals. A term the user saved as a preference is never learned negative. Saved and learned taste rank results; they never hide events.

## Review Test Prompts

See `golden-prompts.md` for the fuller direct, indirect, and negative prompt set used for metadata and routing regression checks.

1. Find five techno events in Berlin this weekend.
2. Recommend a low-cost night out in London tonight with intimate or underground vibes.
3. Plan a Saturday night in New York with a concert first and a late party fallback.
4. Who is Nina Kraviz and when does she play next?
5. Get details for an event id returned by search.
6. Ask what kind of events I generally like, save my preferences after I consent, ask what type/vibe I want this weekend, and recommend events.
7. Ask me a follow-up about whether I liked a returned event, record my answer, and explain how future recommendations changed.
8. Delete my Dizko saved event preferences and feedback history.

## Pre-Submission Checklist

- Public HTTPS MCP endpoint is deployed and reachable.
- `/health` returns `{"ok":true,"name":"dizko","version":"<version>"}`.
- Tool list and descriptions are final.
- Tool annotations correctly label read-only, write, destructive, and open-world behavior.
- Tool descriptors include ChatGPT invocation status text in `_meta["openai/toolInvocation/invoking"]` and `_meta["openai/toolInvocation/invoked"]`.
- Search, entity and preference tools use `openWorldHint: false`; `dizko_delete_profile` is destructive; `dizko_purchase_tickets` is destructive/open-world because it is the bounded action point for ticket purchase or checkout handoff.
- Tool descriptors intentionally omit `outputSchema`; every result is returned as `structuredContent` plus a JSON text block, and the verifier asserts no `outputSchema` is served.
- Every input parameter has a description and defaults are served in the schema.
- The server advertises the `prompts` capability with `dizko_onboarding`, `dizko_search_followups`, `dizko_post_event_feedback`, and `dizko_ticket_policy`; clarifying questions before a broad search are conversational and optional.
- Profile creation returns `access_instructions` so users can reuse their profile in clients that do not persist connector state automatically.
- Preference storage has a persistent backing store or mounted volume (single replica).
- `DIZKO_QUOTE_SIGNING_SECRET` is set on the hosted deployment.
- CSP is defined for the MCP service and allows only the exact current fetch/image domains.
- `/mcp` responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`; the default limit (600/min per IP) is generous enough for ChatGPT review traffic.
- Privacy policy describes saved preferences, feedback, retention, and deletion.
- Test prompts produce accurate, relevant results on ChatGPT web and mobile.
- Privacy policy URL and support URL are ready.
- Company URL and English localization fields are ready.
- Logo URL and local logo file are ready.
- ChatGPT connector screenshots are captured from Developer Mode.
- Business or individual verification is complete in the OpenAI Platform Dashboard.

## ChatGPT UI Evidence Checklist

Capture these from the actual ChatGPT connector flow before submitting:

- Connector setup screen showing the hosted MCP endpoint connected.
- Tool list or tool-call details showing all 19 `dizko_*` tools.
- Live search result for a current event prompt, including at least one event URL.
- Clarifying questions asked conversationally before a broad tonight/week/weekend search, followed by one search call.
- Consent-first preference onboarding before saving preferences.
- Personalized recommendation after creating or reusing a preference profile.
- Post-event feedback questions and successful feedback recording.
- Preference deletion flow scoped to Dizko connector data.

Run this command before submitting to generate a JSON evidence report for the reachable endpoint, current Railway deployment metadata, public pages, logo, CSP/security headers, tool list, tool annotations, prompts, live search, and preference-memory flow:

```bash
npm run verify:submission
```

To also save that evidence as a local review artifact:

```bash
npm run verify:submission:write
```

This writes `submission-evidence/latest.json` with the exact production endpoint, current Railway deployment id and image digest, check timestamp, public-page/security-header results, tool metadata, rate-limit headers, live search sample, prompt checks, and the preference-memory create/read/feedback/delete flow. The folder is intentionally gitignored because each run contains timestamps and live sample ids.

To generate both the raw JSON evidence and a human-readable submission summary for the dashboard handoff:

```bash
npm run verify:submission:bundle
```

This writes:

- `submission-evidence/latest.json`
- `submission-evidence/latest-summary.md`

Validate the stable dashboard-copy JSON against the latest evidence:

```bash
npm run verify:submission:fields
```

Run the complete preflight immediately before submitting:

```bash
npm run preflight:submission
```

Security and vulnerability reporting are documented in `SECURITY.md` and on the hosted support page. Security reports should go to `security@dizko.app`.

## Current External Submission Blockers

- Capture screenshots from ChatGPT Developer Mode after adding the MCP connector. These must come from the actual ChatGPT UI.
- Complete individual or business verification in the OpenAI Platform Dashboard if the submitting account has not already done so.
- Submit the app through the OpenAI dashboard review flow.
- Keep `mcp.dizko.app` attached to the Railway service and verify it with `npm run domain:check` before submission.
