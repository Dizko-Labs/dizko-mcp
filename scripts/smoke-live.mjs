import { LiveCheckError, fetchJson, mcpBaseUrl, resolveMcpEndpoint, rpcCall } from "../src/liveChecks.js";

const endpoint = resolveMcpEndpoint();
const baseUrl = mcpBaseUrl(endpoint);
const timeoutMs = Number(process.env.EVENTCHAT_SMOKE_TIMEOUT_MS || 15000);
const smokeCity = process.env.EVENTCHAT_SMOKE_CITY || "berlin";

let currentCheck = "startup";

async function main() {
  currentCheck = "health";
  await checkHealth();

  currentCheck = "tools/list";
  const tools = await rpcCall(endpoint, "tools/list", undefined, { timeoutMs, check: currentCheck });
  const toolNames = tools.tools.map((tool) => tool.name);
  assertIncludes(toolNames, [
    "get_preference_onboarding",
    "create_event_preference_profile",
    "recommend_events_for_user",
    "record_event_feedback",
    "get_event_feedback_prompt",
    "get_event_search_followups",
    "delete_event_preferences",
    "search_events",
    "get_ticket_purchase_policy",
    "get_ticket_offers",
    "quote_ticket_order",
    "purchase_ticket_order"
  ]);

  currentCheck = "search_events";
  const search = await callTool("search_events", { city: smokeCity, when: "week", limit: 1 });
  if (!search.events?.length) {
    throw new LiveCheckError(`Expected at least one live ${smokeCity} event (application-level no-results)`, {
      check: currentCheck,
      classification: "no_results",
      url: endpoint,
      status: 200
    });
  }

  currentCheck = "get_event_search_followups";
  const searchFollowups = await callTool("get_event_search_followups", { city: smokeCity, when: "tonight" });
  if (!searchFollowups.questions?.some((question) => question.includes("vibe"))) {
    throw new Error("Expected search followups to include a vibe question");
  }

  currentCheck = "get_event_feedback_prompt";
  const feedbackPrompt = await callTool("get_event_feedback_prompt", {
    event_id: search.events[0].id,
    attended_at: "2026-06-09"
  });
  if (!feedbackPrompt.questions?.some((question) => question.includes("Did you like"))) {
    throw new Error("Expected feedback prompt to include a like/dislike question");
  }

  currentCheck = "create_event_preference_profile";
  const created = await callTool("create_event_preference_profile", {
    consent: true,
    preferences: {
      genres: ["techno"],
      vibe: ["underground"],
      avoid: ["mainstream"]
    }
  });
  const profileId = created.profile?.profile_id;
  const profileSecret = created.profile_secret;
  if (!/^upg_[0-9a-f-]{36}$/.test(profileId || "")) {
    throw new Error(`Expected opaque generated profile id, got ${profileId}`);
  }
  if (!/^ups_[A-Za-z0-9_-]+$/.test(profileSecret || "")) {
    throw new Error("Expected generated profile secret");
  }

  currentCheck = "get_event_preferences";
  const fetched = await callTool("get_event_preferences", { profile_id: profileId, profile_secret: profileSecret });
  if (!fetched.profile?.preferences?.genres?.includes("techno")) {
    throw new Error("Saved profile preferences were not readable");
  }

  currentCheck = "get_event_preferences (invalid secret)";
  await assertToolError("get_event_preferences", { profile_id: profileId, profile_secret: "wrong-secret" });

  currentCheck = "delete_event_preferences";
  const deleted = await callTool("delete_event_preferences", { profile_id: profileId, profile_secret: profileSecret, confirm_delete: true });
  if (deleted.deleted !== true) throw new Error("Smoke profile was not deleted");

  console.log(JSON.stringify({
    ok: true,
    endpoint,
    checked_tools: toolNames.length,
    sample_event: search.events[0].title,
    search_followup_questions: searchFollowups.questions.length,
    feedback_prompt_questions: feedbackPrompt.questions.length
  }, null, 2));
}

async function assertToolError(name, args) {
  const result = await rpcCall(endpoint, "tools/call", { name, arguments: args }, { timeoutMs, check: currentCheck });
  if (result.isError !== true) throw new Error(`${name} unexpectedly accepted invalid input`);
}

async function checkHealth() {
  const { body } = await fetchJson(`${baseUrl}/health`, { timeoutMs, check: "health" });
  if (body.ok !== true) {
    throw new LiveCheckError("Health endpoint responded but did not report ok", {
      check: "health",
      classification: "bad_response",
      url: `${baseUrl}/health`,
      status: 200,
      cause: JSON.stringify(body).slice(0, 300)
    });
  }
}

async function callTool(name, args) {
  const result = await rpcCall(endpoint, "tools/call", { name, arguments: args }, { timeoutMs, check: currentCheck });
  const first = result.content?.[0];
  if (!first || first.type !== "text") throw new Error(`${name} returned no text content`);
  if (result.isError) {
    const structured = result.structuredContent || safeParse(first.text) || {};
    throw new LiveCheckError(`${name} returned error: ${structured.error || first.text.slice(0, 200)}`, {
      check: currentCheck,
      classification: structured.classification || "tool_error",
      code: structured.code || null,
      hostname: structured.hostname || null,
      url: endpoint,
      status: structured.status ?? 200,
      cause: structured.cause || structured.error || null
    });
  }
  return JSON.parse(first.text);
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function assertIncludes(values, required) {
  for (const value of required) {
    if (!values.includes(value)) throw new Error(`Missing expected tool: ${value}`);
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    endpoint,
    failed_check: error.check || currentCheck,
    error: error.message,
    classification: error.classification || "unknown",
    code: error.code || null,
    hostname: error.hostname || null,
    url: error.url || null,
    status: error.status ?? null,
    cause: error.cause?.message || error.cause || null
  }, null, 2));
  process.exitCode = 1;
});
