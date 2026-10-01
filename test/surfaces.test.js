import assert from "node:assert/strict";
import test from "node:test";
import { createHttpMcpServer } from "../src/httpServer.js";
import { surfaceResult, surfaceTools } from "../src/surfaces.js";
import { tools } from "../src/tools.js";

const OPENAI_TOOLS = [
  "create_event_calendar_file",
  "find_scene_entities",
  "get_artist",
  "get_artist_events",
  "get_artist_page",
  "get_city_pulse",
  "get_daily_roundup",
  "get_event",
  "get_venue",
  "list_cities",
  "plan_night",
  "recommend_events",
  "search_events"
];

async function rpc(port, path, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-06-18"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body })
  });
  const text = await response.text();
  const line = text.trimStart().startsWith("event:") ? text.split("\n").find((entry) => entry.startsWith("data:")).slice(5) : text;
  return JSON.parse(line);
}

async function withServer(options, run) {
  const server = createHttpMcpServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("openai surface lists only read-only, no-auth discovery tools", () => {
  const listed = surfaceTools("openai");
  assert.deepEqual(listed.map((tool) => tool.name).sort(), OPENAI_TOOLS);
  for (const tool of listed) {
    assert.equal(tool.annotations.readOnlyHint, true, tool.name);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
    assert.equal(typeof tool.annotations.openWorldHint, "boolean", tool.name);
    assert.deepEqual(tool.securitySchemes, [{ type: "noauth" }], tool.name);
    assert.ok(!("profile_id" in (tool.inputSchema.properties || {})), tool.name);
    assert.ok(!("profile_secret" in (tool.inputSchema.properties || {})), tool.name);
    assert.ok(!(tool.inputSchema.required || []).some((key) => key.startsWith("profile_")), tool.name);
    assert.doesNotMatch(tool.description, /profile_id|profile_secret|saved profile|purchase|\bbuy\b|iPhone/i, tool.name);
  }
  assert.deepEqual(listed.find((tool) => tool.name === "get_artist_events").inputSchema.required, ["artists"]);
  assert.equal(surfaceTools("full"), tools);
});

test("openai surface strips app promotion from results", () => {
  const result = surfaceResult("openai", {
    structuredContent: { events: [{ id: "e1", app_download_url: "x" }], app_download_url: "x" },
    content: [{ type: "text", text: "{}" }, { type: "resource_link", uri: "https://a" }],
    isError: false
  });
  assert.deepEqual(result.structuredContent, { events: [{ id: "e1" }] });
  assert.equal(result.content[0].text, JSON.stringify({ events: [{ id: "e1" }] }));
  assert.equal(result.content[1].uri, "https://a");
});

test("/openai/mcp serves the reviewed subset and rejects hidden tools", async () => {
  await withServer({}, async (port) => {
    const openaiList = await rpc(port, "/openai/mcp", { method: "tools/list" });
    assert.deepEqual(openaiList.result.tools.map((tool) => tool.name).sort(), OPENAI_TOOLS);

    const fullList = await rpc(port, "/mcp", { method: "tools/list" });
    assert.equal(fullList.result.tools.length, tools.length);

    const hidden = await rpc(port, "/openai/mcp", {
      method: "tools/call",
      params: { name: "purchase_ticket_order", arguments: { quote_token: "q", confirmation_text: "yes" } }
    });
    assert.equal(hidden.result.isError, true);
    assert.equal(hidden.result.structuredContent.code, "unknown_tool");
  });
});

test("openai apps challenge is served only when configured", async () => {
  await withServer({}, async (port) => {
    const missing = await fetch(`http://127.0.0.1:${port}/.well-known/openai-apps-challenge`);
    assert.equal(missing.status, 404);
  });
  await withServer({ openaiAppsChallenge: "token-123" }, async (port) => {
    const served = await fetch(`http://127.0.0.1:${port}/.well-known/openai-apps-challenge`);
    assert.equal(served.status, 200);
    assert.match(served.headers.get("content-type"), /text\/plain/);
    assert.equal(await served.text(), "token-123");
  });
});
