# Dizko Events MCP Operations Runbook

Use this runbook after deployment, before OpenAI submission, and during public operation.

## Production

MCP endpoint:

```text
https://mcp.dizko.app/mcp
```

Railway project:

```text
radar-backend
```

Railway service:

```text
eventchat-events-mcp
```

Do not route review traffic to `https://mcp.urbanplayground.xyz/mcp` until DNS and Railway custom-domain attachment are verified.

Custom-domain readiness check:

```bash
npm run domain:check
```

As of June 9, 2026, `mcp.urbanplayground.xyz` resolves away from the Railway MCP service and returns 404 for `/health`, `/`, and `/mcp`. The check should fail until Railway serves the MCP on that domain and DNS is updated.

## Daily Health Check

Run:

```bash
curl https://mcp.dizko.app/health
npm run monitor:live
npm run smoke:live
```

Expected:

- `/health` returns `{"ok":true,"name":"eventchat-events"}`.
- `npm run monitor:live` reports `ok: true`, health and metadata success, 18 tools, and at least one live read-only search result. This command does not create preference profiles, write feedback, or attempt ticket purchases.
- `npm run smoke:live` reports `ok: true`, 18 tools, a live sample event, search follow-up questions, and feedback-prompt questions.

For hosted uptime monitoring, run `npm run monitor:live` on a 5 to 15 minute interval and alert on any non-zero exit. Keep `npm run smoke:live` as a daily or pre-release check because it also exercises temporary preference profile creation and deletion.

## Launch Readiness Check

Run this after `npm run preflight:submission` and immediately before filling the OpenAI dashboard:

```bash
npm run submission:status
```

Expected:

- `ready_for_openai_dashboard_submission` is `true`.
- `submit_endpoint` is the hosted MCP endpoint.
- `code_readiness.latest_evidence`, `code_readiness.live_monitor`, and `code_readiness.dashboard_fields` are all `ok: true`.
- `code_readiness.branded_domain.ok` may be `false` until `mcp.urbanplayground.xyz` is attached to Railway and DNS is updated.
- `external_gates_remaining` lists only dashboard, screenshot, and publisher-verification tasks.

This command intentionally treats the branded custom domain as informational. A failing custom-domain check should block switching review traffic to `mcp.urbanplayground.xyz`, but it should not block OpenAI submission with the verified hosted endpoint.

## Submission Preflight

Run immediately before dashboard submission or resubmission:

```bash
npm run preflight:submission
```

This covers:

- Unit and integration tests.
- Live MCP smoke test.
- Public health, metadata, privacy, support, logo, and `security.txt` URLs.
- Tool list, titles, descriptions, annotations, and output schemas.
- Rate-limit headers.
- Live event search.
- Current-context follow-up questions.
- Post-event feedback prompt.
- Preference profile creation, private access-card behavior, wrong-secret rejection, feedback learning, and deletion.
- Dashboard field validation.

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

- Startup line: `eventchat-events MCP listening on http://0.0.0.0:<port>/mcp`
- Repeated upstream API timeouts.
- Repeated auth failures on preference tools.
- Repeated rate-limit responses.
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

Last known-good deployment at this runbook update:

```text
771149dc-039d-4fc1-aeef-7d7db59c15eb
```

## Preference Data Handling

Preference profiles live in the persistent Railway volume at:

```text
/data/preferences.json
```

Privacy invariants:

- Preference creation requires consent.
- The raw `profile_secret` is returned once.
- Only a hash of the `profile_secret` is stored.
- Later preference reads must not echo the raw secret.
- Preference access requires both `profile_id` and `profile_secret`.
- Deletion through `delete_event_preferences` removes saved preferences and feedback for that profile only when the request includes `confirm_delete: true` after user confirmation.
- Inactive preference profiles are pruned automatically after `EVENTCHAT_PREFERENCE_RETENTION_DAYS`, defaulting to `730` days.

If a user requests deletion through support instead of a tool call, verify ownership with both `profile_id` and `profile_secret` before deleting the profile from active storage.

Support deletion command:

```bash
npm run preferences:delete -- \
  --profile-id upg_... \
  --profile-secret ups_... \
  --preferences-path /data/preferences.json
```

The command uses the same profile-secret verification as the MCP tools. It exits with code `2` for an invalid secret and does not print the submitted secret.

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
3. Check `EVENTCHAT_API_BASE_URL`.
4. If the upstream API is down, MCP tools should return structured retryable errors and the assistant should ask the user to retry with narrower filters or later.

For preference-memory issues:

1. Confirm the Railway volume is mounted at `/data`.
2. Run `npm run preflight:submission`.
3. Confirm wrong-secret rejection and deletion still pass.
4. Do not manually reveal or reconstruct profile secrets; the service stores only hashes.

For suspected security issue:

1. Preserve relevant timestamps, deployment id, and tool names.
2. Do not collect raw profile secrets or unrelated personal data.
3. Use `SECURITY.md` and the hosted support page for reporting flow.
4. If user data may be at risk, rotate deployment credentials, consider disabling preference writes, and prioritize deletion/support requests.

## When To Resubmit

Resubmit to OpenAI review when any of these change materially:

- MCP endpoint URL.
- App name, logo, privacy URL, or support URL.
- Tool names, descriptions, annotations, input schemas, or output schemas.
- Data handling, retention, deletion, authentication, or preference-memory behavior.
- CSP fetch/image/frame domains.
- OAuth or bearer-token requirements.

Run `npm run preflight:submission` and capture fresh ChatGPT Developer Mode screenshots before resubmitting.
