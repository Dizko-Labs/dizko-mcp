import assert from "node:assert/strict";
import test from "node:test";
import { SORT_OPTIONS } from "../src/api.js";
import { tools } from "../src/tools.js";
import { firstErrorPayload, validateInput } from "../src/validate.js";

function schemaFor(name) {
  const tool = tools.find((candidate) => candidate.name === name);
  assert.ok(tool, `tool ${name} is registered`);
  return tool.inputSchema;
}

// ---------------------------------------------------------------------------
// Coercion
// ---------------------------------------------------------------------------

test("validateInput coerces the shapes models actually send", () => {
  const schema = {
    type: "object",
    properties: {
      limit: { type: "integer" },
      genres: { type: "array", items: { type: "string" } },
      free: { type: "boolean" },
      city: { type: "string" },
      sort_by: { type: "string", enum: ["soonest", "popular"] },
      query: { type: "string" }
    }
  };
  const { value, errors } = validateInput(schema, {
    limit: "5",
    genres: "techno,house",
    free: "true",
    city: 123,
    sort_by: "Soonest",
    query: "2"
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(value, {
    limit: 5,
    genres: ["techno", "house"],
    free: true,
    city: "123",
    sort_by: "soonest",
    query: "2"
  });
  assert.equal(typeof value.limit, "number");
  assert.equal(typeof value.query, "string", "a numeric string stays a string when the schema wants text");
});

test("enum matching is case-insensitive and returns the canonical value", () => {
  const schema = { type: "object", properties: { sort_by: { type: "string", enum: SORT_OPTIONS } } };
  assert.equal(validateInput(schema, { sort_by: "  POPULAR " }).value.sort_by, "popular");
  assert.equal(validateInput(schema, { sort_by: "Soonest" }).value.sort_by, "soonest");
});

test("unknown keys are kept and untouched", () => {
  const schema = { type: "object", properties: { limit: { type: "integer" } } };
  const { value, errors } = validateInput(schema, { limit: "3", extra: "kept" });
  assert.deepEqual(errors, []);
  assert.deepEqual(value, { limit: 3, extra: "kept" });
});

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

test("a limit above maximum names the field and the bound", () => {
  const schema = { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200 } } };
  const { errors } = validateInput(schema, { limit: 500 });
  assert.deepEqual(errors, [{ field: "limit", message: "limit must be at most 200." }]);
});

test("an enum mismatch lists the allowed values", () => {
  const schema = { type: "object", properties: { sort_by: { type: "string", enum: SORT_OPTIONS } } };
  const { errors } = validateInput(schema, { sort_by: "fastest" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].field, "sort_by");
  assert.equal(errors[0].message, `sort_by must be one of: ${SORT_OPTIONS.join(", ")}.`);
  assert.deepEqual(errors[0].allowed, SORT_OPTIONS);
});

test("a fractional integer is rejected as not a whole number", () => {
  const schema = { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 200 } } };
  assert.deepEqual(validateInput(schema, { limit: 1.5 }).errors, [
    { field: "limit", message: "limit must be a whole number." }
  ]);
  assert.deepEqual(validateInput(schema, { limit: "1.5" }).errors, [
    { field: "limit", message: "limit must be a whole number." }
  ]);
});

test("a type mismatch describes the expected type", () => {
  const schema = { type: "object", properties: { limit: { type: "integer" }, city: { type: "string" } } };
  const { errors } = validateInput(schema, { limit: "many", city: null });
  assert.equal(errors.length, 2);
  assert.equal(errors[0].field, "limit");
  assert.equal(errors[0].message, "limit must be a whole number.");
  assert.equal(errors[1].field, "city");
  assert.equal(errors[1].message, "city must be text, not null.");
});

test("dependentRequired: profile_id without profile_secret reports profile_secret", () => {
  const { errors } = validateInput(schemaFor("dizko_search_events"), { city: "berlin", profile_id: "dzk_1" });
  assert.deepEqual(errors, [
    { field: "profile_secret", message: "profile_secret is required when profile_id is given." }
  ]);
  const reverse = validateInput(schemaFor("dizko_search_events"), { city: "berlin", profile_secret: "dzs_1" });
  assert.deepEqual(reverse.errors, [
    { field: "profile_id", message: "profile_id is required when profile_secret is given." }
  ]);
});

test("a missing required field reads '<field> is required.'", () => {
  assert.deepEqual(validateInput(schemaFor("dizko_ticket_offers"), {}).errors, [
    { field: "event_id", message: "event_id is required." }
  ]);
  // Blank strings count as missing.
  assert.deepEqual(validateInput(schemaFor("dizko_ticket_offers"), { event_id: "   " }).errors, [
    { field: "event_id", message: "event_id is required." }
  ]);
});

test("anyOf branches: feedback needs liked, rating or notes", () => {
  const schema = schemaFor("dizko_record_feedback");
  const base = { profile_id: "dzk_1", profile_secret: "dzs_1", event_id: "evt-1" };

  assert.deepEqual(validateInput(schema, base).errors, [
    { field: "liked", message: "Provide at least one of: liked, rating, notes." }
  ]);
  assert.deepEqual(validateInput(schema, { ...base, liked: false }).errors, []);
  assert.deepEqual(validateInput(schema, { ...base, rating: "4" }).errors, []);
  assert.deepEqual(validateInput(schema, { ...base, notes: "great night" }).errors, []);
});

test("$ref into $defs resolves for nested preferences.day_filters", () => {
  const schema = schemaFor("dizko_create_profile");
  const { value, errors } = validateInput(schema, {
    consent: "true",
    preferences: {
      genres: "techno,house",
      max_price: "30",
      day_filters: {
        friday: { genres: "techno", max_price: "20", free: "yes" }
      }
    }
  });
  assert.deepEqual(errors, []);
  assert.equal(value.consent, true);
  assert.deepEqual(value.preferences.genres, ["techno", "house"]);
  assert.equal(value.preferences.max_price, 30);
  assert.deepEqual(value.preferences.day_filters.friday, { genres: ["techno"], max_price: 20, free: true });

  const invalid = validateInput(schema, {
    consent: true,
    preferences: { day_filters: { friday: { max_price: "cheap" } } }
  });
  assert.equal(invalid.errors.length, 1);
  assert.equal(invalid.errors[0].field, "preferences.day_filters.friday.max_price");
  assert.equal(invalid.errors[0].message, "preferences.day_filters.friday.max_price must be a number.");
});

// ---------------------------------------------------------------------------
// firstErrorPayload
// ---------------------------------------------------------------------------

test("firstErrorPayload shapes a single error without optional keys", () => {
  const payload = firstErrorPayload([{ field: "limit", message: "limit must be at most 200." }], "dizko_search_events");
  assert.deepEqual(payload, {
    error: "limit must be at most 200.",
    code: "invalid_argument",
    field: "limit",
    hint: "Fix the argument and call dizko_search_events again."
  });
  assert.ok(!("allowed" in payload));
  assert.ok(!("other_errors" in payload));
});

test("firstErrorPayload carries allowed values and the remaining errors", () => {
  const schema = {
    type: "object",
    properties: {
      sort_by: { type: "string", enum: SORT_OPTIONS },
      limit: { type: "integer", maximum: 200 }
    }
  };
  const { errors } = validateInput(schema, { sort_by: "fastest", limit: 500 });
  assert.equal(errors.length, 2);
  const payload = firstErrorPayload(errors, "dizko_search_events");
  assert.deepEqual(payload, {
    error: `sort_by must be one of: ${SORT_OPTIONS.join(", ")}.`,
    code: "invalid_argument",
    field: "sort_by",
    allowed: SORT_OPTIONS,
    other_errors: ["limit must be at most 200."],
    hint: "Fix the argument and call dizko_search_events again."
  });
  assert.match(payload.hint, /dizko_search_events/);
});

test("firstErrorPayload normalizes a missing field to null", () => {
  const payload = firstErrorPayload([{ field: undefined, message: "Provide at least one of: liked, rating, notes." }], "dizko_record_feedback");
  assert.equal(payload.field, null);
  assert.equal(payload.error, "Provide at least one of: liked, rating, notes.");
  assert.equal(payload.hint, "Fix the argument and call dizko_record_feedback again.");
});
