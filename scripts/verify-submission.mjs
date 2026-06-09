import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const endpoint = process.env.EVENTCHAT_MCP_URL || "https://eventchat-events-mcp-production.up.railway.app/mcp";
const baseUrl = endpoint.replace(/\/mcp\/?$/, "");
const companyUrl = process.env.EVENTCHAT_COMPANY_URL || "https://urbanplayground.xyz";
const requestTimeoutMs = Number(process.env.EVENTCHAT_VERIFY_TIMEOUT_MS || 15000);
const evidenceOutputPath = process.env.EVENTCHAT_SUBMISSION_EVIDENCE_PATH || null;
const railwayService = process.env.EVENTCHAT_RAILWAY_SERVICE || "eventchat-events-mcp";

const requiredTools = [
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
];

const requiredAnnotations = {
  search_events: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  get_event: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  create_event_preference_profile: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  save_event_preferences: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  record_event_feedback: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  get_event_feedback_prompt: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  get_event_search_followups: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  delete_event_preferences: { readOnlyHint: false, destructiveHint: true, openWorldHint: false }
};

async function main() {
  const evidence = {
    ok: true,
    checked_at: new Date().toISOString(),
    endpoint,
    base_url: baseUrl,
    company_url: companyUrl,
    deployment: await getDeploymentMetadata(),
    checks: {}
  };

  evidence.checks.health = await checkHealth();
  evidence.checks.metadata = await checkMetadata();
  evidence.checks.public_pages = await checkPublicPages();
  evidence.checks.company_url = await checkCompanyUrl();
  evidence.checks.initialize = await checkInitialize();
  evidence.checks.initialized_notification = await checkInitializedNotification();
  evidence.checks.tools = await checkTools();
  evidence.checks.rate_limit_headers = await checkRateLimitHeaders();
  evidence.checks.search_followups = await checkSearchFollowups();
  evidence.checks.live_search = await checkLiveSearch();
  evidence.checks.feedback_prompt = await checkFeedbackPrompt();
  evidence.checks.preference_memory = await checkPreferenceMemory();

  if (evidenceOutputPath) {
    const path = resolve(evidenceOutputPath);
    evidence.evidence_path = path;
    const json = JSON.stringify(evidence, null, 2);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${json}\n`);
    console.log(json);
    return;
  }

  const json = JSON.stringify(evidence, null, 2);
  console.log(json);
}

async function getDeploymentMetadata() {
  if (process.env.EVENTCHAT_CAPTURE_DEPLOYMENT_METADATA === "false") {
    return {
      ok: false,
      skipped: true,
      reason: "EVENTCHAT_CAPTURE_DEPLOYMENT_METADATA=false"
    };
  }

  try {
    const { stdout } = await execFileAsync("railway", [
      "deployment",
      "list",
      "--service",
      railwayService,
      "--json"
    ], {
      timeout: requestTimeoutMs,
      maxBuffer: 1024 * 1024
    });
    const deployments = JSON.parse(stdout);
    const current = deployments.find((deployment) => deployment.status === "SUCCESS") || deployments[0];
    return {
      ok: Boolean(current?.id),
      provider: "railway",
      service: railwayService,
      id: current?.id || null,
      status: current?.status || null,
      created_at: current?.createdAt || null,
      builder: current?.meta?.serviceManifest?.build?.builder || null,
      dockerfile_path: current?.meta?.serviceManifest?.build?.dockerfilePath || null,
      start_command: current?.meta?.serviceManifest?.deploy?.startCommand || null,
      config_file: current?.meta?.configFile || null,
      image_digest: current?.meta?.imageDigest || null
    };
  } catch (error) {
    return {
      ok: false,
      provider: "railway",
      service: railwayService,
      error: error.message
    };
  }
}

async function checkCompanyUrl() {
  const response = await fetchWithTimeout(companyUrl, {
    redirect: "follow"
  });
  const body = await response.text();
  assert(response.ok, `Company URL returned HTTP ${response.status}`);
  assert((response.headers.get("content-type") || "").includes("text/html"), "Company URL was not served as HTML");
  assert(body.toLowerCase().includes("urban"), "Company URL did not include expected UrbanPlayground brand text");
  return {
    ok: true,
    url: companyUrl,
    status: response.status,
    content_type: response.headers.get("content-type"),
    bytes: Buffer.byteLength(body, "utf8")
  };
}

async function checkInitializedNotification() {
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2024-11-05"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized"
    })
  });
  const body = await response.text();
  assert(response.status === 202, `notifications/initialized expected HTTP 202, got ${response.status}`);
  assert(body === "", "notifications/initialized should not return a response body");
  assertSecurityHeaders(response, "/mcp");
  assertRateLimitHeaders(response, "/mcp");
  return {
    ok: true,
    status: response.status
  };
}

async function checkInitialize() {
  const result = await callRpc("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: {
      name: "eventchat-submission-verifier",
      version: "0.0.0"
    }
  });
  assert(result.serverInfo?.name === "eventchat-events", "initialize returned unexpected serverInfo.name");
  assert(result.capabilities?.tools, "initialize returned no tools capability");
  assertInstructions(result.instructions);
  return {
    ok: true,
    server_info: result.serverInfo,
    protocol_version: result.protocolVersion,
    tool_capabilities: result.capabilities.tools,
    instructions: result.instructions
  };
}

function assertInstructions(instructions) {
  assert(typeof instructions === "string" && instructions.length > 0, "initialize returned no server instructions");
  for (const phrase of [
    "live event discovery",
    "get_preference_onboarding",
    "consent",
    "profile_id and profile_secret",
    "get_event_search_followups",
    "recommend_events_for_user",
    "get_event_feedback_prompt",
    "record_event_feedback"
  ]) {
    assert(instructions.includes(phrase), `initialize instructions missing ${phrase}`);
  }
}

async function checkHealth() {
  const response = await fetchWithTimeout(`${baseUrl}/health`);
  const body = await response.json();
  assert(response.ok, `Health endpoint returned HTTP ${response.status}`);
  assert(body.ok === true && body.name === "eventchat-events", "Health body did not match expected service metadata");
  return {
    ok: true,
    status: response.status,
    body,
    security_headers: assertSecurityHeaders(response, "/health")
  };
}

async function checkMetadata() {
  const response = await fetchWithTimeout(`${baseUrl}/`);
  const body = await response.json();
  assert(response.ok, `Metadata endpoint returned HTTP ${response.status}`);
  for (const key of ["endpoint", "privacy", "support", "terms", "user_guide", "security", "logo"]) {
    assert(typeof body[key] === "string" && body[key].startsWith("/"), `Metadata missing ${key}`);
  }
  return {
    ok: true,
    status: response.status,
    body,
    security_headers: assertSecurityHeaders(response, "/")
  };
}

async function checkPublicPages() {
  const pages = {};
  for (const [name, path, requiredTexts] of [
    ["privacy", "/privacy-policy.html", ["UrbanPlayground", "hashed profile secret", "Personalization summaries", "learned genres, vibes, event types, venues, and avoid signals", "24 months", "automatically pruned", "30 days", "Deletion requests"]],
    ["support", "/support.html", ["support@urbanplayground.xyz", "feedback history", "security@urbanplayground.xyz", "vulnerability"]],
    ["terms", "/terms.html", ["UPlayground Events Connector Terms", "Third-Party Links", "Preference Memory", "explicit confirmation", "Acceptable Use"]],
    ["user_guide", "/user-guide.html", ["UPlayground Events Connector User Guide", "UrbanPlayground", "Connect", "ChatGPT Developer Mode", "Claude custom connectors", "https://eventchat-events-mcp-production.up.railway.app/mcp", "https://mcp.urbanplayground.xyz/mcp", "Useful Prompts", "Preference Memory", "Learning From Feedback", "too crowded", "too expensive", "too late", "Deleting Saved Preferences"]]
  ]) {
    const response = await fetchWithTimeout(`${baseUrl}${path}`);
    const body = await response.text();
    assert(response.ok, `${name} page returned HTTP ${response.status}`);
    for (const requiredText of requiredTexts) {
      assert(body.includes(requiredText), `${name} page did not include expected text: ${requiredText}`);
    }
    pages[name] = {
      ok: true,
      status: response.status,
      content_type: response.headers.get("content-type"),
      security_headers: assertSecurityHeaders(response, path),
      bytes: Buffer.byteLength(body, "utf8")
    };
  }

  const logo = await fetchWithTimeout(`${baseUrl}/logo-512.png`);
  const logoBytes = (await logo.arrayBuffer()).byteLength;
  assert(logo.ok, `Logo returned HTTP ${logo.status}`);
  assert(logo.headers.get("content-type") === "image/png", "Logo was not served as image/png");
  assert(logoBytes > 1024, "Logo response was unexpectedly small");
  pages.logo = {
    ok: true,
    status: logo.status,
    content_type: logo.headers.get("content-type"),
    security_headers: assertSecurityHeaders(logo, "/logo-512.png"),
    bytes: logoBytes
  };

  const securityTxt = await fetchWithTimeout(`${baseUrl}/.well-known/security.txt`);
  const securityBody = await securityTxt.text();
  assert(securityTxt.ok, `security.txt returned HTTP ${securityTxt.status}`);
  assert((securityTxt.headers.get("content-type") || "").includes("text/plain"), "security.txt was not served as text/plain");
  for (const requiredText of ["Contact: mailto:security@urbanplayground.xyz", "Policy: https://eventchat-events-mcp-production.up.railway.app/support.html", "Expires:"]) {
    assert(securityBody.includes(requiredText), `security.txt missing expected text: ${requiredText}`);
  }
  pages.security_txt = {
    ok: true,
    status: securityTxt.status,
    content_type: securityTxt.headers.get("content-type"),
    security_headers: assertSecurityHeaders(securityTxt, "/.well-known/security.txt"),
    bytes: Buffer.byteLength(securityBody, "utf8")
  };

  return pages;
}

async function checkTools() {
  const response = await callRpc("tools/list");
  const toolNames = response.tools.map((tool) => tool.name);
  assertIncludes(toolNames, requiredTools);

  const toolsByName = Object.fromEntries(response.tools.map((tool) => [tool.name, tool]));
  for (const tool of response.tools) {
    assert(typeof tool.title === "string" && tool.title.length > 0, `${tool.name} missing title`);
    assert(/^Use this (when|only when)\b/.test(tool.description || ""), `${tool.name} description should start with "Use this..."`);
    assert(tool.inputSchema && typeof tool.inputSchema === "object", `${tool.name} missing inputSchema`);
    assert(tool.outputSchema && typeof tool.outputSchema === "object", `${tool.name} missing outputSchema`);
    assert(JSON.stringify(tool.securitySchemes) === JSON.stringify([{ type: "noauth" }]), `${tool.name} must advertise noauth securitySchemes`);
    assert(JSON.stringify(tool._meta?.securitySchemes) === JSON.stringify([{ type: "noauth" }]), `${tool.name} must mirror noauth securitySchemes in _meta`);
    assert(typeof tool._meta?.["openai/toolInvocation/invoking"] === "string", `${tool.name} missing openai/toolInvocation/invoking`);
    assert(typeof tool._meta?.["openai/toolInvocation/invoked"] === "string", `${tool.name} missing openai/toolInvocation/invoked`);
    assert(tool._meta["openai/toolInvocation/invoking"].length <= 64, `${tool.name} invoking status exceeds 64 chars`);
    assert(tool._meta["openai/toolInvocation/invoked"].length <= 64, `${tool.name} invoked status exceeds 64 chars`);
  }

  assert(toolsByName.search_events.outputSchema?.anyOf?.[0]?.properties?.events?.items?.properties?.event_url?.type === "string", "search_events outputSchema missing event_url");
  assert(toolsByName.recommend_events.outputSchema?.anyOf?.[0]?.properties?.events?.items?.properties?.recommendation_score?.type === "number", "recommend_events outputSchema missing recommendation_score");
  assert(toolsByName.recommend_events_for_user.outputSchema?.anyOf?.[0]?.properties?.personalization?.properties?.applied_preferences?.type === "object", "recommend_events_for_user outputSchema missing personalization.applied_preferences");
  assert(toolsByName.create_event_preference_profile.outputSchema?.anyOf?.[0]?.properties?.profile_secret?.type === "string", "create_event_preference_profile outputSchema missing profile_secret");
  assert(toolsByName.create_event_preference_profile.outputSchema?.anyOf?.[0]?.properties?.access_instructions?.properties?.profile_secret_returned_now?.type === "boolean", "create_event_preference_profile outputSchema missing access_instructions.profile_secret_returned_now");
  assert(toolsByName.get_event_preferences.outputSchema?.anyOf?.[0]?.properties?.profile?.properties?.learned_preferences?.type === "object", "get_event_preferences outputSchema missing learned_preferences");
  assert(toolsByName.get_event_preferences.outputSchema?.anyOf?.[0]?.properties?.access_instructions?.properties?.reuse_instruction?.type === "string", "get_event_preferences outputSchema missing access_instructions.reuse_instruction");
  assert(toolsByName.get_event_feedback_prompt.outputSchema?.anyOf?.[0]?.properties?.questions?.items?.type === "string", "get_event_feedback_prompt outputSchema missing questions");
  assert(toolsByName.record_event_feedback.inputSchema?.anyOf?.some((branch) => branch.required?.includes("liked")), "record_event_feedback inputSchema must accept liked as a feedback signal");
  assert(toolsByName.record_event_feedback.inputSchema?.anyOf?.some((branch) => branch.required?.includes("rating")), "record_event_feedback inputSchema must accept rating as a feedback signal");
  assert(toolsByName.record_event_feedback.inputSchema?.anyOf?.some((branch) => branch.required?.includes("notes")), "record_event_feedback inputSchema must accept notes as a feedback signal");
  assert(toolsByName.get_event_search_followups.outputSchema?.anyOf?.[0]?.properties?.search_args_hint?.properties?.when?.type?.includes("null"), "get_event_search_followups outputSchema missing nullable search_args_hint.when");
  assert(toolsByName.delete_event_preferences.inputSchema?.properties?.confirm_delete?.type === "boolean", "delete_event_preferences inputSchema missing confirm_delete");
  assert(toolsByName.delete_event_preferences.inputSchema?.required?.includes("confirm_delete"), "delete_event_preferences inputSchema must require confirm_delete");
  assert(toolsByName.delete_event_preferences.outputSchema?.anyOf?.[0]?.properties?.deleted?.type === "boolean", "delete_event_preferences outputSchema missing deleted");

  for (const [toolName, annotations] of Object.entries(requiredAnnotations)) {
    const tool = toolsByName[toolName];
    assert(tool, `Missing expected tool ${toolName}`);
    for (const [key, expected] of Object.entries(annotations)) {
      assert(tool.annotations?.[key] === expected, `${toolName}.${key} expected ${expected}, got ${tool.annotations?.[key]}`);
    }
  }

  return {
    ok: true,
    count: response.tools.length,
    names: toolNames,
    titles: Object.fromEntries(response.tools.map((tool) => [tool.name, tool.title])),
    output_schema_tools: response.tools.map((tool) => tool.name),
    annotation_samples: Object.fromEntries(Object.keys(requiredAnnotations).map((name) => [name, toolsByName[name].annotations]))
  };
}

async function checkLiveSearch() {
  const search = await callTool("search_events", { city: "berlin", when: "week", limit: 1 });
  assert(Array.isArray(search.events) && search.events.length > 0, "Live search returned no Berlin events");
  return {
    ok: true,
    sample_event: {
      id: search.events[0].id,
      title: search.events[0].title,
      url: search.events[0].url
    }
  };
}

async function checkSearchFollowups() {
  const followups = await callTool("get_event_search_followups", {
    city: "berlin",
    when: "tonight"
  });
  assert(followups.needs_followup === true, "Search followups should ask for missing details");
  assert(followups.missing_fields?.includes("event_types"), "Search followups missing event_types");
  assert(followups.missing_fields?.includes("vibe"), "Search followups missing vibe");
  assert(followups.questions?.some((question) => question.includes("type of event")), "Search followups missing event type question");
  assert(followups.questions?.some((question) => question.includes("vibe")), "Search followups missing vibe question");
  return {
    ok: true,
    missing_fields: followups.missing_fields,
    question_count: followups.questions.length
  };
}

async function checkFeedbackPrompt() {
  const search = await callTool("search_events", { city: "berlin", when: "week", limit: 1 });
  assert(Array.isArray(search.events) && search.events.length > 0, "Feedback prompt could not get a live event id");
  const prompt = await callTool("get_event_feedback_prompt", {
    event_id: search.events[0].id,
    attended_at: "2026-06-09"
  });
  assert(prompt.event?.id === search.events[0].id, "Feedback prompt returned the wrong event");
  assert(Array.isArray(prompt.questions) && prompt.questions.some((question) => question.includes("Did you like")), "Feedback prompt missing like/dislike question");
  assert(/record_event_feedback/.test(prompt.assistant_instruction || ""), "Feedback prompt missing record_event_feedback instruction");
  return {
    ok: true,
    event_id: prompt.event.id,
    question_count: prompt.questions.length
  };
}

async function checkPreferenceMemory() {
  const created = await callTool("create_event_preference_profile", {
    consent: true,
    preferences: {
      event_types: ["concert", "club night"],
      genres: ["techno"],
      vibe: ["underground"],
      avoid: ["mainstream"]
    }
  });
  const profileId = created.profile?.profile_id;
  const profileSecret = created.profile_secret;
  assert(/^upg_[0-9a-f-]{36}$/.test(profileId || ""), `Expected generated profile id, got ${profileId}`);
  assert(/^ups_[A-Za-z0-9_-]+$/.test(profileSecret || ""), "Expected generated profile secret");
  assert(created.access_instructions?.profile_id === profileId, "Profile creation missing access_instructions.profile_id");
  assert(created.access_instructions?.profile_secret === profileSecret, "Profile creation access_instructions did not include one-time profile_secret");
  assert(created.access_instructions?.profile_secret_returned_now === true, "Profile creation should mark profile_secret_returned_now true");
  assert(created.access_instructions?.keep_private === true, "Profile creation should mark access instructions private");

  const fetched = await callTool("get_event_preferences", {
    profile_id: profileId,
    profile_secret: profileSecret
  });
  assert(fetched.profile?.preferences?.genres?.includes("techno"), "Preference profile did not save genre");
  assert(fetched.profile?.profile_secret_hash === undefined, "Public profile leaked profile_secret_hash");
  assert(fetched.access_instructions?.profile_id === profileId, "Preference read missing access_instructions.profile_id");
  assert(fetched.access_instructions?.profile_secret === null, "Preference read must not echo profile_secret");
  assert(fetched.access_instructions?.profile_secret_returned_now === false, "Preference read should mark profile_secret_returned_now false");

  await assertToolError("get_event_preferences", {
    profile_id: profileId,
    profile_secret: "wrong-secret"
  });

  const search = await callTool("search_events", { city: "berlin", when: "week", limit: 1 });
  assert(Array.isArray(search.events) && search.events.length > 0, "Preference memory could not get a live event for feedback");
  await assertToolError("record_event_feedback", {
    profile_id: profileId,
    profile_secret: profileSecret,
    event_id: search.events[0].id
  });

  await callTool("record_event_feedback", {
    profile_id: profileId,
    profile_secret: profileSecret,
    event_id: search.events[0].id,
    liked: true,
    rating: 5,
    notes: "Submission verifier liked the music but not the crowd, and it was too expensive."
  });

  const learned = await callTool("get_event_preferences", {
    profile_id: profileId,
    profile_secret: profileSecret
  });
  assert(learned.profile?.feedback_count >= 1, "Feedback did not increment profile feedback_count");
  assert(learned.profile?.learned_preferences?.avoid?.includes("crowded"), "Feedback notes did not create learned crowd avoid signal");
  assert(learned.profile?.learned_preferences?.avoid?.includes("expensive tickets"), "Feedback notes did not create learned price avoid signal");

  await assertToolError("delete_event_preferences", {
    profile_id: profileId,
    profile_secret: profileSecret
  });

  const deleted = await callTool("delete_event_preferences", {
    profile_id: profileId,
    profile_secret: profileSecret,
    confirm_delete: true
  });
  assert(deleted.deleted === true, "Temporary submission-check profile was not deleted");

  return {
    ok: true,
    created_profile_id_prefix: profileId.slice(0, 8),
    secret_returned_once: true,
    access_card_returned_on_create: true,
    access_card_private: true,
    profile_read_did_not_echo_secret: true,
    wrong_secret_rejected: true,
    empty_feedback_rejected: true,
    note_feedback_learned: true,
    unconfirmed_delete_rejected: true,
    feedback_recorded: true,
    feedback_count_before_delete: learned.profile.feedback_count,
    deleted: true
  };
}

async function checkRateLimitHeaders() {
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method: "tools/list"
    })
  });
  assert(response.ok, `Rate-limit header check failed: HTTP ${response.status}`);
  assertSecurityHeaders(response, "/mcp");
  const headers = assertRateLimitHeaders(response, "/mcp");
  const body = await response.json();
  assert(!body.error, `Rate-limit header check returned RPC error: ${body.error?.message}`);
  return {
    ok: true,
    headers
  };
}

async function assertToolError(name, args) {
  const result = await callRpc("tools/call", { name, arguments: args });
  assert(result.isError === true, `${name} unexpectedly accepted invalid input`);
}

async function callTool(name, args) {
  const result = await callRpc("tools/call", { name, arguments: args });
  const first = result.content?.[0];
  assert(first?.type === "text", `${name} returned no text content`);
  assert(result.structuredContent && typeof result.structuredContent === "object", `${name} returned no structuredContent`);
  assert(result.isError !== true, `${name} returned error: ${first.text}`);
  return JSON.parse(first.text);
}

async function callRpc(method, params = undefined) {
  const response = await fetchWithTimeout(endpoint, {
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
  assert(response.ok, `${method} failed: HTTP ${response.status}`);
  assertSecurityHeaders(response, "/mcp");
  assertRateLimitHeaders(response, "/mcp");
  const body = await response.json();
  assert(!body.error, `${method} error: ${body.error?.message}`);
  return body.result;
}

async function fetchWithTimeout(url, options = {}) {
  try {
    return await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(requestTimeoutMs)
    });
  } catch (error) {
    throw new Error(`Request timed out or failed after ${requestTimeoutMs}ms: ${url} (${error.message})`);
  }
}

function assertSecurityHeaders(response, path) {
  const csp = response.headers.get("content-security-policy") || "";
  assert(csp.includes("default-src 'none'"), `${path} missing restrictive CSP default-src`);
  assert(csp.includes("connect-src 'self' https://backend-production-958d.up.railway.app https://urbanplayground.xyz"), `${path} CSP missing exact connect-src domains`);
  assert(csp.includes("frame-ancestors https://chatgpt.com https://chat.openai.com"), `${path} CSP missing ChatGPT frame ancestors`);
  assert(response.headers.get("x-content-type-options") === "nosniff", `${path} missing X-Content-Type-Options`);
  assert(response.headers.get("referrer-policy") === "no-referrer", `${path} missing Referrer-Policy`);
  return {
    content_security_policy: csp,
    referrer_policy: response.headers.get("referrer-policy"),
    x_content_type_options: response.headers.get("x-content-type-options")
  };
}

function assertRateLimitHeaders(response, path) {
  const limit = Number(response.headers.get("x-ratelimit-limit"));
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  assert(Number.isFinite(limit) && limit > 0, `${path} missing X-RateLimit-Limit`);
  assert(Number.isFinite(remaining) && remaining >= 0, `${path} missing X-RateLimit-Remaining`);
  assert(Number.isFinite(reset) && reset > 0, `${path} missing X-RateLimit-Reset`);
  return {
    x_ratelimit_limit: limit,
    x_ratelimit_remaining: remaining,
    x_ratelimit_reset: reset
  };
}

function assertIncludes(values, required) {
  for (const value of required) {
    assert(values.includes(value), `Missing expected tool: ${value}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
