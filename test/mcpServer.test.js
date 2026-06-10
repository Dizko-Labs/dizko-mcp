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
  assert.match(response.instructions, /get_ticket_offers/);
  assert.match(response.instructions, /purchase_ticket_order/);
  assert.match(response.instructions, /Hermes, OpenClaw/);
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
    "get_event",
    "get_ticket_purchase_policy",
    "get_ticket_offers",
    "quote_ticket_order",
    "purchase_ticket_order",
    "create_event_calendar_file"
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
  assert.equal(tools.get_ticket_offers.annotations.readOnlyHint, true);
  assert.equal(tools.quote_ticket_order.annotations.readOnlyHint, true);
  assert.equal(tools.purchase_ticket_order.annotations.readOnlyHint, false);
  assert.equal(tools.purchase_ticket_order.annotations.destructiveHint, true);
  assert.equal(tools.purchase_ticket_order.annotations.openWorldHint, true);
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
  assert.equal(tools.get_ticket_purchase_policy.outputSchema.anyOf[0].properties.supported_modes.items.type, "string");
  assert.equal(tools.get_ticket_offers.outputSchema.anyOf[0].properties.offers.items.properties.purchase_mode.type, "string");
  assert.equal(tools.quote_ticket_order.outputSchema.anyOf[0].properties.quote_token.type, "string");
  assert.ok(tools.purchase_ticket_order.inputSchema.required.includes("confirmation_text"));
  assert.equal(tools.purchase_ticket_order.outputSchema.anyOf[0].properties.purchased.type, "boolean");
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

test("MCP ticket tools quote and hand off third-party checkout after written confirmation", async () => {
  const options = {
    fetch: async () => Response.json({
      id: "event-1",
      title: "Ostbahnhof XL",
      start_time: "2026-06-13T13:00:00Z",
      end_time: "2026-06-14T02:00:00Z",
      venue_name: "Psstudio",
      venue_city: "los angeles",
      price_min: 100,
      price_max: 100,
      currency: "USD",
      source: "resident_advisor",
      source_display: "resident_advisor",
      ticket_url: "https://ra.co/events/2339406",
      genres: ["techno"],
      vibe: ["warehouse"],
      event_types: ["party"],
      lineup: []
    }),
    now: new Date("2026-06-10T12:00:00Z")
  };

  const offers = await handleMcpRequest({
    method: "tools/call",
    params: { name: "get_ticket_offers", arguments: { event_id: "event-1" } }
  }, options);

  assert.equal(offers.structuredContent.count, 1);
  assert.equal(offers.structuredContent.offers[0].provider, "resident_advisor");
  assert.equal(offers.structuredContent.offers[0].purchase_mode, "external_checkout");
  assert.equal(offers.structuredContent.offers[0].autonomous_purchase_supported, false);

  const quote = await handleMcpRequest({
    method: "tools/call",
    params: {
      name: "quote_ticket_order",
      arguments: {
        event_id: "event-1",
        quantity: 2,
        ticket_type: "GA",
        max_total: 240,
        currency: "USD"
      }
    }
  }, options);

  assert.equal(quote.structuredContent.quoted, true);
  assert.equal(quote.structuredContent.quote.quantity, 2);
  assert.equal(quote.structuredContent.quote.max_total, 240);
  assert.match(quote.structuredContent.confirmation_prompt, /Yes, buy 2 ticket/);

  const purchase = await handleMcpRequest({
    method: "tools/call",
    params: {
      name: "purchase_ticket_order",
      arguments: {
        quote_token: quote.structuredContent.quote_token,
        confirmation_text: "Yes, buy 2 tickets for Ostbahnhof XL, max total USD240. Stop if price, date, venue, ticket type, quantity, or refund terms change."
      }
    }
  }, options);

  assert.equal(purchase.structuredContent.purchased, false);
  assert.equal(purchase.structuredContent.status, "requires_external_checkout");
  assert.equal(purchase.structuredContent.checkout_url, "https://ra.co/events/2339406");
  assert.match(purchase.structuredContent.assistant_instruction, /do not claim the agent bought/);
});

test("MCP purchase_ticket_order rejects vague confirmation", async () => {
  const options = {
    fetch: async () => Response.json({
      id: "event-1",
      title: "Club Night",
      ticket_url: "https://tickets.example.test/event-1",
      source: "hermes",
      genres: [],
      vibe: [],
      event_types: [],
      lineup: []
    }),
    now: new Date("2026-06-10T12:00:00Z")
  };
  const quote = await handleMcpRequest({
    method: "tools/call",
    params: { name: "quote_ticket_order", arguments: { event_id: "event-1", quantity: 2, max_total: 80 } }
  }, options);

  const purchase = await handleMcpRequest({
    method: "tools/call",
    params: {
      name: "purchase_ticket_order",
      arguments: {
        quote_token: quote.structuredContent.quote_token,
        confirmation_text: "sounds good"
      }
    }
  }, options);

  assert.equal(purchase.structuredContent.purchased, false);
  assert.equal(purchase.structuredContent.status, "confirmation_required");
  assert.match(purchase.structuredContent.error, /buy or purchase/);
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

test("MCP search_events reports DNS failures as retryable with cause, code, hostname, and url", async () => {
  const dnsError = new TypeError("fetch failed");
  dnsError.cause = Object.assign(new Error("getaddrinfo EAI_AGAIN backend.example.test"), {
    code: "EAI_AGAIN",
    syscall: "getaddrinfo",
    hostname: "backend.example.test"
  });

  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "los angeles", when: "week", limit: 1 } }
  }, {
    config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
    retries: 1,
    sleep: async () => {},
    fetch: async () => { throw dnsError; }
  });

  assert.equal(response.isError, true);
  const body = response.structuredContent;
  assert.equal(body.retryable, true, "EAI_AGAIN must be reported as retryable");
  assert.equal(body.code, "EAI_AGAIN");
  assert.equal(body.classification, "dns");
  assert.equal(body.type, "EventChatNetworkError");
  assert.equal(body.status, null);
  assert.equal(body.hostname, "backend.example.test");
  assert.match(body.url, /^https:\/\/backend\.example\.test\/events\?/);
  assert.match(body.error, /DNS lookup for backend\.example\.test failed \(EAI_AGAIN\)/);
  assert.match(body.cause, /getaddrinfo EAI_AGAIN/);
  assert.match(body.assistant_instruction, /Retry the same call/);
});

test("MCP search_events reports retryable HTTP 5xx errors with status", async () => {
  const response = await handleMcpRequest({
    method: "tools/call",
    params: { name: "search_events", arguments: { city: "berlin", when: "week", limit: 1 } }
  }, {
    config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
    retries: 0,
    fetch: async () => new Response("upstream exploded", { status: 503 })
  });

  assert.equal(response.isError, true);
  const body = response.structuredContent;
  assert.equal(body.status, 503);
  assert.equal(body.retryable, true);
  assert.match(body.url, /^https:\/\/backend\.example\.test\/events\?/);
});
