import assert from "node:assert/strict";
import test from "node:test";
import { authenticateConnectorRequest, currentAuthContext, requireScope, runWithAuthContext } from "../src/authContext.js";

function request(authorization) { return { headers: authorization ? { authorization } : {} }; }

test("anonymous requests have no connector identity or scopes", async () => {
  assert.deepEqual(await authenticateConnectorRequest(request(), {}), { authenticated: false, subject: null, clientId: null, token: null, scopes: [] });
});

test("shared bearer is read-only transport auth, never user write auth", async () => {
  const context = await authenticateConnectorRequest(request("Bearer shared"), {}, "shared");
  assert.deepEqual(context, { authenticated: true, subject: "shared-transport", clientId: null, token: null, scopes: ["events:read"] });
  assert.equal(requireScope(context, "events:read").ok, true);
  assert.deepEqual(requireScope(context, "saved:write"), { ok: false, status: 403, code: "insufficient_scope" });
});

test("a pluggable verifier supplies a request-bound user and least-privilege scopes", async () => {
  const context = await authenticateConnectorRequest(request("Bearer user-token"), {
    verifyBearerToken: async (token) => token === "user-token"
      ? { subject: "user-123", clientId: "client-1", scopes: ["saved:write", "events:read", "saved:write"] }
      : null
  });
  assert.deepEqual(context, { authenticated: true, subject: "user-123", clientId: "client-1", token: "user-token", scopes: ["events:read", "saved:write"] });
  await runWithAuthContext(context, async () => {
    await Promise.resolve();
    assert.equal(currentAuthContext().subject, "user-123");
  });
  assert.equal(currentAuthContext().authenticated, false);
});

test("malformed and rejected bearer credentials fail authentication", async () => {
  assert.equal(await authenticateConnectorRequest(request("Basic nope"), {}), null);
  assert.equal(await authenticateConnectorRequest(request("Bearer nope"), { verifyBearerToken: async () => null }), null);
});
