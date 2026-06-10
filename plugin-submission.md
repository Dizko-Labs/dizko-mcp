# UPlayground Events Plugin Submission Draft

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

UPlayground Events

## Short Description

Find current concerts, parties, nightlife, festivals, and cultural events from UrbanPlayground's UPlayground live event inventory.

## Long Description

UPlayground Events is UrbanPlayground's connector for ChatGPT, Claude, and MCP-compatible agents. It connects users to live event listings across major cities, supports structured search by city, date, genre, vibe, neighborhood, venue, artist, price, attendance, and event type, then returns verifiable event links and ticket URLs. Recommendation tools include explainable taste matching, compact night plans with fallbacks, consent-based saved preferences, current-context follow-up questions, and post-event feedback learning.
Ticket tools can show ticket offers, create locked quotes, require explicit written confirmation, and hand off third-party checkout. Autonomous purchase is only available when a bounded provider adapter such as Hermes, OpenClaw, UPlayground Checkout, a partner ticketing API, or delegated payment is configured.

## Discovery Phrases

- Find events this weekend in Berlin.
- Use UrbanPlayground to find live events this weekend.
- What techno events are happening tonight near me?
- Plan a night out in New York with underground music.
- Find free cultural events in Paris.
- Show events at a specific venue.
- Remember what kind of events I like and recommend something for this weekend.
- I went to that event yesterday; I liked the music but not the crowd.

## MCP Endpoint

Production:

```text
https://eventchat-events-mcp-production.up.railway.app/mcp
```

Privacy policy:

```text
https://eventchat-events-mcp-production.up.railway.app/privacy-policy.html
```

Support:

```text
https://eventchat-events-mcp-production.up.railway.app/support.html
```

Terms:

```text
https://eventchat-events-mcp-production.up.railway.app/terms.html
```

User guide:

```text
https://eventchat-events-mcp-production.up.railway.app/user-guide.html
```

Security contact metadata:

```text
https://eventchat-events-mcp-production.up.railway.app/.well-known/security.txt
```

Logo:

```text
https://eventchat-events-mcp-production.up.railway.app/logo-512.png
```

Local logo file:

```text
public/submission-assets/uplayground-events-logo-512.png
```

Do not submit this branded endpoint until Railway custom-domain attachment and DNS are fixed:

```text
https://mcp.urbanplayground.xyz/mcp
```

Current status on June 9, 2026: `mcp.urbanplayground.xyz` resolves away from the Railway MCP service and returns 404 for `/health`, `/`, and `/mcp`. Use the verified Railway endpoint for review until `npm run domain:check` reports `ok: true`.

Local development:

```text
http://127.0.0.1:8787/mcp
```

## Tools

- `get_preference_onboarding`: Return consent-first questions the assistant should ask before saving a user's event preferences.
- `create_event_preference_profile`: Create an opaque preference profile after consent so the assistant can remember a stable profile id and private profile secret for future recommendations.
- `save_event_preferences`: Save or update a user's event preferences after explicit consent and profile-secret access.
- `get_event_preferences`: Read saved and learned event preferences with profile-secret access.
- `delete_event_preferences`: Delete a user's saved preferences and feedback history with profile-secret access and explicit confirmation.
- `record_event_feedback`: Record post-event feedback with profile-secret access so recommendations learn over time; rejects empty feedback unless liked/disliked, rating, or notes are supplied.
- `get_event_feedback_prompt`: Ask short post-event follow-up questions for a returned event before recording feedback.
- `get_event_search_followups`: Ask only the missing event type, vibe, budget, area, or avoidance questions before searching tonight/week/weekend events.
- `search_events`: Search live UPlayground event inventory with structured filters.
- `recommend_events`: Search and rank events for a user's taste, returning explainable recommendation reasons.
- `recommend_events_for_user`: Recommend events using saved preferences, learned feedback signals, profile-secret access, and the current night/week request.
- `plan_night`: Build a compact event plan with a primary option and fallbacks.
- `get_event`: Fetch detail for a specific UPlayground event id.
- `get_ticket_purchase_policy`: Explain purchase modes, safety rules, and provider requirements.
- `get_ticket_offers`: Return ticket options and whether autonomous purchase is supported for a specific event.
- `quote_ticket_order`: Create a locked quote with quantity, max total, ticket type, expiration, and stop conditions.
- `purchase_ticket_order`: Require explicit written confirmation, then either execute an integrated provider purchase or return external checkout handoff.

## Privacy Notes

The public version does not require personal accounts for basic event search. Preference learning is opt-in: the assistant asks whether UPlayground may save preferences before calling `create_event_preference_profile` or `save_event_preferences`. New users receive an opaque `upg_...` profile id and a private `ups_...` profile secret that the assistant can remember for future recommendations. The creation response also returns `access_instructions`, a user-facing access card for clients that cannot persist connector state across sessions. The raw secret is returned once and stored only as a hash by the MCP service. Stored data can include a profile id, hashed profile secret, event preferences, liked/disliked event feedback, ratings, notes, event ids, timestamps, and derived learned taste signals. Users can request deletion through `delete_event_preferences`, which requires `confirm_delete: true` after the user confirms the UPlayground-only deletion scope. Search location is limited to user-provided city, neighborhood, venue, or event-area filters. Do not collect GPS coordinates, street addresses, full chat transcripts, or agent prompts unless the tool schemas, privacy policy, and submission packet are explicitly updated and re-reviewed.

Saved preference profiles and feedback are retained until user deletion or 24 months of inactivity, whichever comes first. The preference store automatically prunes inactive profiles after the configured retention window, defaulting to 730 days. Technical logs and diagnostics are normally retained for up to 30 days unless needed longer for abuse, security, fraud, reliability, or support investigations.

Positive feedback promotes matching genres, vibes, event types, and venues. Notes such as "liked the music," "too crowded," "too expensive," or "too late" can become learned preference or avoid signals. Negative feedback is converted into learned avoid signals so future recommendations can explain when an event was penalized for a disliked tag.

## Review Test Prompts

See `golden-prompts.md` for the fuller direct, indirect, and negative prompt set used for metadata and routing regression checks.

1. Find five techno events in Berlin this weekend.
2. Recommend a low-cost night out in London tonight with intimate or underground vibes.
3. Plan a Saturday night in New York with a concert first and a late party fallback.
4. Get details for an event id returned by search.
5. Ask what kind of events I generally like, save my preferences after I consent, ask what type/vibe I want this weekend, and recommend events.
6. Ask me a follow-up about whether I liked a returned event, record my answer, and explain how future recommendations changed.
7. Delete my UPlayground saved event preferences and feedback history.

## Pre-Submission Checklist

- Public HTTPS MCP endpoint is deployed and reachable.
- `/health` returns `{"ok":true,"name":"eventchat-events"}`.
- Tool list and descriptions are final.
- Tool annotations correctly label read-only, write, destructive, and open-world behavior.
- Tool descriptors include ChatGPT invocation status text in `_meta["openai/toolInvocation/invoking"]` and `_meta["openai/toolInvocation/invoked"]`.
- Search and preference tools use `openWorldHint: false`; `purchase_ticket_order` is destructive/open-world because it is the bounded action point for ticket purchase or checkout handoff.
- Tool descriptors include `outputSchema` for structured event, recommendation, profile, feedback, deletion, and error responses.
- Tonight/week/weekend discovery includes a dedicated current-context follow-up prompt tool before searching.
- Post-event learning includes a dedicated follow-up prompt tool before saving feedback.
- Profile creation returns `access_instructions` so users can reuse their profile in clients that do not persist connector state automatically.
- Preference storage has a persistent backing store or mounted volume.
- CSP is defined for the MCP service and allows only the exact current fetch/image domains.
- `/mcp` responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`; the default limit is generous enough for ChatGPT review traffic.
- Privacy policy describes saved preferences, feedback, retention, and deletion.
- Test prompts produce accurate, relevant results on ChatGPT web and mobile.
- Privacy policy URL and support URL are ready.
- Company URL and English localization fields are ready.
- Logo URL and local logo file are ready.
- ChatGPT connector screenshots are captured from Developer Mode.
- Business or individual verification is complete in the OpenAI Platform Dashboard.

## ChatGPT UI Evidence Checklist

Capture these from the actual ChatGPT connector flow before submitting:

- Connector setup screen showing the Railway MCP endpoint connected.
- Tool list or tool-call details showing UPlayground Events exposes 18 tools.
- Live search result for a current event prompt, including at least one event URL.
- Current-context follow-up flow before a tonight/week/weekend search.
- Consent-first preference onboarding before saving preferences.
- Personalized recommendation after creating or reusing a preference profile.
- Post-event feedback prompt and successful feedback recording.
- Preference deletion flow scoped to UPlayground connector data.

Run this command before submitting to generate a JSON evidence report for the reachable endpoint, current Railway deployment metadata, public pages, logo, CSP/security headers, tool list, tool annotations, output schemas, live search, and preference-memory flow:

```bash
npm run verify:submission
```

To also save that evidence as a local review artifact:

```bash
npm run verify:submission:write
```

This writes `submission-evidence/latest.json` with the exact production endpoint, current Railway deployment id and image digest, check timestamp, public-page/security-header results, tool metadata, rate-limit headers, live search sample, current-context follow-up check, feedback-prompt check, and preference-memory create/read/feedback/delete flow. The folder is intentionally gitignored because each run contains timestamps and live sample ids.

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

Security and vulnerability reporting are documented in `SECURITY.md` and on the hosted support page. Security reports should go to `security@urbanplayground.xyz`.

## Current External Submission Blockers

- Capture screenshots from ChatGPT Developer Mode after adding the MCP connector. These must come from the actual ChatGPT UI.
- Complete individual or business verification in the OpenAI Platform Dashboard if the submitting account has not already done so.
- Submit the app through the OpenAI dashboard review flow.
- Optional: attach `mcp.urbanplayground.xyz` to the Railway service after Railway custom-domain authorization is available and DNS is repointed away from Vercel.
