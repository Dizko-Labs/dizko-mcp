import { AsyncLocalStorage } from "node:async_hooks";
import { timingSafeEqual } from "node:crypto";

const storage = new AsyncLocalStorage();

export function currentAuthContext() {
  return storage.getStore() || { authenticated: false, subject: null, clientId: null, token: null, scopes: [] };
}

export function runWithAuthContext(context, operation) {
  return storage.run(freezeContext(context), operation);
}

export async function authenticateConnectorRequest(request, options = {}, staticToken = "") {
  const authorization = String(request.headers.authorization || "");
  if (!authorization) return { authenticated: false, subject: null, clientId: null, token: null, scopes: [] };
  if (!authorization.startsWith("Bearer ")) return null;
  const token = authorization.slice("Bearer ".length);
  if (staticToken && safeEqual(token, staticToken)) {
    // A shared transport token cannot identify a Dizko user. It may gate read
    // traffic, but must never gain saved:read or saved:write.
    return { authenticated: true, subject: "shared-transport", clientId: null, token: null, scopes: ["events:read"] };
  }
  if (typeof options.verifyBearerToken === "function") {
    const verified = await options.verifyBearerToken(token);
    if (!verified?.subject || !Array.isArray(verified.scopes)) return null;
    return freezeContext({ authenticated: true, subject: verified.subject, clientId: verified.clientId, token, scopes: verified.scopes });
  }
  return null;
}

export function requireScope(context, scope) {
  if (!context?.authenticated) return { ok: false, status: 401, code: "authentication_required" };
  if (!context.scopes?.includes(scope)) return { ok: false, status: 403, code: "insufficient_scope" };
  return { ok: true };
}

function freezeContext(context) {
  return Object.freeze({
    authenticated: Boolean(context?.authenticated),
    subject: context?.subject ? String(context.subject) : null,
    clientId: context?.clientId ? String(context.clientId) : null,
    token: context?.token ? String(context.token) : null,
    scopes: Object.freeze([...new Set((context?.scopes || []).map(String))].sort())
  });
}

function safeEqual(value, expected) {
  const a = Buffer.from(value);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
