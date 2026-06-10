// Shared network-error classification for the CLI, MCP servers, doctor,
// smoke test, and monitor. Keep retryability and failure labels here so
// the surfaces cannot drift from each other.

export const RETRYABLE_ERROR_CODES = new Set([
  "EAI_AGAIN",
  "ENOTFOUND",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET"
]);

const TIMEOUT_ERROR_NAMES = new Set(["TimeoutError", "AbortError"]);

export function isRetryableStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

// Walks error.cause / AggregateError.errors to the most specific failure.
// undici wraps DNS and socket errors as TypeError("fetch failed") with the
// real error (code, syscall, hostname) on .cause.
export function rootCause(error) {
  let current = error;
  const seen = new Set();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if (Array.isArray(current.errors) && current.errors.length) {
      current = current.errors[0];
      continue;
    }
    if (current.cause && typeof current.cause === "object") {
      current = current.cause;
      continue;
    }
    break;
  }
  return current || error;
}

export function classifyErrorCode(code, errorName) {
  if (code === "EAI_AGAIN" || code === "ENOTFOUND") return "dns";
  if (code === "ECONNREFUSED") return "connection_refused";
  if (code === "ECONNRESET" || code === "EPIPE" || code === "UND_ERR_SOCKET") return "connection_reset";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT" || code === "UND_ERR_HEADERS_TIMEOUT" || code === "UND_ERR_BODY_TIMEOUT") return "timeout";
  if (TIMEOUT_ERROR_NAMES.has(errorName)) return "timeout";
  if (typeof code === "string" && (code.startsWith("ERR_TLS") || code.startsWith("CERT_") || code.startsWith("UNABLE_TO_VERIFY"))) return "tls";
  return "network";
}

// Normalizes any thrown fetch/network error into a flat description:
// { message, code, hostname, url, classification, retryable, cause }
export function describeNetworkError(error, url) {
  const root = rootCause(error);
  const code = root?.code || (TIMEOUT_ERROR_NAMES.has(error?.name) ? "ETIMEDOUT" : null);
  const classification = classifyErrorCode(code, error?.name);
  const hostname = root?.hostname || hostnameFromUrl(url);
  const retryable = (code !== null && RETRYABLE_ERROR_CODES.has(code)) || classification === "timeout";
  return {
    message: humanNetworkMessage({ classification, code, hostname, root, error }),
    code,
    hostname,
    url: url ? String(url) : null,
    classification,
    retryable,
    cause: root?.message || error?.message || String(error)
  };
}

function humanNetworkMessage({ classification, code, hostname, root, error }) {
  const host = hostname || "the server";
  switch (classification) {
    case "dns":
      return `DNS lookup for ${host} failed (${code}). This is usually a temporary resolver or network issue — retry shortly, check your network/VPN/DNS, or override the endpoint via environment variables.`;
    case "connection_refused":
      return `Connection to ${host} was refused (${code}). The service may be down or the port blocked.`;
    case "connection_reset":
      return `Connection to ${host} was dropped (${code}). This is usually transient — retry shortly.`;
    case "timeout":
      return `Request to ${host} timed out${code ? ` (${code})` : ""}. The service may be slow or unreachable — retry shortly.`;
    case "tls":
      return `TLS handshake with ${host} failed (${code}). Check system certificates or any intercepting proxy.`;
    default:
      return root?.message || error?.message || "Network request failed.";
  }
}

export function hostnameFromUrl(url) {
  if (!url) return null;
  try {
    return new URL(String(url)).hostname;
  } catch {
    return null;
  }
}
