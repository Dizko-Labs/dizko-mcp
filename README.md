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
client: **https://www.dizko.app/mcp/install** (`https://mcp.dizko.app/install`
redirects there).

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

Claude Desktop one-click bundle: `npm run build:mcpb` produces
`dist/dizko-events-<version>.mcpb`; the hosted server serves it at
`/download/dizko-events.mcpb`.

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
     -H 'mcp-method: tools/call' \
     -H 'mcp-name: dizko_search_events' \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"dizko_search_events","arguments":{"city":"los angeles","when":"week"},"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}'
   ```

   The `_meta` block is what makes this a `2026-07-28` request: the revision
   is stateless, so there is no `initialize` handshake and no session - every
   request carries its own protocol version and client capabilities. Call
   `server/discover` to see which revisions the endpoint speaks. Clients on
   `2025-11-25` and earlier keep working unchanged; omit `_meta` and the
   server answers them over the 2025-era path instead.

4. **In-process library**: embed the tools directly (no MCP layer). The package
   exposes a stable API:

   ```js
   import { tools, prompts, callTool, getPrompt, searchEvents } from "dizko-events";
   // Hand `tools` (JSON Schemas) to your model as function definitions, then:
   const result = await callTool("dizko_search_events", { city: "berlin", when: "weekend" });
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
await callTool("dizko_purchase_tickets", input, { ticketPurchaseProvider: hermesAdapter });
```

`dizko_purchase_tickets` still requires a signed quote from `dizko_quote_tickets`
and explicit written confirmation before the adapter is invoked. The
`dizko_ticket_policy` prompt explains the rules. Set `DIZKO_QUOTE_SIGNING_SECRET`
so quote tokens survive restarts.

---

This package exposes Dizko's live event inventory to agents and humans:

- `dizko-events`: a CLI for quick searches, ranked recommendations, night plans, client install, and diagnostics.
- `dizko-events mcp` (binary `dizko-events-mcp`): a stdio MCP server for local developer clients.
- `dizko-events serve` (binary `dizko-events-http`): an HTTP MCP server for hosted connectors/apps.
- Agentic ticket tools for ticket offers, signed quotes, written confirmation, checkout handoff, and future Hermes/OpenClaw/Dizko purchase adapters.

## Why This Beats Normal Chat

General chat can describe likely events, but it does not reliably know current inventory. This tool gives an agent:

- Live structured results from Dizko's `/events` API across 47 cities, with every time already in the city's local timezone.
- Deterministic filters for city, date, genre, vibe, event type, venue, neighborhood, promoter, price, and artist.
- Artist, venue and promoter lookups with upcoming dates, and city-level trend reads with evidence counts.
- Explainable ranking so recommendations include reasons instead of opaque taste guesses.
- Ticket links and Dizko event links for verification, plus one-click calendar and directions links.
- A planning tool that returns a primary option plus fallbacks in a compact machine-readable shape.
- Consent-based preference learning: onboarding questions, saved taste profiles, post-event feedback, note-derived signals, and learned ranking signals. Saved taste only ranks results; it never hides them.
- Ticket purchase safety rails: agents can quote and prepare ticket orders, but autonomous purchase requires a signed quote, explicit written confirmation, and an integrated purchase provider.

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
dizko-events search --city berlin --when weekend --genres techno --limit 5
```

From this repository:

```bash
node ./bin/dizko.js search --city berlin --when weekend --genres techno --limit 5
node ./bin/dizko.js recommend --city new-york --when tonight --vibe underground,intimate --max-price 30
node ./bin/dizko.js plan --city london --when weekend --event-types party --avoid mainstream
node ./bin/dizko.js cities
node ./bin/dizko.js doctor
```

`doctor` checks DNS resolution, the API health endpoint, the hosted MCP endpoint (health, metadata, tools/list), and one small live search, reporting the underlying cause of any failure. Run it first whenever a search fails.

Transient network failures (`EAI_AGAIN`, `ETIMEDOUT`, `ECONNRESET`, `ENOTFOUND`, temporary 5xx) are retried automatically and reported as `retryable: true` with the underlying cause, code, hostname, and target URL when they persist. All surfaces (CLI, stdio MCP, hosted MCP, smoke test, monitor) resolve endpoints through `src/config.js`; see [Configuration](#configuration).

## MCP For Local Developer Clients

Run the stdio MCP server from npm:

```bash
npm exec --yes --package dizko-events -- dizko-events-mcp
```

Or from this repository:

```bash
node ./bin/dizko-mcp.js
```

Example MCP client config:

```json
{
  "mcpServers": {
    "dizko": {
      "command": "node",
      "args": ["/absolute/path/to/dizko-mcp/bin/dizko-mcp.js"],
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
      "args": ["exec", "--yes", "--package", "dizko-events", "--", "dizko-events-mcp"],
      "env": {
        "DIZKO_API_BASE_URL": "https://api.dizko.app"
      }
    }
  }
}
```

## Tools

The server lists 19 tools (the count comes from `tools.length` in `src/tools.js`; scripts and monitors read it from there rather than hard-coding it). Every parameter carries a description and defaults are served in the schema.

Discovery:

- `dizko_search_events`: search live events in one city and timeframe. Use for any "what's on" request that names a city, a venue, an artist, or a timeframe. Filters you pass (`genres`, `vibe`, `event_types`, `neighborhoods`, `venue`, `featuring`, `promoter`, `free`, `pride`, `price_min`, `price_max`) are hard filters; `avoid` and `max_price` are ranking hints. `count` is the total matching; page with `limit`/`offset`.
- `dizko_plan_night`: a night plan for one city and date: a primary event plus a nearby fallback (best taste fit within 6 km), a later-starting fallback, and alternates. Same filters as search; `city` may be omitted when a profile with a saved home city is given.
- `dizko_daily_roundup`: one-day digest for a city: top picks plus sections for parties, live music, art, comedy and theatre, talks, food, and more. `compact=true` gives a short push-style digest. Built for "what's happening today" and scheduled briefings.
- `dizko_city_pulse`: aggregate read of a city's scene over 1-14 days: busiest nights, top venues, genre mix, headline events and free-event count, every stat with evidence counts. Public inventory only.
- `dizko_get_event`: full detail for one event id (local times, venue and address, price, lineup, set times, artist socials, image, coordinates, links). Search results already contain what the render template needs, so only call it for an id the user gave you.
- `dizko_list_cities`: live coverage: every city with status (`live`, `unlocking`, `early`), event count, timezone and freshness.

Entities:

All three searches rank candidates by how well the name answers the query, not by upstream relevance: an exact name first, then a name that starts with the query, then a whole-word hit, then a hit buried inside a longer word. The catalog name has to contain what was typed, never the reverse, so a profile called "Honey" is not an answer for "Honey Dijon". Two rows for the same name are one answer rather than an ambiguity, since catalogs carry the same venue twice under different casing.

When several candidates answer the name equally well, the name has said all it can, so how much of an answer each one actually is decides. `prominence` scores that: for an artist, listed Dizko dates, upcoming dates, co-billed artists, press clips, mixes, career appearances and editorial standing; for a venue, whether the record carries a capacity, genres and a real bio rather than a one-line stub; for a promoter, its upcoming count. `best_match.confident` is true only when the leader wins outright on name, or is decisively ahead on prominence. So "Klock" resolves confidently to Ben Klock (nine listed dates, twelve press clips) over BJ Klock (one appearance), while two comparable artists sharing a name stay ambiguous and `best_match.alternatives` carries the candidates to ask about.

An exact name match is never overridden by prominence: someone who types a profile's full name means that profile. Artist prominence costs two extra upstream calls per tied candidate and is fetched only when a tie makes it matter, so an unambiguous lookup pays nothing for it; venue and promoter scores come from rows the search already returned. Upstream relevance cannot do this job: its score ranked Nina Kraviz last of nineteen "Nina" profiles and its `authority` field is 0.59 for every artist in the catalog.

- `dizko_find_artist`: search by `query` for candidates with a `best_match`, or pass an `id` for the full profile: bio, cities, genres, links, upcoming events, insights, mixes, press, and the artist's published Dizko page (`page.published`, `page.page_url`) when one exists.
- `dizko_find_venue`: search by name, or pass an `id` for neighborhood, capacity, genres, bio, links, and upcoming events at that venue. Listings are matched room by room, so Berghain Kantine does not inherit Berghain's Klubnacht and Berghain does not claim Kantine's programme. A venue with no listing under its full name falls back to its colloquial short form, which is how "Salon zur Wilden Renate" finds events listed at "Renate".
- `dizko_find_promoter`: promoters, collectives and party crews. Pass `city` to include promoters with upcoming listings (promoter ids are per city; collectives are searched worldwide); pass an `id` for the profile and upcoming events.
- `dizko_artist_events`: upcoming shows grouped by artist for up to 8 named DJs, performers or comedians, deduplicated and date-ordered, optionally scoped to a city. With a profile and no artists named, it tracks the profile's saved `featuring` list.

Preferences (opt-in, protected by `profile_id` + `profile_secret`):

- `dizko_create_profile`: create a private preference profile after explicit consent (`consent: true`). Returns `profile_id` (`dzk_...`) and a one-time `profile_secret` (`dzs_...`); the service stores only a hash of the secret.
- `dizko_update_profile`: add to (`mode: merge`, default) or replace saved preferences: cities, event types, genres, vibe, neighborhoods, venues, promoters, artists to track (`featuring`), avoid, budget, and per-weekday `day_filters`.
- `dizko_get_profile`: saved preferences, learned taste (with scores) and feedback count.
- `dizko_delete_profile`: delete saved preferences and feedback history; requires `confirm_delete: true` after the user confirms. Destructive.
- `dizko_record_feedback`: store post-event feedback (`liked`, 1-5 `rating`, `notes`) and update learned taste. At least one signal is required.

Tickets and calendar:

- `dizko_ticket_offers`: ticket options for one event: provider, checkout link, estimated price, free entry, whether autonomous purchase is supported, and the purchase policy. Call before quoting.
- `dizko_quote_tickets`: a signed, time-limited (10 minute) quote: quantity, ticket type, max total, currency, refund terms, delivery email and stop conditions. Returns `quote_token` and the exact confirmation text to ask the user for.
- `dizko_purchase_tickets`: execute a quoted order after the user's explicit written confirmation. With a third-party link it returns `status: requires_external_checkout` and the `checkout_url`; never claim a purchase unless `status` is `purchased`. Destructive and open-world.
- `dizko_calendar_file`: an importable `.ics` entry for one event; the per-event `calendar_url` is the one-click alternative.

Annotations: the discovery, entity, `dizko_get_profile`, `dizko_ticket_offers`, `dizko_quote_tickets` and `dizko_calendar_file` tools are `readOnlyHint: true`. `dizko_create_profile`, `dizko_update_profile` and `dizko_record_feedback` write private connector memory (`readOnlyHint: false`, `destructiveHint: false`). `dizko_delete_profile` is `destructiveHint: true`; `dizko_purchase_tickets` is `destructiveHint: true` and `openWorldHint: true` because it is the bounded action point for ticket purchase or checkout handoff. No tool serves an `outputSchema`; results come back as `structuredContent` plus a JSON text block.

Auth note: the public hosted connector submits as `noauth` for event discovery. Preference tools still require the user's opaque `profile_id` plus private `profile_secret`. Tool descriptors include `securitySchemes: [{ "type": "noauth" }]` and mirror it in `_meta.securitySchemes` for ChatGPT compatibility, plus `_meta["openai/toolInvocation/invoking"]` / `invoked` status text.

Retention note: saved preference profiles are pruned after the configured inactivity window (`DIZKO_PREFERENCE_RETENTION_DAYS`, default 730 days), matching the published 24-month retention policy.

### Prompts

The server also advertises the `prompts` capability with four prompts (`prompts/list`, `prompts/get`):

- `dizko_onboarding`: consent-first questions to ask before `dizko_create_profile`.
- `dizko_search_followups` (`city`, `when` optional): the clarifying questions worth asking before a broad "what's on" search. Optional: the server instructions tell the assistant to ask these conversationally and only when the request is genuinely ambiguous.
- `dizko_post_event_feedback` (`event_id` required): short questions to ask before `dizko_record_feedback`.
- `dizko_ticket_policy`: how quoting, confirmation, checkout handoff and autonomous purchase work, plus the hard safety rules.

### Request conventions

- **Timeframes.** `when` accepts `today`, `tonight`, `tomorrow`, `weekend`, `next weekend`, `week`, `next week`, `month`, a weekday name, `any`, or an exact `YYYY-MM-DD`; all are resolved in the city's timezone. `date_from`/`date_to` (inclusive, city-local) override `when` for custom ranges. `dizko_daily_roundup` accepts single-day presets only.
- **Event payloads** carry `when` (already local, e.g. `Fri 11 Sep, 22:00`), `starts_at`/`ends_at` (UTC), `starts_at_local`, `timezone`, `venue`, `address`, `city`, `price`, `genres`, `vibe`, `event_types`, `lineup` (capped, with `lineup_count` when truncated), `set_times`, `featured`, `promoters` (names), `ticket_url`, `event_url`, `calendar_url`, `directions_url`. Ask for `description`, `images`, `coordinates`, `socials`, `source`, or full `promoters` objects via `fields`.
- **Ordering.** `sort_by`: `soonest` (default for single-day requests), `popular` (default for ranges), `cost`, `event_type`, or `distance` with `origin_lat`/`origin_lng` (only pass coordinates the user gave you). `rank`: `relevance` (default) keeps the API order; `taste` re-ranks the page by genres, vibe, avoid and budget from the request and the profile. `rank` defaults to `taste` when a profile is given.
- **Profiles.** `profile_id` + `profile_secret` are accepted by `dizko_search_events`, `dizko_plan_night`, `dizko_daily_roundup` and `dizko_artist_events`. Saved taste is a ranking hint only; it is never turned into a filter.
- **Empty results.** A search or plan that matches nothing is not an error. It returns `no_results` with `reason` (`filters_too_narrow`, `empty_timeframe` or `no_inventory`), `baseline_count` (how many events exist in the same city and timeframe with every filter removed), `active_filters`, and `suggested_relaxations`: an ordered list of `{ relax, why, retry_with }` where `retry_with` is a directly callable argument set. Price caps are suggested first because they also exclude every event with no published price. The `assistant_instruction` on an empty result tells the model to report what is on instead of rendering an empty list.
- **Errors** are returned as `isError: true` with `{ error, code, field?, allowed?, hint? }`. Codes: `invalid_argument`, `unknown_tool`, `unsupported_city` (with `nearest_covered_city` computed by distance from the live list), `event_not_found`, `entity_not_found`, `profile_not_found`, `profile_secret_invalid`, `consent_required`, `confirmation_required`, `feedback_signal_required`, `invalid_quote_token`, `confirmation_mismatch`, `quote_expired`, `upstream_unavailable`, `upstream_timeout`.

### Learning rules

- A like promotes the event's genres, vibe, event types, venue and promoters.
- A dislike marks the venue and promoter. Genres are only penalized when the notes blame the music or lineup.
- Notes about crowds, price, timing, mainstream or alcohol-focused events become learned avoid signals.
- A term the user saved as a preference is never learned negative.
- Genres, vibe and event types need two negative signals before they become an avoid rule; venues and promoters need one.

### Migrating from 0.7

0.7 tool names keep working as hidden aliases (they answer `tools/call` but are not in `tools/list`), so existing connectors and scripts do not break. New integrations should use the 0.8 names:

| 0.7 | 0.8 |
| --- | --- |
| `search_events` | `dizko_search_events` |
| `recommend_events` | `dizko_search_events` with `rank: "taste"` (`result_limit` → `limit`) |
| `recommend_events_for_user` | `dizko_search_events` with `profile_id`/`profile_secret` (`rank` defaults to `taste`) |
| `plan_night` | `dizko_plan_night` |
| `get_daily_roundup` | `dizko_daily_roundup` |
| `get_city_pulse` | `dizko_city_pulse` |
| `get_event` | `dizko_get_event` |
| `list_cities` | `dizko_list_cities` |
| `find_scene_entities` | `dizko_find_artist`, `dizko_find_venue`, `dizko_find_promoter` |
| `get_artist_page` | `dizko_find_artist` with `id` (the `page` object) |
| `get_artist_events` | `dizko_artist_events` |
| `create_event_preference_profile` | `dizko_create_profile` |
| `save_event_preferences` | `dizko_update_profile` |
| `get_event_preferences` | `dizko_get_profile` |
| `delete_event_preferences` | `dizko_delete_profile` |
| `record_event_feedback` | `dizko_record_feedback` |
| `get_ticket_offers` | `dizko_ticket_offers` |
| `quote_ticket_order` | `dizko_quote_tickets` |
| `purchase_ticket_order` | `dizko_purchase_tickets` |
| `create_event_calendar_file` | `dizko_calendar_file` |
| `get_preference_onboarding` | prompt `dizko_onboarding` |
| `get_event_search_followups` | prompt `dizko_search_followups` |
| `get_event_feedback_prompt` | prompt `dizko_post_event_feedback` |
| `get_ticket_purchase_policy` | prompt `dizko_ticket_policy` |

Profile ids changed prefix from `upg_` to `dzk_` and secrets from `ups_` to `dzs_`; profiles created before 0.8 keep working with their existing values.

## Hosted MCP For ChatGPT And Claude

For normal users, publish a hosted MCP endpoint rather than asking them to run a local command.

```bash
PORT=8787 node ./bin/dizko-http.js
```

Endpoints:

- `POST /mcp`: JSON-RPC MCP endpoint (rate-limited, optional bearer token).
- `GET /health`: deployment health check.
- `GET /`: basic service metadata.
- `GET /install`: redirects to the per-client install guide at `https://www.dizko.app/mcp/install`.
- `GET /e/<event-id>/cal`, `/map`, `/ics`: short links used in tool payloads: Google Calendar template, Google Maps directions, and a downloadable `.ics` file. They share the `/mcp` rate limiter.
- `GET /download/dizko-events.mcpb`: the Claude Desktop bundle when `dist/` contains one.
- `GET /privacy-policy.html`, `/support.html`, `/terms.html`, `/user-guide.html`, `/install.html`: public pages.
- `GET /.well-known/security.txt` (also `/security.txt`): vulnerability-reporting contact metadata.
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
See `SECURITY.md` for vulnerability reporting, the security posture, and operational safeguards.
See `REGISTRY_PUBLISHING.md` and `DIRECTORY_SUBMISSIONS.md` for registry and directory listings.

Live smoke test:

```bash
npm run monitor:live
npm run smoke:live
```

`monitor:live` is read-only and suitable for uptime checks; it expects the tool count from the package's tool registry. `smoke:live` also exercises the prompts and temporary preference profile creation and deletion.

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

The bundle command saves `submission-evidence/latest.json` and `submission-evidence/latest-summary.md` for dashboard review prep while keeping generated evidence out of git. The evidence includes the verified endpoint, current Railway deployment id, image digest, public-page checks, tool metadata, live search, prompt checks, and the preference-memory flow.
The fields command validates `submission-fields.json`, the stable dashboard-copy artifact, against the latest live evidence, including deployment metadata and the served tool count.
The preflight command runs local tests, live smoke, live submission evidence generation, and dashboard-field validation in one pass.
The status command gives a final go/no-go for OpenAI dashboard submission and names the single endpoint to submit.
The review-demo command writes a sanitized `submission-evidence/review-demo.md` transcript from live MCP calls for dashboard prompt/response prep.

Support deletion utility:

```bash
npm run preferences:delete -- --profile-id dzk_... --profile-secret dzs_... --preferences-path /data/preferences.json
```

This is for support deletion requests when the user cannot call `dizko_delete_profile` through their MCP client.

## Configuration

`DIZKO_*` names are preferred. `EVENTCHAT_*` (and, for the four URLs, `UPLAYGROUND_*`) are legacy aliases the code still accepts; the HTTP server's own settings are read under `EVENTCHAT_*` only.

Shared by every surface (`src/config.js`):

| Variable | Default | Legacy aliases | Purpose |
| --- | --- | --- | --- |
| `DIZKO_API_BASE_URL` | `https://api.dizko.app` | `EVENTCHAT_API_BASE_URL`, `UPLAYGROUND_API_BASE_URL` | Events API. |
| `DIZKO_WEB_BASE_URL` | `https://www.dizko.app` | `EVENTCHAT_WEB_BASE_URL`, `UPLAYGROUND_WEB_BASE_URL` | Public event links. |
| `DIZKO_MCP_URL` | `https://mcp.dizko.app/mcp` | `EVENTCHAT_MCP_URL`, `UPLAYGROUND_MCP_URL` | Hosted endpoint; also the base for `/e/<id>/...` short links. |
| `DIZKO_APP_DOWNLOAD_URL` | `https://www.dizko.app/ios` | `EVENTCHAT_APP_DOWNLOAD_URL`, `UPLAYGROUND_APP_DOWNLOAD_URL` | `app_download_url` in results. |
| `DIZKO_API_TIMEOUT_MS` | `8000` | `EVENTCHAT_API_TIMEOUT_MS` | Per-request upstream timeout. |
| `DIZKO_API_RETRIES` | `2` | `EVENTCHAT_API_RETRIES` | Retries for transient network/5xx failures (backoff + jitter). |
| `DIZKO_API_RETRY_BASE_DELAY_MS` | `250` | `EVENTCHAT_API_RETRY_BASE_DELAY_MS` | Backoff base delay. |
| `DIZKO_API_CACHE_TTL_MS` | `300000` | `EVENTCHAT_API_CACHE_TTL_MS` | Upstream response cache; `0` disables. |
| `DIZKO_API_CACHE_STALE_MS` | `3600000` | `EVENTCHAT_API_CACHE_STALE_MS` | How long an expired cache entry may be served while the upstream fails. |
| `DIZKO_USER_AGENT` | `DizkoEventsTool/<version>` | `EVENTCHAT_USER_AGENT` | User agent sent upstream. |
| `DIZKO_MCP_UPSTREAM_SECRET` | unset | `EVENTCHAT_MCP_UPSTREAM_SECRET` | Shared secret the hosted deployment sends to the Dizko API as the `X-Dizko-MCP-Secret` header. |

Tickets, preferences (`src/tickets.js`, `src/preferences.js`):

| Variable | Default | Legacy aliases | Purpose |
| --- | --- | --- | --- |
| `DIZKO_QUOTE_SIGNING_SECRET` | random per process | `EVENTCHAT_QUOTE_SIGNING_SECRET` | HMAC key for quote tokens. Set it on hosted deployments so quotes survive restarts; the per-process fallback is only safe for a single instance. |
| `DIZKO_MAX_TRACKED_QUOTES` | `20000` | none | How many spent-quote claims are held at once. Sized for concurrent live quotes: expired claims are pruned first, so the ceiling is only reached by that many unexpired claims. At the ceiling a purchase is refused (`quote_registry_full`) rather than an existing claim being dropped. |
| `DIZKO_PREFERENCES_PATH` | `./data/preferences.json` | `EVENTCHAT_PREFERENCES_PATH` | Preference store file. |
| `DIZKO_PREFERENCE_RETENTION_DAYS` | `730` | `EVENTCHAT_PREFERENCE_RETENTION_DAYS` | Inactive profiles are pruned after this many days. |
| `DIZKO_MAX_PROFILES` | `10000` | `EVENTCHAT_MAX_PROFILES` | Ceiling on stored profiles. At the ceiling, profiles that were created but never used or consented to are evicted oldest-first; only if that frees nothing does creation fail with `profile_limit_reached`. |
| `DIZKO_MAX_PROFILE_BYTES` | `98304` | `EVENTCHAT_MAX_PROFILE_BYTES` | Ceiling on one serialized profile. Over it, the oldest feedback entries are dropped to fit (their signal already lives in `learned`); a profile still too large with no feedback left is refused with `profile_too_large`. |
| `EVENTCHAT_ALLOW_LEGACY_PROFILE_IDS` | unset | none | `true` lets pre-secret legacy profiles be read without a secret. Keep it unset in production. |

HTTP server (`src/httpServer.js`, `EVENTCHAT_*` only):

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` / `EVENTCHAT_MCP_PORT` | `8787` | Listen port (`PORT` wins). |
| `HOST` / `EVENTCHAT_MCP_HOST` | `0.0.0.0` | Listen host. |
| `EVENTCHAT_MCP_BEARER_TOKEN` | unset (public) | When set, `/mcp` requires `Authorization: Bearer <token>`. Short links and public pages stay open. |
| `EVENTCHAT_MCP_ALLOWED_ORIGINS` | `*` | Comma list for `Access-Control-Allow-Origin`. When set to anything but `*`, a request carrying an `Origin` outside the list is refused with 403 rather than only being denied by the browser. Requests with no `Origin` (every non-browser client) are unaffected. |
| `EVENTCHAT_MCP_RATE_LIMIT_MAX` | `600` | Requests per window per client IP on `/mcp` and short links. |
| `EVENTCHAT_MCP_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window. |
| `EVENTCHAT_MCP_RATE_LIMIT_EXEMPT` | empty | Comma list of IP prefixes exempt from the limiter (hosted assistants call from shared egress addresses). |
| `EVENTCHAT_MCP_RATE_LIMIT_DISABLED` | `false` | Disable the limiter entirely. |
| `EVENTCHAT_MCP_MAX_BODY_BYTES` | `1048576` | Maximum JSON-RPC body. |
| `EVENTCHAT_MCP_MAX_BATCH_SIZE` | `20` | Maximum requests in one JSON-RPC batch. A larger batch is rejected with `-32600` before any of it runs; each element in an accepted batch is charged to the rate limiter. |
| `EVENTCHAT_MCP_TRUSTED_PROXIES` | `1` | How many proxy hops sit in front of the server. The rate-limit client IP is taken this many entries from the right of `X-Forwarded-For`, so a caller cannot pick their own bucket by prepending addresses. Set it to the real hop count behind a CDN plus load balancer. |

## Flows

Personalization:

1. User asks for personalized event help.
2. Assistant asks the onboarding questions (prompt `dizko_onboarding`): event types, genres, vibe, budget, locations, avoidances.
3. Assistant asks whether Dizko may save those preferences.
4. If yes and there is no existing profile, assistant calls `dizko_create_profile` with `consent: true` and privately remembers the returned `profile_id` and `profile_secret`. The response also includes `access_instructions`, a user-facing access card for clients that cannot persist connector state across sessions.
5. If a profile already exists, assistant calls `dizko_update_profile` with both `profile_id` and `profile_secret`.
6. A request that names a city and a timeframe is one `dizko_search_events` call with the profile attached. Clarifying questions (type, vibe, budget, area) are asked conversationally and only when the request is genuinely ambiguous.
7. Preferences can include `day_filters`, per-weekday rules such as techno Fridays but chill Sundays. Array fields add to the general taste and `max_price`/`free`/`nightlife` override it, but only on that weekday: single-day searches (tonight, tomorrow, an explicit date) and daily roundups apply the matching day automatically.
8. For a daily digest ("what's happening today?", a scheduled morning briefing), assistant calls `dizko_daily_roundup` with the city plus the profile credentials and renders top picks followed by category sections.
9. After the event, assistant asks whether the user went and liked it (prompt `dizko_post_event_feedback`), then calls `dizko_record_feedback` only after the user provides liked/disliked, rating, or notes.

Ticket purchase:

1. User asks to buy or reserve tickets for an event.
2. Assistant calls `dizko_ticket_offers` with the event id.
3. Assistant explains whether the offer supports autonomous purchase or only external checkout.
4. Assistant calls `dizko_quote_tickets` with quantity, ticket type, max total, currency, and refund constraints, and receives a signed `quote_token` plus the confirmation prompt.
5. Assistant asks for explicit written confirmation, for example: `Yes, buy 2 ticket(s) for Ostbahnhof XL, max total EUR240. Stop if price, date, venue, ticket type, quantity, or refund terms change.` The confirmation must contain `buy` or `purchase` as a whole word plus the quantity and the max total as whole numbers; `confirmation_mismatch` lists what is missing.
6. Assistant calls `dizko_purchase_tickets` with the unchanged `quote_token` only after that confirmation. Quotes expire after 10 minutes (`quote_expired`); edited tokens fail signature verification (`invalid_quote_token`).
7. If the quote uses `external_checkout`, the tool returns `requires_external_checkout` and a checkout URL. The assistant must not claim it purchased the ticket.
8. If Hermes, OpenClaw, Dizko Checkout, or another integrated provider is configured, the provider can execute the bounded purchase and return order/receipt/ticket delivery status. `supported_modes`: `external_checkout`, `partner_api_purchase`, `dizko_checkout`, `delegated_payment_future`.

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

The public ChatGPT user surface is the hosted MCP endpoint plus OpenAI app submission. The npm package is the developer distribution path for local agents, Claude Desktop-style MCP clients, Cursor and Windsurf setups, and technical testers who can run a command. The source is available under the MIT License for inspection, reuse, and issue reporting.

Before publishing a new npm version:

```bash
npm test
npm pack --dry-run --json
npm publish --access public
```
