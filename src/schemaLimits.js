// Input size caps.
//
// The MCP transport accepts whatever a client sends, and every tool argument
// eventually reaches a loop, a regex, or a file on disk. A single call with
// `avoid` holding 20,000 terms used to block the event loop for ~58 seconds,
// because each term compiles a fresh RegExp against every event in the page.
// Rather than trust each schema author to remember a cap, every string and
// array in every tool schema gets one here, and validate.js rejects anything
// over it before a single byte reaches the upstream API.
//
// Caps are deliberately generous for a human typing through an assistant and
// deliberately small next to what an automated caller can produce.

export const DEFAULT_STRING_MAX_LENGTH = 200;
export const DEFAULT_ARRAY_MAX_ITEMS = 25;

// Fields that legitimately carry more than a short phrase.
export const STRING_MAX_LENGTH_BY_FIELD = {
  notes: 2000,
  confirmation_text: 400,
  refund_terms: 400,
  // A signed quote token is base64url(JSON).base64url(HMAC) over a trimmed
  // event, so it is long by construction. Still bounded: a token past this
  // was not minted by us.
  quote_token: 8192,
  query: 200,
  description: 500
};

// Taste lists are set-membership checks over a page of events, which is
// linear and cheap: 50 terms across 500 events costs ~90ms. Someone who
// follows fifty DJs is a real user, not an attacker, so these are generous.
// `avoid` is the one list that runs a regex per term, so it stays tighter.
const TASTE_LIST_MAX_ITEMS = 50;

export const ARRAY_MAX_ITEMS_BY_FIELD = {
  genres: TASTE_LIST_MAX_ITEMS,
  vibe: TASTE_LIST_MAX_ITEMS,
  event_types: TASTE_LIST_MAX_ITEMS,
  neighborhoods: TASTE_LIST_MAX_ITEMS,
  venues: TASTE_LIST_MAX_ITEMS,
  promoters: TASTE_LIST_MAX_ITEMS,
  featuring: TASTE_LIST_MAX_ITEMS,
  avoid: 40,
  fields: 12,
  cities: 12
};

// Applies the caps to a JSON Schema in place and returns it. Schemas that
// already declare a limit keep it, so a tighter hand-written cap (artists:
// maxItems 8) always wins over the default.
export function applySchemaLimits(schema, fieldName = "") {
  if (!schema || typeof schema !== "object") return schema;

  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : [];

  if (types.includes("string") && schema.maxLength === undefined && !schema.enum) {
    schema.maxLength = STRING_MAX_LENGTH_BY_FIELD[fieldName] ?? DEFAULT_STRING_MAX_LENGTH;
  }
  if (types.includes("array") && schema.maxItems === undefined) {
    schema.maxItems = ARRAY_MAX_ITEMS_BY_FIELD[fieldName] ?? DEFAULT_ARRAY_MAX_ITEMS;
  }

  if (schema.items) applySchemaLimits(schema.items, fieldName);
  for (const [key, child] of Object.entries(schema.properties || {})) {
    applySchemaLimits(child, key);
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    applySchemaLimits(schema.additionalProperties, fieldName);
  }
  for (const [key, child] of Object.entries(schema.$defs || {})) {
    applySchemaLimits(child, key);
  }
  for (const branch of schema.anyOf || []) applySchemaLimits(branch, fieldName);

  return schema;
}
