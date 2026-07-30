# Dizko Events CLI and MCP

## Quick Start

**Recommended: add the hosted connector. It runs on our servers, so it never
gets access to your computer (no scary local-install warning), needs no install
and no auth:**

```text
https://mcp.dizko.app/mcp
```

Paste that into your client's **Settings → Connectors → Add custom connector**
(claude.ai, Claude Desktop, ChatGPT developer mode, Cursor). Step-by-step per
client: **https://mcp.dizko.app/install**

For Claude Code:

```bash
claude mcp add --transport http dizko-events https://mcp.dizko.app/mcp
```

**Advanced: run the server locally** (only if you can't use the hosted
connector, e.g. a free Claude plan or a client that only supports local
servers). A local server runs as you, so Claude Desktop warns it "can access
everything on your computer". That is inherent to *any* local MCP extension,
not something this package over-requests. The hosted connector above avoids it.

```bash
npx -y dizko-events install claude-desktop   # writes the local config
# or the raw stdio snippet for any client:
{ "command": "npx", "args": ["-y", "dizko-events", "mcp"] }
```

Claude Desktop one-click bundle: `npm run build:mcpb` produces `dist/dizko-events-<version>.mcpb`.

## Agent frameworks (Hermes, OpenClaw, LangGraph, OpenAI Agents SDK, custom loops)

Framework agents don't have a "Connectors" UI, so they integrate programmatically.
Four paths, simplest first:

1. **Remote MCP over HTTP**: point the framework's MCP client at the hosted
   endpoint `https://mcp.dizko.app/mcp`
   (streamable-http, no auth). Works with the official MCP SDKs, the OpenAI
   Agents SDK, LangGraph/LangChain MCP adapters, Pydantic AI, etc.

2. **stdio MCP**: spawn `npx -y dizko-events mcp` as a subprocess and
   speak MCP over stdio.

3. **Raw HTTP JSON-RPC**: no MCP library needed; POST to `/mcp`:

   ```bash
   curl -s https://mcp.dizko.app/mcp \
     -H 'content-type: application/json' \
     -H 'accept: application/json, text/event-stream' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"search_events","arguments":{"city":"los angeles","when":"this week"}}}'
   ```

4. **In-process library**: embed the tools directly (no MCP layer). The package
   exposes a stable API:

   ```js
   import { tools, callTool, searchEvents } from "dizko-events";
   // Hand `tools` (JSON Schemas) to your model as function definitions, then:
   const result = await callTool("search_events", { city: "berlin", when: "weekend" });
   ```

### Autonomous ticket purchase (the Hermes / OpenClaw integration point)

By default the ticket tools return a **checkout handoff** (a link). To enable
bounded autonomous purchase, supply a `ticketPurchaseProvider` adapter. This is
only injectable when you **embed the package** or **self-host the server** - the
hosted endpoint runs in our process and cannot accept your payment adapter.

```js
import { createHttpMcpServer, callTool } from "dizko-events";

const hermesAdapter = {
  canPurchase: (event, summary) => true,
  purchase: async ({ quote, confirmation_text, delivery_email, add_to_calendar }) => {
    // ... perform the bounded purchase, return { status, order_id, receipt_url }
  }
};

// Self-host with the adapter wired in:
createHttpMcpServer({ ticketPurchaseProvider: hermesAdapter }).listen(8787);

// ...or call tools in-process with it:
await callTool("purchase_ticket_order", input, { ticketPurchaseProvider: hermesAdapter });
```

`purchase_ticket_order` still requires a locked quote from `quote_ticket_order`
and explicit written confirmation before the adapter is invoked. See
`get_ticket_purchase_policy`.

---

This package exposes Dizko's live event inventory to agents and humans:

- `dizko-events`: a CLI for quick searches, ranked recommendations, night plans, client install, and diagnostics.
- `dizko-events mcp` (alias `eventchat-events-mcp`): a stdio MCP server for local developer clients.
- `dizko-events serve` (alias `eventchat-events-http`): an HTTP MCP server for hosted connectors/apps.
- Agentic ticket tools for ticket offers, locked quotes, written confirmation, checkout handoff, and future Hermes/OpenClaw/Dizko purchase adapters.

## Why This Beats Normal Chat

General chat can describe likely events, but it does not reliably know current inventory. This tool gives an agent:

- Live structured results from Dizko's `/events` API.
- Deterministic filters for city, date, genre, vibe, venue, price, attendance, neighborhood, and artist.
- Explainable ranking so recommendations include reasons instead of opaque taste guesses.
- Ticket links and Dizko event links for verification.
- A planning tool that returns primary options plus fallbacks in a compact machine-readable shape.
- Consent-based preference learning: onboarding questions, saved taste profiles, post-event feedback, note-derived signals, and learned ranking signals.
- Negative feedback becomes learned avoid signals, so future recommendations can steer away from disliked genres, vibes, event types, or venues.
- Ticket purchase safety rails: agents can quote and prepare ticket orders, but autonomous purchase requires a locked quote, explicit written confirmation, and an integrated purchase provider.

The agent can still write conversational prose, but its event facts come from the tool.

## CLI

Run without installing:

```bash
npm exec --yes --package dizko-events -- dizko-events search --city "Los Angeles" --when week --limit 5
npm exec --yes --package dizko-events -- dizko-events recommend --city "New York" --when tonight --vibe underground,intimate --max-price 30
```

Or install the early-access developer package:

```bash
npm install -g dizko-events
eventchat-events search --city berlin --when weekend --genres techno --limit 5
```

From this repository:

```bash
node ./bin/eventchat-events.js search --city berlin --when weekend --genres techno --limit 5
node ./bin/eventchat-events.js recommend --city new-york --when tonight --vibe underground,intimate --max-price 30
node ./bin/eventchat-events.js plan --city london --when weekend --event-types party --avoid mainstream
node ./bin/eventchat-events.js cities
node ./bin/eventchat-events.js doctor
```

`doctor` checks DNS resolution, the API health endpoint, the hosted MCP endpoint (health, metadata, tools/list), and one small live search, reporting the underlying cause of any failure. Run it first whenever a search fails.

Environment (all surfaces - CLI, stdio MCP, hosted MCP, smoke test, and monitor - resolve endpoints through the same `src/config.js`):

```bash
DIZKO_API_BASE_URL=https://api.dizko.app
DIZKO_WEB_BASE_URL=https://www.dizko.app
DIZKO_MCP_URL=https://mcp.dizko.app/mcp
DIZKO_API_TIMEOUT_MS=8000
DIZKO_API_RETRIES=2                  # transient network/5xx failures retry with backoff + jitter
DIZKO_API_RETRY_BASE_DELAY_MS=250
EVENTCHAT_MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com,https://claude.ai
```

Transient network failures (`EAI_AGAIN`, `ETIMEDOUT`, `ECONNRESET`, `ENOTFOUND`, temporary 5xx) are retried automatically and reported as `retryable: true` with the underlying cause, code, hostname, and target URL when they persist.

## MCP For Local Developer Clients

Run the stdio MCP server from npm:

```bash
npm exec --yes --package dizko-events -- eventchat-events-mcp
```

Or from this repository:

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
        "DIZKO_API_BASE_URL": "https://api.dizko.app"
      }
    }
  }
}
```

Example MCP client config using npm:

```json
{
  "mcpServers": {
    "dizko-events": {
      "command": "npm",
      "args": ["exec", "--yes", "--package", "dizko-events", "--", "eventchat-events-mcp"],
      "env": {
        "DIZKO_API_BASE_URL": "https://api.dizko.app"
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
- `get_daily_roundup`: one-day digest for a city: ranked top picks plus parties, live music, art, comedy, talks, and food sections. Built for recurring morning briefings; optional profile-secret access personalizes the ranking with saved, learned, and per-day preferences.
- `get_artist_events`: upcoming shows grouped by artist for named DJs, performers, or comedians. With profile-secret access and no artists named, it tracks the profile's saved `featuring` list.
- `get_city_pulse`: aggregate momentum read for a city over the coming days: busiest nights, top venues, genre mix, and headline events, every stat carrying its evidence counts. Public inventory only.
- `get_event`: detail lookup by event id.
- `get_ticket_purchase_policy`: explains current purchase modes, hard safety rules, and provider requirements.
- `get_ticket_offers`: returns ticket options for an event, including checkout URL and whether autonomous purchase is supported.
- `quote_ticket_order`: creates a locked quote with quantity, max total, ticket type, expiration, and stop conditions.
- `purchase_ticket_order`: accepts explicit written confirmation and either executes an integrated provider purchase or returns the required external checkout handoff.

Annotation note: search and recommendation tools read live event data, and preference tools write only private connector memory protected by `profile_id` plus `profile_secret`. Only `purchase_ticket_order` is marked destructive/open-world because it is the bounded action point for ticket purchases or checkout handoff.

Ticket note: `purchase_ticket_order` is intentionally marked destructive and open-world because it is the future action boundary for autonomous ticket purchase. In the default npm/hosted build, third-party ticket links return `requires_external_checkout`; the tool does not scrape checkout pages, bypass CAPTCHAs, or charge cards. True autonomous purchase requires a provider adapter such as Hermes, OpenClaw, Dizko Checkout, a partner ticketing API, or an approved delegated-payment flow.

Auth note: the public hosted connector submits as `noauth` for basic event discovery. Saved preference, feedback, personalized recommendation, read, update, and deletion tools still require the user's opaque `profile_id` plus private `profile_secret`. Tool descriptors include `securitySchemes: [{ "type": "noauth" }]` and mirror it in `_meta.securitySchemes` for ChatGPT compatibility.

Deletion safety note: `delete_event_preferences` also requires `confirm_delete: true`, which should only be sent after the user confirms they want to delete Dizko connector preferences and feedback history.

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
https://mcp.dizko.app/mcp
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
The status command gives a final go/no-go for OpenAI dashboard submission, names the endpoint to submit, and keeps unresolved custom-domain status separate from hosted endpoint readiness.
The review-demo command writes a sanitized `submission-evidence/review-demo.md` transcript from live MCP calls for dashboard prompt/response prep.

Support deletion utility:

```bash
npm run preferences:delete -- --profile-id upg_... --profile-secret ups_... --preferences-path /data/preferences.json
```

This is for support deletion requests when the user cannot call `delete_event_preferences` through their MCP client.

Personalization flow:

1. User asks for personalized event help.
2. Assistant calls `get_preference_onboarding` and asks what events, genres, vibe, budget, locations, and avoidances the user generally likes.
3. Assistant asks whether Dizko may save those preferences.
4. If yes and there is no existing profile, assistant calls `create_event_preference_profile` and privately remembers the returned `profile_id` and `profile_secret`.
5. The creation response also includes `access_instructions`, a user-facing access card for clients that cannot persist connector state across sessions.
6. If a profile already exists, assistant calls `save_event_preferences` with both `profile_id` and `profile_secret`.
7. For tonight/week/weekend searches, assistant calls `get_event_search_followups`, asks lightweight current-context questions, then calls `recommend_events_for_user`.
8. Preferences can include `day_filters`, per-weekday rules such as techno Fridays but chill Sundays. Array fields add to the general taste and `max_price`/`free`/`nightlife` override it, but only on that weekday: single-day searches (tonight, tomorrow, an explicit date) and daily roundups apply the matching day automatically.
9. For a daily digest ("what's happening today?", a scheduled morning briefing), assistant calls `get_daily_roundup` with the city plus the profile credentials and renders top picks followed by category sections.
10. After the event, assistant calls `get_event_feedback_prompt`, asks whether the user went and liked it, then calls `record_event_feedback` only after the user provides liked/disliked, rating, or notes.

Ticket purchase flow:

1. User asks to buy or reserve tickets for an event.
2. Assistant calls `get_ticket_offers` with the event id.
3. Assistant explains whether the offer supports autonomous purchase or only external checkout.
4. Assistant calls `quote_ticket_order` with quantity, ticket type, max total, currency, and refund constraints.
5. Assistant asks for explicit written confirmation, for example: `Yes, buy 2 ticket(s) for Ostbahnhof XL, max total USD240. Stop if price, date, venue, ticket type, quantity, or refund terms change.`
6. Assistant calls `purchase_ticket_order` only after that confirmation.
7. If the quote uses `external_checkout`, the tool returns `requires_external_checkout` and a checkout URL. The assistant must not claim it purchased the ticket.
8. If Hermes, OpenClaw, Dizko Checkout, or another integrated provider is configured, the provider can execute the bounded purchase and return order/receipt/ticket delivery status.

Provider adapter contract:

```js
{
  canPurchase(event, summary) {
    return true;
  },
  async purchase({ quote, confirmation_text, user_payment_profile_id, idempotency_key }) {
    return {
      purchased: true,
      status: "purchased",
      order_id: "...",
      receipt_url: "...",
      ticket_delivery_status: "pending_delivery",
      provider_response: {}
    };
  }
}
```

## Distribution Notes

The public ChatGPT user surface is the hosted MCP endpoint plus OpenAI app submission. The npm package is a day-zero developer distribution path for local agents, Claude Desktop-style MCP clients, Cursor/Windsurf setups, and technical testers who can run a command. It remains marked `UNLICENSED` because this is a proprietary early-access package, not an open-source release.

Before publishing a new npm version:

```bash
npm test
npm pack --dry-run --json
npm publish --access public
```
