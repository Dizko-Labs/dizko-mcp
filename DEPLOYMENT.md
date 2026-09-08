# Deploy Dizko Events MCP

This service is deployed as a public HTTPS remote MCP endpoint:

```text
https://mcp.dizko.app/mcp
```

Check the current custom-domain state:

```bash
npm run domain:check
```

Expected in production: this command reports `ok: true` for `mcp.dizko.app` (DNS, HTTPS health, metadata, and a `tools/list` with the full tool count).

## Required Environment

```bash
DIZKO_API_BASE_URL=https://api.dizko.app
DIZKO_WEB_BASE_URL=https://www.dizko.app
DIZKO_MCP_URL=https://mcp.dizko.app/mcp
DIZKO_PREFERENCES_PATH=/data/preferences.json   # the Dockerfile sets the EVENTCHAT_PREFERENCES_PATH alias to the same value
DIZKO_QUOTE_SIGNING_SECRET=<random, 32+ bytes>  # signs ticket quote tokens; see below
PORT=8787
EVENTCHAT_MCP_HOST=0.0.0.0
```

Optional:

```bash
DIZKO_APP_DOWNLOAD_URL=https://www.dizko.app/ios
DIZKO_API_TIMEOUT_MS=8000
DIZKO_API_RETRIES=2
DIZKO_API_RETRY_BASE_DELAY_MS=250
DIZKO_API_CACHE_TTL_MS=300000
DIZKO_API_CACHE_STALE_MS=3600000
DIZKO_USER_AGENT=DizkoEventsTool/<version>
DIZKO_MCP_UPSTREAM_SECRET=<shared secret sent to api.dizko.app as X-Dizko-MCP-Secret>
DIZKO_PREFERENCE_RETENTION_DAYS=730
EVENTCHAT_MCP_ALLOWED_ORIGINS=https://chatgpt.com,https://chat.openai.com,https://claude.ai
EVENTCHAT_MCP_BEARER_TOKEN=replace-me
EVENTCHAT_MCP_MAX_BODY_BYTES=1048576
EVENTCHAT_MCP_RATE_LIMIT_WINDOW_MS=60000
EVENTCHAT_MCP_RATE_LIMIT_MAX=600
EVENTCHAT_MCP_RATE_LIMIT_EXEMPT=<comma-separated IP prefixes of trusted shared egress>
EVENTCHAT_MCP_RATE_LIMIT_DISABLED=false
```

Naming: `DIZKO_*` is preferred. `EVENTCHAT_*` (and `UPLAYGROUND_*` for the four URLs) are legacy aliases still accepted by `src/config.js`, `src/preferences.js` and `src/tickets.js`. The HTTP server's own settings (bearer token, allowed origins, rate limit, body size, host and port) are read from `EVENTCHAT_*` names only. `EVENTCHAT_ALLOW_LEGACY_PROFILE_IDS` disables secret checks for legacy profiles and must stay unset. The full table is in `README.md`.

For public ChatGPT review, leave `EVENTCHAT_MCP_BEARER_TOKEN` unset unless you are submitting OAuth or explicit test credentials. For private testing, set it and configure the MCP client with the same bearer token. The `/e/<id>/cal|map|ics` short links stay public even when a token is set.

The public MCP endpoint rate-limits `/mcp` POST traffic and the `/e/` short links by client IP (default 600 requests per minute) and returns `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers. Hosted assistants call from shared egress addresses, so the per-IP budget is generous; exempt known ranges with `EVENTCHAT_MCP_RATE_LIMIT_EXEMPT`. `/health`, `/`, the public pages, and the logo are not rate-limited so platform health checks and policy links stay reachable.

The HTTP server emits a restrictive `Content-Security-Policy` header on `/mcp`, `/health`, `/`, static public pages, and the logo asset. The current policy allows only these network/image origins:

```text
connect-src 'self' https://api.dizko.app https://www.dizko.app
img-src 'self' https://www.dizko.app data:
frame-ancestors https://chatgpt.com https://chat.openai.com
```

Update `securityHeaders()` in `src/httpServer.js` if the connector begins fetching from new domains, then rerun `npm run verify:submission`.

## Preference Store

Preference learning requires persistent storage. The store is a single JSON file at `DIZKO_PREFERENCES_PATH`. Writes are atomic (temp file + rename) and serialized per path within the process, which makes it safe for exactly one replica: two instances sharing the volume would race. On Railway, mount a persistent volume at `/data` and keep the service at one instance. Scaling out requires an external store (Postgres, Redis, or the Dizko backend) behind the same interface as `FilePreferenceStore` (`getProfile`, `createProfile`, `savePreferences`, `recordFeedback`, `deleteProfile`).

Profiles use an opaque `profile_id` (`dzk_...`) plus a one-time `profile_secret` (`dzs_...`); only a hash of the secret is stored. Inactive profiles are pruned after `DIZKO_PREFERENCE_RETENTION_DAYS`, defaulting to `730` days, whenever the store is accessed. Keep this aligned with the published privacy policy before submission.

## Quote Signing

Ticket quote tokens are HMAC-signed with `DIZKO_QUOTE_SIGNING_SECRET` so a caller cannot edit quantity, max total, purchase mode or checkout URL between `dizko_quote_tickets` and `dizko_purchase_tickets`. Without it the server generates a per-process secret: quotes then expire on every restart and would not verify across replicas. Set it on every hosted deployment.

## Railway

1. Create a new Railway service from this directory.
2. Use the included `Dockerfile` and `railway.json`.
3. Add the required environment variables, including `DIZKO_QUOTE_SIGNING_SECRET`.
4. Add a persistent volume mounted at `/data` and keep the service at one replica.
5. Deploy.
6. Generate or verify the Railway domain.
7. Attach the custom domain `mcp.dizko.app`:

```bash
railway login
railway domain mcp.dizko.app \
  --service eventchat-events-mcp \
  --environment production \
  --project cab5c6fa-26dd-44d3-af60-d2329ae65f56 \
  --json
```

8. Add the Railway-provided CNAME and ownership TXT records in DNS.
9. Verify the custom domain and the service:

```bash
npm run domain:check
curl https://mcp.dizko.app/health
curl https://mcp.dizko.app/.well-known/security.txt
curl https://mcp.dizko.app/mcp \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
npm run smoke:live
npm run verify:submission
```

10. Rerun `npm run preflight:submission` before routing review traffic.

## Docker

```bash
docker build -t dizko-events-mcp .
docker run --rm -p 8787:8787 \
  -e DIZKO_API_BASE_URL=https://api.dizko.app \
  -e DIZKO_WEB_BASE_URL=https://www.dizko.app \
  -e DIZKO_QUOTE_SIGNING_SECRET=change-me \
  -v dizko-preferences:/data \
  dizko-events-mcp
```

## ChatGPT App Review

Submit the public MCP URL in the OpenAI dashboard:

```text
https://mcp.dizko.app/mcp
```

Use `plugin-submission.md` for the app name, descriptions, tool list, test prompts, and checklist.
Use `submission-fields.json` for stable machine-readable dashboard copy, then validate it against the latest live evidence with `npm run verify:submission:fields`.
Use `OPERATIONS.md` after launch for health checks, logs, rollback, preference-data handling, and resubmission triggers.

Because this app saves preferences and post-event feedback, confirm the submitted privacy policy states what is stored, why it is stored, how users delete it through `dizko_delete_profile`, and how generated profile ids plus profile secrets are used for access.

## Claude Custom Connector

Use the same URL:

```text
https://mcp.dizko.app/mcp
```

Claude reaches remote MCP servers from Anthropic cloud infrastructure, so localhost URLs will not work.
