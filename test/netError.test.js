import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyErrorCode,
  describeNetworkError,
  isRetryableStatus,
  rootCause
} from "../src/netError.js";

function undiciDnsError(code = "EAI_AGAIN", hostname = "backend.example.test") {
  const error = new TypeError("fetch failed");
  error.cause = Object.assign(new Error(`getaddrinfo ${code} ${hostname}`), {
    code,
    syscall: "getaddrinfo",
    hostname
  });
  return error;
}

test("rootCause walks nested cause chains to the most specific error", () => {
  const error = undiciDnsError();
  assert.equal(rootCause(error).code, "EAI_AGAIN");

  const aggregate = new AggregateError([Object.assign(new Error("refused"), { code: "ECONNREFUSED" })], "all failed");
  const wrapped = new TypeError("fetch failed");
  wrapped.cause = aggregate;
  assert.equal(rootCause(wrapped).code, "ECONNREFUSED");

  const plain = new Error("plain");
  assert.equal(rootCause(plain), plain);
});

test("EAI_AGAIN is classified as retryable DNS failure with hostname and url", () => {
  const described = describeNetworkError(undiciDnsError(), "https://backend.example.test/events?city=los+angeles");
  assert.equal(described.retryable, true);
  assert.equal(described.classification, "dns");
  assert.equal(described.code, "EAI_AGAIN");
  assert.equal(described.hostname, "backend.example.test");
  assert.equal(described.url, "https://backend.example.test/events?city=los+angeles");
  assert.match(described.message, /DNS lookup for backend\.example\.test failed \(EAI_AGAIN\)/);
  assert.match(described.cause, /getaddrinfo EAI_AGAIN/);
});

test("ENOTFOUND, ETIMEDOUT, ECONNRESET, and ECONNREFUSED are retryable", () => {
  for (const code of ["ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"]) {
    const described = describeNetworkError(undiciDnsError(code), "https://x.example.test/");
    assert.equal(described.retryable, true, `${code} should be retryable`);
    assert.equal(described.code, code);
  }
});

test("timeout abort errors classify as retryable timeouts", () => {
  const abort = new Error("The operation was aborted due to timeout");
  abort.name = "TimeoutError";
  const described = describeNetworkError(abort, "https://slow.example.test/");
  assert.equal(described.classification, "timeout");
  assert.equal(described.retryable, true);
  assert.match(described.message, /timed out/);
});

test("classifyErrorCode maps codes to failure classes", () => {
  assert.equal(classifyErrorCode("EAI_AGAIN"), "dns");
  assert.equal(classifyErrorCode("ENOTFOUND"), "dns");
  assert.equal(classifyErrorCode("ECONNREFUSED"), "connection_refused");
  assert.equal(classifyErrorCode("ECONNRESET"), "connection_reset");
  assert.equal(classifyErrorCode("ETIMEDOUT"), "timeout");
  assert.equal(classifyErrorCode("UND_ERR_CONNECT_TIMEOUT"), "timeout");
  assert.equal(classifyErrorCode(null, "AbortError"), "timeout");
  assert.equal(classifyErrorCode("SOMETHING_ELSE"), "network");
});

test("isRetryableStatus treats temporary statuses as retryable", () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    assert.equal(isRetryableStatus(status), true, `${status} should be retryable`);
  }
  for (const status of [200, 400, 404, 422]) {
    assert.equal(isRetryableStatus(status), false, `${status} should not be retryable`);
  }
});

test("non-network errors stay non-retryable and keep their message", () => {
  const described = describeNetworkError(new Error("Unsupported date preset: someday"), null);
  assert.equal(described.retryable, false);
  assert.equal(described.classification, "network");
  assert.equal(described.message, "Unsupported date preset: someday");
});

test("internal deployment hostnames are masked in user-facing messages only", async () => {
  const { isInternalHostname } = await import("../src/netError.js");
  assert.equal(isInternalHostname("eventchat-events-mcp-production.up.railway.app"), true);
  assert.equal(isInternalHostname("db.railway.internal"), true);
  assert.equal(isInternalHostname("cache.internal"), true);
  assert.equal(isInternalHostname("api.dizko.app"), false);
  assert.equal(isInternalHostname(null), false);

  const described = describeNetworkError(
    undiciDnsError("ENOTFOUND", "eventchat-events-mcp-production.up.railway.app"),
    "https://eventchat-events-mcp-production.up.railway.app/events"
  );
  assert.doesNotMatch(described.message, /railway/i);
  assert.match(described.message, /the Dizko API/);
  // Structured fields keep the real hostname for logs and diagnostics.
  assert.equal(described.hostname, "eventchat-events-mcp-production.up.railway.app");
});
