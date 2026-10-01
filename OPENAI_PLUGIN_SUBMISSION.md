# ChatGPT and Codex Plugin Submission

> **Status: on hold (October 1, 2026). Do not submit.** The guidelines reject
> plugins that "scrape external websites or relay queries without
> authorization." A week of events across eight major cities was 71% Resident
> Advisor, which has no public API, and about 2% from sources with official
> APIs. Submit only after enough coverage comes from licensed partners,
> official APIs used within their terms, or first-party organizer and venue
> listings. Until then, users can add the connector privately as a custom
> connector. Everything below is ready for when sourcing is resolved.

OpenAI replaced the ChatGPT apps dashboard flow with a shared ChatGPT and Codex
plugin directory (DevDay, September 29, 2026). Submission is now a plugin ZIP
plus a review form. This file is the handoff for that flow. It supersedes
`OPENAI_SUBMISSION_PACKET.md`, `plugin-submission.md`, and
`submission-fields.json`, which describe the retired apps flow.

Official guidance checked October 1, 2026:

- Submission flow: https://developers.openai.com/apps-sdk/deploy/submission
- Package format: https://developers.openai.com/plugins/build/plugins
- Review guidelines: https://developers.openai.com/plugins/plugin-guidelines
- Validation errors: https://developers.openai.com/plugins/deploy/submission-errors

## What we submit

| Item | Value |
| --- | --- |
| Package | `npm run build:openai-plugin` writes `dist/dizko-events-openai-plugin-<version>.zip` from `openai-plugin/` |
| MCP endpoint | `https://mcp.dizko.app/openai/mcp` |
| Auth | None. Every listed tool is public and read-only. |
| Category | Entertainment |
| Capabilities | Read |

`/openai/mcp` is the same deployment as `/mcp`, filtered through
`src/surfaces.js`. It lists 13 read-only discovery tools. Preference profiles
(`profile_secret`), post-event feedback, ticket quote and purchase, and OAuth
account tools stay on `/mcp` for Claude, Muse, and stdio clients. They are left
out of the plugin because the guidelines reject tools that ask for secrets,
require checkout on the developer's own domain, and require reviewer logins
without SMS codes, which Dizko phone sign-in cannot provide yet.

## Before submitting

1. Deploy the current `main` and confirm `npm run build:openai-plugin` passes its live check against `/openai/mcp`.
2. Confirm individual or business verification on the OpenAI organization. Submitters need Owner or "Apps Management Write".
3. Start the submission, upload the ZIP, and copy the domain challenge token.
4. Set `DIZKO_OPENAI_APPS_CHALLENGE=<token>` on the Railway `dizko-mcp` service, redeploy, and confirm `https://mcp.dizko.app/.well-known/openai-apps-challenge` returns the token.
5. Record the demo video (all 8 test cases on ChatGPT web and mobile) and paste its URL.
6. Fill in the test cases, annotation justifications, and release notes below.

No reviewer credentials are needed.

## Positive test cases

| # | Scenario | Prompt | Expected tools | Expected behavior |
| --- | --- | --- | --- | --- |
| 1 | Genre and timeframe search | Find techno events in Berlin this weekend | `search_events` | Lists current Berlin techno events for the coming weekend, each with venue, time, Dizko event link, and ticket source link when available. |
| 2 | Night plan | Plan a Saturday night out in London with live music first and a club after | `plan_night` | Returns a primary pick plus nearby and later fallbacks for the coming Saturday in London, with links. |
| 3 | Daily digest | What's happening in New York tomorrow? | `get_daily_roundup` | Gives tomorrow's top picks and category sections for New York with links. |
| 4 | Artist tour dates | When does Amelie Lens play next? | `get_artist_events` | Lists Amelie Lens's upcoming Dizko-listed events with dates, venues, and links, or says none are listed. |
| 5 | Venue lookup | What's on at Fabric in London this week? | `get_venue` (or `find_scene_entities`) | Identifies Fabric and lists its upcoming events. Ambiguous names return choices instead of a guess. |

## Negative test cases

| # | Scenario | Prompt | Expected behavior |
| --- | --- | --- | --- |
| 1 | Unrelated request | What will the weather be in Berlin this weekend? | Dizko Events is not called. |
| 2 | Ticket purchase | Buy me two tickets to the first event you found | No purchase tool exists. The assistant explains that Dizko Events does not buy tickets and gives the event's ticket source link, noting that price and availability must be confirmed there. |
| 3 | Uncovered city | Find clubs in Reykjavik tonight | The tool returns `unsupported_city`. The assistant says the city is not covered and offers covered cities from `list_cities` without inventing events. |

## Annotation justifications

All 13 tools: `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false`.

- Read-only: every tool only retrieves or computes from Dizko's event catalog. None creates, changes, or deletes anything, and none sends data anywhere except Dizko's own API.
- Not destructive: no tool changes state.
- Not open world: every tool queries Dizko's own bounded event, artist, and venue catalog through Dizko's API. No tool searches the web, calls third-party services, or acts on external accounts. Results include links to third-party ticket pages, but the tools never fetch or act on those pages.

| Tool | Justification |
| --- | --- |
| `list_cities` | Reads Dizko's covered-city list with listing counts. |
| `find_scene_entities` | Looks up artists, venues, collectives, or promoters in Dizko's catalog. |
| `get_artist` | Reads one artist profile and their upcoming Dizko-listed events. |
| `get_venue` | Reads one venue profile and its upcoming Dizko-listed events. |
| `search_events` | Filters Dizko's current event listings. |
| `recommend_events` | Ranks Dizko listings against preferences stated in the request. Nothing is saved. |
| `plan_night` | Picks a primary event and fallbacks from Dizko listings. Nothing is saved. |
| `get_daily_roundup` | Summarizes one day of Dizko listings for a city. |
| `get_artist_events` | Reads upcoming Dizko-listed events for named artists. |
| `get_artist_page` | Reads an artist's published Dizko page and its links. |
| `get_city_pulse` | Aggregates listing counts for a city over the coming days. |
| `get_event` | Reads one Dizko event by id. |
| `create_event_calendar_file` | Generates an .ics file for one event and returns it. It does not write to any calendar. |

## Release notes

```text
First release of Dizko Events for ChatGPT and Codex. Search current concerts, club nights, festivals, and cultural events in 30 cities; get taste-ranked recommendations, night-out plans, daily roundups, artist and venue lookups, and city activity summaries. Read-only, no account required.
```

## Reviewer notes

```text
Dizko Events is read-only and needs no account. Results come from Dizko's own event catalog at api.dizko.app. Ticket links point to the original ticket source; the plugin does not sell or buy tickets. Coverage is limited to the 30 cities returned by list_cities.
```

## Listing assets

- Logo and composer icon: `openai-plugin/assets/` (current Dizko mark, square PNG).
- Brand color `#4E6B00` (Dizko acid deep), which passes 2:1 contrast against white and `#212121`.
- Screenshots are only required for plugins with custom UI. Dizko Events has none.

## After publication

OpenAI scans the endpoint daily and compares its tools with the published
definitions. Changing `src/surfaces.js` (tools, descriptions, or schemas) changes
the reviewed surface: rebuild the ZIP, and expect a re-review. Changes to `/mcp`
alone do not affect the plugin.

## Known risks

- Source authorization is the blocker described at the top. When it is resolved, the plugin surface may need to filter results to authorized sources, and the reviewer notes should say how listings are sourced.
- Inventory can include adult-themed events, such as figure-drawing sessions with nude models. The directory expects content suitable for ages 13 and up.
- Cancelled events sometimes appear in results with a `[CANCELLED]` title prefix until backend ingestion filters them.
