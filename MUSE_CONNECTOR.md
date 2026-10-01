# Muse connector readiness

Dizko's connector endpoint is `https://mcp.dizko.app/mcp`. It uses stateless
Streamable HTTP and strict JSON-RPC tool results. `/health` publishes the server,
contract and transport versions.

## Stable V1 read tools

- `search_events`: current event search with opaque cursor pagination.
- `get_event`: one canonical event.
- `get_artist`: exact artist profile, graph context and upcoming events. An
  ambiguous name returns choices rather than guessing.
- `get_venue`: exact venue profile, graph context and upcoming events. An
  ambiguous name returns choices rather than guessing.
- `recommend_events`: explainable live ranking. Every recommendation carries
  reasons; it must not be presented as current if the underlying search fails.

Event results use contract version `2026-09-19`. They include a canonical id,
timezone-aware ISO start/end values when known, venue and city, source provider
and URL, retrieval and upstream freshness timestamps, ticket URL, explicit
price/currency fields, price freshness, and availability status/confidence.
`unverified` and `unknown` are intentional values, not missing guarantees.

## Authentication status

Production is currently anonymous for read tools. The server can require one
static Bearer token through `EVENTCHAT_MCP_BEARER_TOKEN`, but that is only a
transport gate and is not per-user authorization. It must not be described as
OAuth or used to authorize saved-event writes.

The planned user authorization model is OAuth with least-privilege scopes:

- `events:read`
- `saved:read`
- `saved:write`

`save_event` / `add_to_dizko_plan` must remain unavailable until the MCP server
can validate a user-bound token, receive scopes in request context, and call a
user-bound backend endpoint with idempotency and explicit confirmation. A shared
key is not a substitute.

## Side effects

Read tools are marked read-only, non-destructive and idempotent. Existing write
tools retain write annotations. Any future saved-event write must require an
idempotency key and explicit confirmation in its schema and must default-deny
without `saved:write`.

## Review links

- Health: `https://mcp.dizko.app/health`
- Privacy: `https://mcp.dizko.app/privacy-policy.html`
- Terms: `https://mcp.dizko.app/terms.html`
- Support: `https://mcp.dizko.app/support.html`
- Security: `https://mcp.dizko.app/.well-known/security.txt`
