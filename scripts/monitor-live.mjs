import { resolveMcpEndpoint, runMonitorChecks } from "../src/liveChecks.js";

const endpoint = resolveMcpEndpoint();
const timeoutMs = Number(process.env.EVENTCHAT_MONITOR_TIMEOUT_MS || 10000);
const expectedToolCount = process.env.EVENTCHAT_MONITOR_TOOL_COUNT
  ? Number(process.env.EVENTCHAT_MONITOR_TOOL_COUNT)
  : undefined; // defaults to the package's real tool registry size
const city = process.env.EVENTCHAT_MONITOR_CITY || "berlin";

async function main() {
  const startedAt = Date.now();
  const result = await runMonitorChecks({ endpoint, timeoutMs, expectedToolCount, city });

  console.log(JSON.stringify({
    ok: result.ok,
    checked_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    endpoint: result.endpoint,
    checks: result.checks
  }, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    endpoint,
    error: error.message,
    classification: error.classification || "unknown",
    code: error.code || null,
    hostname: error.hostname || null,
    url: error.url || null,
    cause: error.cause?.message || error.cause || null
  }, null, 2));
  process.exitCode = 1;
});
