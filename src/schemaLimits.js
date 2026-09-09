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
  quote_token: 8192
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

  // Items and map values do NOT inherit the parent's field name: a per-field
  // override is about that field, and letting an array named `notes` hand its
  // 2000-character budget to every one of its entries is the opposite of a
  // cap. They take the defaults.
  for (const item of Array.isArray(schema.items) ? schema.items : [schema.items]) {
    if (item) applySchemaLimits(item, "");
  }
  for (const item of schema.prefixItems || []) applySchemaLimits(item, "");
  for (const [key, child] of Object.entries(schema.properties || {})) {
    applySchemaLimits(child, key);
  }
  for (const [key, child] of Object.entries(schema.patternProperties || {})) {
    applySchemaLimits(child, key);
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
    applySchemaLimits(schema.additionalProperties, "");
  }
  for (const [key, child] of Object.entries(schema.$defs || {})) {
    applySchemaLimits(child, key);
  }
  for (const keyword of ["anyOf", "oneOf", "allOf"]) {
    for (const branch of schema[keyword] || []) applySchemaLimits(branch, fieldName);
  }

  return schema;
}

// Bounds for input that reaches a handler without a schema to check it
// against. The pre-0.8 tool names have no inputSchema of their own and are
// dispatched before validation, so without this they are an uncapped door
// into the same handlers and the same upstream API.
export const LEGACY_INPUT_LIMITS = {
  maxStringLength: 8192,
  maxArrayItems: 100,
  maxKeys: 200,
  maxDepth: 8
};

export function assertBoundedInput(input, onViolation) {
  let keys = 0;
  const walk = (value, depth, path) => {
    if (depth > LEGACY_INPUT_LIMITS.maxDepth) onViolation(`${path || "input"} is nested too deeply.`, path);
    if (typeof value === "string") {
      if (value.length > LEGACY_INPUT_LIMITS.maxStringLength) {
        onViolation(`${path || "input"} must be at most ${LEGACY_INPUT_LIMITS.maxStringLength} characters.`, path);
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > LEGACY_INPUT_LIMITS.maxArrayItems) {
        onViolation(`${path || "input"} accepts at most ${LEGACY_INPUT_LIMITS.maxArrayItems} items.`, path);
      }
      value.slice(0, LEGACY_INPUT_LIMITS.maxArrayItems).forEach((item, index) => walk(item, depth + 1, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        keys += 1;
        if (keys > LEGACY_INPUT_LIMITS.maxKeys) onViolation("The request carries too many fields.", path || null);
        walk(child, depth + 1, path ? `${path}.${key}` : key);
      }
    }
  };
  walk(input, 0, "");
}
