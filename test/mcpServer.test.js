import assert from "node:assert/strict";
import test from "node:test";
import { extractMessage, handleMcpRequest, writeMcpMessage } from "../src/mcpServer.js";

test("MCP initialize exposes server instructions for cross-tool workflows", async () => {
  const response = await handleMcpRequest({
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "test", version: "0" }
    }
  });

  assert.equal(response.serverInfo.name, "eventchat-events");
  assert.match(response.instructions, /live event discovery/);
  assert.match(response.instructions, /get_preference_onboarding/);
  assert.match(response.instructions, /consent/);
  assert.match(response.instructions, /profile_id and profile_secret/);
  assert.match(response.instructions, /get_event_search_followups/);
  assert.match(response.instructions, /record_event_feedback/);
});

test("MCP lists event tools", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });
  assert.deepEqual(response.tools.map((tool) => tool.name), [
    "get_preference_onboarding",
    "create_event_preference_profile",
    "save_event_preferences",
    "get_event_preferences",
    "delete_event_preferences",
    "record_event_feedback",
    "get_event_feedback_prompt",
    "get_event_search_followups",
    "search_events",
    "recommend_events",
    "recommend_events_for_user",
    "plan_night",
    "get_event"
  ]);
});

test("MCP tool annotations describe read, write, and destructive behavior", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });
  const tools = Object.fromEntries(response.tools.map((tool) => [tool.name, tool]));

  assert.equal(tools.search_events.annotations.readOnlyHint, true);
  assert.equal(tools.search_events.annotations.openWorldHint, false);
  assert.equal(tools.create_event_preference_profile.annotations.readOnlyHint, false);
  assert.equal(tools.create_event_preference_profile.annotations.destructiveHint, false);
  assert.equal(tools.create_event_preference_profile.annotations.openWorldHint, false);
  assert.equal(tools.get_event_feedback_prompt.annotations.readOnlyHint, true);
  assert.equal(tools.get_event_search_followups.annotations.openWorldHint, false);
  assert.equal(tools.record_event_feedback.annotations.idempotentHint, false);
  assert.equal(tools.record_event_feedback.annotations.openWorldHint, false);
  assert.equal(tools.delete_event_preferences.annotations.destructiveHint, true);
  assert.equal(tools.delete_event_preferences.annotations.readOnlyHint, false);
  assert.equal(tools.delete_event_preferences.annotations.openWorldHint, false);
});

test("MCP tool metadata is review-friendly", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });

  for (const tool of response.tools) {
    assert.equal(typeof tool.title, "string", `${tool.name} is missing a title`);
    assert.ok(tool.title.length > 0, `${tool.name} has an empty title`);
    assert.match(tool.description, /^Use this (when|only when)\b/, `${tool.name} description should start with "Use this..."`);
    assert.equal(typeof tool.inputSchema, "object", `${tool.name} is missing inputSchema`);
    assert.equal(typeof tool.outputSchema, "object", `${tool.name} is missing outputSchema`);
    assert.deepEqual(tool.securitySchemes, [{ type: "noauth" }], `${tool.name} should advertise noauth securitySchemes`);
    assert.deepEqual(tool._meta?.securitySchemes, [{ type: "noauth" }], `${tool.name} should mirror noauth securitySchemes in _meta`);
    assert.equal(typeof tool._meta?.["openai/toolInvocation/invoking"], "string", `${tool.name} should define invoking status text`);
    assert.equal(typeof tool._meta?.["openai/toolInvocation/invoked"], "string", `${tool.name} should define invoked status text`);
    assert.ok(tool._meta["openai/toolInvocation/invoking"].length <= 64, `${tool.name} invoking status is too long`);
    assert.ok(tool._meta["openai/toolInvocation/invoked"].length <= 64, `${tool.name} invoked status is too long`);
  }
});

test("MCP output schemas expose reusable structured fields", async () => {
  const response = await handleMcpRequest({ method: "tools/list" });
  const tools = Object.fromEntries(response.tools.map((tool) => [tool.name, tool]));

  assert.equal(tools.search_events.outputSchema.anyOf[0].properties.events.items.properties.event_url.type, "string");
  assert.equal(tools.recommend_events.outputSchema.anyOf[0].properties.events.items.properties.recommendation_score.type, "number");
  assert.equal(tools.create_event_preference_profile.outputSchema.anyOf[0].properties.profile_secret.type, "string");
  assert.equal(tools.create_event_preference_profile.outputSchema.anyOf[0].properties.access_instructions.properties.profile_secret_returned_now.type, "boolean");
  assert.equal(tools.get_event_preferences.outputSchema.anyOf[0].properties.profile.properties.learned_preferences.type, "object");
  assert.equal(tools.get_event_preferences.outputSchema.anyOf[0].properties.access_instructions.properties.reuse_instruction.type, "string");
  assert.equal(tools.get_event_feedback_prompt.outputSchema.anyOf[0].properties.questions.items.type, "string");
  assert.ok(tools.record_event_feedback.inputSchema.anyOf.some((branch) => branch.required.includes("liked")));
  assert.ok(tools.record_event_feedback.inputSchema.anyOf.some((branch) => branch.required.includes("rating")));
  assert.ok(tools.record_event_feedback.inputSchema.anyOf.some((branch) => branch.required.includes("notes")));
  assert.equal(tools.get_event_search_followups.outputSchema.anyOf[0].properties.search_args_hint.properties.when.type[1], "null");
  assert.equal(tools.delete_event_preferences.inputSchema.properties.confirm_delete.type, "boolean");
  assert.ok(tools.delete_event_preferences.inputSchema.required.includes("confirm_delete"));
  assert.equal(tools.delete_event_preferences.outputSchema.anyOf[0].properties.deleted.type, "boolean");
});

test("MCP get_event_search_followups asks for missing event type and vibe", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "get_event_search_followups", arguments: { city: "berlin", when: "tonight" } }
  });

  assert.equal(response.structuredContent.needs_followup, true);
  assert.ok(response.structuredContent.missing_fields.includes("event_types"));
  assert.ok(response.structuredContent.missing_fields.includes("vibe"));
  assert.ok(response.structuredContent.questions.some((question) => question.includes("type of event")));
  assert.ok(response.structuredContent.questions.some((question) => question.includes("vibe")));
  assert.equal(response.structuredContent.search_args_hint.city, "berlin");
  assert.equal(response.structuredContent.search_args_hint.when, "tonight");
});

test("MCP get_event_feedback_prompt returns questions for post-event learning", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "get_event_feedback_prompt", arguments: { event_id: "event-1", attended_at: "2026-06-09" } }
  }, {
    fetch: async () => Response.json({
      id: "event-1",
      title: "Basement Night",
      start_time: "2026-06-09T22:00:00Z",
      genres: ["techno"],
      vibe: ["warehouse"],
      event_types: ["party"],
      lineup: [],
      venue_name: "RSO.BERLIN"
    })
  });

  assert.equal(response.structuredContent.event.title, "Basement Night");
  assert.equal(response.structuredContent.attended_at, "2026-06-09");
  assert.ok(response.structuredContent.questions.some((question) => question.includes("Did you like")));
  assert.match(response.structuredContent.assistant_instruction, /record_event_feedback/);
});

test("MCP search_events returns tool content", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "berlin" } }
  }, {
    config: { apiBaseUrl: "https://api.example.test", userAgent: "test" },
    fetch: async () => Response.json({
      count: 1,
      events: [{ id: "1", title: "Night One", genres: [], vibe: [], event_types: [], lineup: [] }]
    })
  });

  assert.equal(response.content[0].type, "text");
  assert.match(response.content[0].text, /Night One/);
  assert.equal(response.structuredContent.events[0].title, "Night One");
});

test("MCP search_events returns structured tool errors for slow upstream calls", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "berlin" } }
  }, {
    config: { apiBaseUrl: "https://api.example.test", userAgent: "test", apiTimeoutMs: 5 },
    fetch: async (_url, init) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 50);
        init.signal.addEventListener("abort", () => {
          clearTimeout(timer);
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }
  });

  assert.equal(response.isError, true);
  assert.equal(response.structuredContent.status, 504);
  assert.equal(response.structuredContent.retryable, true);
  assert.match(response.content[0].text, /timed out/);
});

test("MCP stdio framing reads and writes Content-Length messages", () => {
  const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
  const framed = `Content-Length: ${Buffer.byteLength(payload, "utf8")}\r\n\r\n${payload}extra`;
  const message = extractMessage(framed);

  assert.equal(message.payload, payload);
  assert.equal(message.remaining, "extra");

  let written = "";
  writeMcpMessage({ write: (chunk) => { written += chunk; } }, { jsonrpc: "2.0", id: 1, result: {} });
  assert.match(written, /^Content-Length: \d+\r\n\r\n\{/);
});
