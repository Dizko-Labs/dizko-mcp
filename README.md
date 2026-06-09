# EventChat Events CLI and MCP

This package exposes UrbanPlayground's UPlayground live event inventory to agents and humans:

- `eventchat-events`: a CLI for quick searches, ranked recommendations, and night plans.
- `eventchat-events-mcp`: a stdio MCP server for local developer clients.
- `eventchat-events-http`: an HTTP MCP server for hosted connectors/apps.

## Why This Beats Normal Chat

General chat can describe likely events, but it does not reliably know current inventory. This tool gives an agent:

- Live structured results from UrbanPlayground's `/events` API.
- Deterministic filters for city, date, genre, vibe, venue, price, attendance, neighborhood, and artist.
- Explainable ranking so recommendations include reasons instead of opaque taste guesses.
- Ticket links and UPlayground event links for verification.
- A planning tool that returns primary options plus fallbacks in a compact machine-readable shape.
- Consent-based preference learning: onboarding questions, saved taste profiles, post-event feedback, note-derived signals, and learned ranking signals.
- Negative feedback becomes learned avoid signals, so future recommendations can steer away from disliked genres, vibes, event types, or venues.

The agent can still write conversational prose, but its event facts come from the tool.

## CLI

```bash
node ./bin/eventchat-events.js search --city berlin --when weekend --genres techno --limit 5
node ./bin/eventchat-events.js recommend --city new-york --when tonight --vibe underground,intimate --max-price 30
node ./bin/eventchat-events.js plan --city london --when weekend --event-types party --avoid mainstream
node ./bin/eventchat-events.js cities
```

Environment:

```bash
EVENTCHAT_API_BASE_URL=https://backend-production-958d.up.railway.app
EVENTCHAT_WEB_BASE_URL=https://urbanplayground.xyz
EVENTCHAT_MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com,https://claude.ai
```

## MCP For Local Developer Clients

Run the server:

```bash
node ./bin/eventchat-events-mcp.js
```

Example MCP client config:

```json
{
  "mcpServers": {
    "eventchat-events": {
      "command": "node",
      "args": ["/Users/zakkrevitt/EventChat/ios/EventChat/agent-tools/eventchat-events/bin/eventchat-events-mcp.js"],
      "env": {
        "EVENTCHAT_API_BASE_URL": "https://backend-production-958d.up.railway.app"
      }
    }
  }
}
```

Tools:

- `get_preference_onboarding`: returns the questions the assistant should ask before saving preferences.
- `create_event_preference_profile`: creates an opaque saved-preference profile after consent and returns a profile id plus private profile secret the assistant can remember.
- `save_event_preferences`: saves user preferences only after explicit consent and profile-secret access.
- `get_event_preferences`: reads saved and learned preferences with profile-secret access.
- `delete_event_preferences`: deletes a profile's saved preferences and feedback with profile-secret access and explicit user confirmation.
- `record_event_feedback`: stores post-event liked/disliked signals, ratings, or notes and updates learned signals with profile-secret access. Notes about music, crowd, price, timing, or venue can become learned preference or avoid signals. It rejects empty feedback.
- `get_event_feedback_prompt`: returns short post-event follow-up questions for a specific event before feedback is saved.
- `get_event_search_followups`: returns only the missing current-context questions before a tonight/week/weekend search.
- `search_events`: live structured event search.
- `recommend_events`: live search plus explainable taste ranking.
- `recommend_events_for_user`: live recommendations using saved preferences and learned feedback with profile-secret access.
- `plan_night`: compact plan with fallbacks.
- `get_event`: detail lookup by event id.

Annotation note: all current tools set `openWorldHint: false`. Search and recommendation tools read live event data, and preference tools write only private connector memory protected by `profile_id` plus `profile_secret`; no tool publishes content, buys tickets, messages third parties, or changes publicly visible internet state.

Auth note: the public hosted connector submits as `noauth` for basic event discovery. Saved preference, feedback, personalized recommendation, read, update, and deletion tools still require the user's opaque `profile_id` plus private `profile_secret`. Tool descriptors include `securitySchemes: [{ "type": "noauth" }]` and mirror it in `_meta.securitySchemes` for ChatGPT compatibility.

Deletion safety note: `delete_event_preferences` also requires `confirm_delete: true`, which should only be sent after the user confirms they want to delete UPlayground connector preferences and feedback history.

Retention note: saved preference profiles are automatically pruned after the configured inactivity window, defaulting to 730 days, matching the published 24-month retention policy.

## Hosted MCP For ChatGPT And Claude

For normal users, publish a hosted MCP endpoint rather than asking them to run a local command.

```bash
PORT=8787 node ./bin/eventchat-events-http.js
```

Endpoints:

- `POST /mcp`: JSON-RPC MCP endpoint.
- `GET /health`: deployment health check.
- `GET /`: basic service metadata.
- `GET /privacy-policy.html`: public privacy policy for saved preferences, feedback, retention, and deletion.
- `GET /support.html`: public support, deletion, and security-contact page.
- `GET /terms.html`: public connector terms and acceptable-use page.
- `GET /user-guide.html`: public normal-user guide with prompts, preference memory, feedback, and deletion behavior.
- `GET /.well-known/security.txt`: vulnerability-reporting contact metadata.
- `GET /logo-512.png`: 512px connector logo for submission metadata.

Current deployed endpoint:

```text
https://eventchat-events-mcp-production.up.railway.app/mcp
```

To become a ChatGPT app/plugin:

1. Deploy this HTTP server on a public HTTPS domain.
2. Test it in ChatGPT Developer Mode by creating a connector with that URL.
3. Validate tool calls on web and mobile.
4. Submit the app through the OpenAI dashboard with the public MCP URL, privacy/support URLs, logo, screenshots, test prompts, and tool descriptions.

Claude users can add the same public MCP URL as a custom connector where their plan/workspace supports remote MCP.

See `plugin-submission.md` and `submission-fields.json` for the working submission copy.
See `OPENAI_SUBMISSION_PACKET.md` for the final dashboard handoff packet.
See `SCREENSHOT_CHECKLIST.md` for exact ChatGPT Developer Mode screenshot prompts and filenames.
See `SUBMISSION_AUDIT.md` for requirement-to-evidence mapping and remaining external review gates.
See `USER_GUIDE.md` for normal-user prompts, preference-memory behavior, and support/privacy links.
See `DEPLOYMENT.md` for Railway, Docker, custom-domain, and review steps.
See `OPERATIONS.md` for health checks, logs, rollback, preference-data handling, and resubmission triggers.
See `golden-prompts.md` for direct, indirect, and negative prompt tests for connector discovery and tool routing.
See `SECURITY.md` for vulnerability reporting and operational safeguards.

Live smoke test:

```bash
npm run monitor:live
npm run smoke:live
```

`monitor:live` is read-only and suitable for uptime checks. `smoke:live` also exercises temporary preference profile creation and deletion.

Submission evidence:

```bash
npm run verify:submission
npm run verify:submission:write
npm run verify:submission:bundle
npm run verify:submission:fields
npm run submission:status
npm run review:demo
npm run preflight:submission
```

The bundle command saves `submission-evidence/latest.json` and `submission-evidence/latest-summary.md` for dashboard review prep while keeping generated evidence out of git. The evidence includes the verified endpoint, current Railway deployment id, image digest, public-page checks, tool metadata, live search, and preference-memory flow.
The fields command validates `submission-fields.json`, the stable dashboard-copy artifact, against the latest live evidence, including deployment metadata.
The preflight command runs local tests, live smoke, live submission evidence generation, and dashboard-field validation in one pass.
The status command gives a final go/no-go for OpenAI dashboard submission, names the endpoint to submit, and keeps unresolved custom-domain status separate from Railway endpoint readiness.
The review-demo command writes a sanitized `submission-evidence/review-demo.md` transcript from live MCP calls for dashboard prompt/response prep.

Support deletion utility:

```bash
npm run preferences:delete -- --profile-id upg_... --profile-secret ups_... --preferences-path /data/preferences.json
```

This is for support deletion requests when the user cannot call `delete_event_preferences` through their MCP client.

Personalization flow:

1. User asks for personalized event help.
2. Assistant calls `get_preference_onboarding` and asks what events, genres, vibe, budget, locations, and avoidances the user generally likes.
3. Assistant asks whether UPlayground may save those preferences.
4. If yes and there is no existing profile, assistant calls `create_event_preference_profile` and privately remembers the returned `profile_id` and `profile_secret`.
5. The creation response also includes `access_instructions`, a user-facing access card for clients that cannot persist connector state across sessions.
6. If a profile already exists, assistant calls `save_event_preferences` with both `profile_id` and `profile_secret`.
7. For tonight/week/weekend searches, assistant calls `get_event_search_followups`, asks lightweight current-context questions, then calls `recommend_events_for_user`.
8. After the event, assistant calls `get_event_feedback_prompt`, asks whether the user went and liked it, then calls `record_event_feedback` only after the user provides liked/disliked, rating, or notes.

## Distribution Notes

The production user surface is the hosted MCP endpoint, not an npm install. The npm package remains marked `UNLICENSED` because it is an internal/proprietary deployment artifact. If the code package itself is later published for third-party reuse, choose a public license and rerun `npm pack --dry-run --json` before publishing.
