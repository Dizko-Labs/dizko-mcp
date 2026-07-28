import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

const evidencePath = new URL("../submission-evidence/latest.json", import.meta.url);
const requiredExternalGates = [
  "Add the hosted MCP endpoint in ChatGPT Developer Mode.",
  "Run the review prompts in ChatGPT web and mobile.",
  "Capture screenshots from the actual ChatGPT UI.",
  "Complete OpenAI individual or business publisher verification if required.",
  "Submit from the OpenAI Platform Dashboard with an account that has app write access."
];

async function main() {
  const [evidence, monitor, fieldValidation, domain] = await Promise.all([
    readLatestEvidence(),
    runJsonCommand("node", ["./scripts/monitor-live.mjs"]),
    runJsonCommand("node", ["./scripts/validate-submission-fields.mjs"]),
    runJsonCommand("node", ["./scripts/check-custom-domain.mjs"], { allowFailure: true })
  ]);

  const latestEvidenceOk = evidence.ok === true && evidence.body?.ok === true;
  const monitorOk = monitor.ok === true && monitor.body?.ok === true;
  const fieldValidationOk = fieldValidation.ok === true && fieldValidation.body?.ok === true;
  const hostedEndpoint = evidence.body?.endpoint || process.env.EVENTCHAT_MCP_URL || "https://mcp.dizko.app/mcp";
  const brandedDomainReady = domain.ok === true && domain.body?.ok === true;

  const readyForOpenAiSubmission =
    latestEvidenceOk &&
    monitorOk &&
    fieldValidationOk &&
    hostedEndpoint.includes("mcp.dizko.app/mcp");

  const result = {
    ok: readyForOpenAiSubmission,
    checked_at: new Date().toISOString(),
    ready_for_openai_dashboard_submission: readyForOpenAiSubmission,
    submit_endpoint: hostedEndpoint,
    do_not_submit_endpoint: brandedDomainReady ? null : domain.body?.endpoint || "https://mcp.urbanplayground.xyz/mcp",
    code_readiness: {
      latest_evidence: statusFrom(latestEvidenceOk, evidence),
      live_monitor: statusFrom(monitorOk, monitor),
      dashboard_fields: statusFrom(fieldValidationOk, fieldValidation),
      branded_domain: {
        ok: brandedDomainReady,
        note: brandedDomainReady
          ? "Custom domain is ready, but confirm docs before switching review traffic."
          : "Custom domain is not ready; use the hosted endpoint for review.",
        details: domain.body || domain.error
      }
    },
    latest_verified_deployment: evidence.body?.deployment || null,
    external_gates_remaining: requiredExternalGates,
    next_step: readyForOpenAiSubmission
      ? "Use OPENAI_SUBMISSION_PACKET.md and submit the hosted endpoint after completing the external gates."
      : "Run npm run preflight:submission, fix failed checks, then rerun npm run submission:status."
  };

  console.log(JSON.stringify(result, null, 2));
  if (!readyForOpenAiSubmission) process.exitCode = 1;
}

async function readLatestEvidence() {
  try {
    const raw = await readFile(evidencePath, "utf8");
    return { ok: true, body: JSON.parse(raw) };
  } catch (error) {
    return { ok: false, error: `Could not read latest evidence: ${error.message}` };
  }
}

async function runJsonCommand(command, args, options = {}) {
  const result = await runCommand(command, args);
  const body = parseLastJson(result.stdout);
  const ok = result.status === 0 || options.allowFailure === true;
  return {
    ok: ok && body !== null,
    command: [command, ...args].join(" "),
    status: result.status,
    body,
    error: body === null ? result.stderr || result.stdout || "Command did not print JSON." : undefined
  };
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: new URL("..", import.meta.url),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function parseLastJson(text) {
  const start = text.lastIndexOf("\n{");
  const jsonText = start >= 0 ? text.slice(start + 1).trim() : text.trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

function statusFrom(ok, commandResult) {
  return {
    ok,
    status: commandResult.status ?? null,
    details: commandResult.body || commandResult.error || null
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
