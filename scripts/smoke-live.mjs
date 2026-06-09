const endpoint = process.env.EVENTCHAT_MCP_URL || "https://eventchat-events-mcp-production.up.railway.app/mcp";
const baseUrl = endpoint.replace(/\/mcp\/?$/, "");

async function main() {
  await checkHealth();
  const tools = await callRpc("tools/list");
  const toolNames = tools.tools.map((tool) => tool.name);
  assertIncludes(toolNames, [
    "get_preference_onboarding",
    "create_event_preference_profile",
    "recommend_events_for_user",
    "record_event_feedback",
    "get_event_feedback_prompt",
    "get_event_search_followups",
    "delete_event_preferences",
    "search_events"
  ]);

  const search = await callTool("search_events", { city: "berlin", when: "week", limit: 1 });
  if (!search.events?.length) throw new Error("Expected at least one live Berlin event");

  const searchFollowups = await callTool("get_event_search_followups", { city: "berlin", when: "tonight" });
  if (!searchFollowups.questions?.some((question) => question.includes("vibe"))) {
    throw new Error("Expected search followups to include a vibe question");
  }

  const feedbackPrompt = await callTool("get_event_feedback_prompt", {
    event_id: search.events[0].id,
    attended_at: "2026-06-09"
  });
  if (!feedbackPrompt.questions?.some((question) => question.includes("Did you like"))) {
    throw new Error("Expected feedback prompt to include a like/dislike question");
  }

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

  const fetched = await callTool("get_event_preferences", { profile_id: profileId, profile_secret: profileSecret });
  if (!fetched.profile?.preferences?.genres?.includes("techno")) {
    throw new Error("Saved profile preferences were not readable");
  }

  await assertToolError("get_event_preferences", { profile_id: profileId, profile_secret: "wrong-secret" });

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
  const result = await callRpc("tools/call", { name, arguments: args });
  if (result.isError !== true) throw new Error(`${name} unexpectedly accepted invalid input`);
}

async function checkHealth() {
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) throw new Error(`Health failed: HTTP ${response.status}`);
  const body = await response.json();
  if (body.ok !== true) throw new Error("Health response did not report ok");
}

async function callTool(name, args) {
  const result = await callRpc("tools/call", { name, arguments: args });
  const first = result.content?.[0];
  if (!first || first.type !== "text") throw new Error(`${name} returned no text content`);
  if (result.isError) throw new Error(`${name} returned error: ${first.text}`);
  return JSON.parse(first.text);
}

async function callRpc(method, params = undefined) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method,
      params
    })
  });
  if (!response.ok) throw new Error(`${method} failed: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method} error: ${body.error.message}`);
  return body.result;
}

function assertIncludes(values, required) {
  for (const value of required) {
    if (!values.includes(value)) throw new Error(`Missing expected tool: ${value}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
