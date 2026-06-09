import { FilePreferenceStore, verifyProfileSecret } from "../src/preferences.js";

const args = parseArgs(process.argv.slice(2));

async function main() {
  const profileId = args.profile_id || process.env.EVENTCHAT_PROFILE_ID;
  const profileSecret = args.profile_secret || process.env.EVENTCHAT_PROFILE_SECRET;
  const preferencesPath = args.preferences_path || process.env.EVENTCHAT_PREFERENCES_PATH;

  if (!profileId || !profileSecret) {
    throw new Error("Usage: npm run preferences:delete -- --profile-id upg_... --profile-secret ups_... [--preferences-path /data/preferences.json]");
  }

  const store = new FilePreferenceStore(preferencesPath);
  const profile = await store.getProfile(profileId);
  if (!profile) {
    console.log(JSON.stringify({
      ok: true,
      deleted: false,
      profile_id: profileId,
      reason: "not_found"
    }, null, 2));
    return;
  }

  if (!verifyProfileSecret(profile, profileSecret)) {
    console.log(JSON.stringify({
      ok: false,
      deleted: false,
      profile_id: profileId,
      reason: "invalid_profile_secret"
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const result = await store.deleteProfile(profileId);
  console.log(JSON.stringify({
    ok: true,
    profile_id: profileId,
    deleted: result.deleted
  }, null, 2));
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--profile-id") parsed.profile_id = argv[++index];
    else if (value === "--profile-secret") parsed.profile_secret = argv[++index];
    else if (value === "--preferences-path") parsed.preferences_path = argv[++index];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message
  }, null, 2));
  process.exitCode = 1;
});
