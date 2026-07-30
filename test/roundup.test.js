import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { resolveSingleDay, weekdayName } from "../src/dateRange.js";
import { dailyRoundup, resolveRoundupDay } from "../src/roundup.js";
import { callTool } from "../src/tools.js";

beforeEach(() => clearEventCache());

// 2026-08-07 is a Friday.
const FRIDAY_NOON = new Date("2026-08-07T12:00:00Z");

function dayEvent(id, overrides = {}) {
  return {
    id,
    title: `Event ${id}`,
    start_time: "2026-08-07T20:00:00Z",
    venue_name: "Somewhere",
    venue_city: "berlin",
    genres: [],
    vibe: [],
    event_types: [],
    lineup: [],
    ...overrides
  };
}

test("weekday and single-day resolution", () => {
  assert.equal(weekdayName("2026-08-07"), "friday");
  assert.equal(weekdayName("2026-08-09"), "sunday");
  assert.equal(weekdayName("not-a-date"), null);
  assert.equal(resolveSingleDay({ when: "tonight" }, FRIDAY_NOON), "2026-08-07");
  assert.equal(resolveSingleDay({ when: "2026-08-09" }, FRIDAY_NOON), "2026-08-09");
  assert.equal(resolveSingleDay({ date_from: "2026-08-09", date_to: "2026-08-09" }, FRIDAY_NOON), "2026-08-09");
  assert.equal(resolveSingleDay({ when: "weekend" }, FRIDAY_NOON), null);
  assert.equal(resolveSingleDay({ date_from: "2026-08-07", date_to: "2026-08-09" }, FRIDAY_NOON), null);
  assert.equal(resolveRoundupDay({ date: "2026-08-09" }, FRIDAY_NOON), "2026-08-09");
  assert.equal(resolveRoundupDay({ when: "tomorrow" }, FRIDAY_NOON), "2026-08-08");
  assert.equal(resolveRoundupDay({}, FRIDAY_NOON), "2026-08-07");
});

test("daily roundup groups the day into top picks and deduped category sections", async () => {
  const events = [
    dayEvent("e1", { title: "Techno Basement", genres: ["techno"], event_types: ["party"] }),
    dayEvent("e2", { title: "Jazz Set", event_types: ["live music"] }),
    dayEvent("e3", { title: "Gallery Opening", event_types: ["art"] }),
    dayEvent("e4", { title: "Standup Hour", event_types: ["comedy"] }),
    dayEvent("e5", { title: "City Talk", event_types: ["talk"] }),
    dayEvent("e6", { title: "Street Food Market", event_types: ["food"] }),
    dayEvent("e7", { title: "Mystery Happening" }),
    dayEvent("e8", { title: "Warehouse Rave", event_types: ["party"] })
  ];
  let requestedUrl = null;
  const roundup = await dailyRoundup({
    city: "berlin",
    when: "today",
    genres: ["techno"],
    top_limit: 1
  }, {
    now: FRIDAY_NOON,
    fetch: async (url) => {
      requestedUrl = new URL(url);
      return Response.json({ count: events.length, events });
    }
  });

  assert.equal(requestedUrl.searchParams.get("date_from"), "2026-08-07");
  assert.equal(requestedUrl.searchParams.get("date_to"), "2026-08-07");
  assert.equal(roundup.city, "berlin");
  assert.equal(roundup.date, "2026-08-07");
  assert.equal(roundup.weekday, "friday");
  assert.equal(roundup.total_available, 8);

  assert.equal(roundup.top_picks.length, 1);
  assert.equal(roundup.top_picks[0].id, "e1");
  assert.ok(roundup.top_picks[0].recommendation_reasons.some((reason) => reason.includes("genre match")));
  assert.ok(roundup.top_picks[0].event_url.startsWith("https://www.dizko.app/events/"));

  assert.deepEqual(roundup.sections.map((section) => section.key), [
    "parties", "live_music", "art_and_museums", "comedy_and_theatre",
    "talks_and_meetups", "food_and_drink", "more"
  ]);
  const parties = roundup.sections.find((section) => section.key === "parties");
  assert.deepEqual(parties.events.map((event) => event.id), ["e8"], "top pick must not repeat in its section");
  const more = roundup.sections.find((section) => section.key === "more");
  assert.deepEqual(more.events.map((event) => event.id), ["e7"]);
});

test("get_daily_roundup applies saved taste plus that weekday's day_filters", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eventchat-roundup-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    const created = await callTool("create_event_preference_profile", {
      consent: true,
      preferences: {
        genres: ["house"],
        day_filters: {
          friday: { genres: ["techno"], max_price: 30 },
          funday: { genres: ["ignored"] }
        }
      }
    }, { preferencesPath });
    const createdBody = JSON.parse(created.content[0].text);
    assert.deepEqual(createdBody.profile.preferences.day_filters.friday.genres, ["techno"]);
    assert.equal(createdBody.profile.preferences.day_filters.funday, undefined);

    const events = [
      dayEvent("pop-night", { title: "Chart Hits", genres: ["pop"], event_types: ["party"] }),
      dayEvent("techno-night", { title: "Techno Friday", genres: ["techno"], event_types: ["party"] })
    ];
    const fetchDay = async () => Response.json({ count: events.length, events });

    const friday = await callTool("get_daily_roundup", {
      city: "berlin",
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      top_limit: 1
    }, { preferencesPath, now: FRIDAY_NOON, fetch: fetchDay });
    const fridayBody = JSON.parse(friday.content[0].text);

    assert.equal(fridayBody.weekday, "friday");
    assert.ok(fridayBody.personalization.applied_preferences.genres.includes("techno"),
      "friday day_filters should join the applied preferences");
    assert.equal(fridayBody.personalization.applied_preferences.max_price, 30);
    assert.equal(fridayBody.top_picks[0].id, "techno-night");

    const saturday = await callTool("get_daily_roundup", {
      city: "berlin",
      date: "2026-08-08",
      profile_id: createdBody.profile.profile_id,
      profile_secret: createdBody.profile_secret,
      top_limit: 1
    }, { preferencesPath, now: FRIDAY_NOON, fetch: fetchDay });
    const saturdayBody = JSON.parse(saturday.content[0].text);

    assert.equal(saturdayBody.weekday, "saturday");
    assert.equal(saturdayBody.personalization.applied_preferences.genres.includes("techno"), false,
      "day_filters must stay scoped to their weekday");

    const wrongSecret = await callTool("get_daily_roundup", {
      city: "berlin",
      profile_id: createdBody.profile.profile_id,
      profile_secret: "ups_wrong",
      top_limit: 1
    }, { preferencesPath, now: FRIDAY_NOON, fetch: fetchDay });
    assert.equal(wrongSecret.isError, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unpersonalized get_daily_roundup returns the digest with render instructions", async () => {
  const events = [dayEvent("solo", { event_types: ["party"] })];
  const result = await callTool("get_daily_roundup", { city: "berlin" }, {
    now: FRIDAY_NOON,
    fetch: async () => Response.json({ count: 1, events })
  });
  const body = JSON.parse(result.content[0].text);
  assert.equal(result.isError, false);
  assert.equal(body.total_available, 1);
  assert.equal(body.personalization, undefined);
  assert.match(body.assistant_instruction, /daily digest/i);
});
