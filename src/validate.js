// Small JSON Schema subset validator with model-friendly coercion. The MCP
// SDK's low-level server never validates tool arguments against
// inputSchema, so this is the only thing standing between "city": 123 and
// the upstream API. Supports: type (incl. type arrays), enum, minimum,
// maximum, minLength, maxLength, items, properties, required, $ref into
// $defs, anyOf (as "at least one branch"), dependentRequired.
//
// Coercion: numeric strings -> numbers, "true"/"false" -> booleans,
// comma-separated strings -> arrays, scalars -> single-element arrays,
// numbers -> strings where a string is expected. Unknown keys are kept.

export function validateInput(schema, input, options = {}) {
  const root = options.root || schema;
  const errors = [];
  const value = coerceAndCheck(schema, input, "", root, errors);
  return { value, errors };
}

export function firstErrorPayload(errors, toolName) {
  const first = errors[0];
  return {
    error: first.message,
    code: "invalid_argument",
    field: first.field || null,
    ...(first.allowed ? { allowed: first.allowed } : {}),
    ...(errors.length > 1 ? { other_errors: errors.slice(1, 6).map((error) => error.message) } : {}),
    hint: `Fix the argument and call ${toolName} again.`
  };
}

function coerceAndCheck(schema, value, path, root, errors) {
  if (!schema || typeof schema !== "object") return value;
  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, root);
    return resolved ? coerceAndCheck(resolved, value, path, root, errors) : value;
  }
  if (value === undefined) return value;
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : [];
  if (value === null) {
    if (types.includes("null") || !types.length) return value;
    errors.push({ field: path, message: `${label(path)} must be ${describeType(types)}, not null.` });
    return value;
  }

  let coerced = value;
  if (types.length) {
    coerced = coerceToTypes(types, value);
    if (!matchesAnyType(types, coerced)) {
      errors.push({ field: path, message: `${label(path)} must be ${describeType(types)}.`, allowed: schema.enum || undefined });
      return coerced;
    }
  }

  if (schema.enum) {
    const lowered = typeof coerced === "string" ? coerced.toLowerCase().trim() : coerced;
    const match = schema.enum.find((item) => item === coerced || (typeof item === "string" && typeof lowered === "string" && item.toLowerCase() === lowered));
    if (match === undefined) {
      errors.push({ field: path, message: `${label(path)} must be one of: ${schema.enum.join(", ")}.`, allowed: schema.enum });
      return coerced;
    }
    coerced = match;
  }

  if (typeof coerced === "number") {
    if (schema.minimum !== undefined && coerced < schema.minimum) errors.push({ field: path, message: `${label(path)} must be at least ${schema.minimum}.` });
    if (schema.maximum !== undefined && coerced > schema.maximum) errors.push({ field: path, message: `${label(path)} must be at most ${schema.maximum}.` });
    if (types.includes("integer") && !Number.isInteger(coerced)) errors.push({ field: path, message: `${label(path)} must be a whole number.` });
  }
  if (typeof coerced === "string") {
    if (schema.minLength !== undefined && coerced.length < schema.minLength) errors.push({ field: path, message: `${label(path)} must be at least ${schema.minLength} characters.` });
    if (schema.maxLength !== undefined && coerced.length > schema.maxLength) errors.push({ field: path, message: `${label(path)} must be at most ${schema.maxLength} characters.` });
  }
  if (Array.isArray(coerced)) {
    if (schema.maxItems !== undefined && coerced.length > schema.maxItems) errors.push({ field: path, message: `${label(path)} accepts at most ${schema.maxItems} items.` });
    if (schema.items) coerced = coerced.map((item, index) => coerceAndCheck(schema.items, item, `${path}[${index}]`, root, errors));
  }
  if (coerced && typeof coerced === "object" && !Array.isArray(coerced)) {
    const out = { ...coerced };
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (out[key] !== undefined) out[key] = coerceAndCheck(child, out[key], path ? `${path}.${key}` : key, root, errors);
    }
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      for (const key of Object.keys(out)) {
        if (!(schema.properties || {})[key]) out[key] = coerceAndCheck(schema.additionalProperties, out[key], path ? `${path}.${key}` : key, root, errors);
      }
    }
    for (const key of schema.required || []) {
      if (isMissing(out[key])) errors.push({ field: path ? `${path}.${key}` : key, message: `${label(path ? `${path}.${key}` : key)} is required.` });
    }
    for (const [key, deps] of Object.entries(schema.dependentRequired || {})) {
      if (!isMissing(out[key])) {
        for (const dep of deps) {
          if (isMissing(out[dep])) errors.push({ field: dep, message: `${label(dep)} is required when ${key} is given.` });
        }
      }
    }
    if (Array.isArray(schema.anyOf) && schema.anyOf.length) {
      const satisfied = schema.anyOf.some((branch) => {
        const probe = [];
        coerceAndCheck({ ...branch, properties: undefined }, out, path, root, probe);
        return probe.length === 0;
      });
      if (!satisfied) {
        const needs = schema.anyOf.map((branch) => (branch.required || []).join("+")).filter(Boolean);
        errors.push({ field: path || null, message: `Provide at least one of: ${needs.join(", ")}.` });
      }
    }
    coerced = out;
  }
  return coerced;
}

function coerceToTypes(types, value) {
  const wants = (type) => types.includes(type);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if ((wants("number") || wants("integer")) && trimmed !== "" && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    if (wants("boolean") && /^(true|false|yes|no|1|0)$/i.test(trimmed) && !wants("string")) return /^(true|yes|1)$/i.test(trimmed);
    if (wants("array") && !wants("string")) return trimmed === "" ? [] : trimmed.split(",").map((item) => item.trim()).filter(Boolean);
    return value;
  }
  if (typeof value === "number") {
    if (wants("string") && !wants("number") && !wants("integer")) return String(value);
    if (wants("array") && !wants("number")) return [String(value)];
    if (wants("boolean") && !wants("number") && (value === 0 || value === 1)) return value === 1;
    return value;
  }
  if (typeof value === "boolean" && wants("string") && !wants("boolean")) return String(value);
  if (Array.isArray(value) && wants("string") && !wants("array") && value.length === 1) return String(value[0]);
  return value;
}

function matchesAnyType(types, value) {
  return types.some((type) => {
    switch (type) {
      case "string": return typeof value === "string";
      case "number": return typeof value === "number" && Number.isFinite(value);
      case "integer": return typeof value === "number" && Number.isFinite(value);
      case "boolean": return typeof value === "boolean";
      case "array": return Array.isArray(value);
      case "object": return value !== null && typeof value === "object" && !Array.isArray(value);
      case "null": return value === null;
      default: return true;
    }
  });
}

function resolveRef(ref, root) {
  if (!ref.startsWith("#/")) return null;
  return ref.slice(2).split("/").reduce((node, key) => (node ? node[key] : null), root);
}

function isMissing(value) {
  return value === undefined || value === null || (typeof value === "string" && !value.trim());
}

function describeType(types) {
  const names = types.map((type) => ({ string: "text", number: "a number", integer: "a whole number", boolean: "true or false", array: "a list", object: "an object", null: "null" })[type] || type);
  return names.join(" or ");
}

function label(path) {
  return path || "input";
}
