import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const evidencePath = resolve(process.env.EVENTCHAT_SUBMISSION_EVIDENCE_PATH || "./submission-evidence/latest.json");
const summaryPath = resolve(process.env.EVENTCHAT_SUBMISSION_SUMMARY_PATH || "./submission-evidence/latest-summary.md");

async function main() {
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
  const checks = evidence.checks || {};
  const publicPages = checks.public_pages || {};
  const tools = checks.tools || {};
  const rateLimit = checks.rate_limit_headers?.headers || {};
  const preferenceMemory = checks.preference_memory || {};
  const deployment = evidence.deployment || {};

  const body = [
    "# Dizko Events MCP Submission Evidence",
    "",
    `Generated: ${evidence.checked_at}`,
    `Endpoint: ${evidence.endpoint}`,
    `Base URL: ${evidence.base_url}`,
    `Overall status: ${evidence.ok ? "PASS" : "FAIL"}`,
    `Deployment: ${deployment.id || "unknown"}${deployment.status ? ` (${deployment.status})` : ""}`,
    `Image digest: ${deployment.image_digest || "unknown"}`,
    "",
    "## Public URLs",
    "",
    `- MCP: ${evidence.endpoint}`,
    `- Health: ${evidence.base_url}/health`,
    `- Privacy: ${evidence.base_url}/privacy-policy.html`,
    `- Support: ${evidence.base_url}/support.html`,
    `- Terms: ${evidence.base_url}/terms.html`,
    `- User guide: ${evidence.base_url}/user-guide.html`,
    `- Company: ${evidence.company_url || "unknown"}`,
    `- Logo: ${evidence.base_url}/logo-512.png`,
    "",
    "## Automated Checks",
    "",
    `- Health endpoint: ${pass(checks.health?.ok)} (${checks.health?.status || "unknown"})`,
    `- Metadata endpoint: ${pass(checks.metadata?.ok)} (${checks.metadata?.status || "unknown"})`,
    `- MCP server/discover: ${pass(checks.discover?.ok)} (${(checks.discover?.supported_versions || []).join(", ") || "unknown"})`,
    `- MCP initialize (2025-era fallback): ${pass(checks.initialize?.ok)} (${checks.initialize?.server_info?.name || "unknown"})`,
    `- MCP initialized notification: ${pass(checks.initialized_notification?.ok)} (${checks.initialized_notification?.status || "unknown"})`,
    `- Privacy page: ${pass(publicPages.privacy?.ok)} (${publicPages.privacy?.status || "unknown"})`,
    `- Support page: ${pass(publicPages.support?.ok)} (${publicPages.support?.status || "unknown"})`,
    `- Terms page: ${pass(publicPages.terms?.ok)} (${publicPages.terms?.status || "unknown"})`,
    `- User guide: ${pass(publicPages.user_guide?.ok)} (${publicPages.user_guide?.status || "unknown"})`,
    `- Company URL: ${pass(checks.company_url?.ok)} (${checks.company_url?.status || "unknown"})`,
    `- Logo asset: ${pass(publicPages.logo?.ok)} (${publicPages.logo?.status || "unknown"}, ${publicPages.logo?.bytes || 0} bytes)`,
    `- Tool metadata: ${pass(tools.ok)} (${tools.count || 0} tools)`,
    `- Rate-limit headers: ${pass(checks.rate_limit_headers?.ok)} (limit ${rateLimit.x_ratelimit_limit || "unknown"})`,
    `- Search follow-ups: ${pass(checks.search_followups?.ok)} (${checks.search_followups?.question_count || 0} questions)`,
    `- Live search: ${pass(checks.live_search?.ok)} (${checks.live_search?.sample_event?.title || "no sample"})`,
    `- Feedback prompt: ${pass(checks.feedback_prompt?.ok)} (${checks.feedback_prompt?.question_count || 0} questions)`,
    `- Preference memory: ${pass(preferenceMemory.ok)} (access card: ${Boolean(preferenceMemory.access_card_returned_on_create)}, wrong secret rejected: ${Boolean(preferenceMemory.wrong_secret_rejected)}, empty feedback rejected: ${Boolean(preferenceMemory.empty_feedback_rejected)}, note learning: ${Boolean(preferenceMemory.note_feedback_learned)}, unconfirmed delete rejected: ${Boolean(preferenceMemory.unconfirmed_delete_rejected)}, feedback recorded: ${Boolean(preferenceMemory.feedback_recorded)}, deleted: ${Boolean(preferenceMemory.deleted)})`,
    "",
    "## Tools",
    "",
    ...(tools.names || []).map((name) => `- ${name}${tools.titles?.[name] ? `: ${tools.titles[name]}` : ""}`),
    "",
    "## Review Test Prompts",
    "",
    "Use these in ChatGPT Developer Mode on web and mobile and capture screenshots for submission.",
    "",
    "1. Find five techno events in Berlin this weekend.",
    "2. Find something good tonight in Berlin, but ask me what kind of event and vibe first.",
    "3. Ask what kind of events I generally like, save my preferences after I consent, ask what type/vibe I want this weekend, and recommend events.",
    "4. Ask me a follow-up about whether I liked a returned event, record my answer, and explain how future recommendations changed.",
    "5. Delete my Dizko saved event preferences and feedback history.",
    "",
    "## Expected Behavior",
    "",
    "- Direct event prompts return live Dizko events with event URLs and ticket/source links when available.",
    "- Current-context prompts call `get_event_search_followups` before searching when event type, vibe, budget, area, or avoidances are missing.",
    "- Preference creation requires explicit consent and returns an opaque profile id plus one-time profile secret in a private access card.",
    "- Later preference reads include reuse/deletion instructions but do not echo the profile secret back.",
    "- Personalized recommendations use saved preferences, learned positive signals, and learned avoid signals from negative feedback.",
    "- Post-event learning calls `get_event_feedback_prompt` before `record_event_feedback`; feedback recording requires liked, rating, or notes.",
    "- Deletion calls `delete_event_preferences` only after explicit confirmation and is scoped to Dizko connector preferences.",
    "",
    "## Remaining External Gates",
    "",
    "- Add the MCP endpoint in ChatGPT Developer Mode.",
    "- Run the review prompts on ChatGPT web and mobile and capture screenshots.",
    "- Complete individual or business verification in the OpenAI Platform Dashboard if needed.",
    "- Submit through the OpenAI dashboard using the hosted MCP endpoint, not the unresolved custom domain.",
    ""
  ].join("\n");

  await mkdir(dirname(summaryPath), { recursive: true });
  await writeFile(summaryPath, body);
  console.log(JSON.stringify({
    ok: true,
    evidence_path: evidencePath,
    summary_path: summaryPath,
    tools: tools.count || 0
  }, null, 2));
}

function pass(value) {
  return value ? "PASS" : "FAIL";
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
