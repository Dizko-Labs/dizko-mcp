import { TOOL_VERSION } from "../src/config.js";
import { LiveCheckError, fetchJson, mcpBaseUrl, resolveMcpEndpoint, rpcCall } from "../src/liveChecks.js";
import { prompts, tools } from "../src/tools.js";

const endpoint = resolveMcpEndpoint();
const baseUrl = mcpBaseUrl(endpoint);
const timeoutMs = Number(process.env.EVENTCHAT_SMOKE_TIMEOUT_MS || 15000);
const smokeCity = process.env.EVENTCHAT_SMOKE_CITY || "berlin";

let currentCheck = "startup";

async function main() {
  currentCheck = "health";
  await checkHealth();

  // The expected names come from the package's own registry, so the smoke
  // test cannot drift from what the server ships.
  currentCheck = "tools/list";
  const listed = await rpcCall(endpoint, "tools/list", undefined, { timeoutMs, check: currentCheck });
  const toolNames = listed.tools.map((tool) => tool.name);
  assertIncludes(toolNames, tools.map((tool) => tool.name), "tool");
  const legacy = toolNames.filter((name) => !name.startsWith("dizko_"));
  if (legacy.length) throw new Error(`tools/list still lists pre-0.8 names: ${legacy.join(", ")}`);

  currentCheck = "prompts/list";
  const listedPrompts = await rpcCall(endpoint, "prompts/list", undefined, { timeoutMs, check: currentCheck });
  const promptNames = (listedPrompts.prompts || []).map((prompt) => prompt.name);
  assertIncludes(promptNames, prompts.map((prompt) => prompt.name), "prompt");

  currentCheck = "dizko_search_events";
  const search = await callTool("dizko_search_events", { city: smokeCity, when: "week", limit: 1 });
  if (!search.events?.length) {
    throw new LiveCheckError(`Expected at least one live ${smokeCity} event (application-level no-results)`, {
      check: currentCheck,
      classification: "no_results",
      url: endpoint,
      status: 200
    });
  }
  if (!search.events[0].when || !search.timezone) {
    throw new Error("Expected search results to carry local `when` and the city timezone");
  }

  currentCheck = "prompts/get dizko_search_followups";
  const searchFollowups = await getPrompt("dizko_search_followups", { city: smokeCity, when: "tonight" });
  if (!searchFollowups.questions.some((question) => question.includes("vibe"))) {
    throw new Error("Expected search follow-ups prompt to include a vibe question");
  }

  currentCheck = "prompts/get dizko_post_event_feedback";
  const feedbackPrompt = await getPrompt("dizko_post_event_feedback", { event_id: search.events[0].id });
  if (!feedbackPrompt.questions.some((question) => question.includes("Did you like"))) {
    throw new Error("Expected feedback prompt to include a like/dislike question");
  }

  currentCheck = "dizko_create_profile";
  const created = await callTool("dizko_create_profile", {
    consent: true,
    preferences: {
      genres: ["techno"],
      vibe: ["underground"],
      avoid: ["mainstream"]
    }
  });
  const profileId = created.profile_id;
  const profileSecret = created.profile_secret;
  if (!/^dzk_[0-9a-f-]{36}$/.test(profileId || "")) {
    throw new Error(`Expected opaque generated profile id, got ${profileId}`);
  }
  if (!/^dzs_[A-Za-z0-9_-]+$/.test(profileSecret || "")) {
    throw new Error("Expected generated profile secret");
  }

  currentCheck = "dizko_get_profile";
  const fetched = await callTool("dizko_get_profile", { profile_id: profileId, profile_secret: profileSecret });
  if (!fetched.profile?.preferences?.genres?.includes("techno")) {
    throw new Error("Saved profile preferences were not readable");
  }

  currentCheck = "dizko_get_profile (invalid secret)";
  await assertToolError("dizko_get_profile", { profile_id: profileId, profile_secret: "wrong-secret" });

  currentCheck = "dizko_delete_profile";
  const deleted = await callTool("dizko_delete_profile", { profile_id: profileId, profile_secret: profileSecret, confirm_delete: true });
  if (deleted.deleted !== true) throw new Error("Smoke profile was not deleted");

  console.log(JSON.stringify({
    ok: true,
    endpoint,
    checked_tools: toolNames.length,
    checked_prompts: promptNames.length,
    sample_event: search.events[0].title,
    sample_when: search.events[0].when,
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

// prompts/get returns a description plus one text message whose numbered
// lines are the questions to ask. It is sent directly because the 2026-07-28
// server requires the Mcp-Name routing header on prompts/get as well as
// tools/call, and rpcCall only adds it for tools/call.
async function getPrompt(name, args) {
  const { status, body } = await fetchJson(endpoint, {
    timeoutMs,
    check: currentCheck,
    method: "POST",
    headers: { "mcp-method": "prompts/get", "mcp-name": name },
    body: {
      jsonrpc: "2.0",
      id: 1,
      method: "prompts/get",
      params: {
        name,
        arguments: args,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": "2026-07-28",
          "io.modelcontextprotocol/clientCapabilities": {},
          "io.modelcontextprotocol/clientInfo": { name: "dizko-smoke-live", version: TOOL_VERSION }
        }
      }
    }
  });
  if (body.error) {
    throw new LiveCheckError(`prompts/get ${name} returned JSON-RPC error: ${body.error.message}`, {
      check: currentCheck,
      classification: "rpc_error",
      url: endpoint,
      status,
      cause: JSON.stringify(body.error).slice(0, 300)
    });
  }
  const result = body.result || {};
  const message = (result.messages || []).find((entry) => entry?.content?.type === "text");
  if (!message) throw new Error(`${name} prompt returned no text message`);
  const questions = message.content.text
    .split("\n")
    .filter((line) => /^\d+\.\s/.test(line))
    .map((line) => line.replace(/^\d+\.\s/, ""));
  if (!questions.length) throw new Error(`${name} prompt returned no questions`);
  return { description: result.description || "", questions };
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function assertIncludes(values, required, kind) {
  for (const value of required) {
    if (!values.includes(value)) throw new Error(`Missing expected ${kind}: ${value}`);
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
