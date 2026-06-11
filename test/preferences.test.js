import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { FilePreferenceStore } from "../src/preferences.js";
import { callTool } from "../src/tools.js";
import { clearEventCache } from "../src/api.js";

beforeEach(() => clearEventCache());

test("preference tools require consent and persist saved preferences", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-prefs-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    const denied = await callTool("save_event_preferences", {
      profile_id: "user-1",
      consent: false,
      preferences: { genres: ["techno"] }
    }, { preferencesPath });
    assert.equal(denied.isError, true);

    const saved = await callTool("save_event_preferences", {
      profile_id: "user-1",
      consent: true,
      preferences: {
        genres: ["techno"],
        vibe: ["underground"],
        avoid: ["mainstream"],
        max_price: 30
      }
    }, { preferencesPath });
    assert.equal(saved.isError, true);

    const created = await callTool("create_event_preference_profile", {
      consent: true,
      preferences: { genres: ["techno"] }
    }, { preferencesPath });
    const createdBody = JSON.parse(created.content[0].text);

    const updated = await callTool("save_event_preferences", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      consent: true,
      preferences: {
        genres: ["techno"],
        vibe: ["underground"],
        avoid: ["mainstream"],
        max_price: 30
      }
    }, { preferencesPath });
    const updatedBody = JSON.parse(updated.content[0].text);
    assert.equal(updatedBody.saved, true);
    assert.deepEqual(updatedBody.profile.preferences.genres, ["techno"]);

    const fetched = await callTool("get_event_preferences", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret
    }, { preferencesPath });
    const fetchedBody = JSON.parse(fetched.content[0].text);
    assert.equal(fetchedBody.profile.feedback_count, 0);
    assert.deepEqual(fetchedBody.profile.preferences.vibe, ["underground"]);

    const blocked = await callTool("get_event_preferences", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: "wrong-secret"
    }, { preferencesPath });
    assert.equal(blocked.isError, true);

    const unconfirmedDelete = await callTool("delete_event_preferences", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret
    }, { preferencesPath });
    assert.equal(unconfirmedDelete.isError, true);
    assert.match(JSON.parse(unconfirmedDelete.content[0].text).assistant_instruction, /confirm/);

    const deleted = await callTool("delete_event_preferences", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      confirm_delete: true
    }, { preferencesPath });
    assert.equal(JSON.parse(deleted.content[0].text).deleted, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("create_event_preference_profile returns an opaque usable profile id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-prefs-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    const created = await callTool("create_event_preference_profile", {
      consent: true,
      preferences: {
        genres: ["jazz"],
        vibe: ["intimate"]
      }
    }, { preferencesPath });
    const createdBody = JSON.parse(created.content[0].text);

    assert.equal(createdBody.created, true);
    assert.match(createdBody.profile.profile_id, /^upg_[0-9a-f-]{36}$/);
    assert.match(createdBody.profile_secret, /^ups_[A-Za-z0-9_-]+$/);
    assert.equal(createdBody.access_instructions.profile_id, createdBody.profile.profile_id);
    assert.equal(createdBody.access_instructions.profile_secret, createdBody.profile_secret);
    assert.equal(createdBody.access_instructions.profile_secret_returned_now, true);
    assert.equal(createdBody.access_instructions.keep_private, true);
    assert.match(createdBody.access_instructions.reuse_instruction, /keep both profile_id and profile_secret/);
    assert.equal(createdBody.profile.profile_secret_hash, undefined);
    assert.deepEqual(createdBody.profile.preferences.genres, ["jazz"]);

    const fetched = await callTool("get_event_preferences", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret
    }, { preferencesPath });
    const fetchedBody = JSON.parse(fetched.content[0].text);
    assert.deepEqual(fetchedBody.profile.preferences.vibe, ["intimate"]);
    assert.equal(fetchedBody.access_instructions.profile_id, createdBody.profile.profile_id);
    assert.equal(fetchedBody.access_instructions.profile_secret, null);
    assert.equal(fetchedBody.access_instructions.profile_secret_returned_now, false);
    assert.match(fetchedBody.access_instructions.reuse_instruction, /cannot reveal it later/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("feedback updates learned preferences used by user recommendations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-prefs-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    const created = await callTool("create_event_preference_profile", {
      consent: true,
      preferences: { genres: ["house"] }
    }, { preferencesPath });
    const createdBody = JSON.parse(created.content[0].text);

    await callTool("record_event_feedback", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      event_id: "event-1",
      liked: true,
      rating: 5
    }, {
      preferencesPath,
      fetch: async () => Response.json({
        id: "event-1",
        title: "Basement Night",
        genres: ["techno"],
        vibe: ["warehouse"],
        event_types: ["party"],
        lineup: [],
        venue_name: "RSO.BERLIN"
      })
    });

    const fetched = await callTool("get_event_preferences", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret
    }, { preferencesPath });
    const fetchedBody = JSON.parse(fetched.content[0].text);
    assert.deepEqual(fetchedBody.profile.learned_preferences.genres, ["techno"]);
    assert.deepEqual(fetchedBody.profile.learned_preferences.vibe, ["warehouse"]);

    const recommended = await callTool("recommend_events_for_user", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      city: "berlin",
      when: "week",
      result_limit: 1
    }, {
      preferencesPath,
      fetch: async () => Response.json({
        count: 1,
        events: [{
          id: "event-2",
          title: "Warehouse Return",
          start_time: "2026-06-10T22:00:00Z",
          genres: ["techno"],
          vibe: ["warehouse"],
          event_types: ["party"],
          lineup: [],
          venue_name: "RSO.BERLIN"
        }]
      })
    });
    const recommendedBody = JSON.parse(recommended.content[0].text);
    assert.equal(recommendedBody.events[0].id, "event-2");
    assert.equal(recommendedBody.personalization.source, "saved_and_learned_preferences");
    assert.deepEqual(recommendedBody.personalization.learned_preferences.genres, ["techno"]);
    assert.deepEqual(recommendedBody.personalization.applied_preferences.vibe, ["warehouse"]);
    assert.ok(recommendedBody.events[0].recommendation_reasons.some((reason) => reason.includes("genre match")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("feedback requires a real learning signal before writing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-prefs-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    const created = await callTool("create_event_preference_profile", {
      consent: true,
      preferences: { genres: ["house"] }
    }, { preferencesPath });
    const createdBody = JSON.parse(created.content[0].text);
    let fetchCalled = false;

    const rejected = await callTool("record_event_feedback", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      event_id: "event-1"
    }, {
      preferencesPath,
      fetch: async () => {
        fetchCalled = true;
        return Response.json({ id: "event-1", title: "Should Not Fetch" });
      }
    });

    const rejectedBody = JSON.parse(rejected.content[0].text);
    assert.equal(rejected.isError, true);
    assert.equal(rejectedBody.saved, false);
    assert.match(rejectedBody.error, /feedback signal/);
    assert.equal(fetchCalled, false);

    const fetched = await callTool("get_event_preferences", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret
    }, { preferencesPath });
    const fetchedBody = JSON.parse(fetched.content[0].text);
    assert.equal(fetchedBody.profile.feedback_count, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("feedback notes create learned preference and avoid signals", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-prefs-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    const created = await callTool("create_event_preference_profile", {
      consent: true,
      preferences: { event_types: ["club night"] }
    }, { preferencesPath });
    const createdBody = JSON.parse(created.content[0].text);

    await callTool("record_event_feedback", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      event_id: "event-1",
      notes: "I liked the music but not the crowd, and it was too expensive."
    }, {
      preferencesPath,
      fetch: async () => Response.json({
        id: "event-1",
        title: "Basement Night",
        genres: ["techno"],
        vibe: ["warehouse"],
        event_types: ["party"],
        lineup: [],
        venue_name: "RSO.BERLIN"
      })
    });

    const fetched = await callTool("get_event_preferences", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret
    }, { preferencesPath });
    const fetchedBody = JSON.parse(fetched.content[0].text);
    assert.deepEqual(fetchedBody.profile.learned_preferences.genres, ["techno"]);
    assert.ok(fetchedBody.profile.learned_preferences.avoid.includes("crowded"));
    assert.ok(fetchedBody.profile.learned_preferences.avoid.includes("expensive tickets"));

    const recommended = await callTool("recommend_events_for_user", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      city: "berlin",
      when: "week",
      result_limit: 1
    }, {
      preferencesPath,
      fetch: async () => Response.json({
        count: 1,
        events: [{
          id: "event-2",
          title: "Warehouse Return",
          start_time: "2026-06-10T22:00:00Z",
          genres: ["techno"],
          vibe: ["crowded"],
          event_types: ["party"],
          lineup: [],
          venue_name: "RSO.BERLIN"
        }]
      })
    });
    const recommendedBody = JSON.parse(recommended.content[0].text);
    assert.ok(recommendedBody.personalization.applied_preferences.avoid.includes("crowded"));
    assert.ok(recommendedBody.events[0].recommendation_reasons.some((reason) => reason.includes("penalized: crowded")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("negative feedback becomes learned avoid signals for future recommendations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-prefs-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    const created = await callTool("create_event_preference_profile", {
      consent: true,
      preferences: { genres: ["house"] }
    }, { preferencesPath });
    const createdBody = JSON.parse(created.content[0].text);

    await callTool("record_event_feedback", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      event_id: "event-1",
      liked: false,
      rating: 1
    }, {
      preferencesPath,
      fetch: async () => Response.json({
        id: "event-1",
        title: "Mainstream Club Night",
        genres: ["edm"],
        vibe: ["mainstream"],
        event_types: ["club"],
        lineup: [],
        venue_name: "Big Room"
      })
    });

    const fetched = await callTool("get_event_preferences", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret
    }, { preferencesPath });
    const fetchedBody = JSON.parse(fetched.content[0].text);
    assert.ok(fetchedBody.profile.learned_preferences.avoid.includes("edm"));
    assert.ok(fetchedBody.profile.learned_preferences.avoid.includes("mainstream"));

    const recommended = await callTool("recommend_events_for_user", {
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      city: "berlin",
      when: "week",
      result_limit: 1
    }, {
      preferencesPath,
      fetch: async () => Response.json({
        count: 1,
        events: [{
          id: "event-2",
          title: "Mainstream Club Return",
          start_time: "2026-06-10T22:00:00Z",
          genres: ["edm"],
          vibe: ["mainstream"],
          event_types: ["club"],
          lineup: [],
          venue_name: "Big Room"
        }]
      })
    });
    const recommendedBody = JSON.parse(recommended.content[0].text);
    assert.ok(recommendedBody.personalization.applied_preferences.avoid.includes("mainstream"));
    assert.ok(recommendedBody.events[0].recommendation_reasons.some((reason) => reason.includes("penalized: mainstream")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("concurrent preference writes preserve profiles in the file store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-prefs-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    const created = await Promise.all(Array.from({ length: 12 }, (_, index) => callTool("create_event_preference_profile", {
      consent: true,
      preferences: {
        genres: [`genre-${index}`],
        vibe: ["underground"]
      }
    }, { preferencesPath })));
    const profiles = created.map((result) => JSON.parse(result.content[0].text).profile.profile_id);
    assert.equal(new Set(profiles).size, 12);

    const data = JSON.parse(await readFile(preferencesPath, "utf8"));
    for (const profileId of profiles) {
      assert.ok(data.users[profileId], `Missing concurrently-created profile ${profileId}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inactive preference profiles are pruned after the retention window", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-prefs-"));
  const preferencesPath = join(dir, "preferences.json");
  const oldDate = new Date(Date.now() - 731 * 24 * 60 * 60 * 1000).toISOString();
  const recentDate = new Date().toISOString();

  try {
    await writeFile(preferencesPath, JSON.stringify({
      users: {
        old_profile: {
          profile_id: "old_profile",
          profile_secret_hash: "abc",
          consent: true,
          preferences: { genres: ["expired"] },
          learned: {},
          feedback: [],
          created_at: oldDate,
          updated_at: oldDate
        },
        active_profile: {
          profile_id: "active_profile",
          profile_secret_hash: "def",
          consent: true,
          preferences: { genres: ["active"] },
          learned: {},
          feedback: [],
          created_at: recentDate,
          updated_at: recentDate
        }
      }
    }, null, 2));

    const store = new FilePreferenceStore(preferencesPath);
    assert.equal(await store.getProfile("old_profile"), null);
    assert.equal((await store.getProfile("active_profile")).profile_id, "active_profile");

    const data = JSON.parse(await readFile(preferencesPath, "utf8"));
    assert.equal(data.users.old_profile, undefined);
    assert.equal(data.users.active_profile.profile_id, "active_profile");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
