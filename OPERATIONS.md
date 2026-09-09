# Dizko Events MCP Operations Runbook

Use this runbook after deployment, before OpenAI submission, and during public operation.

## Production

MCP endpoint (the only hosted endpoint):

```text
https://mcp.dizko.app/mcp
```

Railway project:

```text
radar-backend
```

Railway service (legacy service name; the deployed code and public branding are Dizko):

```text
eventchat-events-mcp
```

Custom-domain readiness check:

```bash
npm run domain:check
```

The check must pass for `mcp.dizko.app` (DNS, HTTPS health, metadata, and a `tools/list` with the full tool count) before release and before an OpenAI dashboard submission.

## Daily Health Check

Run:

```bash
curl https://mcp.dizko.app/health
npm run monitor:live
npm run smoke:live
```

Expected:

- `/health` returns `{"ok":true,"name":"dizko","version":"<package version>"}`.
- `npm run monitor:live` reports `ok: true`, health and metadata success, the full tool count (19 in 0.8.0; the script reads it from the package's tool registry, so it cannot drift), and at least one live read-only search result. This command does not create preference profiles, write feedback, or attempt ticket purchases.
- `npm run smoke:live` reports `ok: true`, the expected `dizko_*` tool names, a live sample event, the `dizko_search_followups` and `dizko_post_event_feedback` prompts, and a temporary profile round-trip (create, read, wrong-secret rejection, delete).

For hosted uptime monitoring, run `npm run monitor:live` on a 5 to 15 minute interval and alert on any non-zero exit. Keep `npm run smoke:live` as a daily or pre-release check because it also exercises temporary preference profile creation and deletion.

## Launch Readiness Check

Run this after `npm run preflight:submission` and immediately before filling the OpenAI dashboard:

```bash
npm run submission:status
```

Expected:

- `ready_for_openai_dashboard_submission` is `true`.
- `submit_endpoint` is `https://mcp.dizko.app/mcp`.
- `code_readiness.latest_evidence`, `code_readiness.live_monitor`, and `code_readiness.dashboard_fields` are all `ok: true`.
- `code_readiness.branded_domain.ok` is `true`.
- `external_gates_remaining` lists only dashboard, screenshot, and publisher-verification tasks.

A failing custom-domain check blocks release and OpenAI submission because `mcp.dizko.app` is the canonical public connector.

## Submission Preflight

Run immediately before dashboard submission or resubmission:

```bash
npm run preflight:submission
```

This covers:

- Unit and integration tests.
- Live MCP smoke test.
- Public health, metadata, privacy, support, terms, user-guide, logo, and `security.txt` URLs.
- Tool list, titles, descriptions, annotations, `noauth` security schemes, and invocation status text; it also confirms that no `outputSchema` is served (results are `structuredContent`).
- Rate-limit headers.
- Live event search.
- The `dizko_search_followups` and `dizko_post_event_feedback` prompts.
- Preference profile creation (`dzk_`/`dzs_` identifiers), private access-card behavior, wrong-secret rejection, feedback learning, and deletion.
- Dashboard field validation, including the served tool count.

Generated evidence is written to ignored files:

```text
submission-evidence/latest.json
submission-evidence/latest-summary.md
```

## Logs

Tail the current deployment logs:

```bash
railway logs --service eventchat-events-mcp --environment production --tail 120
```

Tail a specific deployment:

```bash
railway logs --deployment <deployment-id> --tail 120
```

Look for:

- Startup line: `dizko MCP listening on http://0.0.0.0:<port>/mcp`
- Repeated upstream API timeouts (`upstream_timeout` / `upstream_unavailable` in tool results).
- Repeated `profile_secret_invalid` or `profile_not_found` on preference tools.
- Repeated rate-limit responses (HTTP 429); consider `EVENTCHAT_MCP_RATE_LIMIT_EXEMPT` for known shared egress ranges.
- JSON parse or schema errors from malformed client requests.

## Rollback

If a deployment breaks `/health`, `/mcp`, or preference-memory behavior:

1. Find the last successful deployment:

```bash
railway deployment list --service eventchat-events-mcp --environment production --limit 5 --json
```

2. Redeploy the last known-good local state or use Railway's dashboard rollback controls.
3. Re-run:

```bash
npm run preflight:submission
```

Record the last known-good deployment id from `submission-evidence/latest.json` (`deployment.id`) after each successful preflight. The 0.7-era id previously listed here predates the 0.8.0 tool rename; rolling back to it restores the old tool names.

## Preference Data Handling

Preference profiles live in the persistent Railway volume at:

```text
/data/preferences.json
```

The path comes from `DIZKO_PREFERENCES_PATH` (alias `EVENTCHAT_PREFERENCES_PATH`; the Dockerfile sets the alias).

Store characteristics:

- A single JSON file. Writes are atomic (temp file + rename) and serialized per path within one process.
- Safe for one replica only. Two replicas sharing the volume would race, so do not scale the service out until the store is moved behind an external store (Postgres, Redis, or the Dizko backend) that implements the same interface: `getProfile`, `createProfile`, `savePreferences`, `recordFeedback`, `deleteProfile`.
- Inactive profiles are pruned on access after `DIZKO_PREFERENCE_RETENTION_DAYS` (alias `EVENTCHAT_PREFERENCE_RETENTION_DAYS`), defaulting to `730` days.
- One profile serializes to at most `DIZKO_MAX_PROFILE_BYTES` (default `98304`). Past it the oldest feedback entries are dropped to fit, since their signal is already folded into `learned`. This is the bound that actually holds: free-text notes and event snapshots dominate a large profile, and no per-field term count constrains them.
- The store holds at most `DIZKO_MAX_PROFILES` profiles (default `10000`). At the ceiling, profiles created but never used or consented to are evicted oldest-first; consented profiles are never evicted for space. If nothing can be freed, `dizko_create_profile` returns `profile_limit_reached` while every existing profile keeps working. Raising the ceiling raises the cost of every write, since the store is one JSON file rewritten per operation.

Privacy invariants:

- Preference creation requires consent.
- The raw `profile_secret` (`dzs_...`) is returned once.
- Only a hash of the `profile_secret` is stored.
- Later preference reads must not echo the raw secret.
- Preference access requires both `profile_id` (`dzk_...`) and `profile_secret`.
- Deletion through `dizko_delete_profile` removes saved preferences and feedback for that profile only when the request includes `confirm_delete: true` after user confirmation.
- `EVENTCHAT_ALLOW_LEGACY_PROFILE_IDS` must stay unset in production; `true` disables secret checks for legacy profiles that have no stored hash.

If a user requests deletion through support instead of a tool call, verify ownership with both `profile_id` and `profile_secret` before deleting the profile from active storage.

Support deletion command:

```bash
npm run preferences:delete -- \
  --profile-id dzk_... \
  --profile-secret dzs_... \
  --preferences-path /data/preferences.json
```

The command uses the same profile-secret verification as the MCP tools. It exits with code `2` for an invalid secret and does not print the submitted secret.

## Secrets And Rate Limiting

- `DIZKO_QUOTE_SIGNING_SECRET` (alias `EVENTCHAT_QUOTE_SIGNING_SECRET`) signs ticket quote tokens. Set it on the Railway service: without it every restart invalidates outstanding quotes (`invalid_quote_token`), and a second replica would reject the first one's tokens.
- `DIZKO_MCP_UPSTREAM_SECRET` (alias `EVENTCHAT_MCP_UPSTREAM_SECRET`) is sent to the Dizko API as `X-Dizko-MCP-Secret`.
- The rate limiter allows `EVENTCHAT_MCP_RATE_LIMIT_MAX` requests (default `600`) per `EVENTCHAT_MCP_RATE_LIMIT_WINDOW_MS` (default `60000`) per client IP on `/mcp` and the `/e/` short links. Hosted assistants call from shared egress addresses, so add their prefixes to `EVENTCHAT_MCP_RATE_LIMIT_EXEMPT` (comma-separated IP prefixes) if legitimate traffic sees 429s. `EVENTCHAT_MCP_RATE_LIMIT_DISABLED=true` turns the limiter off and is not for production.

## Script Environment

The verification scripts read these knobs in addition to the shared `DIZKO_*` settings in `README.md`. All are optional.

| Variable | Script | Default |
| --- | --- | --- |
| `DIZKO_MCP_URL` (alias `EVENTCHAT_MCP_URL`) | all live scripts | `https://mcp.dizko.app/mcp` |
| `EVENTCHAT_SMOKE_TIMEOUT_MS`, `EVENTCHAT_SMOKE_CITY` | `smoke-live.mjs` | `15000`, `berlin` |
| `EVENTCHAT_MONITOR_TIMEOUT_MS`, `EVENTCHAT_MONITOR_CITY` | `monitor-live.mjs` | `10000`, `berlin` |
| `EVENTCHAT_MONITOR_TOOL_COUNT` | `monitor-live.mjs` | the package's tool registry size |
| `EVENTCHAT_VERIFY_TIMEOUT_MS`, `EVENTCHAT_COMPANY_URL` | `verify-submission.mjs` | `15000`, `https://www.dizko.app` |
| `EVENTCHAT_RAILWAY_SERVICE`, `EVENTCHAT_CAPTURE_DEPLOYMENT_METADATA` | `verify-submission.mjs` | `eventchat-events-mcp`; `false` skips the Railway lookup |
| `EVENTCHAT_SUBMISSION_EVIDENCE_PATH` | `verify-submission.mjs` (write), `validate-submission-fields.mjs`, `write-submission-summary.mjs` | unset = print only; `./submission-evidence/latest.json` for readers |
| `EVENTCHAT_SUBMISSION_SUMMARY_PATH` | `write-submission-summary.mjs` | `./submission-evidence/latest-summary.md` |
| `EVENTCHAT_SUBMISSION_FIELDS_PATH`, `EVENTCHAT_SECURITY_POLICY_PATH`, `EVENTCHAT_SUBMISSION_PACKET_PATH`, `EVENTCHAT_SUBMISSION_AUDIT_PATH` | `validate-submission-fields.mjs` | the checked-in files |
| `EVENTCHAT_REQUIRE_DEPLOYMENT_METADATA` | `validate-submission-fields.mjs` | `true`; `false` accepts evidence that skipped Railway |
| `EVENTCHAT_REVIEW_DEMO_PATH` | `write-review-demo.mjs` | `./submission-evidence/review-demo.md` |
| `DIZKO_CUSTOM_DOMAIN` (alias `EVENTCHAT_CUSTOM_DOMAIN`) | `check-custom-domain.mjs` | `mcp.dizko.app` |
| `EVENTCHAT_PROFILE_ID`, `EVENTCHAT_PROFILE_SECRET`, `DIZKO_PREFERENCES_PATH` (alias `EVENTCHAT_PREFERENCES_PATH`) | `delete-preference-profile.mjs` | flags `--profile-id`, `--profile-secret`, `--preferences-path` take precedence |

## Incident Response

For endpoint outage:

1. Check Railway service status and latest deployment status.
2. Check `/health`.
3. Check logs for startup failure or volume mount failure.
4. Run `npm run monitor:live`.
5. Run `npm run smoke:live` if the monitor passes but users still report personalization or feedback issues.
6. Roll back if the current deployment introduced the issue.

For upstream event API outage:

1. Confirm `/health` still passes.
2. Run a read-only live search through `npm run monitor:live`.
3. Check `DIZKO_API_BASE_URL` (alias `EVENTCHAT_API_BASE_URL`) on the service.
4. If the upstream API is down, tools return structured errors (`upstream_unavailable` or `upstream_timeout`, `retryable: true`) and keep serving cached responses for up to `DIZKO_API_CACHE_STALE_MS`; the assistant should ask the user to retry later or with narrower filters.

For preference-memory issues:

1. Confirm the Railway volume is mounted at `/data`.
2. Run `npm run preflight:submission`.
3. Confirm wrong-secret rejection and deletion still pass.
4. Do not manually reveal or reconstruct profile secrets; the service stores only hashes.

For suspected security issue:

1. Preserve relevant timestamps, deployment id, and tool names.
2. Do not collect raw profile secrets or unrelated personal data.
3. Use `SECURITY.md` and the hosted support page for reporting flow.
4. If user data may be at risk, rotate deployment credentials (`DIZKO_QUOTE_SIGNING_SECRET`, `DIZKO_MCP_UPSTREAM_SECRET`, any bearer token), consider disabling preference writes, and prioritize deletion/support requests.

## When To Resubmit

Resubmit to OpenAI review when any of these change materially:

- MCP endpoint URL.
- App name, logo, privacy URL, or support URL.
- Tool names, descriptions, annotations, or input schemas, or the prompt list.
- Data handling, retention, deletion, authentication, or preference-memory behavior.
- CSP fetch/image/frame domains.
- OAuth or bearer-token requirements.

Run `npm run preflight:submission` and capture fresh ChatGPT Developer Mode screenshots before resubmitting. The 0.8.0 tool rename is such a change.
