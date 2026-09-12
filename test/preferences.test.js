import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import {
  FilePreferenceStore,
  extractNoteSignals,
  learnedToPreferences,
  updateLearnedSignals
} from "../src/preferences.js";
import { callTool } from "../src/tools.js";
import { clearEventCache } from "../src/api.js";

beforeEach(() => clearEventCache());

const PROFILE_ID = /^dzk_[0-9a-f-]{36}$/;
const PROFILE_SECRET = /^dzs_[A-Za-z0-9_-]+$/;

// 2026-08-05 is a Wednesday; 2026-08-07 is a Friday.
const WEDNESDAY_NOON = new Date("2026-08-05T12:00:00Z");
const FRIDAY_NOON = new Date("2026-08-07T12:00:00Z");

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), "dizko-prefs-"));
  try {
    await run(join(dir, "preferences.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function body(result) {
  return JSON.parse(result.content[0].text);
}

async function createProfile(preferencesPath, preferences) {
  const created = body(await callTool("dizko_create_profile", { consent: true, preferences }, { preferencesPath }));
  assert.equal(created.created, true);
  return { profile_id: created.profile_id, profile_secret: created.profile_secret, created };
}

function eventResponse(event) {
  return async () => Response.json(event);
}

function searchResponse(events) {
  return async () => Response.json({ count: events.length, events });
}

// ---------------------------------------------------------------------------
// Profile lifecycle: validation, consent, secrets, deletion
// ---------------------------------------------------------------------------

test("preference tools validate input first, then gate on consent, secret and confirmation", async () => {
  await withStore(async (preferencesPath) => {
    // Validation runs before the consent gate: a missing required field is
    // an invalid_argument, not a consent problem.
    const missingSecret = await callTool("dizko_update_profile", {
      profile_id: "dzk_missing",
      consent: false,
      preferences: { genres: ["techno"] }
    }, { preferencesPath });
    assert.equal(missingSecret.isError, true);
    assert.deepEqual(body(missingSecret), {
      error: "profile_secret is required.",
      code: "invalid_argument",
      field: "profile_secret",
      hint: "Fix the argument and call dizko_update_profile again."
    });

    const refusedCreate = await callTool("dizko_create_profile", {
      consent: false,
      preferences: { genres: ["techno"] }
    }, { preferencesPath });
    assert.equal(refusedCreate.isError, true);
    const refusedCreateBody = body(refusedCreate);
    assert.equal(refusedCreateBody.created, false);
    assert.equal(refusedCreateBody.code, "consent_required");
    assert.ok(refusedCreateBody.questions.length > 0, "the onboarding questions travel with the refusal");

    const { profile_id, profile_secret } = await createProfile(preferencesPath, { genres: ["techno"] });

    // Every required field present, valid credentials, consent false: the
    // consent gate itself answers.
    const refusedUpdate = await callTool("dizko_update_profile", {
      profile_id,
      profile_secret,
      consent: false,
      preferences: { genres: ["house"] }
    }, { preferencesPath });
    assert.equal(refusedUpdate.isError, true);
    const refusedUpdateBody = body(refusedUpdate);
    assert.equal(refusedUpdateBody.saved, false);
    assert.equal(refusedUpdateBody.error, "Consent is required before saving preferences.");
    assert.equal(refusedUpdateBody.code, "consent_required");
    assert.ok(refusedUpdateBody.questions.length > 0);

    const updated = body(await callTool("dizko_update_profile", {
      profile_id,
      profile_secret,
      consent: true,
      preferences: { genres: ["techno"], vibe: ["underground"], avoid: ["mainstream"], max_price: 30 }
    }, { preferencesPath }));
    assert.equal(updated.saved, true);
    assert.equal(updated.mode, "merge");
    assert.deepEqual(updated.profile.preferences.genres, ["techno"]);
    assert.deepEqual(updated.profile.preferences.vibe, ["underground"]);
    assert.equal(updated.profile.preferences.max_price, 30);

    const fetched = body(await callTool("dizko_get_profile", { profile_id, profile_secret }, { preferencesPath }));
    assert.equal(fetched.profile.feedback_count, 0);
    assert.deepEqual(fetched.profile.preferences.vibe, ["underground"]);
    assert.equal(fetched.profile.preferences.genres.includes("house"), false, "a refused update must not write anything");

    const wrongSecret = await callTool("dizko_get_profile", { profile_id, profile_secret: "dzs_wrong" }, { preferencesPath });
    assert.equal(wrongSecret.isError, true);
    assert.equal(body(wrongSecret).code, "profile_secret_invalid");

    const unknownProfile = await callTool("dizko_get_profile", {
      profile_id: "dzk_00000000-0000-0000-0000-000000000000",
      profile_secret
    }, { preferencesPath });
    assert.equal(unknownProfile.isError, true);
    assert.equal(body(unknownProfile).code, "profile_not_found");

    const missingConfirm = await callTool("dizko_delete_profile", { profile_id, profile_secret }, { preferencesPath });
    assert.equal(missingConfirm.isError, true);
    assert.equal(body(missingConfirm).code, "invalid_argument");
    assert.equal(body(missingConfirm).field, "confirm_delete");

    const unconfirmed = await callTool("dizko_delete_profile", { profile_id, profile_secret, confirm_delete: false }, { preferencesPath });
    assert.equal(unconfirmed.isError, true);
    assert.equal(body(unconfirmed).deleted, false);
    assert.equal(body(unconfirmed).code, "confirmation_required");

    const deleted = body(await callTool("dizko_delete_profile", { profile_id, profile_secret, confirm_delete: true }, { preferencesPath }));
    assert.equal(deleted.deleted, true);

    const gone = await callTool("dizko_get_profile", { profile_id, profile_secret }, { preferencesPath });
    assert.equal(gone.isError, true);
    assert.equal(body(gone).code, "profile_not_found");
  });
});

test("dizko_create_profile returns dzk_/dzs_ credentials and the normalized profile shape", async () => {
  await withStore(async (preferencesPath) => {
    const result = await callTool("dizko_create_profile", {
      consent: true,
      preferences: { genres: ["jazz"], vibe: ["intimate"], max_price: 20 }
    }, { preferencesPath });
    assert.equal(result.isError, false);
    const created = body(result);

    assert.deepEqual(Object.keys(created).sort(), [
      "access_instructions", "assistant_instruction", "created", "profile", "profile_id", "profile_secret"
    ]);
    assert.equal(created.created, true);
    assert.match(created.profile_id, PROFILE_ID);
    assert.match(created.profile_secret, PROFILE_SECRET);
    assert.equal(created.profile.profile_id, created.profile_id);
    assert.deepEqual(Object.keys(created.profile).sort(), [
      "consent", "feedback_count", "learned_preferences", "learned_scores", "preferences", "profile_id", "updated_at"
    ]);
    assert.equal(created.profile.consent, true);
    assert.equal(created.profile.profile_secret_hash, undefined, "the hash never leaves the store");
    // Created profiles carry the full normalized shape, including the
    // promoters list, with empty lists still present.
    assert.deepEqual(created.profile.preferences, {
      cities: [],
      event_types: [],
      genres: ["jazz"],
      vibe: ["intimate"],
      neighborhoods: [],
      venues: [],
      promoters: [],
      featuring: [],
      avoid: [],
      max_price: 20
    });
    assert.deepEqual(created.profile.learned_preferences, {});
    assert.deepEqual(created.profile.learned_scores, {});
    assert.equal(created.profile.feedback_count, 0);
    assert.ok(Date.parse(created.profile.updated_at) > 0);

    assert.equal(created.access_instructions.profile_id, created.profile_id);
    assert.equal(created.access_instructions.profile_secret, created.profile_secret);
    assert.equal(created.access_instructions.profile_secret_returned_now, true);
    assert.equal(created.access_instructions.keep_private, true);
    assert.match(created.access_instructions.reuse_instruction, /keep both profile_id and profile_secret/);
    assert.match(created.access_instructions.deletion_instruction, /dizko_delete_profile/);
    assert.match(created.assistant_instruction, /profile_id and profile_secret/);

    const fetched = body(await callTool("dizko_get_profile", {
      profile_id: created.profile_id,
      profile_secret: created.profile_secret
    }, { preferencesPath }));
    assert.deepEqual(fetched.profile.preferences.vibe, ["intimate"]);
    assert.equal(fetched.access_instructions.profile_id, created.profile_id);
    assert.equal(fetched.access_instructions.profile_secret, null);
    assert.equal(fetched.access_instructions.profile_secret_returned_now, false);
    assert.match(fetched.access_instructions.reuse_instruction, /cannot reveal it later/);

    // mode=replace overwrites and returns the compacted shape: no empty lists.
    const replaced = body(await callTool("dizko_update_profile", {
      profile_id: created.profile_id,
      profile_secret: created.profile_secret,
      consent: true,
      mode: "replace",
      preferences: { genres: ["ambient"], promoters: ["Gegen"] }
    }, { preferencesPath }));
    assert.equal(replaced.saved, true);
    assert.equal(replaced.mode, "replace");
    assert.deepEqual(replaced.profile.preferences, { genres: ["ambient"], promoters: ["gegen"] });
  });
});

// ---------------------------------------------------------------------------
// Feedback and learning
// ---------------------------------------------------------------------------

test("a like promotes the event's genres, vibe, types, venue and promoters into learned taste that ranks searches", async () => {
  await withStore(async (preferencesPath) => {
    const { profile_id, profile_secret } = await createProfile(preferencesPath, { genres: ["house"] });

    const feedback = body(await callTool("dizko_record_feedback", {
      profile_id,
      profile_secret,
      event_id: "event-1",
      liked: true,
      rating: 5
    }, {
      preferencesPath,
      fetch: eventResponse({
        id: "event-1",
        title: "Basement Night",
        genres: ["techno"],
        vibe: ["warehouse"],
        event_types: ["party"],
        lineup: [],
        venue_name: "RSO.BERLIN",
        promoters: [{ name: "Klubnacht", slug: "klubnacht" }]
      })
    }));
    assert.equal(feedback.saved, true);
    assert.equal(feedback.feedback.event_id, "event-1");
    assert.equal(feedback.feedback.liked, true);
    assert.equal(feedback.feedback.rating, 5);
    assert.deepEqual(feedback.learned_now, {
      genres: ["techno"],
      vibe: ["warehouse"],
      event_types: ["party"],
      venues: ["rso.berlin"],
      promoters: ["klubnacht"]
    });
    assert.deepEqual(feedback.profile.learned_scores, {
      genres: { techno: 1 },
      vibe: { warehouse: 1 },
      event_types: { party: 1 },
      venues: { "rso.berlin": 1 },
      promoters: { klubnacht: 1 }
    });
    assert.equal(feedback.profile.feedback_count, 1);

    const fetched = body(await callTool("dizko_get_profile", { profile_id, profile_secret }, { preferencesPath }));
    assert.deepEqual(fetched.profile.learned_preferences, feedback.learned_now);
    assert.equal(fetched.profile.feedback_count, 1);

    let requestedUrl = null;
    const search = await callTool("dizko_search_events", {
      profile_id,
      profile_secret,
      city: "berlin",
      when: "week",
      limit: 1
    }, {
      preferencesPath,
      now: WEDNESDAY_NOON,
      fetch: async (url) => {
        requestedUrl = new URL(url);
        return Response.json({
          count: 2,
          events: [
            {
              id: "disco-brunch",
              title: "Disco Brunch",
              start_time: "2026-08-08T12:00:00Z",
              genres: ["disco"],
              vibe: ["sunny"],
              event_types: ["party"],
              lineup: [],
              venue_name: "Rooftop"
            },
            {
              id: "warehouse-return",
              title: "Warehouse Return",
              start_time: "2026-08-08T22:00:00Z",
              genres: ["techno"],
              vibe: ["warehouse"],
              event_types: ["party"],
              lineup: [],
              venue_name: "RSO.BERLIN"
            }
          ]
        });
      }
    });
    assert.equal(search.isError, false);
    const searchBody = body(search);

    // Learned taste ranks; it is never sent upstream as a filter.
    assert.equal(requestedUrl.searchParams.get("city"), "berlin");
    assert.equal(requestedUrl.searchParams.has("genres"), false);
    assert.equal(requestedUrl.searchParams.has("vibe"), false);
    assert.equal(requestedUrl.searchParams.has("venue"), false);
    assert.ok(Number(requestedUrl.searchParams.get("limit")) >= 12, "taste mode fetches a wider candidate page than it returns");

    assert.equal(searchBody.rank, "taste");
    assert.equal(searchBody.count, 2);
    assert.equal(searchBody.returned, 1);
    assert.equal(searchBody.events[0].id, "warehouse-return");
    assert.ok(searchBody.events[0].recommendation_score > 0);
    for (const reason of ["genre match: techno", "vibe match: warehouse", "event type match: party", "venue match: rso.berlin"]) {
      assert.ok(searchBody.events[0].recommendation_reasons.includes(reason), `expected reason ${JSON.stringify(reason)}`);
    }
    assert.equal(searchBody.personalization.source, "saved_and_learned_preferences");
    assert.equal(searchBody.personalization.profile_id, profile_id);
    assert.deepEqual(searchBody.personalization.learned_preferences.genres, ["techno"]);
    assert.deepEqual(searchBody.personalization.applied_ranking_hints.genres, ["house", "techno"]);
    assert.deepEqual(searchBody.personalization.applied_ranking_hints.vibe, ["warehouse"]);
    assert.deepEqual(searchBody.personalization.hard_filters_from_profile, []);
    assert.equal(searchBody.personalization.feedback_count, 1);
    assert.equal(searchBody.personalization.applied_preferences, undefined, "renamed to applied_ranking_hints");
  });
});

test("feedback requires a real learning signal: empty feedback is rejected before any upstream call", async () => {
  await withStore(async (preferencesPath) => {
    const { profile_id, profile_secret } = await createProfile(preferencesPath, { genres: ["house"] });
    let fetchCalled = false;
    const fetch = async () => {
      fetchCalled = true;
      return Response.json({ id: "event-1", title: "Should Not Fetch" });
    };

    // Input validation runs first: the schema demands at least one of
    // liked, rating or notes, so the request never reaches the store or
    // the event lookup.
    for (const input of [{}, { notes: "   " }]) {
      const rejected = await callTool("dizko_record_feedback", {
        profile_id,
        profile_secret,
        event_id: "event-1",
        ...input
      }, { preferencesPath, fetch });
      const rejectedBody = body(rejected);
      assert.equal(rejected.isError, true);
      assert.equal(rejectedBody.code, "invalid_argument");
      assert.match(rejectedBody.error, /at least one of: liked, rating, notes/);
      assert.match(rejectedBody.hint, /dizko_record_feedback/);
      assert.equal(rejectedBody.saved, undefined);
    }
    assert.equal(fetchCalled, false, "no upstream call before the signal check");

    const fetched = body(await callTool("dizko_get_profile", { profile_id, profile_secret }, { preferencesPath }));
    assert.equal(fetched.profile.feedback_count, 0);
  });
});

test("legacy tool names still work: create_event_preference_profile + recommend_events_for_user rank by learned venue affinity without filtering on it", async () => {
  await withStore(async (preferencesPath) => {
    const created = body(await callTool("create_event_preference_profile", {
      consent: true,
      preferences: { cities: ["berlin"], genres: ["techno"] }
    }, { preferencesPath }));
    assert.equal(created.created, true);
    assert.match(created.profile_id, PROFILE_ID);

    const feedback = body(await callTool("record_event_feedback", {
      profile_id: created.profile_id,
      profile_secret: created.profile_secret,
      event_id: "event-1",
      liked: true,
      notes: "Loved the venue and the music."
    }, {
      preferencesPath,
      fetch: eventResponse({
        id: "event-1",
        title: "Venue Love",
        genres: ["techno"],
        vibe: ["underground"],
        event_types: ["party"],
        lineup: [],
        venue_name: "ÆDEN",
        venue_city: "berlin"
      })
    }));
    assert.equal(feedback.saved, true);
    assert.deepEqual(feedback.learned_now.venues, ["æden"]);

    let requestedUrl = null;
    const recommended = await callTool("recommend_events_for_user", {
      profile_id: created.profile_id,
      profile_secret: created.profile_secret,
      when: "weekend",
      result_limit: 2
    }, {
      preferencesPath,
      now: WEDNESDAY_NOON,
      fetch: async (url) => {
        requestedUrl = new URL(url);
        return Response.json({
          count: 2,
          events: [
            {
              id: "event-2",
              title: "Another Night",
              start_time: "2026-08-08T22:00:00Z",
              genres: ["techno"],
              vibe: ["queer-friendly"],
              event_types: ["party"],
              lineup: [],
              venue_name: "OXI",
              venue_city: "berlin"
            },
            {
              id: "event-3",
              title: "Home Turf",
              start_time: "2026-08-08T23:00:00Z",
              genres: ["techno"],
              vibe: ["underground"],
              event_types: ["party"],
              lineup: [],
              venue_name: "ÆDEN",
              venue_city: "berlin"
            }
          ]
        });
      }
    });
    assert.equal(recommended.isError, false);
    const recommendedBody = body(recommended);

    const params = requestedUrl.searchParams;
    assert.equal(params.get("venue"), null, "learned venue affinity guides ranking, it never hard-filters the search");
    assert.equal(params.get("city"), "berlin", "the saved city seeds the search when the user omits it");
    assert.equal(params.has("genres"), false);
    assert.ok(Number(params.get("limit")) >= 12);

    // The alias adapts result_limit into the new limit argument and forces taste ranking.
    assert.equal(recommendedBody.rank, "taste");
    assert.equal(recommendedBody.returned, 2);
    assert.equal(recommendedBody.events[0].id, "event-3");
    assert.ok(recommendedBody.events[0].recommendation_reasons.includes("venue match: æden"));
    assert.ok(recommendedBody.personalization.applied_ranking_hints.venues.includes("æden"));
  });
});

test("feedback notes create learned preference and avoid signals", async () => {
  await withStore(async (preferencesPath) => {
    const { profile_id, profile_secret } = await createProfile(preferencesPath, { event_types: ["club night"] });

    const feedback = body(await callTool("dizko_record_feedback", {
      profile_id,
      profile_secret,
      event_id: "event-1",
      notes: "Too crowded and too expensive, but I loved the music."
    }, {
      preferencesPath,
      fetch: eventResponse({
        id: "event-1",
        title: "Basement Night",
        genres: ["techno"],
        vibe: ["warehouse"],
        event_types: ["party"],
        lineup: [],
        venue_name: "RSO.BERLIN"
      })
    }));
    assert.deepEqual(feedback.learned_now, {
      genres: ["techno"],
      avoid: ["crowded", "huge crowds", "expensive tickets"]
    });
    assert.equal(feedback.profile.learned_scores.venues, undefined, "notes alone do not blame the venue");

    const fetched = body(await callTool("dizko_get_profile", { profile_id, profile_secret }, { preferencesPath }));
    assert.deepEqual(fetched.profile.learned_preferences, feedback.learned_now);

    const recommended = body(await callTool("dizko_search_events", {
      profile_id,
      profile_secret,
      city: "berlin",
      when: "week",
      limit: 1
    }, {
      preferencesPath,
      now: WEDNESDAY_NOON,
      fetch: searchResponse([{
        id: "event-2",
        title: "Warehouse Return",
        start_time: "2026-08-08T22:00:00Z",
        genres: ["techno"],
        vibe: ["crowded"],
        event_types: ["party"],
        lineup: [],
        venue_name: "RSO.BERLIN"
      }])
    }));
    assert.ok(recommended.personalization.applied_ranking_hints.avoid.includes("crowded"));
    assert.ok(recommended.events[0].recommendation_reasons.includes("genre match: techno"));
    assert.ok(recommended.events[0].recommendation_reasons.includes("penalized: crowded"));
  });
});

test("a dislike without an explanation blames the venue and promoter, never the genre", async () => {
  await withStore(async (preferencesPath) => {
    const { profile_id, profile_secret } = await createProfile(preferencesPath, { genres: ["house"] });

    const feedback = body(await callTool("dizko_record_feedback", {
      profile_id,
      profile_secret,
      event_id: "event-1",
      liked: false
    }, {
      preferencesPath,
      fetch: eventResponse({
        id: "event-1",
        title: "Pressure",
        genres: ["techno"],
        vibe: ["dark"],
        event_types: ["party"],
        lineup: [],
        venue_name: "AMT",
        promoters: [{ name: "Gegen", slug: "gegen" }]
      })
    }));
    assert.equal(feedback.saved, true);
    assert.deepEqual(feedback.learned_now, { avoid: ["amt", "gegen"] });
    assert.deepEqual(feedback.profile.learned_scores, { venues: { amt: -1 }, promoters: { gegen: -1 } });
    assert.equal(feedback.profile.learned_scores.genres, undefined, "techno is untouched");
    assert.match(feedback.assistant_instruction, /avoid entry/);

    const recommended = body(await callTool("dizko_search_events", {
      profile_id,
      profile_secret,
      city: "berlin",
      when: "week"
    }, {
      preferencesPath,
      now: WEDNESDAY_NOON,
      fetch: searchResponse([
        {
          id: "amt-again",
          title: "Pressure II",
          start_time: "2026-08-08T22:00:00Z",
          genres: ["techno"],
          vibe: ["dark"],
          event_types: ["party"],
          lineup: [],
          venue_name: "AMT"
        },
        {
          id: "elsewhere",
          title: "Techno Elsewhere",
          start_time: "2026-08-08T23:00:00Z",
          genres: ["techno"],
          vibe: ["dark"],
          event_types: ["party"],
          lineup: [],
          venue_name: "Basement"
        }
      ])
    }));
    assert.equal(recommended.events[0].id, "elsewhere");
    assert.equal(recommended.events[1].id, "amt-again");
    assert.ok(recommended.events[1].recommendation_reasons.includes("penalized: amt"));
    assert.equal(recommended.events[0].recommendation_reasons.some((reason) => reason.startsWith("penalized")), false);
  });
});

test("repeated dislikes that blame the music learn to avoid the genre", async () => {
  await withStore(async (preferencesPath) => {
    const { profile_id, profile_secret } = await createProfile(preferencesPath, { genres: ["house"] });

    const dislike = (eventId, venue) => callTool("dizko_record_feedback", {
      profile_id,
      profile_secret,
      event_id: eventId,
      liked: false,
      notes: "hated the music"
    }, {
      preferencesPath,
      fetch: eventResponse({
        id: eventId,
        title: `Night at ${venue}`,
        genres: ["techno"],
        vibe: ["dark"],
        event_types: ["party"],
        lineup: [],
        venue_name: venue
      })
    });

    const first = body(await dislike("event-1", "AMT"));
    assert.ok(first.learned_now.avoid.includes("amt"), "one bad night is enough to avoid the place");
    assert.ok(first.profile.learned_scores.genres.techno < 0, "blaming the music penalizes the genre");

    const second = body(await dislike("event-2", "Void"));
    assert.equal(second.profile.feedback_count, 2);
    assert.ok(second.learned_now.avoid.includes("techno"), "two music-blaming dislikes cross the genre threshold");
    assert.ok(second.learned_now.avoid.includes("amt"));
    assert.ok(second.learned_now.avoid.includes("void"));
    assert.equal(second.learned_now.genres, undefined, "no positive genre signal exists");

    const recommended = body(await callTool("dizko_search_events", {
      profile_id,
      profile_secret,
      city: "berlin",
      when: "week"
    }, {
      preferencesPath,
      now: WEDNESDAY_NOON,
      fetch: searchResponse([
        {
          id: "techno-night",
          title: "Techno Night",
          start_time: "2026-08-08T22:00:00Z",
          genres: ["techno"],
          vibe: ["dark"],
          event_types: ["party"],
          lineup: [],
          venue_name: "Basement"
        },
        {
          id: "house-night",
          title: "House Night",
          start_time: "2026-08-08T23:00:00Z",
          genres: ["house"],
          vibe: ["warm"],
          event_types: ["party"],
          lineup: [],
          venue_name: "Basement"
        }
      ])
    }));
    assert.ok(recommended.personalization.applied_ranking_hints.avoid.includes("techno"));
    assert.equal(recommended.events[0].id, "house-night");
    assert.ok(recommended.events[1].recommendation_reasons.includes("penalized: techno"));
  });
});

test("saved taste is floored at zero: a saved genre never becomes an avoid rule", async () => {
  await withStore(async (preferencesPath) => {
    const { profile_id, profile_secret } = await createProfile(preferencesPath, { genres: ["techno"], venues: ["Basement"] });

    for (const eventId of ["event-1", "event-2"]) {
      const feedback = await callTool("dizko_record_feedback", {
        profile_id,
        profile_secret,
        event_id: eventId,
        liked: false,
        rating: 1,
        notes: "the lineup was terrible, hated the music"
      }, {
        preferencesPath,
        fetch: eventResponse({
          id: eventId,
          title: "Hard Night",
          genres: ["techno", "hardgroove"],
          vibe: ["dark"],
          event_types: ["party"],
          lineup: [],
          venue_name: "Basement"
        })
      });
      assert.equal(feedback.isError, false);
    }

    const fetched = body(await callTool("dizko_get_profile", { profile_id, profile_secret }, { preferencesPath }));
    const learned = fetched.profile.learned_preferences;
    assert.equal(fetched.profile.feedback_count, 2);
    assert.equal(learned.avoid.includes("techno"), false, "saved genre is floored at 0");
    assert.equal(learned.avoid.includes("basement"), false, "saved venue is floored at 0");
    assert.ok(learned.avoid.includes("hardgroove"), "the unsaved genre on the same events is avoided");
    assert.equal(fetched.profile.learned_scores.genres.techno, undefined, "zero scores are not reported");
    assert.ok(fetched.profile.learned_scores.genres.hardgroove <= -2);
    assert.equal(fetched.profile.learned_scores.venues, undefined);
  });
});

test("note signals and learning rules: praise, mild praise, blame, saved-term floor and avoid thresholds", () => {
  const event = { genres: ["techno"], vibe: ["dark"], event_types: ["party"], venue: "AMT", promoters: [{ name: "Gegen" }] };

  // Praise for the music promotes the event's genres.
  assert.deepEqual(extractNoteSignals("loved the music", event), {
    positive: [{ key: "genres", values: ["techno"] }],
    negative: [],
    blamesMusic: false,
    blamesVibe: false
  });

  // Fixed avoid vocabulary from common complaints.
  const complaints = extractNoteSignals("too crowded and way too expensive, ended too late", event);
  assert.deepEqual(complaints.negative, [
    { key: "notes", values: ["crowded", "huge crowds"] },
    { key: "notes", values: ["expensive tickets"] },
    { key: "notes", values: ["late nights"] }
  ]);
  assert.deepEqual(extractNoteSignals("way too mainstream", event).negative, [{ key: "notes", values: ["mainstream"] }]);
  assert.deepEqual(extractNoteSignals("we left during the commercial break", event).negative, [], "'commercial break' is not a taste signal");

  // "not bad" is mild praise, not a negation.
  const mild = extractNoteSignals("not bad music, wasn't bad at all", event);
  assert.equal(mild.blamesMusic, false);
  assert.deepEqual(mild.negative, []);
  assert.deepEqual(mild.positive, []);

  const blame = extractNoteSignals("hated the music and the crowd was awful", event);
  assert.equal(blame.blamesMusic, true);
  assert.equal(blame.blamesVibe, true);

  // A like promotes every dimension of the event.
  assert.deepEqual(updateLearnedSignals({}, { liked: true, event }, {}), {
    genres: { techno: 1 },
    vibe: { dark: 1 },
    event_types: { party: 1 },
    venues: { amt: 1 },
    promoters: { gegen: 1 }
  });
  assert.deepEqual(updateLearnedSignals({}, { rating: 4, event }, {}).genres, { techno: 1 }, "rating >= 4 counts as a like");

  // A dislike without notes only marks the place.
  assert.deepEqual(updateLearnedSignals({}, { liked: false, event }, {}), { venues: { amt: -1 }, promoters: { gegen: -1 } });
  assert.deepEqual(updateLearnedSignals({}, { rating: 2, event }, {}), { venues: { amt: -1 }, promoters: { gegen: -1 } }, "rating <= 2 counts as a dislike");

  // A dislike that blames the crowd penalizes the vibe, not the genre.
  assert.deepEqual(updateLearnedSignals({}, { liked: false, notes: "the crowd was awful", event }, {}), {
    venues: { amt: -1 },
    promoters: { gegen: -1 },
    vibe: { dark: -1 }
  });

  // Notes alone that blame the music penalize the genre without touching the place.
  assert.deepEqual(updateLearnedSignals({}, { rating: 3, notes: "hated the music", event }, {}), { genres: { techno: -1 } });

  // Neutral feedback with no signal leaves learning untouched.
  const untouched = { genres: { house: 2 } };
  assert.equal(updateLearnedSignals(untouched, { rating: 3, notes: "it was fine", event }, {}), untouched);

  // Saved terms are floored at zero.
  const floored = updateLearnedSignals({}, { liked: false, notes: "hated the music", event }, { genres: ["techno"], venues: ["AMT"] });
  assert.equal(floored.genres.techno, 0);
  assert.equal(floored.venues.amt, 0);
  assert.equal(floored.promoters.gegen, -1);
  assert.deepEqual(learnedToPreferences(floored).avoid, ["gegen"]);

  // Thresholds: taste dimensions need -2, places and notes need -1.
  assert.deepEqual(learnedToPreferences({
    genres: { techno: -1, edm: -2, house: 3, disco: 1 },
    vibe: { dark: -1 },
    event_types: { festival: -2 },
    venues: { amt: -1 },
    promoters: { gegen: -1 },
    notes: { mainstream: -1 }
  }), {
    genres: ["house", "disco"],
    avoid: ["edm", "festival", "amt", "gegen", "mainstream"]
  });
});

// ---------------------------------------------------------------------------
// Personalization is ranking only, never an upstream filter
// ---------------------------------------------------------------------------

test("saved taste ranks results but never becomes an upstream filter; only typed fields filter", async () => {
  await withStore(async (preferencesPath) => {
    const { profile_id, profile_secret } = await createProfile(preferencesPath, {
      cities: ["berlin"],
      genres: ["techno", "house"],
      vibe: ["underground"],
      max_price: 30
    });

    const candidates = [
      {
        id: "jazz-45",
        title: "Late Jazz",
        start_time: "2026-08-07T20:00:00Z",
        venue_city: "berlin",
        price_min: 45,
        currency: "EUR",
        genres: ["jazz"],
        vibe: ["intimate"],
        event_types: ["live music"],
        lineup: []
      },
      {
        id: "house-free",
        title: "Open Air House",
        start_time: "2026-08-08T16:00:00Z",
        venue_city: "berlin",
        price_min: 0,
        currency: "EUR",
        genres: ["house"],
        vibe: ["outdoors"],
        event_types: ["party"],
        lineup: []
      },
      {
        id: "techno-20",
        title: "Basement Techno",
        start_time: "2026-08-08T22:00:00Z",
        venue_city: "berlin",
        price_min: 20,
        currency: "EUR",
        genres: ["techno"],
        vibe: ["underground"],
        event_types: ["party"],
        lineup: []
      }
    ];

    let requestedUrl = null;
    const fetchCandidates = async (url) => {
      requestedUrl = new URL(url);
      return Response.json({ count: candidates.length, events: candidates });
    };

    const result = await callTool("dizko_search_events", {
      profile_id,
      profile_secret,
      when: "weekend"
    }, { preferencesPath, now: WEDNESDAY_NOON, fetch: fetchCandidates });
    assert.equal(result.isError, false);
    const searchBody = body(result);

    // Regression: nothing from the profile reaches the upstream query except
    // the fallback city.
    const params = requestedUrl.searchParams;
    assert.equal(params.get("city"), "berlin", "saved city is the fallback scope");
    assert.equal(params.has("genres"), false, "saved genres must not filter upstream");
    assert.equal(params.has("vibe"), false, "saved vibe must not filter upstream");
    assert.equal(params.has("price_max"), false, "saved budget must not filter upstream");
    assert.equal(params.has("max_price"), false);
    assert.equal(params.has("venue"), false);
    assert.equal(params.get("date_from"), "2026-08-07");
    assert.equal(params.get("date_to"), "2026-08-09");
    assert.ok(Number(params.get("limit")) >= 12, "taste mode fetches a wider candidate page");

    assert.equal(searchBody.city, "Berlin");
    assert.equal(searchBody.timezone, "Europe/Berlin");
    assert.equal(searchBody.rank, "taste");
    assert.equal(searchBody.count, 3);
    assert.equal(searchBody.returned, 3, "over-budget events are penalized, not hidden");
    assert.deepEqual(searchBody.events.map((event) => event.id), ["techno-20", "house-free", "jazz-45"]);
    const [techno, house, jazz] = searchBody.events;
    assert.ok(techno.recommendation_reasons.includes("genre match: techno"));
    assert.ok(techno.recommendation_reasons.includes("vibe match: underground"));
    assert.ok(techno.recommendation_reasons.includes("within budget"));
    assert.ok(house.recommendation_reasons.includes("genre match: house"));
    assert.ok(jazz.recommendation_reasons.includes("over budget"));
    assert.ok(jazz.recommendation_score < house.recommendation_score);
    assert.ok(jazz.recommendation_score <= techno.recommendation_score - 30, "over budget costs 30 points");
    assert.equal(jazz.price, "€45");
    assert.equal(techno.city, "Berlin");

    assert.equal(searchBody.profile.profile_id, profile_id);
    assert.deepEqual(searchBody.personalization, {
      source: "saved_and_learned_preferences",
      profile_id,
      saved_preferences: {
        cities: ["berlin"],
        event_types: [],
        genres: ["techno", "house"],
        vibe: ["underground"],
        neighborhoods: [],
        venues: [],
        promoters: [],
        featuring: [],
        avoid: [],
        max_price: 30
      },
      learned_preferences: {},
      current_request: {
        city: null,
        when: "weekend",
        event_types: [],
        genres: [],
        vibe: [],
        neighborhoods: [],
        price_max: null,
        max_price: null,
        free: null,
        avoid: []
      },
      applied_ranking_hints: {
        cities: ["berlin"],
        genres: ["techno", "house"],
        vibe: ["underground"],
        max_price: 30
      },
      hard_filters_from_profile: [],
      feedback_count: 0
    });

    // Fields typed in the request are real filters and reach upstream.
    const typed = body(await callTool("dizko_search_events", {
      profile_id,
      profile_secret,
      when: "weekend",
      genres: ["jazz"]
    }, { preferencesPath, now: WEDNESDAY_NOON, fetch: fetchCandidates }));
    assert.deepEqual(requestedUrl.searchParams.getAll("genres"), ["jazz"]);
    assert.equal(requestedUrl.searchParams.has("vibe"), false);
    assert.equal(requestedUrl.searchParams.has("price_max"), false);
    assert.deepEqual(typed.personalization.current_request.genres, ["jazz"]);
    assert.deepEqual(typed.personalization.applied_ranking_hints.genres, ["techno", "house", "jazz"]);
  });
});

test("personalized night plans rank by saved taste as hints and pick the best-scoring nearby fallback", async () => {
  await withStore(async (preferencesPath) => {
    const { profile_id, profile_secret } = await createProfile(preferencesPath, {
      cities: ["berlin"],
      genres: ["techno"],
      max_price: 25,
      avoid: ["huge crowds"]
    });
    let requestedUrl = null;

    const planned = await callTool("dizko_plan_night", {
      profile_id,
      profile_secret,
      city: "berlin",
      when: "weekend",
      result_limit: 3
    }, {
      preferencesPath,
      now: new Date("2026-07-29T12:00:00Z"),
      fetch: async (url) => {
        requestedUrl = new URL(url);
        return Response.json({
          count: 4,
          events: [
            {
              id: "primary",
              title: "Small Room Techno",
              start_time: "2026-08-01T20:00:00Z",
              venue_city: "berlin",
              price_min: 18,
              genres: ["techno"],
              vibe: ["intimate"],
              event_types: ["party"],
              lineup: [],
              lat: 52.52,
              lng: 13.405,
              attendance_count: 120,
              ra_pick: true
            },
            {
              id: "close-miss",
              title: "Pricey Next Door",
              start_time: "2026-08-01T21:00:00Z",
              venue_city: "berlin",
              price_min: 40,
              genres: ["house"],
              vibe: ["intimate"],
              event_types: ["party"],
              lineup: [],
              lat: 52.5205,
              lng: 13.4055
            },
            {
              id: "near-fit",
              title: "Techno Two Kilometres Away",
              start_time: "2026-08-01T22:00:00Z",
              venue_city: "berlin",
              price_min: 20,
              genres: ["techno"],
              vibe: ["underground"],
              event_types: ["party"],
              lineup: [],
              lat: 52.535,
              lng: 13.42
            },
            {
              id: "later",
              title: "Later Techno Across Town",
              start_time: "2026-08-01T23:00:00Z",
              venue_city: "berlin",
              price_min: 20,
              genres: ["techno"],
              vibe: ["underground"],
              event_types: ["party"],
              lineup: [],
              lat: 52.60,
              lng: 13.50,
              attendance_count: 160
            }
          ]
        });
      }
    });
    assert.equal(planned.isError, false);
    const plannedBody = body(planned);

    const params = requestedUrl.searchParams;
    assert.equal(params.get("city"), "berlin");
    assert.equal(params.has("genres"), false, "saved genres are ranking hints, not filters");
    assert.equal(params.has("price_max"), false, "saved budget is a ranking hint, not a filter");
    assert.equal(params.get("date_from"), "2026-07-31");
    assert.equal(params.get("date_to"), "2026-08-02");

    assert.equal(plannedBody.profile.profile_id, profile_id);
    assert.equal(plannedBody.personalization.applied_ranking_hints.max_price, 25);
    assert.deepEqual(plannedBody.personalization.applied_ranking_hints.genres, ["techno"]);
    assert.deepEqual(plannedBody.personalization.hard_filters_from_profile, []);
    assert.equal(plannedBody.timezone, "Europe/Berlin");
    assert.equal(plannedBody.city, "berlin");
    assert.equal(plannedBody.when, "weekend");
    assert.match(plannedBody.strategy, /nearby fallback/);
    assert.equal(plannedBody.count, 4);

    assert.deepEqual(plannedBody.events.map((event) => [event.id, event.plan_role]), [
      ["primary", "primary"],
      ["near-fit", "nearby_fallback"],
      ["later", "later_fallback"]
    ]);
    const nearby = plannedBody.events[1];
    assert.ok(nearby.distance_from_primary_km > 1 && nearby.distance_from_primary_km < 6,
      "the best-scoring event within 6 km wins over the closer over-budget one");
    assert.ok(nearby.recommendation_reasons.includes("genre match: techno"));
    assert.ok(nearby.recommendation_reasons.includes("within budget"));
    assert.equal(plannedBody.events[0].distance_from_primary_km, 0);
    assert.ok(plannedBody.events.every((event) => event.recommendation_score !== undefined));
  });
});

test("day_filters merge per weekday and steer single-day ranking without touching the upstream query", async () => {
  await withStore(async (preferencesPath) => {
    const created = body(await callTool("dizko_create_profile", {
      consent: true,
      preferences: {
        genres: ["house"],
        day_filters: { friday: { genres: ["techno"] } }
      }
    }, { preferencesPath }));
    assert.deepEqual(created.profile.preferences.day_filters, { friday: { genres: ["techno"] } });
    const { profile_id, profile_secret } = created;

    const saved = body(await callTool("dizko_update_profile", {
      profile_id,
      profile_secret,
      consent: true,
      preferences: { day_filters: { sunday: { vibe: ["chill"], nightlife: false, max_price: 15 } } }
    }, { preferencesPath }));
    assert.deepEqual(saved.profile.preferences.day_filters, {
      friday: { genres: ["techno"] },
      sunday: { vibe: ["chill"], max_price: 15, nightlife: false }
    });
    assert.deepEqual(saved.profile.preferences.genres, ["house"]);

    let requestedUrl = null;
    const friday = body(await callTool("dizko_search_events", {
      profile_id,
      profile_secret,
      city: "berlin",
      when: "tonight",
      limit: 1
    }, {
      preferencesPath,
      now: FRIDAY_NOON,
      fetch: async (url) => {
        requestedUrl = new URL(url);
        return Response.json({
          count: 2,
          events: [
            {
              id: "pop-1", title: "Chart Night", start_time: "2026-08-07T22:00:00Z",
              genres: ["pop"], vibe: [], event_types: ["party"], lineup: [], venue_name: "Big Room"
            },
            {
              id: "techno-1", title: "Friday Pressure", start_time: "2026-08-07T23:00:00Z",
              genres: ["techno"], vibe: [], event_types: ["party"], lineup: [], venue_name: "Basement"
            }
          ]
        });
      }
    }));
    assert.equal(requestedUrl.searchParams.get("date_from"), "2026-08-07");
    assert.equal(requestedUrl.searchParams.has("genres"), false, "friday genres are hints, not filters");
    assert.deepEqual(friday.personalization.applied_ranking_hints.genres, ["house", "techno"],
      "tonight on a Friday pulls the friday day_filters into the ranking hints");
    assert.equal(friday.sort_by, "soonest");
    assert.equal(friday.events[0].id, "techno-1");
    assert.ok(friday.events[0].recommendation_reasons.includes("genre match: techno"));

    const sunday = body(await callTool("dizko_search_events", {
      profile_id,
      profile_secret,
      city: "berlin",
      when: "sunday"
    }, {
      preferencesPath,
      now: FRIDAY_NOON,
      fetch: async (url) => {
        requestedUrl = new URL(url);
        return Response.json({
          count: 2,
          events: [
            {
              id: "loud-25", title: "Sunday Pressure", start_time: "2026-08-09T22:00:00Z",
              genres: ["techno"], vibe: ["high-energy"], event_types: ["party"], lineup: [], venue_name: "Basement", price_min: 25
            },
            {
              id: "chill-10", title: "Sunday Listening", start_time: "2026-08-09T16:00:00Z",
              genres: ["house"], vibe: ["chill"], event_types: ["party"], lineup: [], venue_name: "Garden", price_min: 10
            }
          ]
        });
      }
    }));
    assert.equal(requestedUrl.searchParams.get("date_from"), "2026-08-09");
    assert.equal(requestedUrl.searchParams.has("price_max"), false, "the Sunday budget ranks, it does not filter");
    assert.equal(requestedUrl.searchParams.has("genres"), false);
    assert.equal(requestedUrl.searchParams.has("vibe"), false);
    assert.deepEqual(sunday.personalization.applied_ranking_hints, {
      genres: ["house"],
      vibe: ["chill"],
      max_price: 15,
      nightlife: false
    });
    assert.deepEqual(sunday.events.map((event) => event.id), ["chill-10", "loud-25"]);
    assert.ok(sunday.events[0].recommendation_reasons.includes("vibe match: chill"));
    assert.ok(sunday.events[0].recommendation_reasons.includes("within budget"));
    assert.ok(sunday.events[1].recommendation_reasons.includes("over budget"), "over budget is a penalty, the event still shows");

    const saturday = body(await callTool("dizko_search_events", {
      profile_id,
      profile_secret,
      city: "berlin",
      when: "saturday"
    }, { preferencesPath, now: FRIDAY_NOON, fetch: searchResponse([]) }));
    assert.deepEqual(saturday.personalization.applied_ranking_hints, { genres: ["house"] }, "day_filters stay scoped to their weekday");
  });
});

// ---------------------------------------------------------------------------
// Store behavior
// ---------------------------------------------------------------------------

test("concurrent preference writes preserve profiles in the file store", async () => {
  await withStore(async (preferencesPath) => {
    const created = await Promise.all(Array.from({ length: 12 }, (_, index) => callTool("dizko_create_profile", {
      consent: true,
      preferences: {
        genres: [`genre-${index}`],
        vibe: ["underground"]
      }
    }, { preferencesPath })));
    const profiles = created.map((result) => body(result).profile_id);
    assert.equal(new Set(profiles).size, 12);
    assert.ok(profiles.every((profileId) => PROFILE_ID.test(profileId)));

    const data = JSON.parse(await readFile(preferencesPath, "utf8"));
    for (const profileId of profiles) {
      assert.ok(data.users[profileId], `Missing concurrently-created profile ${profileId}`);
    }
  });
});

test("inactive preference profiles are pruned after the retention window", async () => {
  await withStore(async (preferencesPath) => {
    const oldDate = new Date(Date.now() - 731 * 24 * 60 * 60 * 1000).toISOString();
    const recentDate = new Date().toISOString();

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
  });
});
