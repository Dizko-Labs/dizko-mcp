import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  FilePreferenceStore,
  extractNoteSignals,
  learnedToPreferences,
  publicProfile,
  updateLearnedSignals
} from "../src/preferences.js";

const EVENT = {
  id: "evt-1",
  title: "Loone with Gegen",
  genres: ["techno"],
  vibe: ["underground"],
  event_types: ["party"],
  venue: "AMT",
  promoters: ["GEGEN"]
};

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), "dizko-learning-"));
  try {
    await run(new FilePreferenceStore(join(dir, "preferences.json")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function feedback(store, profileId, entry) {
  const { profile } = await store.recordFeedback(profileId, { event_id: EVENT.id, event: EVENT, ...entry });
  return profile;
}

function avoidSet(learned) {
  return new Set(learnedToPreferences(learned).avoid || []);
}

function allScores(learned) {
  return Object.values(learned).flatMap((scores) => Object.values(scores));
}

test("a dislike without notes blames the place, not the taste", async () => {
  await withStore(async (store) => {
    const profile = await feedback(store, "p-dislike", { liked: false });
    assert.deepEqual(profile.learned, { venues: { amt: -1 }, promoters: { gegen: -1 } });
    assert.equal(profile.learned.genres, undefined, "genres untouched");
    assert.equal(profile.learned.vibe, undefined);
    assert.equal(profile.learned.event_types, undefined);

    const learned = learnedToPreferences(profile.learned);
    assert.deepEqual(new Set(learned.avoid), new Set(["amt", "gegen"]));
    assert.deepEqual(Object.keys(learned), ["avoid"], "no positive preferences from a dislike");
  });
});

test("a dislike that blames the music penalizes genres one step per feedback", async () => {
  await withStore(async (store) => {
    const first = await feedback(store, "p-music", { liked: false, notes: "hated the music" });
    assert.equal(first.learned.genres.techno, -1);
    assert.ok(!avoidSet(first.learned).has("techno"), "one bad night is not yet an avoid rule for a genre");
    assert.ok(avoidSet(first.learned).has("amt"), "the venue is avoided after one bad night");

    const second = await feedback(store, "p-music", { liked: false, notes: "hated the music" });
    assert.equal(second.learned.genres.techno, -2);
    assert.ok(avoidSet(second.learned).has("techno"));
  });
});

test("a saved genre is floored at zero and never becomes an avoid rule", async () => {
  await withStore(async (store) => {
    await store.savePreferences("p-saved", { genres: ["techno"] }, { consent: true });
    await feedback(store, "p-saved", { liked: false, notes: "hated the music" });
    const profile = await feedback(store, "p-saved", { liked: false, notes: "hated the music" });
    assert.equal(profile.learned.genres.techno, 0);
    assert.ok(!avoidSet(profile.learned).has("techno"));
    assert.ok(avoidSet(profile.learned).has("amt"), "unsaved venue still learns");
    assert.equal(publicProfile(profile).learned_scores.genres, undefined, "a zero score is not exposed");
  });
});

test("'not bad' is mild praise, not negation", async () => {
  await withStore(async (store) => {
    const profile = await feedback(store, "p-notbad", { rating: 5, notes: "not bad music at all, great venue" });
    assert.equal(profile.learned.genres.techno, 1);
    assert.equal(profile.learned.venues.amt, 1);
    assert.equal(profile.learned.notes, undefined, "no avoid notes");
    assert.ok(allScores(profile.learned).every((score) => score > 0), JSON.stringify(profile.learned));
    assert.equal(learnedToPreferences(profile.learned).avoid, undefined);
  });
});

test("a like with a crowd complaint learns both the taste and the avoid rule", async () => {
  await withStore(async (store) => {
    const profile = await feedback(store, "p-packed", { liked: true, notes: "loved it but the crowd was a bit packed" });
    assert.ok(profile.learned.genres.techno > 0);
    assert.ok(profile.learned.vibe.underground > 0);
    assert.ok(profile.learned.venues.amt > 0);
    assert.deepEqual(profile.learned.notes, { crowded: -1, "huge crowds": -1 });

    const learned = learnedToPreferences(profile.learned);
    assert.deepEqual(learned.genres, ["techno"]);
    assert.deepEqual(learned.venues, ["amt"]);
    assert.ok(learned.avoid.includes("crowded"));
    assert.ok(learned.avoid.includes("huge crowds"));
  });
});

test("notes with no signal leave the learned state untouched", async () => {
  await withStore(async (store) => {
    const profile = await feedback(store, "p-noop", { notes: "the commercial break was long" });
    assert.deepEqual(profile.learned, {});
    assert.equal(profile.feedback.length, 1, "the feedback itself is still recorded");
  });
  const before = { genres: { techno: 1 } };
  assert.equal(updateLearnedSignals(before, { notes: "the commercial break was long", event: EVENT }, {}), before, "same object when nothing changes");
});

test("notes-only complaints become avoid rules", async () => {
  await withStore(async (store) => {
    const mainstream = await feedback(store, "p-mainstream", { notes: "too mainstream for me" });
    assert.deepEqual(mainstream.learned, { notes: { mainstream: -1 } });
    assert.deepEqual(learnedToPreferences(mainstream.learned), { avoid: ["mainstream"] });

    const expensive = await feedback(store, "p-expensive", { notes: "way too expensive" });
    assert.deepEqual(expensive.learned, { notes: { "expensive tickets": -1 } });
    assert.deepEqual(learnedToPreferences(expensive.learned), { avoid: ["expensive tickets"] });

    const late = await feedback(store, "p-late", { notes: "started too late" });
    assert.deepEqual(late.learned, { notes: { "late nights": -1 } });
    assert.deepEqual(learnedToPreferences(late.learned), { avoid: ["late nights"] });
  });
});

test("extractNoteSignals reads praise and blame near the music words", () => {
  const awful = extractNoteSignals("the dj was awful", EVENT);
  assert.equal(awful.blamesMusic, true);
  assert.deepEqual(awful.negative, [{ key: "genres", values: ["techno"] }]);
  assert.deepEqual(awful.positive, []);

  const amazing = extractNoteSignals("the dj was amazing", EVENT);
  assert.equal(amazing.blamesMusic, false);
  assert.deepEqual(amazing.positive, [{ key: "genres", values: ["techno"] }]);
  assert.deepEqual(amazing.negative, []);

  assert.deepEqual(extractNoteSignals("", EVENT), { positive: [], negative: [], blamesMusic: false, blamesVibe: false });
});

test("extractNoteSignals keeps 'good venue' and 'music was not great' apart", () => {
  const mixed = extractNoteSignals("good venue but the music was not great", EVENT);
  assert.ok(mixed.positive.some((signal) => signal.key === "venues" && signal.values[0] === "AMT"), "likes the place");
  assert.equal(mixed.blamesMusic, true);
});

test("publicProfile exposes learned_scores alongside learned_preferences", async () => {
  await withStore(async (store) => {
    const profile = await feedback(store, "p-public", { liked: false });
    const view = publicProfile(profile);
    assert.deepEqual(view.learned_scores, { venues: { amt: -1 }, promoters: { gegen: -1 } });
    assert.deepEqual(new Set(view.learned_preferences.avoid), new Set(["amt", "gegen"]));
    assert.equal(view.feedback_count, 1);
    assert.equal(view.profile_id, "p-public");
    assert.ok(!("profile_secret_hash" in view));
    assert.ok(!("feedback" in view));
  });
});
