import http from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { getEvent } from "./api.js";
import { buildCalendarEvent } from "./calendar.js";
import { eventLinkTargets } from "./format.js";
import { createSdkMcpServer } from "./sdkServer.js";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

export function createHttpMcpServer(options = {}) {
  const settings = {
    maxBodyBytes: Number(options.maxBodyBytes || process.env.EVENTCHAT_MCP_MAX_BODY_BYTES || 1024 * 1024),
    bearerToken: options.bearerToken ?? process.env.EVENTCHAT_MCP_BEARER_TOKEN,
    allowedOrigins: splitList(options.allowedOrigins ?? process.env.EVENTCHAT_MCP_ALLOWED_ORIGINS ?? "*"),
    rateLimitDisabled: parseBoolean(options.rateLimitDisabled ?? process.env.EVENTCHAT_MCP_RATE_LIMIT_DISABLED, false),
    rateLimitWindowMs: Number(options.rateLimitWindowMs || process.env.EVENTCHAT_MCP_RATE_LIMIT_WINDOW_MS || 60_000),
    rateLimitMax: Number(options.rateLimitMax || process.env.EVENTCHAT_MCP_RATE_LIMIT_MAX || 120)
  };
  const rateLimiter = createRateLimiter(settings);

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://localhost");

      if (request.method === "OPTIONS") {
        sendNoBody(response, 204, corsHeaders(request, settings));
        return;
      }

      if (request.method === "GET" && url.pathname === "/health") {
        sendJson(response, 200, { ok: true, name: "eventchat-events" }, corsHeaders(request, settings));
        return;
      }

      if (request.method === "GET" && url.pathname === "/") {
        sendJson(response, 200, {
          name: "eventchat-events",
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
        await sendStaticHtml(response, "install.html", corsHeaders(request, settings));
        return;
      }

      const shortLink = request.method === "GET" && url.pathname.match(/^\/e\/([^/]+)\/(cal|map|ics)$/);
      if (shortLink) {
        // Short links trigger upstream event lookups, so they share the
        // /mcp rate limiter — random-id scans must not hammer the backend.
        const rateLimit = rateLimiter.check(clientIp(request));
        if (!rateLimit.allowed) {
          sendJson(response, 429, { error: "Rate limit exceeded. Please retry shortly." }, {
            ...corsHeaders(request, settings),
            ...rateLimitHeadersFor(rateLimit),
            "Retry-After": String(rateLimit.retryAfterSeconds)
          });
          return;
        }
        await handleEventShortLink(response, decodeURIComponent(shortLink[1]), shortLink[2], corsHeaders(request, settings), options);
        return;
      }

      if (request.method === "GET" && url.pathname === "/download/uplayground-events.mcpb") {
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

      const rateLimit = rateLimiter.check(clientIp(request));
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

      response.setHeader("MCP-Protocol-Version", request.headers["mcp-protocol-version"] || "2024-11-05");
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
      validateJsonRpcPayload(payload);
      const server = createSdkMcpServer(options);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });
      await server.connect(transport);
      response.on("close", () => {
        transport.close();
        server.close();
      });
      await transport.handleRequest(request, response, payload);
    } catch (error) {
      sendJson(response, 400, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: error.message }
      }, corsHeaders(request, settings));
    }
  });
}

export function runHttpMcpServer(env = process.env) {
  const port = Number(env.PORT || env.EVENTCHAT_MCP_PORT || 8787);
  const host = env.HOST || env.EVENTCHAT_MCP_HOST || "0.0.0.0";
  const server = createHttpMcpServer();
  server.listen(port, host, () => {
    process.stderr.write(`eventchat-events MCP listening on http://${host}:${port}/mcp\n`);
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
        ? "Event not found — it may have ended or been removed."
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

async function readJson(request, maxBodyBytes) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body, "utf8") > maxBodyBytes) throw new Error("Request body too large");
  }
  return JSON.parse(body || "{}");
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
    "Contact: mailto:security@urbanplayground.xyz",
    "Contact: mailto:support@urbanplayground.xyz",
    "Policy: https://eventchat-events-mcp-production.up.railway.app/support.html",
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
      "connect-src 'self' https://backend-production-958d.up.railway.app https://urbanplayground.xyz",
      "frame-ancestors https://chatgpt.com https://chat.openai.com",
      "img-src 'self' https://urbanplayground.xyz data:",
      "style-src 'unsafe-inline'"
    ].join("; "),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff"
  };
}

function validateJsonRpcPayload(payload) {
  const requests = Array.isArray(payload) ? payload : [payload];
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
    check(key) {
      const now = Date.now();
      if (settings.rateLimitDisabled) {
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
      entry.count += 1;
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

function rateLimitHeadersFor(rateLimit) {
  return {
    "X-RateLimit-Limit": String(rateLimit.limit),
    "X-RateLimit-Remaining": String(rateLimit.remaining),
    "X-RateLimit-Reset": String(Math.ceil(rateLimit.resetAt / 1000))
  };
}

function clientIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim();
  if (Array.isArray(forwarded) && forwarded.length > 0) return forwarded[0].split(",")[0].trim();
  return request.socket.remoteAddress || "unknown";
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
    "Access-Control-Allow-Headers": "Authorization,Content-Type,MCP-Protocol-Version",
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
