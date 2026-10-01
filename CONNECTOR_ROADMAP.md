# Dizko connector differentiation roadmap

The connector is the typed identity, taste, action, and live-data layer. Muse remains the reasoning layer that combines Dizko's behavioral model with the user's calendar, memory, music, and immediate constraints.

## Phase 1: account taste and closed-loop writes

### `get_taste_profile` (`saved:read`)
Returns the connected account's learned structured taste and recent evidence: genre, vibe, event-type, venue, artist, music-genre, price, and day weights, plus saved and binned event ids. Embeddings never leave Dizko.

### `save_event` (`saved:write`)
Already live. Requires explicit confirmation and an idempotency key. A save updates the canonical interaction ledger and marks the taste profile stale for the next read.

### `bin_event` (`saved:write`)
Explicit negative preference action. Requires confirmation and an idempotency key. It uses the app's strongest `not_interested` signal and hides the event from ranked surfaces. This is different from unsaving, which is only a reversal.

Phase 1 acceptance: OAuth subject binding, least-privilege scopes, no embedding disclosure, write confirmation, idempotency, and a proven save/bin -> stale profile -> recompute loop.

## Phase 2: opinionated selection

### `worth_leaving_for`
Build on personalized ranking. Return a small decision set with score components and concise reasons. Do not ship until score explanations are calibrated against saved/attended/binned outcomes.

### `vibe_match`
Expose typed vibe/sound/atmosphere constraints backed by Dizko's existing vibe and semantic layers. Preserve uncertainty and distinguish catalog evidence from model inference.

## Phase 3: plans that act

### `plan_my_night`
Evolve `plan_night` from a read-only primary/fallback list to a confirmed, persisted itinerary. Separate planning from writes. Each saved plan/calendar mutation stays scoped, confirmed, and idempotent. Google/Apple sync waits for a real linked-calendar integration; `.ics` remains the current truthful fallback.

## Phase 4: live differentiation

### `pulse`
Evolve `get_city_pulse` only when event-level live signals exist. Current aggregate programming counts are not door status, filling-up state, availability, or ticket drops and must not be labeled as such.

### `listen_preview`
Use canonical artist-page embeds and music links already stored by Dizko. Return playable source links with artist/event provenance. Do not guess or scrape a similarly named artist.

## Phase 5: transactional and organizer tools

Ticket search/quote/purchase already has policy scaffolding, but autonomous purchase remains gated on a real provider, locked total, explicit confirmation, and scoped payment handoff. Organizer tools (`create_event`, repeat-attendance insights, audience exports) wait for organizer identity, RBAC, consent, privacy thresholds, and audited endpoints. No speculative tool definitions.

## Submission boundary

This roadmap does not alter the live Muse submission packet or its reviewed fields. Add tools to the submitted connector only after their production contracts and scopes are live and their `tools/list` size/review surface have been re-audited.
