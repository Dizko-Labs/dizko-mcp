import assert from "node:assert/strict";
import test from "node:test";
import { createHttpMcpServer } from "../src/httpServer.js";

test("HTTP MCP server exposes health and tools/list", async () => {
  const server = createHttpMcpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(health.status, 200);
    assert.match(health.headers.get("content-security-policy"), /connect-src 'self' https:\/\/api\.dizko\.app https:\/\/www\.dizko\.app/);
    assert.equal(health.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(await health.json(), { ok: true, name: "eventchat-events" });

    const metadata = await fetch(`http://127.0.0.1:${port}/`);
    assert.equal(metadata.status, 200);
    assert.match(metadata.headers.get("content-security-policy"), /frame-ancestors https:\/\/chatgpt\.com https:\/\/chat\.openai\.com/);
    const metadataBody = await metadata.json();
    assert.equal(metadataBody.logo, "/logo-512.png");
    assert.equal(metadataBody.terms, "/terms.html");
    assert.equal(metadataBody.user_guide, "/user-guide.html");
    assert.equal(metadataBody.security, "/.well-known/security.txt");

    const terms = await fetch(`http://127.0.0.1:${port}/terms.html`);
    const termsBody = await terms.text();
    assert.equal(terms.status, 200);
    assert.match(terms.headers.get("content-type"), /text\/html/);
    assert.match(termsBody, /Dizko Events Connector Terms/);
    assert.match(termsBody, /explicit confirmation/);

    const userGuide = await fetch(`http://127.0.0.1:${port}/user-guide.html`);
    const userGuideBody = await userGuide.text();
    assert.equal(userGuide.status, 200);
    assert.match(userGuide.headers.get("content-type"), /text\/html/);
    assert.match(userGuideBody, /Dizko Events Connector User Guide/);
    assert.match(userGuideBody, /Preference Memory/);
    assert.match(userGuideBody, /Deleting Saved Preferences/);

    const securityTxt = await fetch(`http://127.0.0.1:${port}/.well-known/security.txt`);
    const securityBody = await securityTxt.text();
    assert.equal(securityTxt.status, 200);
    assert.match(securityTxt.headers.get("content-type"), /text\/plain/);
    assert.equal(securityTxt.headers.get("x-content-type-options"), "nosniff");
    assert.match(securityBody, /Contact: mailto:security@urbanplayground\.xyz/);
    assert.match(securityBody, /Expires: /);

    const logo = await fetch(`http://127.0.0.1:${port}/logo-512.png`);
    assert.equal(logo.status, 200);
    assert.equal(logo.headers.get("content-type"), "image/png");
    assert.equal(logo.headers.get("referrer-policy"), "no-referrer");
    assert.ok((await logo.arrayBuffer()).byteLength > 1024);

    const initialized = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2024-11-05"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 0,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "eventchat-test", version: "0.0.0" }
        }
      })
    });
    const initializedBody = await initialized.json();
    assert.equal(initialized.status, 200);
    assert.equal(initialized.headers.get("mcp-protocol-version"), "2024-11-05");
    assert.equal(initializedBody.result.serverInfo.name, "eventchat-events");
    assert.equal(typeof initializedBody.result.capabilities.tools, "object");

    const initializedNotification = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2024-11-05"
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })
    });
    assert.equal(initializedNotification.status, 202);
    assert.equal(await initializedNotification.text(), "");

    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(body.id, 1);
    assert.ok(body.result.tools.some((tool) => tool.name === "search_events"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HTTP MCP server supports CORS preflight and optional bearer auth", async () => {
  const server = createHttpMcpServer({
    bearerToken: "secret",
    allowedOrigins: ["https://chatgpt.com"]
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const preflight = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "OPTIONS",
      headers: { Origin: "https://chatgpt.com" }
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://chatgpt.com");

    const unauthorized = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    assert.equal(unauthorized.status, 401);

    const authorized = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        Authorization: "Bearer secret",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": "2024-11-05"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    assert.equal(authorized.status, 200);
    assert.equal(authorized.headers.get("mcp-protocol-version"), "2024-11-05");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HTTP MCP server rate-limits MCP POST requests with JSON-RPC errors", async () => {
  const server = createHttpMcpServer({
    rateLimitMax: 1,
    rateLimitWindowMs: 60_000
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  try {
    const first = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.42"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" })
    });
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("x-ratelimit-limit"), "1");
    assert.equal(first.headers.get("x-ratelimit-remaining"), "0");
    assert.ok(Number(first.headers.get("x-ratelimit-reset")) > 0);

    const second = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.42"
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
    });
    const limited = await second.json();

    assert.equal(second.status, 429);
    assert.equal(second.headers.get("x-ratelimit-limit"), "1");
    assert.equal(second.headers.get("x-ratelimit-remaining"), "0");
    assert.ok(Number(second.headers.get("retry-after")) >= 1);
    assert.match(second.headers.get("content-security-policy"), /default-src 'none'/);
    assert.equal(limited.error.code, -32029);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("HTTP MCP server serves the install page at /install and /install.html", async () => {
  const server = createHttpMcpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    for (const path of ["/install", "/install.html"]) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`);
      assert.equal(response.status, 200, `${path} should be served`);
      assert.match(response.headers.get("content-type"), /text\/html/);
      const body = await response.text();
      assert.match(body, /Install Dizko Events/);
      assert.match(body, /Add custom connector/);
      assert.match(body, /uplayground-events", "mcp"/);
    }
    const metadata = await (await fetch(`http://127.0.0.1:${port}/`)).json();
    assert.equal(metadata.install, "/install");
  } finally {
    server.close();
  }
});

test("short links redirect to calendar and maps, and serve ICS files", async () => {
  const { clearEventCache } = await import("../src/api.js");
  clearEventCache();
  const fakeFetch = async (url) => {
    if (String(url).includes("/events/evt-short")) {
      return Response.json({
        id: "evt-short",
        title: "Warehouse Party",
        start_time: "2026-06-13T22:00:00+00:00",
        venue_name: "Knockdown Center",
        venue_city: "new york",
        lat: 40.7141,
        lng: -73.9082
      });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const server = createHttpMcpServer({ fetch: fakeFetch, config: { apiBaseUrl: "https://api.example.test", userAgent: "t", apiCacheTtlMs: 0 } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const cal = await fetch(`http://127.0.0.1:${port}/e/evt-short/cal`, { redirect: "manual" });
    assert.equal(cal.status, 302);
    assert.match(cal.headers.get("location"), /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
    assert.match(cal.headers.get("location"), /dates=20260613T220000Z/);

    const map = await fetch(`http://127.0.0.1:${port}/e/evt-short/map`, { redirect: "manual" });
    assert.equal(map.status, 302);
    assert.match(map.headers.get("location"), /google\.com\/maps\/dir.*40\.7141/);

    const ics = await fetch(`http://127.0.0.1:${port}/e/evt-short/ics`);
    assert.equal(ics.status, 200);
    assert.match(ics.headers.get("content-type"), /text\/calendar/);
    const body = await ics.text();
    assert.match(body, /BEGIN:VCALENDAR/);
    assert.match(body, /SUMMARY:Warehouse Party/);
  } finally {
    server.close();
  }
});

test("short links return 404 for missing events and missing data", async () => {
  const { clearEventCache } = await import("../src/api.js");
  clearEventCache();
  const fakeFetch = async (url) => {
    if (String(url).includes("/events/evt-gone")) return new Response("not found", { status: 404 });
    if (String(url).includes("/events/evt-nostart")) {
      return Response.json({ id: "evt-nostart", title: "Mystery", venue_name: "TBA", venue_city: "berlin" });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
  const server = createHttpMcpServer({ fetch: fakeFetch, retries: 0, config: { apiBaseUrl: "https://api.example.test", userAgent: "t", apiCacheTtlMs: 0 } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const gone = await fetch(`http://127.0.0.1:${port}/e/evt-gone/cal`, { redirect: "manual" });
    assert.equal(gone.status, 404);
    assert.match((await gone.json()).error, /may have ended/);

    const noStart = await fetch(`http://127.0.0.1:${port}/e/evt-nostart/cal`, { redirect: "manual" });
    assert.equal(noStart.status, 404);
    assert.match((await noStart.json()).error, /no start time/);

    const noMap = await fetch(`http://127.0.0.1:${port}/e/evt-nostart/map`, { redirect: "manual" });
    assert.equal(noMap.status, 404);
    assert.match((await noMap.json()).error, /no mappable location/);
  } finally {
    server.close();
  }
});

test("mcpb download serves the bundle when built, 404 with hint otherwise", async () => {
  const server = createHttpMcpServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/download/dizko-events.mcpb`);
    if (response.status === 200) {
      assert.match(response.headers.get("content-type"), /application\/zip/);
      assert.match(response.headers.get("content-disposition"), /\.mcpb"/);
    } else {
      assert.equal(response.status, 404);
      assert.match((await response.json()).error, /build:mcpb/);
    }
  } finally {
    server.close();
  }
});

test("short links share the rate limiter so id scans cannot hammer the backend", async () => {
  const { clearEventCache } = await import("../src/api.js");
  clearEventCache();
  let upstreamCalls = 0;
  const fakeFetch = async () => {
    upstreamCalls += 1;
    return Response.json({ id: "evt-rl", title: "Party", start_time: "2026-06-13T22:00:00+00:00" });
  };
  const server = createHttpMcpServer({
    rateLimitMax: 2,
    rateLimitWindowMs: 60_000,
    fetch: fakeFetch,
    config: { apiBaseUrl: "https://api.example.test", userAgent: "t", apiCacheTtlMs: 0 }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const first = await fetch(`http://127.0.0.1:${port}/e/evt-rl/cal`, { redirect: "manual" });
    const second = await fetch(`http://127.0.0.1:${port}/e/evt-rl/cal`, { redirect: "manual" });
    const third = await fetch(`http://127.0.0.1:${port}/e/evt-rl/cal`, { redirect: "manual" });
    assert.equal(first.status, 302);
    assert.equal(second.status, 302);
    assert.equal(third.status, 429);
    assert.ok(third.headers.get("retry-after"), "429 must carry Retry-After");
    assert.equal(upstreamCalls, 2, "rate-limited request must not reach the backend");
  } finally {
    server.close();
  }
});
