import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const fieldsPath = resolve(process.env.EVENTCHAT_SUBMISSION_FIELDS_PATH || "./submission-fields.json");
const evidencePath = resolve(process.env.EVENTCHAT_SUBMISSION_EVIDENCE_PATH || "./submission-evidence/latest.json");
const securityPolicyPath = resolve(process.env.EVENTCHAT_SECURITY_POLICY_PATH || "./SECURITY.md");
const submissionPacketPath = resolve(process.env.EVENTCHAT_SUBMISSION_PACKET_PATH || "./OPENAI_SUBMISSION_PACKET.md");
const submissionAuditPath = resolve(process.env.EVENTCHAT_SUBMISSION_AUDIT_PATH || "./SUBMISSION_AUDIT.md");

async function main() {
  const fields = JSON.parse(await readFile(fieldsPath, "utf8"));
  const evidence = JSON.parse(await readFile(evidencePath, "utf8"));

  assertNonEmpty(fields.app_name, "app_name");
  assertNonEmpty(fields.short_description, "short_description");
  assertNonEmpty(fields.long_description, "long_description");
  assert(fields.short_description.includes("UrbanPlayground"), "short_description must include UrbanPlayground brand alias");
  assert(fields.long_description.includes("UrbanPlayground"), "long_description must include UrbanPlayground brand alias");
  assertUrl(fields.mcp_endpoint, "mcp_endpoint");
  assertUrl(fields.company_url, "company_url");
  assertUrl(fields.privacy_policy_url, "privacy_policy_url");
  assertUrl(fields.support_url, "support_url");
  assertUrl(fields.terms_url, "terms_url");
  assertUrl(fields.user_guide_url, "user_guide_url");
  assertUrl(fields.logo_url, "logo_url");
  assertNonEmpty(fields.localization?.default_locale, "localization.default_locale");
  assertArray(fields.localization?.supported_locales, "localization.supported_locales", 1);
  assert(fields.localization.supported_locales.includes(fields.localization.default_locale), "localization.supported_locales must include default_locale");
  assertNonEmpty(fields.localization?.notes, "localization.notes");
  assert(fields.authentication?.type === "noauth", "authentication.type must be noauth for the public review endpoint");
  assertNonEmpty(fields.authentication?.notes, "authentication.notes");
  assert(fields.mcp_endpoint === evidence.endpoint, "mcp_endpoint must match latest evidence endpoint");
  assert(fields.company_url === evidence.company_url, "company_url must match latest evidence company_url");
  assert(evidence.checks?.company_url?.ok === true, "latest evidence must show company_url ok");
  assert(fields.privacy_policy_url === `${evidence.base_url}/privacy-policy.html`, "privacy_policy_url must match evidence base_url");
  assert(fields.support_url === `${evidence.base_url}/support.html`, "support_url must match evidence base_url");
  assert(fields.terms_url === `${evidence.base_url}/terms.html`, "terms_url must match evidence base_url");
  assert(evidence.checks?.public_pages?.terms?.ok === true, "latest evidence must show terms page ok");
  assert(fields.user_guide_url === `${evidence.base_url}/user-guide.html`, "user_guide_url must match evidence base_url");
  assert(evidence.checks?.public_pages?.user_guide?.ok === true, "latest evidence must show user guide page ok");
  assert(fields.logo_url === `${evidence.base_url}/logo-512.png`, "logo_url must match evidence base_url");
  assert(evidence.ok === true, "latest evidence must be ok");
  assert(evidence.checks?.tools?.count === 13, "latest evidence must show 13 tools");
  assert(evidence.deployment?.ok === true, "latest evidence must include current deployment metadata");
  assertNonEmpty(evidence.deployment?.id, "evidence.deployment.id");
  assertNonEmpty(evidence.deployment?.image_digest, "evidence.deployment.image_digest");
  assert(evidence.checks?.preference_memory?.note_feedback_learned === true, "latest evidence must show note-derived feedback learning");

  assertArray(fields.discovery_phrases, "discovery_phrases", 5);
  assertArray(fields.review_test_prompts, "review_test_prompts", 5);
  assertArray(fields.privacy_notes, "privacy_notes", 4);
  assertArray(fields.submission_checklist, "submission_checklist", 4);
  const checklistText = fields.submission_checklist.join(" ");
  assert(checklistText.includes("npm run preflight:submission"), "submission_checklist must include preflight command");
  assert(checklistText.includes("npm run submission:status"), "submission_checklist must include final status command");
  assert(checklistText.includes("ready_for_openai_dashboard_submission"), "submission_checklist must mention final ready flag");
  assertArray(fields.do_not_submit_urls, "do_not_submit_urls", 1);
  assert(fields.do_not_submit_urls.some((entry) => entry.url === "https://mcp.urbanplayground.xyz/mcp"), "do_not_submit_urls must include unresolved custom domain");
  assert(!fields.mcp_endpoint.includes("mcp.urbanplayground.xyz"), "mcp_endpoint must not use unresolved custom domain");

  const promptText = JSON.stringify(fields.review_test_prompts).toLowerCase();
  for (const phrase of ["consent", "follow-up", "delete", "event", "recommend"]) {
    assert(promptText.includes(phrase), `review_test_prompts must cover ${phrase}`);
  }
  const discoveryText = fields.discovery_phrases.join(" ").toLowerCase();
  assert(discoveryText.includes("urbanplayground"), "discovery_phrases must include UrbanPlayground brand alias");
  for (const phrase of ["liked/disliked", "rating", "notes"]) {
    assert(promptText.includes(phrase), `review_test_prompts must cover feedback signal ${phrase}`);
  }
  const privacyText = fields.privacy_notes.join(" ").toLowerCase();
  for (const phrase of ["opt-in", "profile_secret", "learned avoid", "delete", "gps", "chat transcripts", "24 months", "30 days"]) {
    assert(privacyText.includes(phrase), `privacy_notes must cover ${phrase}`);
  }
  const securityPolicy = await readFile(securityPolicyPath, "utf8");
  assert(securityPolicy.includes("security@urbanplayground.xyz"), "SECURITY.md must include security contact");
  assert(securityPolicy.includes("profile_secret"), "SECURITY.md must cover profile_secret scope");

  const submissionPacket = await readFile(submissionPacketPath, "utf8");
  assertPacketMatches(submissionPacket, fields, evidence);
  const submissionAudit = await readFile(submissionAuditPath, "utf8");
  assertAuditMatches(submissionAudit, fields, evidence);

  console.log(JSON.stringify({
    ok: true,
    fields_path: fieldsPath,
    evidence_path: evidencePath,
    security_policy_path: securityPolicyPath,
    submission_packet_path: submissionPacketPath,
    submission_audit_path: submissionAuditPath,
    app_name: fields.app_name,
    endpoint: fields.mcp_endpoint,
    review_test_prompts: fields.review_test_prompts.length
  }, null, 2));
}

function assertPacketMatches(packet, fields, evidence) {
  for (const value of [
    fields.app_name,
    fields.short_description,
    fields.long_description,
    fields.mcp_endpoint,
    fields.company_url,
    fields.privacy_policy_url,
    fields.support_url,
    fields.terms_url,
    fields.user_guide_url,
    fields.logo_url,
    fields.localization.default_locale,
    ...fields.localization.supported_locales,
    fields.localization.notes,
    fields.authentication.type,
    `${evidence.base_url}/.well-known/security.txt`,
    "submission-fields.json",
    "SUBMISSION_AUDIT.md",
    "submission-evidence/latest-summary.md",
    "submission-evidence/review-demo.md",
    "SCREENSHOT_CHECKLIST.md",
    "npm run review:demo",
    "npm run preflight:submission",
    "npm run submission:status"
  ]) {
    assert(packet.includes(value), `OPENAI_SUBMISSION_PACKET.md must include ${value}`);
  }

  for (const entry of fields.do_not_submit_urls || []) {
    assert(packet.includes(entry.url), `OPENAI_SUBMISSION_PACKET.md must warn against ${entry.url}`);
  }

  for (const phrase of [
    "MCP `initialize`",
    "MCP `notifications/initialized`",
    "private access-card behavior",
    "wrong-secret rejection",
    "feedback learning",
    "empty feedback",
    "preference deletion",
    "13 tool descriptors"
  ]) {
    assert(packet.includes(phrase), `OPENAI_SUBMISSION_PACKET.md must mention ${phrase}`);
  }

  const packetLower = packet.toLowerCase();
  for (const phrase of ["consent", "profile_secret", "only a hash", "delete_event_preferences", "confirm_delete", "learned avoid", "gps coordinates", "full chat transcripts", "24 months", "30 days"]) {
    assert(packetLower.includes(phrase), `OPENAI_SUBMISSION_PACKET.md privacy section must cover ${phrase}`);
  }

  for (const phrase of ["securitySchemes", "_meta.securitySchemes", "noauth"]) {
    assert(packet.includes(phrase), `OPENAI_SUBMISSION_PACKET.md auth section must cover ${phrase}`);
  }
  for (const phrase of ["openai/toolInvocation/invoking", "openai/toolInvocation/invoked"]) {
    assert(packet.includes(phrase), `OPENAI_SUBMISSION_PACKET.md metadata section must cover ${phrase}`);
  }

  for (const phrase of ["basic event search is public", "personalized recommendation", "profile_id", "profile_secret"]) {
    assert(packetLower.includes(phrase), `OPENAI_SUBMISSION_PACKET.md auth section must cover ${phrase}`);
  }
}

function assertAuditMatches(audit, fields, evidence) {
  for (const value of [
    fields.mcp_endpoint,
    "get_preference_onboarding",
    "create_event_preference_profile",
    "save_event_preferences",
    "record_event_feedback",
    "get_event_feedback_prompt",
    "delete_event_preferences",
    "Server-level MCP instructions",
    "Retention timelines",
    "automatically prunes inactive profiles",
    "Terms and acceptable use",
    "Public user guide",
    "Tool invocation status metadata",
    "Localization",
    "liked/disliked, rating, or notes",
    "confirm_delete",
    "npm run review:demo",
    "securitySchemes",
    "_meta.securitySchemes",
    "npm run preflight:submission",
    "npm run submission:status",
    "npm run monitor:live",
    "npm pack --dry-run --json"
  ]) {
    assert(audit.includes(value), `SUBMISSION_AUDIT.md must include ${value}`);
  }

  assert(audit.includes(`${evidence.base_url}/mcp`), "SUBMISSION_AUDIT.md must match latest evidence base_url");
  const auditLower = audit.toLowerCase();
  for (const phrase of ["gps coordinates", "street addresses", "full chat transcripts", "external gates", "chatgpt developer mode", "read-only"]) {
    assert(auditLower.includes(phrase), `SUBMISSION_AUDIT.md must cover ${phrase}`);
  }
}

function assertNonEmpty(value, name) {
  assert(typeof value === "string" && value.trim().length > 0, `${name} must be a non-empty string`);
}

function assertArray(value, name, minimumLength) {
  assert(Array.isArray(value), `${name} must be an array`);
  assert(value.length >= minimumLength, `${name} must contain at least ${minimumLength} items`);
}

function assertUrl(value, name) {
  assertNonEmpty(value, name);
  const url = new URL(value);
  assert(url.protocol === "https:", `${name} must use https`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
