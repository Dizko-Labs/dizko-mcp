import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const setup = join(root, "test", "setup.mjs");

// CI runs the whole suite from several real timezones to catch fixtures that
// quietly assume local time is UTC. That matrix is only worth its runtime if
// the harness actually lets the exported TZ through: an unconditional
// `process.env.TZ = "UTC"` in setup.mjs would make every one of those jobs a
// green no-op, which is worse than not having them.
function resolveTimezone(env) {
  const output = execFileSync(process.execPath, [
    "--import", setup,
    "-e", 'process.stdout.write(JSON.stringify({ tz: process.env.TZ, offset: new Date("2026-09-08T12:00:00Z").getTimezoneOffset() }))'
  ], { env: { ...process.env, ...env }, encoding: "utf8" });
  return JSON.parse(output);
}

test("the test harness pins UTC only when no timezone is exported", () => {
  const withoutTz = { ...process.env };
  delete withoutTz.TZ;
  const pinned = execFileSync(process.execPath, [
    "--import", setup,
    "-e", 'process.stdout.write(JSON.stringify({ tz: process.env.TZ, offset: new Date("2026-09-08T12:00:00Z").getTimezoneOffset() }))'
  ], { env: { ...withoutTz }, encoding: "utf8" });

  assert.deepEqual(JSON.parse(pinned), { tz: "UTC", offset: 0 });
});

test("an exported timezone survives the harness so the CI matrix is real", () => {
  // A half-hour offset and a +14 zone: if either came back as UTC, the
  // timezone jobs in .github/workflows/ci.yml would be testing nothing.
  assert.deepEqual(resolveTimezone({ TZ: "Asia/Kolkata" }), { tz: "Asia/Kolkata", offset: -330 });
  assert.deepEqual(resolveTimezone({ TZ: "Pacific/Kiritimati" }), { tz: "Pacific/Kiritimati", offset: -840 });
});
