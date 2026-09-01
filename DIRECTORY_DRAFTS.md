# Directory Submission Drafts

Paste-ready copy for each directory in [DIRECTORY_SUBMISSIONS.md](DIRECTORY_SUBMISSIONS.md).
Everything here is public information already published in this repo (README,
server.json, package.json). Naming is always **Dizko Events** / `dizko-events` /
`app.dizko/events` — never the old `eventchat-events` name.

Shared fields used by most forms:

| Field | Value |
|---|---|
| Name | Dizko Events |
| Endpoint (hosted) | `https://mcp.dizko.app/mcp` |
| npm package | `dizko-events` (`npx -y dizko-events mcp`) |
| Repository | `https://github.com/Dizko-Labs/dizko-mcp` |
| Website | `https://www.dizko.app` |
| Logo | `https://mcp.dizko.app/logo-512.png` (local: `public/logo-512.png`) |
| Privacy policy | `https://mcp.dizko.app/privacy-policy.html` |
| Support | `https://mcp.dizko.app/support.html` |
| Terms | `https://mcp.dizko.app/terms.html` |
| Auth | None required for search (hosted, streamable-http) |
| Category | Events / Entertainment / Travel & Local |

Short description (directories with a one-line field):

```text
Find current concerts, parties, nightlife, festivals, and cultural events from Dizko's live event inventory.
```

Long description (one-paragraph fields):

```text
Dizko Events is Dizko's connector for ChatGPT, Claude, and MCP-compatible agents. It connects users to live event listings across major cities, supports structured search by city, date, genre, vibe, neighborhood, venue, artist, price, attendance, and event type, then returns verifiable event links and ticket URLs. Recommendation tools include explainable taste matching, compact night plans with fallbacks, daily city roundups with top picks and category sections, consent-based saved preferences with per-weekday day filters, current-context follow-up questions, and post-event feedback learning. Ticket tools can show offers, create locked quotes, require explicit written confirmation, and either hand off third-party checkout or use an integrated provider when configured.
```

## 1. Official MCP Registry (registry.modelcontextprotocol.io)

No copy needed — the manifest is `server.json` in this repo. Remaining steps are
account/DNS only:

1. `brew install mcp-publisher` (or download from github.com/modelcontextprotocol/registry).
2. `mcp-publisher login dns --domain dizko.app` — prints a TXT record; add it at the
   DNS host for dizko.app, then re-run to verify.
3. `npm publish` first if `package.json` changed since the last npm release (the
   `mcpName` field `app.dizko/events` is already in place).
4. `mcp-publisher publish` from the repo root.

## 2. Smithery (smithery.ai)

Sign-in is with the Dizko-Labs GitHub account, so this one is manual:

1. Sign in with GitHub → "Add server".
2. Choose external/remote server.
3. Server URL: `https://mcp.dizko.app/mcp`
4. If it asks for a repo: `https://github.com/Dizko-Labs/dizko-mcp`
5. Name/description: use the shared fields above. Smithery reads tool metadata
   live from the endpoint, so no tool list to paste.

## 3. PulseMCP (pulsemcp.com)

"Submit a server" form:

- Name: Dizko Events
- Endpoint: `https://mcp.dizko.app/mcp`
- npm package: `dizko-events`
- Logo: `https://mcp.dizko.app/logo-512.png`
- Description: the one-paragraph long description above.

They index the npm README automatically, so no extra docs needed.

## 4. mcp.so

Submit on the site, or open an issue/PR on the mcp.so repo with:

```text
Title: Add Dizko Events (MCP server for live event discovery)

Name: Dizko Events
Repository: https://github.com/Dizko-Labs/dizko-mcp
Hosted endpoint: https://mcp.dizko.app/mcp (streamable-http, no auth)
npm: dizko-events (npx -y dizko-events mcp)
Description: Find current concerts, parties, nightlife, festivals, and cultural
events from Dizko's live event inventory. Structured search by city, date, genre,
vibe, neighborhood, venue, artist, and price, with verifiable event and ticket links.
```

## 5. Anthropic connector directory (claude.ai)

Submission is via the partner form: https://www.anthropic.com/partners
("List your connector"). Reuse the OpenAI packet ([OPENAI_SUBMISSION_PACKET.md](OPENAI_SUBMISSION_PACKET.md))
— the requirements overlap:

- Connector name: Dizko Events
- MCP endpoint: `https://mcp.dizko.app/mcp`
- Auth type: none (search is public; preference memory is opt-in via profile_id + secret)
- Privacy policy / support / security contact: URLs from the shared table plus
  `https://mcp.dizko.app/.well-known/security.txt`
- Company: Dizko, `https://www.dizko.app`
- Description: the long description above.

## 6. OpenAI ChatGPT apps

Already in review — see [SUBMISSION_AUDIT.md](SUBMISSION_AUDIT.md). Nothing to draft here.

## After a submission lands

Update the status table in [DIRECTORY_SUBMISSIONS.md](DIRECTORY_SUBMISSIONS.md).
