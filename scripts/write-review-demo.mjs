import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const endpoint = process.env.DIZKO_MCP_URL || process.env.EVENTCHAT_MCP_URL || "https://mcp.dizko.app/mcp";
const outputPath = resolve(process.env.EVENTCHAT_REVIEW_DEMO_PATH || "./submission-evidence/review-demo.md");

async function main() {
  const generatedAt = new Date().toISOString();
  const steps = [];

  const search = await callTool("dizko_search_events", {
    city: "berlin",
    when: "weekend",
    genres: ["techno"],
    limit: 5
  });
  steps.push({
    prompt: "Find five techno events in Berlin this weekend.",
    tools: ["dizko_search_events"],
    evidence: [
      `Returned ${search.events?.length || 0} of ${search.count ?? "?"} live events (local times, ${search.timezone || "timezone unknown"}).`,
      `Sample: ${eventLine(search.events?.[0])}`
    ],
    response: eventResponse(search.events)
  });

  const followups = await getPrompt("dizko_search_followups", { city: "berlin", when: "tonight" });
  steps.push({
    prompt: "Find something good tonight in Berlin, but ask me what kind of event and vibe first.",
    tools: ["prompt dizko_search_followups", "dizko_search_events"],
    evidence: [
      `Prompt guidance: ${followups.description}`,
      `Questions: ${followups.questions.join(" | ")}`
    ],
    response: `Before I search, I would ask: ${followups.questions.slice(0, 2).join(" ")} Then I would make one dizko_search_events call.`
  });

  const onboarding = await getPrompt("dizko_onboarding", {});
  const created = await callTool("dizko_create_profile", {
    consent: true,
    preferences: {
      event_types: ["party", "concert"],
      genres: ["techno", "ambient"],
      vibe: ["underground", "intimate"],
      avoid: ["mainstream", "huge crowds"],
      max_price: 40
    }
  });
  const profileId = created.profile_id;
  const profileSecret = created.profile_secret;
  const personalized = await callTool("dizko_search_events", {
    profile_id: profileId,
    profile_secret: profileSecret,
    city: "berlin",
    when: "weekend",
    event_types: ["party"],
    vibe: ["underground"],
    limit: 3
  });
  steps.push({
    prompt: "Ask what kind of events I generally like, save my preferences after I consent, ask what type/vibe I want this weekend, and recommend events.",
    tools: ["prompt dizko_onboarding", "dizko_create_profile", "dizko_search_events"],
    evidence: [
      `Onboarding questions: ${onboarding.questions.slice(0, 3).join(" | ")}`,
      `Created profile: ${redactProfileId(profileId)}`,
      "Profile secret: [REDACTED]",
      `Personalized results: ${personalized.events?.length || 0} (rank: ${personalized.rank || "unknown"}; saved taste ranks, it never filters)`
    ],
    response: eventResponse(personalized.events)
  });

  const feedbackEvent = personalized.events?.[0] || search.events?.[0];
  const feedbackPrompt = await getPrompt("dizko_post_event_feedback", { event_id: feedbackEvent.id });
  const feedback = await callTool("dizko_record_feedback", {
    profile_id: profileId,
    profile_secret: profileSecret,
    event_id: feedbackEvent.id,
    liked: false,
    rating: 2,
    notes: "Liked the music, but it was too crowded.",
    attended_at: "2026-06-09"
  });
  steps.push({
    prompt: "Ask me a follow-up about whether I liked a returned event, record my answer, and explain how future recommendations changed.",
    tools: ["prompt dizko_post_event_feedback", "dizko_record_feedback"],
    evidence: [
      `Feedback questions: ${feedbackPrompt.questions.join(" | ")}`,
      `Feedback count: ${feedback.profile?.feedback_count}`,
      `Learned avoid signals: ${JSON.stringify(feedback.profile?.learned_preferences?.avoid || [])}`
    ],
    response: "I would explain that future recommendations will still favor matching music, but will rank down that venue and promoter and anything that looks crowded, based on this feedback."
  });

  const deleted = await callTool("dizko_delete_profile", {
    profile_id: profileId,
    profile_secret: profileSecret,
    confirm_delete: true
  });
  steps.push({
    prompt: "Delete my Dizko saved event preferences and feedback history.",
    tools: ["dizko_delete_profile"],
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

// prompts/get returns a description plus one text message whose numbered
// lines are the questions to ask.
async function getPrompt(name, args) {
  const result = await callRpc("prompts/get", { name, arguments: args });
  const message = (result.messages || []).find((entry) => entry?.content?.type === "text");
  if (!message) throw new Error(`${name} prompt returned no text message`);
  return {
    description: result.description || "",
    questions: message.content.text
      .split("\n")
      .filter((line) => /^\d+\.\s/.test(line))
      .map((line) => line.replace(/^\d+\.\s/, ""))
  };
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
      ...(["tools/call", "prompts/get"].includes(method) && params?.name ? { "Mcp-Name": params.name } : {})
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
  const when = event.when || event.starts_at_local || "time TBA";
  const url = event.event_url || "URL unavailable";
  const extra = event.recommendation_reasons?.[0] || event.venue || "";
  return [title, when, url, extra].filter(Boolean).join(" | ");
}

function redactProfileId(profileId = "") {
  return profileId ? `${profileId.slice(0, 8)}...` : "[missing]";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
