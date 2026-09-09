# Security Policy

## Scope

This policy covers the Dizko Events MCP package, hosted MCP endpoint, preference-memory tools, profile-secret access, public privacy/support pages, event-search/recommendation tools, and ticket quote/purchase handoff tools in this directory.

Production MCP endpoint:

```text
https://mcp.dizko.app/mcp
```

## Reporting A Vulnerability

Email security reports to:

```text
security@dizko.app
```

Please include:

- Affected endpoint or tool name.
- Steps to reproduce.
- Expected and actual behavior.
- Whether preference profiles, profile secrets, feedback, or other user data may be involved.
- Any relevant timestamps or request ids, if available.

Do not include another person's profile secret, private notes, or personal data in the report. For ordinary support, deletion, or account/privacy help, use `support@dizko.app` or `privacy@dizko.app`.

## Security Posture

- The hosted endpoint is a public read API. CORS is `*` by default, so with no bearer token any web page can call the discovery tools cross-origin. That is acceptable for public event inventory; anything that writes is protected by the profile secret, not by the transport.
- Setting `EVENTCHAT_MCP_ALLOWED_ORIGINS` to a real list makes the server refuse a request whose `Origin` is outside it (403) on `/mcp`, not merely omit the CORS header. Short links and the public pages are not gated: they serve already-published event data, so gating them would break embedding a calendar or directions link from another site to protect nothing. Header-only enforcement relies on the browser, which does not help against DNS rebinding: after a rebind the attacker's page is the target origin and CORS never applies. Any deployment reachable from a browser on a private network or localhost should set this list. Requests with no `Origin`, which is every non-browser MCP client, are unaffected.
- Profile writes (`dizko_update_profile`, `dizko_record_feedback`, `dizko_delete_profile`) and reads (`dizko_get_profile`) require both `profile_id` and `profile_secret`; the service stores only a hash of the secret and compares it in constant time.
- Short links under `/e/<id>/cal|map|ics` are intentionally public: they bypass `EVENTCHAT_MCP_BEARER_TOKEN` when one is configured, but they share the `/mcp` rate limiter and expose only public event data.
- `EVENTCHAT_ALLOW_LEGACY_PROFILE_IDS=true` disables secret checks for legacy profiles that have no stored secret hash. It must stay unset (off) in production.
- Ticket quote tokens are HMAC-signed with `DIZKO_QUOTE_SIGNING_SECRET` (alias `EVENTCHAT_QUOTE_SIGNING_SECRET`), so quantity, max total, purchase mode and checkout URL cannot be edited between quote and purchase. Set it on hosted deployments; the per-process fallback secret is only safe for a single instance and invalidates outstanding quotes on restart.
- A ticket provider that does not answer returns `purchase_outcome_unknown`, never an error and never a failure: a thrown call says nothing about whether the order was placed, so the claim stands, a blind retry is refused, and the model is told to have the user check their email rather than assert either outcome.
- A signed quote is spendable once, and the claim registry fails closed: at `DIZKO_MAX_TRACKED_QUOTES` a new purchase is refused rather than an existing claim evicted, since every claim still held is by definition unexpired and evicting the oldest would free exactly the claim an attacker wants freed. `dizko_purchase_tickets` claims the quote before calling the purchase provider, so a replayed or concurrently duplicated `quote_token` returns `quote_already_used` instead of a second order; the claim is released only when the provider states the purchase did not happen. The provider idempotency key is derived from the signed quote and is not accepted from the caller. The claim registry is per-process, so a multi-replica deployment needs a shared claim store before autonomous purchase is enabled.
- Every tool argument carries a length and item cap (`src/schemaLimits.js`), enforced before any upstream call, and open key maps only accept keys from their declared set. Saved profiles cap terms per field, learned terms per category, and total profiles (`DIZKO_MAX_PROFILES`), so repeated writes cannot grow the store without bound.
- `assistant_instruction` is a directive field: only values the server produced or validated against a closed set are written into it. Caller-supplied text such as `city` or `when` stays in structured data fields (`requested_city`, `active_filters`, `retry_with`) so injected text is never read as an instruction.
- `DIZKO_MCP_UPSTREAM_SECRET` and `EVENTCHAT_MCP_BEARER_TOKEN` are deployment secrets and never appear in tool output.

## Operational Safeguards

- Preference profiles require explicit consent before creation or updates.
- Profile access requires both `profile_id` and private `profile_secret`; the service stores only a hash of the secret.
- Deletion is exposed through the destructive `dizko_delete_profile` tool and removes saved connector preferences and feedback for the profile only when `confirm_delete: true` is supplied after user confirmation.
- Ticket purchase is exposed through the destructive/open-world `dizko_purchase_tickets` boundary. It requires a signed quote and explicit written confirmation (the words buy/purchase plus the quantity and max total); third-party-only checkout links must not be represented as completed purchases.
- Public MCP traffic is rate-limited per client IP (`EVENTCHAT_MCP_RATE_LIMIT_MAX`, default 600 per minute) and emits `X-RateLimit-*` headers; `EVENTCHAT_MCP_RATE_LIMIT_EXEMPT` whitelists known shared egress ranges.
- The hosted endpoint serves restrictive CSP, referrer-policy, and content-type headers.
- Submission verification should be run before public review:

```bash
npm run verify:submission:bundle
npm run verify:submission:fields
```

Operational checks, rollback, and incident response are documented in `OPERATIONS.md`.
