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
    `- Tool metadata: ${pass(tools.ok)} (${tools.count || 0} tools, ${(tools.output_schema_tools || []).length} with outputSchema)`,
    `- Prompts: ${pass(checks.prompts?.ok)} (${(checks.prompts?.names || []).join(", ") || "none"})`,
    `- Rate-limit headers: ${pass(checks.rate_limit_headers?.ok)} (limit ${rateLimit.x_ratelimit_limit || "unknown"})`,
    `- City coverage: ${pass(checks.cities?.ok)} (${checks.cities?.count || 0} cities, ${checks.cities?.live_count || 0} live)`,
    `- Search follow-ups prompt: ${pass(checks.search_followups?.ok)} (${checks.search_followups?.question_count || 0} questions)`,
    `- Live search: ${pass(checks.live_search?.ok)} (${checks.live_search?.sample_event?.title || "no sample"}${checks.live_search?.sample_event?.when ? `, ${checks.live_search.sample_event.when}` : ""})`,
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
    "3. Who is Nina Kraviz and when does she play next?",
    "4. Ask what kind of events I generally like, save my preferences after I consent, ask what type/vibe I want this weekend, and recommend events.",
    "5. Ask me a follow-up about whether I liked a returned event, record my answer, and explain how future recommendations changed.",
    "6. Delete my Dizko saved event preferences and feedback history.",
    "",
    "## Expected Behavior",
    "",
    "- A prompt that names a city and a timeframe is one `dizko_search_events` call; events render with local `when`, Dizko event URLs and ticket/source links when available.",
    "- Broad prompts get one or two clarifying questions asked conversationally (the optional `dizko_search_followups` prompt lists them), then one search call.",
    "- Artist prompts use `dizko_find_artist` and `dizko_artist_events`.",
    "- Preference creation requires explicit consent (`dizko_onboarding`, then `dizko_create_profile`) and returns an opaque `dzk_` profile id plus one-time `dzs_` profile secret in a private access card.",
    "- Later preference reads include reuse/deletion instructions but do not echo the profile secret back.",
    "- Personalized calls pass `profile_id` and `profile_secret` to `dizko_search_events`; saved preferences, learned positive signals, and learned avoid signals rank results and never hide them.",
    "- Post-event learning asks the `dizko_post_event_feedback` questions before `dizko_record_feedback`; feedback recording requires liked, rating, or notes.",
    "- Deletion calls `dizko_delete_profile` only after explicit confirmation and is scoped to Dizko connector preferences.",
    "",
    "## Remaining External Gates",
    "",
    "- Add the MCP endpoint in ChatGPT Developer Mode.",
    "- Run the review prompts on ChatGPT web and mobile and capture screenshots.",
    "- Complete individual or business verification in the OpenAI Platform Dashboard if needed.",
    `- Submit through the OpenAI dashboard using the hosted MCP endpoint ${evidence.endpoint}.`,
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
