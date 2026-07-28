# Deploy UPlayground Events MCP

This service is deployed as a public HTTPS remote MCP endpoint:

```text
https://mcp.dizko.app/mcp
```

Do not use this preferred custom domain until DNS/Railway domain attachment is resolved:

```text
https://mcp.urbanplayground.xyz/mcp
```

Current status on June 9, 2026: `mcp.urbanplayground.xyz` resolves away from the Railway MCP service and returns 404 for `/health`, `/`, and `/mcp`. Use the verified hosted endpoint for review until `npm run domain:check` reports `ok: true`.

Check the current custom-domain state:

```bash
npm run domain:check
```

Expected before cutover: this command exits non-zero and explains that the hosted endpoint should remain the review endpoint.

## Required Environment

```bash
EVENTCHAT_API_BASE_URL=https://backend-production-958d.up.railway.app
EVENTCHAT_API_TIMEOUT_MS=8000
EVENTCHAT_WEB_BASE_URL=https://www.dizko.app
EVENTCHAT_MCP_HOST=0.0.0.0
EVENTCHAT_PREFERENCES_PATH=/data/preferences.json
PORT=8787
```

Optional:

```bash
EVENTCHAT_MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com,https://claude.ai
EVENTCHAT_MCP_BEARER_TOKEN=replace-me
EVENTCHAT_MCP_MAX_BODY_BYTES=1048576
EVENTCHAT_MCP_RATE_LIMIT_WINDOW_MS=60000
EVENTCHAT_MCP_RATE_LIMIT_MAX=120
EVENTCHAT_MCP_RATE_LIMIT_DISABLED=false
```

For public ChatGPT review, leave `EVENTCHAT_MCP_BEARER_TOKEN` unset unless you are submitting OAuth or explicit test credentials. For private testing, set it and configure the MCP client with the same bearer token.

The public MCP endpoint rate-limits `/mcp` POST traffic by client IP and returns `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on MCP responses. The default is intentionally generous for ChatGPT review traffic. `/health`, `/`, the privacy/support pages, and the logo are not rate-limited so platform health checks and public policy links stay reachable.

The HTTP server emits a restrictive `Content-Security-Policy` header on `/mcp`, `/health`, `/`, static public pages, and the logo asset. The current policy allows only these network/image origins:

```text
connect-src 'self' https://backend-production-958d.up.railway.app https://www.dizko.app
img-src 'self' https://www.dizko.app data:
frame-ancestors https://chatgpt.com https://chat.openai.com
```

Update `securityHeaders()` in `src/httpServer.js` if the connector begins fetching from new domains, then rerun `npm run verify:submission`.

Preference learning requires persistent storage. The current implementation uses a JSON file at `EVENTCHAT_PREFERENCES_PATH`; on Railway, mount a persistent volume at `/data` before public launch. Preference profiles use an opaque `profile_id` plus a one-time `profile_secret`; only a hash of the secret is stored. For high-traffic production, move the `FilePreferenceStore` behind Postgres/Redis or the existing EventChat backend.

Preference profiles are automatically pruned after `EVENTCHAT_PREFERENCE_RETENTION_DAYS`, defaulting to `730` days, whenever the preference store is accessed. Keep this aligned with the published privacy policy before submission.

## Railway

1. Create a new Railway service from this directory.
2. Use the included `Dockerfile` and `railway.json`.
3. Add the required environment variables.
4. Add a persistent volume mounted at `/data`.
5. Deploy.
6. Generate or verify the Railway domain.
7. Attach the custom domain `mcp.urbanplayground.xyz` only when ready to move review/public traffic off the Railway-provided domain:

```bash
railway login
railway domain mcp.urbanplayground.xyz \
  --service eventchat-events-mcp \
  --environment production \
  --project cab5c6fa-26dd-44d3-af60-d2329ae65f56 \
  --json
```

8. Update DNS away from the current Vercel target to the Railway-provided custom-domain target.
9. Verify the custom domain:

```bash
npm run domain:check
```

10. Only after `npm run domain:check` reports `ok: true`, update `submission-fields.json`, `OPENAI_SUBMISSION_PACKET.md`, `SUBMISSION_AUDIT.md`, `README.md`, `USER_GUIDE.md`, and `OPERATIONS.md` to use the branded domain, then rerun `npm run preflight:submission`.
11. Verify:

```bash
curl https://mcp.dizko.app/health
curl https://mcp.dizko.app/.well-known/security.txt
curl https://mcp.dizko.app/mcp \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
npm run smoke:live
npm run verify:submission
```

## Docker

```bash
docker build -t eventchat-events-mcp .
docker run --rm -p 8787:8787 \
  -e EVENTCHAT_API_BASE_URL=https://backend-production-958d.up.railway.app \
  -e EVENTCHAT_WEB_BASE_URL=https://www.dizko.app \
  -v eventchat-preferences:/data \
  eventchat-events-mcp
```

## ChatGPT App Review

Submit the public MCP URL in the OpenAI dashboard:

```text
https://mcp.dizko.app/mcp
```

Use `plugin-submission.md` for the app name, descriptions, tool list, test prompts, and checklist.
Use `submission-fields.json` for stable machine-readable dashboard copy, then validate it against the latest live evidence with `npm run verify:submission:fields`.
Use `OPERATIONS.md` after launch for health checks, logs, rollback, preference-data handling, and resubmission triggers.

Because this app saves preferences and post-event feedback, confirm the submitted privacy policy states what is stored, why it is stored, how users delete it through `delete_event_preferences`, and how generated profile ids plus profile secrets are used for access.

## Claude Custom Connector

Use the same URL:

```text
https://mcp.dizko.app/mcp
```

Claude reaches remote MCP servers from Anthropic cloud infrastructure, so localhost URLs will not work.
