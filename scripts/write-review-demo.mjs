import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const endpoint = process.env.DIZKO_MCP_URL || process.env.EVENTCHAT_MCP_URL || "https://mcp.dizko.app/mcp";
const outputPath = resolve(process.env.EVENTCHAT_REVIEW_DEMO_PATH || "./submission-evidence/review-demo.md");

async function main() {
  const generatedAt = new Date().toISOString();
  const steps = [];

  const search = await callTool("search_events", {
    city: "berlin",
    when: "weekend",
    genres: ["techno"],
    limit: 5
  });
  steps.push({
    prompt: "Find five techno events in Berlin this weekend.",
    tools: ["search_events"],
    evidence: [
      `Returned ${search.events?.length || 0} live events.`,
      `Sample: ${eventLine(search.events?.[0])}`
    ],
    response: eventResponse(search.events)
  });

  const followups = await callTool("get_event_search_followups", {
    city: "berlin",
    when: "tonight"
  });
  steps.push({
    prompt: "Find something good tonight in Berlin, but ask me what kind of event and vibe first.",
    tools: ["get_event_search_followups"],
    evidence: [
      `Missing fields: ${(followups.missing_fields || []).join(", ")}`,
      `Questions: ${(followups.questions || []).join(" | ")}`
    ],
    response: `Before I search, I would ask: ${(followups.questions || []).slice(0, 3).join(" ")}`
  });

  const onboarding = await callTool("get_preference_onboarding", {});
  const created = await callTool("create_event_preference_profile", {
    consent: true,
    preferences: {
      event_types: ["party", "concert"],
      genres: ["techno", "ambient"],
      vibe: ["underground", "intimate"],
      avoid: ["mainstream", "huge crowds"],
      budget: "under 40 EUR"
    }
  });
  const profileId = created.profile?.profile_id;
  const profileSecret = created.profile_secret;
  const personalized = await callTool("recommend_events_for_user", {
    profile_id: profileId,
    profile_secret: profileSecret,
    city: "berlin",
    when: "weekend",
    event_types: ["party"],
    vibe: ["underground"],
    result_limit: 3
  });
  steps.push({
    prompt: "Ask what kind of events I generally like, save my preferences after I consent, ask what type/vibe I want this weekend, and recommend events.",
    tools: ["get_preference_onboarding", "create_event_preference_profile", "recommend_events_for_user"],
    evidence: [
      `Onboarding questions: ${(onboarding.questions || []).slice(0, 3).join(" | ")}`,
      `Created profile: ${redactProfileId(profileId)}`,
      "Profile secret: [REDACTED]",
      `Personalized results: ${personalized.events?.length || 0}`
    ],
    response: eventResponse(personalized.events)
  });

  const feedbackEvent = personalized.events?.[0] || search.events?.[0];
  const feedbackPrompt = await callTool("get_event_feedback_prompt", {
    event_id: feedbackEvent.id,
    attended_at: "2026-06-09"
  });
  const feedback = await callTool("record_event_feedback", {
    profile_id: profileId,
    profile_secret: profileSecret,
    event_id: feedbackEvent.id,
    liked: false,
    rating: 2,
    notes: "Liked the music, disliked the crowd size.",
    attended_at: "2026-06-09"
  });
  steps.push({
    prompt: "Ask me a follow-up about whether I liked a returned event, record my answer, and explain how future recommendations changed.",
    tools: ["get_event_feedback_prompt", "record_event_feedback"],
    evidence: [
      `Feedback questions: ${(feedbackPrompt.questions || []).join(" | ")}`,
      `Feedback count: ${feedback.feedback_count}`,
      `Learned avoid signals: ${JSON.stringify(feedback.learned_preferences?.avoid || [])}`
    ],
    response: "I would explain that future recommendations will still consider matching music, but will penalize crowd-size signals and other disliked traits from this feedback."
  });

  const deleted = await callTool("delete_event_preferences", {
    profile_id: profileId,
    profile_secret: profileSecret,
    confirm_delete: true
  });
  steps.push({
    prompt: "Delete my Dizko saved event preferences and feedback history.",
    tools: ["delete_event_preferences"],
    evidence: ["Deletion confirmation: true", `Deleted: ${Boolean(deleted.deleted)}`],
    response: "Your saved Dizko event preferences and feedback history for this connector profile have been deleted."
  });

  const body = renderMarkdown({ generatedAt, steps });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, body);
  console.log(JSON.stringify({ ok: true, output_path: outputPath, prompts: steps.length }, null, 2));
}

async function callTool(name, args) {
  const result = await callRpc("tools/call", { name, arguments: args });
  const first = result.content?.[0];
  if (!first || first.type !== "text") throw new Error(`${name} returned no text content`);
  if (result.isError) throw new Error(`${name} returned error: ${first.text}`);
  return JSON.parse(first.text);
}

// 2026-07-28 stateless envelope: revision + client capabilities per request
// instead of an initialize handshake, plus the SEP-2243 routing headers.
const MODERN_META = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "dizko-review-demo", version: "0.0.0" }
};

async function callRpc(method, params = undefined) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Method": method,
      ...(method === "tools/call" && params?.name ? { "Mcp-Name": params.name } : {})
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method,
      params: { ...(params || {}), _meta: MODERN_META }
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`${method} failed: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method} error: ${body.error.message}`);
  return body.result;
}

function renderMarkdown({ generatedAt, steps }) {
  return [
    "# Dizko Events Review Demo",
    "",
    `Generated: ${generatedAt}`,
    `Endpoint: ${endpoint}`,
    "",
    "This file is generated from live MCP tool calls. Profile secrets are redacted. Temporary demo preference profiles are deleted at the end of the run.",
    "",
    ...steps.flatMap((step, index) => [
      `## ${index + 1}. ${step.prompt}`,
      "",
      `Tools: ${step.tools.map((tool) => `\`${tool}\``).join(", ")}`,
      "",
      "Evidence:",
      "",
      ...step.evidence.map((line) => `- ${line}`),
      "",
      "Example assistant response:",
      "",
      step.response,
      ""
    ])
  ].join("\n");
}

function eventResponse(events = []) {
  if (!events.length) return "I would tell the user that no matching live events were found and suggest broadening the filters.";
  return [
    "I would recommend these live Dizko events:",
    "",
    ...events.slice(0, 5).map((event) => `- ${eventLine(event)}`)
  ].join("\n");
}

function eventLine(event) {
  if (!event) return "No sample event";
  const title = event.title || "Untitled event";
  const when = event.start_time || event.starts_at || event.date || "time TBA";
  const url = event.event_url || event.url || event.source_url || "URL unavailable";
  const reason = event.reasons?.[0] || event.recommendation_reasons?.[0] || event.venue_name || "";
  return [title, when, url, reason].filter(Boolean).join(" | ");
}

function redactProfileId(profileId = "") {
  return profileId ? `${profileId.slice(0, 8)}...` : "[missing]";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
