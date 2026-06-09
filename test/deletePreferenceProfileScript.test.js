import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { callTool } from "../src/tools.js";

const execFileAsync = promisify(execFile);

test("delete-preference-profile script verifies secret before deleting", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-delete-profile-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    const created = await callTool("create_event_preference_profile", {
      consent: true,
      preferences: { genres: ["jazz"], vibe: ["intimate"] }
    }, { preferencesPath });
    const createdBody = JSON.parse(created.content[0].text);
    const profileId = createdBody.profile.profile_id;
    const profileSecret = createdBody.profile_secret;

    await assert.rejects(
      execFileAsync("node", [
        "./scripts/delete-preference-profile.mjs",
        "--profile-id", profileId,
        "--profile-secret", "wrong-secret",
        "--preferences-path", preferencesPath
      ]),
      (error) => {
        assert.equal(error.code, 2);
        assert.match(error.stdout, /invalid_profile_secret/);
        return true;
      }
    );

    const { stdout } = await execFileAsync("node", [
      "./scripts/delete-preference-profile.mjs",
      "--profile-id", profileId,
      "--profile-secret", profileSecret,
      "--preferences-path", preferencesPath
    ]);
    const deleted = JSON.parse(stdout);
    assert.equal(deleted.ok, true);
    assert.equal(deleted.deleted, true);

    const fetched = await callTool("get_event_preferences", {
      profile_id: profileId,
      profile_secret: profileSecret
    }, { preferencesPath });
    assert.equal(fetched.isError, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
