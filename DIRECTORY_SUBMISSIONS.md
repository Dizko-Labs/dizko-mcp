# Directory Submissions — UPlayground Events

Getting listed turns installation into "search UPlayground, click add" and is the
only route to claude.ai users who can't add custom connectors. Status table at the
bottom — update it as submissions land.

The two URLs every directory wants:

- Hosted MCP endpoint: `https://mcp.dizko.app/mcp`
- npm package: `uplayground-events` (stdio command: `npx -y uplayground-events mcp`)

## 1. Official MCP Registry (registry.modelcontextprotocol.io)

The manifest is checked in as [`server.json`](server.json). Publishing requires
proving you own the `xyz.urbanplayground/*` namespace via DNS:

```bash
brew install mcp-publisher        # or download from github.com/modelcontextprotocol/registry
cd ios/EventChat/agent-tools/eventchat-events
mcp-publisher login dns --domain urbanplayground.xyz
# ^ prints a TXT record to add at your DNS host, then verifies it
mcp-publisher publish
```

Also requires the npm package to embed the registry name — the `mcpName` field is
already in `package.json`. Re-publish to npm before `mcp-publisher publish` if you
changed it.

## 2. Smithery (smithery.ai)

Sign in with GitHub → "Add server" → point it at the GitHub repo (subfolder
`ios/EventChat/agent-tools/eventchat-events`). For a hosted-only listing, choose
"external/remote server" and give the endpoint URL. Smithery reads tool metadata
live from the endpoint.

## 3. PulseMCP (pulsemcp.com)

Submit via the "Submit a server" form: name, endpoint URL, npm package, logo
(`public/logo-512.png`), and a one-paragraph description. They index the npm
README automatically.

## 4. mcp.so

GitHub-based submission: open an issue/PR on the mcp.so repo with name, repo URL,
endpoint, and description, or use the submit form on the site.

## 5. Anthropic connector directory (claude.ai)

Highest-value listing; removes the paid-plan custom-connector barrier. Submission
is via Anthropic's partner form (https://www.anthropic.com/partners — "List your
connector"). Requirements largely overlap with the OpenAI submission packet
already prepared in this repo: privacy policy, support page, security contact
(all live on the hosted service), plus the endpoint. Reuse
`OPENAI_SUBMISSION_PACKET.md` content.

## 6. OpenAI ChatGPT apps

Already in progress — see `OPENAI_SUBMISSION_PACKET.md` and `submission-fields.json`.

## Status

| Directory | Status | Notes |
|---|---|---|
| Official MCP registry | ready to publish | needs DNS TXT for namespace, then `mcp-publisher publish` |
| Smithery | not submitted | |
| PulseMCP | not submitted | |
| mcp.so | not submitted | |
| Anthropic directory | not submitted | reuse OpenAI packet |
| OpenAI apps | in review | see SUBMISSION_AUDIT.md |
