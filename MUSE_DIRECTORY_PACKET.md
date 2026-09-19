# Dizko for Muse - directory packet

## Listing

**Name:** Dizko Events

**One-liner:** Find current events, artists, venues, tickets, and friends' plans from Dizko's live culture graph.

**Short description:** Search current concerts, club nights, festivals, comedy, art, food, and culture across 26 live cities. Get sourced event, artist, venue, price, ticket, and flyer details, then save picks to a connected Dizko account.

**Long description:** Dizko gives Muse a current, sourced culture graph instead of relying on model memory or generic web search. Search by city, date, genre, vibe, neighborhood, venue, artist, price, and event type; open canonical event and ticket links; research artists and venues; and build explainable recommendations. Basic research works without an account. Connecting Dizko adds scoped, confirmation-gated saves and a persistent Dizko plan through OAuth. Dizko currently has quality-passing live inventory in 26 cities, including New York, Los Angeles, London, Amsterdam, Lisbon, and Berlin.

**Primary category:** Local & Travel

**Secondary categories:** Music; Entertainment; Lifestyle; Social

## Suggested prompts

- Find three queer-friendly events in New York Friday after 9 PM under $30.
- What's happening in Los Angeles this weekend that feels underground, not mainstream?
- Research the artists playing this event and tell me who I should arrive early for.
- Compare two techno nights in Amsterdam by lineup, venue, price, and ticket source.
- Plan a night in London with one live show and one late dance floor nearby.
- Find free cultural events in Lisbon this week and show me the flyers.
- What is this venue known for, and what is coming up there?
- Show current ticket links and price confidence for the events we discussed.
- Save this event to my Dizko account.
- Add these two events to my Dizko plan.
- Which current events match my saved taste without guessing beyond Dizko's data?
- Give me a sourced weekend roundup for Berlin.

## Screenshot shot list

Capture from the real Muse connector test surface after installation:

1. Directory card: Dizko name, logo, one-liner, categories, and Connect action.
2. Multi-constraint search: prompt + three current event cards with city, date, venue, price, canonical link, ticket source, and flyers.
3. Artist research: one artist result with exact identity, profile link, and upcoming dates.
4. Venue research: exact venue, city, context, and upcoming events.
5. OAuth consent: Dizko-branded screen naming the client and requested scopes.
6. Save success: explicit user confirmation followed by `save_event` success.
7. Plan success: two confirmed additions followed by the Dizko plan link or success state.
8. Honest uncertainty: ticket link present with unverified live availability/price wording.
9. Cross-city proof: one US city and one European city in the same test session.
10. Account controls: how to disconnect/revoke Dizko access.

## Review notes

- Do not describe Dizko as a UI embedded inside Muse. Muse calls Dizko tools and renders the answer.
- Do not promise live ticket inventory where Dizko only has a source link.
- Do not imply social activity is available until the scoped social-read tool ships.
- Basic reads are public. Account writes require OAuth `saved:write`, explicit confirmation, and idempotency.
