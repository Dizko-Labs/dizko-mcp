# Dizko connector contract (Muse and other MCP clients)

This is a short summary of what the hosted Dizko connector serves to Muse and
any other MCP client today. The full tool reference is in
[README.md](README.md); hosting, environment and domain setup are in
[DEPLOYMENT.md](DEPLOYMENT.md); runbooks are in [OPERATIONS.md](OPERATIONS.md).

## Endpoint

- `https://mcp.dizko.app/mcp`: Streamable HTTP, stateless, JSON-RPC tool
  results as `structuredContent` plus a JSON text block. No tool serves an
  `outputSchema`. This path carries the full catalog of 30 tools.
- `https://mcp.dizko.app/openai/mcp`: the reviewed ChatGPT and Codex subset,
  13 read-only discovery tools with no sign-in, profile or ticket tools
  (`src/surfaces.js`).
- `https://mcp.dizko.app/health` reports `version`, `contract_version`
  (currently `2026-09-19`, `src/connectorV1.js`), `transport` and whether a
  static bearer gate is on.

## Stable V1 read tools

- `search_events`: current events with opaque cursor pagination.
- `get_event`: one canonical event.
- `get_artist`, `get_venue`: one canonical profile with upcoming events when
  the name resolves confidently, choices when it does not. `get_artist` also
  returns the scene API's page `completeness` (`{ score, max, version,
  missing }`) when the backend sends it.
- `recommend_events`: explainable ranking; every recommendation carries
  `recommendation_reasons`.

Event results carry a canonical id, `when` and `starts_at_local` in the
city's own time zone, UTC `starts_at`, venue and city, source provenance,
retrieval and upstream freshness timestamps, ticket URL, price and currency
fields, price freshness and availability. `unverified` and `unknown` are
intentional values. Data-honesty fields (`quality_flags`, `currency_status`,
`ends_on_local`, `also_listed_by`, `alternate_starts_local`,
`listing_confidence`) are described under "Data honesty" in the README.

## Authentication

- Discovery tools need no sign-in.
- Signed-in Dizko accounts use OAuth 2.1 against `api.dizko.app` (PKCE,
  dynamic client registration). The connector publishes
  `/.well-known/oauth-protected-resource` with scopes `events:read`,
  `saved:read` and `saved:write`, and verifies each bearer token by
  introspection (`src/connectorAuth.js`, `src/authContext.js`). A request
  with an invalid or expired token gets `401` with a `WWW-Authenticate`
  header pointing at that metadata; a request with no token is served as
  anonymous discovery.
- The optional static `EVENTCHAT_MCP_BEARER_TOKEN` is a transport gate only.
  It grants `events:read` and never `saved:read` or `saved:write`.

## Account tools

- `get_taste_profile` (`saved:read`): the account's learned taste plus saved
  and binned events.
- `save_event`, `add_to_dizko_plan`, `bin_event` (`saved:write`): each needs
  `confirmed: true` after the user agrees and an `idempotency_key` of 16 to
  128 characters, forwarded to the backend so a retried call acts once.
  Without the scope they return `authentication_required` or
  `insufficient_scope` before any argument is read.

## Side effects and tickets

- Read tools are `readOnlyHint: true`, `destructiveHint: false`.
  `save_event_preferences` (its `replace` mode overwrites the profile),
  `delete_event_preferences` and `bin_event` are destructive.
  `purchase_ticket_order` is destructive and open-world.
- Tickets: `get_ticket_offers`, then a signed, 10-minute `quote_ticket_order`,
  then `purchase_ticket_order` only with the user's written confirmation
  naming the quantity and max total; a refusal, hedge or question is
  rejected server side. The hosted connector has no purchase provider, so the
  last step is a hand off to checkout (`status: requires_external_checkout`
  with `checkout_url`). Dizko never claims a ticket was bought unless
  `status` is `purchased`.

## Review links

- Health: `https://mcp.dizko.app/health`
- Privacy: `https://mcp.dizko.app/privacy-policy.html`
- Terms: `https://mcp.dizko.app/terms.html`
- Support: `https://mcp.dizko.app/support.html`
- Security: `https://mcp.dizko.app/.well-known/security.txt`
