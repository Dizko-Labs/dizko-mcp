import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { toNodeHandler } from "@modelcontextprotocol/node";
import { getEvent } from "./api.js";
import { buildCalendarEvent } from "./calendar.js";
import { eventLinkTargets } from "./format.js";
import { createSdkMcpServer } from "./sdkServer.js";
import { TOOL_VERSION } from "./config.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function createHttpMcpServer(options = {}) {
  const settings = {
    maxBodyBytes: Number(options.maxBodyBytes || process.env.EVENTCHAT_MCP_MAX_BODY_BYTES || 1024 * 1024),
    bearerToken: options.bearerToken ?? process.env.EVENTCHAT_MCP_BEARER_TOKEN,
    allowedOrigins: splitList(options.allowedOrigins ?? process.env.EVENTCHAT_MCP_ALLOWED_ORIGINS ?? "*"),
    rateLimitDisabled: parseBoolean(options.rateLimitDisabled ?? process.env.EVENTCHAT_MCP_RATE_LIMIT_DISABLED, false),
    rateLimitWindowMs: Number(options.rateLimitWindowMs || process.env.EVENTCHAT_MCP_RATE_LIMIT_WINDOW_MS || 60_000),
    // 600/min per client address. Hosted assistants (ChatGPT, Claude) call
    // from shared egress addresses, so the per-IP budget must cover many
    // users; exempt known ranges via EVENTCHAT_MCP_RATE_LIMIT_EXEMPT.
    rateLimitMax: Number(options.rateLimitMax || process.env.EVENTCHAT_MCP_RATE_LIMIT_MAX || 600),
    rateLimitExempt: splitList(options.rateLimitExempt ?? process.env.EVENTCHAT_MCP_RATE_LIMIT_EXEMPT ?? ""),
    // How many proxies of ours sit in front of this process. Only the hops
    // they appended to X-Forwarded-For can be trusted.
    trustedProxies: Number(options.trustedProxies ?? process.env.EVENTCHAT_MCP_TRUSTED_PROXIES ?? 1),
    // A JSON-RPC batch is N calls in one request. Without a cap, one POST
    // inside the 1 MB body limit carries thousands of tool calls and fans
    // out that many upstream requests at once.
    maxBatchSize: Number(options.maxBatchSize || process.env.EVENTCHAT_MCP_MAX_BATCH_SIZE || 20)
  };
  const rateLimiter = createRateLimiter(settings);
  // Serves the 2026-07-28 revision and falls back to old-school stateless
  // serving for 2025-era clients, both from the same server definition.
  // The factory runs once per request - nothing is retained between calls,
  // which is what the stateless core requires.
  const mcpHandler = toNodeHandler(createMcpHandler(() => createSdkMcpServer(options), {
    onerror: (error) => process.stderr.write(`dizko MCP error: ${error.message}\n`)
  }));

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      // An origin allowlist that only shapes the response header is enforced
      // by the browser, which is enough for an ordinary cross-origin read but
      // not for DNS rebinding: after a rebind the attacker page IS the target
      // origin, so CORS never applies. The MCP spec asks servers to validate
      // Origin for exactly this reason, so a configured allowlist rejects
      // here as well. The default "*" keeps the public API open and this is a
      // no-op for it; a request with no Origin (every non-browser client)
      // is unaffected.
      if (!originAllowed(request, settings)) {
        sendJson(response, 403, { error: "Origin not allowed." }, corsHeaders(request, settings));
        return;
      }

      if (request.method === "OPTIONS") {
        sendNoBody(response, 204, corsHeaders(request, settings));
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, name: "dizko", version: TOOL_VERSION }, corsHeaders(request, settings));
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        sendJson(response, 200, {
          name: "dizko",
          transport: "mcp-http",
          endpoint: "/mcp",
          health: "/health",
          install: "/install",
          privacy: "/privacy-policy.html",
          support: "/support.html",
          terms: "/terms.html",
          user_guide: "/user-guide.html",
          security: "/.well-known/security.txt",
          logo: "/logo-512.png"
        }, corsHeaders(request, settings));
        return;
      }

      if (request.method === "GET" && ["/privacy-policy.html", "/support.html", "/terms.html", "/user-guide.html", "/install.html"].includes(url.pathname)) {
        await sendStaticHtml(response, url.pathname.slice(1), corsHeaders(request, settings));
        return;
      }

      if (request.method === "GET" && url.pathname === "/install") {
        response.writeHead(302, {
          ...corsHeaders(request, settings),
          Location: "https://www.dizko.app/mcp/install"
        });
        response.end();
        return;
      }

      const shortLink = request.method === "GET" && url.pathname.match(/^\/e\/([^/]+)\/(cal|map|ics)$/);
      if (shortLink) {
        // Short links trigger upstream event lookups, so they share the
        // /mcp rate limiter - random-id scans must not hammer the backend.
        const rateLimit = rateLimiter.check(clientIp(request, settings.trustedProxies), request.socket?.remoteAddress);
        if (!rateLimit.allowed) {
          sendJson(response, 429, { error: "Rate limit exceeded. Please retry shortly." }, {
            ...corsHeaders(request, settings),
            ...rateLimitHeadersFor(rateLimit),
            "Retry-After": String(rateLimit.retryAfterSeconds)
          });
          return;
        }
        let eventId;
        try {
          eventId = decodeURIComponent(shortLink[1]);
        } catch {
          sendJson(response, 400, { error: "Malformed event id in link." }, corsHeaders(request, settings));
          return;
        }
        await handleEventShortLink(response, eventId, shortLink[2], corsHeaders(request, settings), options);
        return;
      }

      if (
        request.method === "GET"
        && url.pathname === "/download/dizko-events.mcpb"
      ) {
        await sendMcpbBundle(response, corsHeaders(request, settings));
        return;
      }

      if (request.method === "GET" && ["/.well-known/security.txt", "/security.txt"].includes(url.pathname)) {
        sendSecurityTxt(response, corsHeaders(request, settings));
        return;
      }

      if (request.method === "GET" && url.pathname === "/logo-512.png") {
        await sendStaticPng(response, "logo-512.png", corsHeaders(request, settings));
        return;
      }

      if (url.pathname !== "/mcp") {
        sendJson(response, 404, { error: "Not found" }, corsHeaders(request, settings));
        return;
      }

      if (request.method !== "POST") {
        sendJson(response, 405, { error: "Method not allowed" }, corsHeaders(request, settings));
        return;
      }

      if (!isAuthorized(request, settings)) {
        sendJson(response, 401, { error: "Unauthorized" }, {
          ...corsHeaders(request, settings),
          "WWW-Authenticate": "Bearer"
        });
        return;
      }

      const rateLimit = rateLimiter.check(clientIp(request, settings.trustedProxies), request.socket?.remoteAddress);
      const rateLimitHeaders = rateLimitHeadersFor(rateLimit);
      if (!rateLimit.allowed) {
        sendJson(response, 429, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32029, message: "Rate limit exceeded. Please retry shortly." }
        }, {
          ...corsHeaders(request, settings),
          ...rateLimitHeaders,
          "Retry-After": String(rateLimit.retryAfterSeconds)
        });
        return;
      }

      // 2026-07-28 requests carry their revision in `_meta`, not a header.
      // Only 2025-era clients send MCP-Protocol-Version, so echo it back
      // when it is present rather than asserting a revision of our own.
      if (request.headers["mcp-protocol-version"]) {
        response.setHeader("MCP-Protocol-Version", request.headers["mcp-protocol-version"]);
      }
      for (const [name, value] of Object.entries(securityHeaders())) {
        response.setHeader(name, value);
      }
      for (const [name, value] of Object.entries(corsHeaders(request, settings))) {
        response.setHeader(name, value);
      }
      for (const [name, value] of Object.entries(rateLimitHeaders)) {
        response.setHeader(name, value);
      }

      const payload = await readJson(request, settings.maxBodyBytes);
      validateJsonRpcPayload(payload, settings.maxBatchSize);
      // Charge the limiter for every call in the batch, not once for the
      // envelope that carries them.
      const batchCost = Array.isArray(payload) ? payload.length : 1;
      if (batchCost > 1) {
        const batchLimit = rateLimiter.check(clientIp(request, settings.trustedProxies), request.socket?.remoteAddress, batchCost - 1);
        if (!batchLimit.allowed) {
          sendJson(response, 429, {
            jsonrpc: "2.0",
            id: null,
            error: { code: -32029, message: "Rate limit exceeded. Please retry shortly." }
          }, {
            ...corsHeaders(request, settings),
            ...rateLimitHeadersFor(batchLimit),
            "Retry-After": String(batchLimit.retryAfterSeconds)
          });
          return;
        }
      }
      await mcpHandler(request, response, payload);
    } catch (error) {
      const safeError = safeJsonRpcError(error);
      sendJson(response, safeError.status, {
        jsonrpc: "2.0",
        id: null,
        error: { code: safeError.code, message: safeError.message }
      }, corsHeaders(request, settings));
    }
  });
}

export function safeJsonRpcError(error) {
  if (error instanceof SyntaxError) {
    return { status: 400, code: -32700, message: "Invalid JSON request." };
  }
  if (error?.message === "Request body too large") {
    return { status: 413, code: -32600, message: "Request body too large." };
  }
  if (error?.message === "JSON-RPC batch too large") {
    return { status: 400, code: -32600, message: "JSON-RPC batch too large. Send fewer calls per request." };
  }
  if ([
    "Invalid JSON-RPC request",
    "Unsupported JSON-RPC version",
    "Missing JSON-RPC method"
  ].includes(error?.message)) {
    return { status: 400, code: -32600, message: "Invalid JSON-RPC request." };
  }
  return { status: 500, code: -32603, message: "Internal server error." };
}

export function runHttpMcpServer(env = process.env) {
  const port = Number(env.PORT || env.EVENTCHAT_MCP_PORT || 8787);
  const host = env.HOST || env.EVENTCHAT_MCP_HOST || "0.0.0.0";
  const server = createHttpMcpServer();
  server.listen(port, host, () => {
    process.stderr.write(`dizko MCP listening on http://${host}:${port}/mcp\n`);
  });
  return server;
}

// /e/<id>/cal -> 302 Google Calendar template, /e/<id>/map -> 302 Google
// Maps directions, /e/<id>/ics -> downloadable calendar file. Short links
// keep MCP tool payloads small; the full URLs are rebuilt on click.
async function handleEventShortLink(response, eventId, kind, headers, options = {}) {
  let event;
  try {
    event = await getEvent(eventId, options);
  } catch (error) {
    const status = error.status === 404 ? 404 : 502;
    sendJson(response, status, {
      error: status === 404
        ? "Event not found - it may have ended or been removed."
        : "Event lookup failed upstream. Try again shortly."
    }, headers);
    return;
  }

  if (kind === "ics") {
    const calendarEvent = buildCalendarEvent(event, options);
    response.writeHead(200, {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${calendarEvent.ics_filename}"`,
      "Cache-Control": "public, max-age=300",
      ...securityHeaders(),
      ...headers
    });
    response.end(calendarEvent.ics_content);
    return;
  }

  const target = eventLinkTargets(event, options)[kind];
  if (!target) {
    sendJson(response, 404, {
      error: kind === "cal"
        ? "This event has no start time, so a calendar link is not available."
        : "This event has no mappable location, so directions are not available."
    }, headers);
    return;
  }

  response.writeHead(302, {
    Location: target,
    "Cache-Control": "public, max-age=300",
    ...headers
  });
  response.end();
}

async function sendMcpbBundle(response, headers = {}) {
  let bundleFile = null;
  try {
    const files = await readdir(join(packageRoot, "dist"));
    bundleFile = files.filter((file) => file.endsWith(".mcpb")).sort().pop() || null;
  } catch {
    bundleFile = null;
  }
  if (!bundleFile) {
    sendJson(response, 404, { error: "Bundle not built on this deployment. Run `npm run build:mcpb` or install via /install instead." }, headers);
    return;
  }
  const body = await readFile(join(packageRoot, "dist", bundleFile));
  response.writeHead(200, {
    "Content-Type": "application/zip",
    "Content-Disposition": `attachment; filename="${bundleFile}"`,
    "Cache-Control": "public, max-age=3600",
    ...securityHeaders(),
    ...headers
  });
  response.end(body);
}

// Buffer the chunks and decode once. Stringifying each chunk on its own
// replaces any multi-byte character split across a chunk boundary with U+FFFD,
// which silently mangles a city or an artist name in a large body instead of
// failing - and miscounts the size limit against the corrupted string.
export async function readJson(request, maxBodyBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBodyBytes) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8") || "{}");
}

function sendJson(response, statusCode, value, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json",
    ...securityHeaders(),
    ...headers
  });
  response.end(JSON.stringify(value));
}

function sendNoBody(response, statusCode, headers = {}) {
  response.writeHead(statusCode, headers);
  response.end();
}

async function sendStaticHtml(response, filename, headers = {}) {
  const body = await readFile(join(packageRoot, "public", filename), "utf8");
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "public, max-age=0, must-revalidate",
    ...securityHeaders(),
    ...headers
  });
  response.end(body);
}

async function sendStaticPng(response, filename, headers = {}) {
  const body = await readFile(join(packageRoot, "public", filename));
  response.writeHead(200, {
    "Content-Type": "image/png",
    "Cache-Control": "public, max-age=86400",
    ...securityHeaders(),
    ...headers
  });
  response.end(body);
}

function sendSecurityTxt(response, headers = {}) {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const body = [
    "Contact: mailto:security@dizko.app",
    "Contact: mailto:support@dizko.app",
    "Policy: https://mcp.dizko.app/support.html",
    "Preferred-Languages: en",
    `Expires: ${expires}`,
    ""
  ].join("\n");
  response.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "public, max-age=86400",
    ...securityHeaders(),
    ...headers
  });
  response.end(body);
}

function securityHeaders() {
  return {
    "Content-Security-Policy": [
      "default-src 'none'",
      "base-uri 'none'",
      "connect-src 'self' https://api.dizko.app https://www.dizko.app",
      "frame-ancestors https://chatgpt.com https://chat.openai.com",
      "img-src 'self' https://www.dizko.app data:",
      "style-src 'unsafe-inline'"
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function validateJsonRpcPayload(payload, maxBatchSize = 20) {
  const requests = Array.isArray(payload) ? payload : [payload];
  if (Array.isArray(payload) && payload.length > maxBatchSize) {
    throw new Error("JSON-RPC batch too large");
  }
  for (const request of requests) validateJsonRpc(request);
}

function validateJsonRpc(request) {
  if (!request || typeof request !== "object") throw new Error("Invalid JSON-RPC request");
  if (request.jsonrpc && request.jsonrpc !== "2.0") throw new Error("Unsupported JSON-RPC version");
  if (!request.method || typeof request.method !== "string") throw new Error("Missing JSON-RPC method");
}

function isAuthorized(request, settings) {
  if (!settings.bearerToken) return true;
  const expected = `Bearer ${settings.bearerToken}`;
  return request.headers.authorization === expected;
}

function createRateLimiter(settings) {
  const clients = new Map();
  const windowMs = Math.max(1_000, Number(settings.rateLimitWindowMs) || 60_000);
  const max = Math.max(1, Number(settings.rateLimitMax) || 120);

  return {
    check(key, exemptAddress = null, cost = 1) {
      const now = Date.now();
      if (settings.rateLimitDisabled || isExempt(exemptAddress, settings.rateLimitExempt)) {
        return {
          allowed: true,
          limit: max,
          remaining: max,
          resetAt: now + windowMs,
          retryAfterSeconds: 0
        };
      }

      for (const [client, entry] of clients) {
        if (entry.resetAt <= now) clients.delete(client);
      }

      const existing = clients.get(key);
      const entry = existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + windowMs };
      entry.count += Math.max(1, Math.floor(cost));
      clients.set(key, entry);

      const remaining = Math.max(0, max - entry.count);
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      return {
        allowed: entry.count <= max,
        limit: max,
        remaining,
        resetAt: entry.resetAt,
        retryAfterSeconds
      };
    }
  };
}

// Checked against the socket peer address, never a forwarded header: an
// exemption that any caller can claim by setting X-Forwarded-For is not an
// exemption, it is an open door.
export function isExempt(address, prefixes) {
  if (!Array.isArray(prefixes) || !prefixes.length || !address) return false;
  return prefixes.some((prefix) => prefix && String(address).startsWith(prefix));
}

function rateLimitHeadersFor(rateLimit) {
  return {
    "X-RateLimit-Limit": String(rateLimit.limit),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000))
  };
}

// X-Forwarded-For is appended to by each proxy, so the LAST hops are the ones
// our own infrastructure wrote and the leading entries are whatever the client
// claimed. Counting back from the end by the number of proxies we actually run
// gives the first address the client could not forge; taking `[0]` instead
// lets any caller pick its own rate-limit bucket.
export function clientIp(request, trustedProxies = 1) {
  const header = request.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : header;
  const socketAddress = request.socket?.remoteAddress || "unknown";
  if (typeof raw !== "string" || !raw.trim()) return socketAddress;
  const hops = raw.split(",").map((hop) => hop.trim()).filter(Boolean);
  if (!hops.length) return socketAddress;
  const hopCount = Number.isFinite(trustedProxies) && trustedProxies > 0 ? Math.floor(trustedProxies) : 1;
  return hops[Math.max(0, hops.length - hopCount)] || socketAddress;
}

// A browser always sends Origin on a cross-origin request; a curl, an MCP
// client or a server-to-server call sends none, and those are not the
// requests this guard is about.
export function originAllowed(request, settings) {
  const allowed = settings.allowedOrigins || [];
  if (allowed.includes("*") || !allowed.length) return true;
  const origin = request.headers?.origin;
  if (!origin) return true;
  return allowed.includes(origin);
}

function corsHeaders(request, settings) {
  const origin = request.headers.origin;
  const allowOrigin = settings.allowedOrigins.includes("*")
    ? "*"
    : settings.allowedOrigins.includes(origin)
      ? origin
      : settings.allowedOrigins[0] || "";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    // Mcp-Method / Mcp-Name are required on 2026-07-28 POSTs (SEP-2243);
    // MCP-Protocol-Version is the 2025-era header kept for old clients.
    "Access-Control-Allow-Headers": "Authorization,Content-Type,MCP-Protocol-Version,Mcp-Method,Mcp-Name",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function splitList(value) {
  if (Array.isArray(value)) return value;
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}
