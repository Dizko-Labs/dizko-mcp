// One error shape for everything the model can act on. Tool handlers throw
// ToolInputError before any network call; callTool turns it into
// { error, code, field, allowed, hint } so the model knows which argument
// to fix and what values are accepted.

export class ToolInputError extends Error {
  constructor(message, { code = "invalid_argument", field = null, allowed = null, hint = null } = {}) {
    super(message);
    this.name = "ToolInputError";
    this.code = code;
    this.field = field;
    this.allowed = allowed;
    this.hint = hint;
  }

  toPayload() {
    return compact({
      error: this.message,
      code: this.code,
      field: this.field,
      allowed: this.allowed,
      hint: this.hint
    });
  }
}

export function isToolInputError(error) {
  return error instanceof ToolInputError || error?.name === "ToolInputError";
}

function compact(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined));
}
