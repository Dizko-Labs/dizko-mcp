import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { prompts as registryPrompts, tools as registryTools } from "../src/tools.js";

const execFileAsync = promisify(execFile);

const endpoint = process.env.DIZKO_MCP_URL || process.env.EVENTCHAT_MCP_URL || "https://mcp.dizko.app/mcp";
const baseUrl = endpoint.replace(/\/mcp\/?$/, "");
const companyUrl = process.env.EVENTCHAT_COMPANY_URL || "https://www.dizko.app";
const requestTimeoutMs = Number(process.env.EVENTCHAT_VERIFY_TIMEOUT_MS || 15000);
const evidenceOutputPath = process.env.EVENTCHAT_SUBMISSION_EVIDENCE_PATH || null;
const railwayService = process.env.DIZKO_RAILWAY_SERVICE || process.env.EVENTCHAT_RAILWAY_SERVICE || "dizko-mcp";

// Expected tools, order, annotations and security schemes come from the
// package's own registry, so this preflight checks the live server against
// what the package ships and cannot drift from it. The listed names are the
// Muse connector contract surface.
const requiredTools = registryTools.map((tool) => tool.name);
const requiredPrompts = registryPrompts.map((prompt) => prompt.name);
const ANNOTATION_KEYS = ["readOnlyHint", "destructiveHint", "openWorldHint"];
const requiredAnnotations = Object.fromEntries(registryTools.map((tool) => [
  tool.name,
  Object.fromEntries(ANNOTATION_KEYS.map((key) => [key, tool.annotations?.[key]]))
]));
const requiredSecurity = Object.fromEntries(registryTools.map((tool) => [tool.name, JSON.stringify(tool.securitySchemes)]));

// tools/list carries 30 tools with full parameter descriptions (about 47 KB).
// main budgets 26 KB by stripping them; which budget the Muse review surface
// should hold is an open decision, so this only stops unnoticed growth.
const TOOLS_LIST_BYTE_BUDGET = 48_000;

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
  evidence.checks.discover = await checkDiscover();
  evidence.checks.initialize = await checkLegacyInitialize();
  evidence.checks.initialized_notification = await checkInitializedNotification();
  evidence.checks.tools = await checkTools();
  evidence.checks.prompts = await checkPrompts();
  evidence.checks.rate_limit_headers = await checkRateLimitHeaders();
  evidence.checks.cities = await checkCities();
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
  assert(body.toLowerCase().includes("dizko"), "Company URL did not include expected Dizko brand text");
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

// server/discover replaces the initialize handshake on 2026-07-28: it
// advertises supported revisions, capabilities and identity with no prior
// request and no session.
async function checkDiscover() {
  const result = await callRpc("server/discover");
  const serverInfo = result._meta?.["io.modelcontextprotocol/serverInfo"];
  assert(
    Array.isArray(result.supportedVersions) && result.supportedVersions.includes("2026-07-28"),
    `server/discover did not advertise 2026-07-28 (got ${JSON.stringify(result.supportedVersions)})`
  );
  assert(serverInfo?.name === "dizko", "server/discover returned unexpected serverInfo.name");
  assert(result.capabilities?.tools, "server/discover returned no tools capability");
  assert(result.capabilities?.prompts, "server/discover returned no prompts capability");
  assertInstructions(result.instructions);
  return {
    ok: true,
    server_info: serverInfo,
    supported_versions: result.supportedVersions,
    tool_capabilities: result.capabilities.tools,
    prompt_capabilities: result.capabilities.prompts,
    cache_scope: result.cacheScope,
    ttl_ms: result.ttlMs,
    instructions: result.instructions
  };
}

// 2025-era clients still send `initialize`; the SDK serves them from the
// same definition through its stateless legacy fallback. This check is what
// proves we did not break existing ChatGPT/Claude connectors.
async function checkLegacyInitialize() {
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-11-25"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "dizko-submission-verifier", version: "0.0.0" }
      }
    })
  });
  assert(response.ok, `legacy initialize failed: HTTP ${response.status}`);
  const body = await readRpcBody(response);
  const result = body.result;
  assert(!body.error, `legacy initialize error: ${body.error?.message}`);
  assert(result?.serverInfo?.name === "dizko", "legacy initialize returned unexpected serverInfo.name");
  assert(result.capabilities?.tools, "legacy initialize returned no tools capability");
  assert(result.capabilities?.prompts, "legacy initialize returned no prompts capability");
  assertInstructions(result.instructions);
  return {
    ok: true,
    server_info: result.serverInfo,
    protocol_version: result.protocolVersion,
    tool_capabilities: result.capabilities.tools,
    prompt_capabilities: result.capabilities.prompts,
    instructions: result.instructions
  };
}

// The instructions carry the routing contract: one search call per
// city-plus-timeframe request, consent-first memory, honest ticket flow.
function assertInstructions(instructions) {
  assert(typeof instructions === "string" && instructions.length > 0, "server returned no instructions");
  for (const phrase of [
    "47 cities",
    "ONE search_events call",
    "nearest_covered_city",
    "get_artist",
    "dizko_onboarding",
    "consent",
    "profile_id and profile_secret",
    "record_event_feedback",
    "get_ticket_offers"
  ]) {
    assert(instructions.includes(phrase), `server instructions missing ${phrase}`);
  }
}

async function checkHealth() {
  const response = await fetchWithTimeout(`${baseUrl}/health`);
  const body = await readJsonBody(response, `${baseUrl}/health`);
  assert(response.ok, `Health endpoint returned HTTP ${response.status}`);
  assert(body.ok === true && body.name === "dizko", "Health body did not match expected service metadata");
  return {
    ok: true,
    status: response.status,
    body,
    security_headers: assertSecurityHeaders(response, "/health")
  };
}

async function checkMetadata() {
  const response = await fetchWithTimeout(`${baseUrl}/`);
  const body = await readJsonBody(response, `${baseUrl}/`);
  assert(response.ok, `Metadata endpoint returned HTTP ${response.status}`);
  for (const key of ["endpoint", "install", "privacy", "support", "terms", "user_guide", "security", "logo"]) {
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
    ["privacy", "/privacy-policy.html", ["Dizko", "hashed profile secret", "Personalization summaries", "learned genres, vibes, event types, venues, and avoid signals", "24 months", "automatically pruned", "30 days", "Deletion requests"]],
    ["support", "/support.html", ["support@dizko.app", "feedback history", "security@dizko.app", "vulnerability"]],
    ["terms", "/terms.html", ["Dizko Events Connector Terms", "Third-Party Links", "Preference Memory", "explicit confirmation", "Acceptable Use"]],
    ["user_guide", "/user-guide.html", ["Dizko Events Connector User Guide", "Dizko", "Connect", "ChatGPT Developer Mode", "Claude custom connectors", "https://mcp.dizko.app/mcp", "Useful Prompts", "Preference Memory", "Learning From Feedback", "too crowded", "too expensive", "too late", "Deleting Saved Preferences"]]
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
  for (const requiredText of ["Contact: mailto:security@dizko.app", "Policy: https://mcp.dizko.app/support.html", "Expires:"]) {
    assert(securityBody.includes(requiredText), `security.txt missing expected text: ${requiredText}`);
  }
  pages.security_txt = {
    ok: true,
    status: securityTxt.status,
    content_type: securityTxt.headers.get("content-type"),
    security_headers: assertSecurityHeaders(securityTxt, "/.well-known/security.txt"),
    bytes: Buffer.byteLength(securityBody, "utf8")
  };

  // /install is a redirect to the per-client guide; it must not be followed
  // into www.dizko.app, only checked for the Location it advertises.
  const install = await fetchWithTimeout(`${baseUrl}/install`, { redirect: "manual" });
  assert(install.status === 302, `/install expected HTTP 302, got ${install.status}`);
  assert(install.headers.get("location") === "https://www.dizko.app/mcp/install", `/install redirected to ${install.headers.get("location")}`);
  pages.install = { ok: true, status: install.status, location: install.headers.get("location") };

  return pages;
}

async function checkTools() {
  const response = await callRpc("tools/list");
  const toolNames = response.tools.map((tool) => tool.name);
  assertIncludes(toolNames, requiredTools);
  assert(toolNames.length === requiredTools.length, `tools/list served ${toolNames.length} tools, expected ${requiredTools.length}: ${toolNames.join(", ")}`);
  assert(JSON.stringify(toolNames) === JSON.stringify(requiredTools), `tools/list order differs from the package registry: ${toolNames.join(", ")}`);
  assert(!toolNames.some((name) => name.startsWith("dizko_")), `tools/list exposes an unshipped dizko_ name: ${toolNames.filter((name) => name.startsWith("dizko_")).join(", ")}`);

  const toolsByName = Object.fromEntries(response.tools.map((tool) => [tool.name, tool]));
  for (const tool of response.tools) {
    assert(typeof tool.title === "string" && tool.title.length > 0, `${tool.name} missing title`);
    assert(typeof tool.description === "string" && tool.description.length > 40, `${tool.name} description is missing or too short`);
    assert(tool.inputSchema && typeof tool.inputSchema === "object", `${tool.name} missing inputSchema`);
    assert(tool.outputSchema === undefined, `${tool.name} should omit redundant outputSchema`);
    assert(JSON.stringify(tool.securitySchemes) === requiredSecurity[tool.name], `${tool.name} must advertise ${requiredSecurity[tool.name]} securitySchemes`);
    assert(JSON.stringify(tool._meta?.securitySchemes) === requiredSecurity[tool.name], `${tool.name} must mirror its securitySchemes in _meta`);
    assert(typeof tool._meta?.["openai/toolInvocation/invoking"] === "string", `${tool.name} missing openai/toolInvocation/invoking`);
    assert(typeof tool._meta?.["openai/toolInvocation/invoked"] === "string", `${tool.name} missing openai/toolInvocation/invoked`);
    assert(tool._meta["openai/toolInvocation/invoking"].length <= 64, `${tool.name} invoking status exceeds 64 chars`);
    assert(tool._meta["openai/toolInvocation/invoked"].length <= 64, `${tool.name} invoked status exceeds 64 chars`);
  }

  assert(Buffer.byteLength(JSON.stringify(response), "utf8") < TOOLS_LIST_BYTE_BUDGET, `tools/list exceeds the ${TOOLS_LIST_BYTE_BUDGET.toLocaleString()}-byte result budget`);

  const searchProperties = toolsByName.search_events.inputSchema?.properties || {};
  for (const [name, property] of Object.entries(searchProperties)) {
    assert(typeof property.description === "string" && property.description.length > 0, `search_events.${name} needs a description`);
  }
  assert(searchProperties.when?.description?.includes("YYYY-MM-DD"), "search_events.when must document the date form");
  assert(Array.isArray(searchProperties.sort_by?.enum) && searchProperties.sort_by.enum.includes("distance"), "search_events.sort_by must enumerate distance");
  assert(searchProperties.limit?.default === 12, "search_events.limit must serve its default");
  assert(toolsByName.record_event_feedback.inputSchema?.anyOf?.some((branch) => branch.required?.includes("liked")), "record_event_feedback inputSchema must accept liked as a feedback signal");
  assert(toolsByName.record_event_feedback.inputSchema?.anyOf?.some((branch) => branch.required?.includes("rating")), "record_event_feedback inputSchema must accept rating as a feedback signal");
  assert(toolsByName.record_event_feedback.inputSchema?.anyOf?.some((branch) => branch.required?.includes("notes")), "record_event_feedback inputSchema must accept notes as a feedback signal");
  assert(toolsByName.delete_event_preferences.inputSchema?.properties?.confirm_delete?.type === "boolean", "delete_event_preferences inputSchema missing confirm_delete");
  assert(toolsByName.delete_event_preferences.inputSchema?.required?.includes("confirm_delete"), "delete_event_preferences inputSchema must require confirm_delete");
  assert(toolsByName.create_event_preference_profile.inputSchema?.required?.includes("consent"), "create_event_preference_profile inputSchema must require consent");
  assert(toolsByName.purchase_ticket_order.inputSchema?.required?.includes("confirmation_text"), "purchase_ticket_order inputSchema must require confirmation_text");
  assert(toolsByName.purchase_ticket_order.inputSchema?.required?.includes("quote_token"), "purchase_ticket_order inputSchema must require quote_token");

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
    output_schema_tools: response.tools.filter((tool) => tool.outputSchema).map((tool) => tool.name),
    annotation_samples: Object.fromEntries(Object.keys(requiredAnnotations).map((name) => [name, toolsByName[name].annotations]))
  };
}

async function checkPrompts() {
  const response = await callRpc("prompts/list");
  const names = (response.prompts || []).map((prompt) => prompt.name);
  assertIncludes(names, requiredPrompts);
  for (const prompt of response.prompts) {
    assert(typeof prompt.description === "string" && prompt.description.length > 0, `${prompt.name} prompt missing description`);
  }
  return { ok: true, count: names.length, names };
}

async function checkCities() {
  const cities = await callTool("list_cities", {});
  assert(Array.isArray(cities.cities) && cities.cities.length > 0, "list_cities returned no cities");
  assert(cities.live_count > 0, "list_cities reported no live cities");
  for (const city of cities.cities) {
    assert(["live", "unlocking", "early"].includes(city.status), `${city.slug} has unexpected status ${city.status}`);
    assert(typeof city.timezone === "string" && city.timezone.length > 0, `${city.slug} has no timezone`);
  }
  return {
    ok: true,
    count: cities.count,
    live_count: cities.live_count,
    sample: cities.cities.slice(0, 5).map((city) => `${city.slug} (${city.status})`)
  };
}

async function checkLiveSearch() {
  const search = await callTool("search_events", { city: "berlin", when: "week", limit: 1 });
  assert(Array.isArray(search.events) && search.events.length > 0, "Live search returned no Berlin events");
  const event = search.events[0];
  assert(typeof search.timezone === "string", "Live search did not report the city timezone");
  assert(typeof event.when === "string" && event.when.length > 0, "Live search event is missing the local `when`");
  assert(typeof event.event_url === "string" && event.event_url.startsWith("https://"), "Live search event is missing event_url");
  return {
    ok: true,
    timezone: search.timezone,
    count: search.count,
    sample_event: {
      id: event.id,
      title: event.title,
      when: event.when,
      url: event.event_url
    }
  };
}

// The clarifying questions are served as a prompt; the assistant asks them
// conversationally and only when a broad request is ambiguous.
async function checkSearchFollowups() {
  const prompt = await getPrompt("dizko_search_followups", { city: "berlin", when: "tonight" });
  assert(/search_events/.test(prompt.description || ""), "Search follow-ups prompt should point back at search_events");
  assert(prompt.questions.some((question) => question.includes("type of event")), "Search follow-ups missing event type question");
  assert(prompt.questions.some((question) => question.includes("vibe")), "Search follow-ups missing vibe question");
  return {
    ok: true,
    prompt: "dizko_search_followups",
    question_count: prompt.questions.length
  };
}

async function checkFeedbackPrompt() {
  const search = await callTool("search_events", { city: "berlin", when: "week", limit: 1 });
  assert(Array.isArray(search.events) && search.events.length > 0, "Feedback prompt could not get a live event id");
  const event = search.events[0];
  const prompt = await getPrompt("dizko_post_event_feedback", { event_id: event.id });
  assert((prompt.description || "").includes(event.title), "Feedback prompt did not name the event");
  assert(prompt.questions.some((question) => question.includes("Did you like")), "Feedback prompt missing like/dislike question");
  assert(/record_event_feedback/.test(prompt.description || ""), "Feedback prompt missing record_event_feedback instruction");
  return {
    ok: true,
    prompt: "dizko_post_event_feedback",
    event_id: event.id,
    question_count: prompt.questions.length
  };
}

async function checkPreferenceMemory() {
  await assertToolError("create_event_preference_profile", { consent: false, preferences: { genres: ["techno"] } });

  const created = await callTool("create_event_preference_profile", {
    consent: true,
    preferences: {
      event_types: ["concert", "club night"],
      genres: ["techno"],
      vibe: ["underground"],
      avoid: ["mainstream"]
    }
  });
  const profileId = created.profile_id;
  const profileSecret = created.profile_secret;
  assert(created.created === true, "Profile creation did not report created: true");
  assert(/^dzk_[0-9a-f-]{36}$/.test(profileId || ""), `Expected generated profile id, got ${profileId}`);
  assert(/^dzs_[A-Za-z0-9_-]+$/.test(profileSecret || ""), "Expected generated profile secret");
  assert(created.profile?.profile_id === profileId, "Profile creation public profile did not match profile_id");
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

  const recorded = await callTool("record_event_feedback", {
    profile_id: profileId,
    profile_secret: profileSecret,
    event_id: search.events[0].id,
    liked: true,
    rating: 5,
    notes: "Submission verifier liked the music but not the crowd, and it was too expensive."
  });
  assert(recorded.saved === true, "Feedback was not saved");
  assert(recorded.profile?.feedback_count >= 1, "Feedback response did not carry profile.feedback_count");

  const learned = await callTool("get_event_preferences", {
    profile_id: profileId,
    profile_secret: profileSecret
  });
  assert(learned.profile?.feedback_count >= 1, "Feedback did not increment profile feedback_count");
  assert(learned.profile?.learned_preferences?.avoid?.includes("crowded"), "Feedback notes did not create learned crowd avoid signal");
  assert(learned.profile?.learned_preferences?.avoid?.includes("expensive tickets"), "Feedback notes did not create learned price avoid signal");

  await assertToolError("delete_event_preferences", {
    profile_id: profileId,
    profile_secret: profileSecret,
    confirm_delete: false
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
    consent_required_enforced: true,
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
  const body = await readRpcBody(response);
  assert(!body.error, `Rate-limit header check returned RPC error: ${body.error?.message}`);
  return {
    ok: true,
    headers
  };
}

async function assertToolError(name, args) {
  const result = await callRpc("tools/call", { name, arguments: args });
  assert(result.isError === true, `${name} unexpectedly accepted invalid input`);
  assert(typeof result.structuredContent?.code === "string", `${name} error is missing a code`);
}

async function callTool(name, args) {
  const result = await callRpc("tools/call", { name, arguments: args });
  const first = result.content?.[0];
  assert(first?.type === "text", `${name} returned no text content`);
  assert(result.structuredContent && typeof result.structuredContent === "object", `${name} returned no structuredContent`);
  assert(result.isError !== true, `${name} returned error: ${first.text}`);
  return JSON.parse(first.text);
}

// prompts/get answers with a description plus numbered questions in one
// text message; return both so checks can assert on either.
async function getPrompt(name, args) {
  const result = await callRpc("prompts/get", { name, arguments: args });
  const message = (result.messages || []).find((entry) => entry?.content?.type === "text");
  assert(message, `${name} prompt returned no text message`);
  const questions = message.content.text
    .split("\n")
    .filter((line) => /^\d+\.\s/.test(line))
    .map((line) => line.replace(/^\d+\.\s/, ""));
  assert(questions.length > 0, `${name} prompt returned no questions`);
  return { description: result.description || "", text: message.content.text, questions };
}

// 2026-07-28 is stateless: the revision, the client's capabilities and its
// identity travel in `_meta` on every request rather than being negotiated
// once by `initialize`.
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "dizko-submission-verifier",
    version: "0.0.0"
  }
};

async function callRpc(method, params = undefined) {
  const response = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      // Required on 2026-07-28 POSTs so intermediaries can route without
      // parsing the body (SEP-2243).
      "Mcp-Method": method,
      ...(["tools/call", "prompts/get"].includes(method) && params?.name ? { "Mcp-Name": params.name } : {})
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method,
      params: { ...(params || {}), _meta: MODERN_META }
    })
  });
  assert(response.ok, `${method} failed: HTTP ${response.status}`);
  assertSecurityHeaders(response, "/mcp");
  assertRateLimitHeaders(response, "/mcp");
  const body = await readRpcBody(response);
  assert(!body.error, `${method} error: ${body.error?.message}`);
  assert(
    body.result?.resultType === "complete",
    `${method} returned resultType ${body.result?.resultType} (expected "complete")`
  );
  return body.result;
}

// Modern exchanges answer with a single JSON body; the 2025-era fallback
// answers over SSE. Read either shape.
async function readRpcBody(response) {
  const text = await response.text();
  if (!text.trimStart().startsWith("event:")) return JSON.parse(text);
  const line = text.split("\n").find((entry) => entry.startsWith("data:"));
  assert(line, "SSE response carried no data frame");
  return JSON.parse(line.slice("data:".length).trim());
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

// A proxy error page, a CDN 502 or a maintenance page all answer with HTML,
// and response.json() then throws a bare SyntaxError whose message begins
// "Unexpected token 'H'" - which says nothing about which endpoint failed or
// what it actually returned. This reports the endpoint, the status and the
// first line of the body instead.
async function readJsonBody(response, url) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.trim().split("\n")[0].slice(0, 200) || "(empty body)";
    throw new Error(`${url} returned HTTP ${response.status} with a non-JSON body: ${preview}`);
  }
}

function assertSecurityHeaders(response, path) {
  const csp = response.headers.get("content-security-policy") || "";
  assert(csp.includes("default-src 'none'"), `${path} missing restrictive CSP default-src`);
  assert(csp.includes("connect-src 'self' https://api.dizko.app https://www.dizko.app"), `${path} CSP missing exact connect-src domains`);
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
