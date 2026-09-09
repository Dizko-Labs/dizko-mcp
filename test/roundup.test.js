import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { resolveSingleDay, weekdayName } from "../src/dateRange.js";
import { isToolInputError } from "../src/errors.js";
import { dailyRoundup, resolveRoundupDay, withDefaultDayScore } from "../src/roundup.js";
import { callTool } from "../src/tools.js";

beforeEach(() => clearEventCache());

// 2026-08-07 is a Friday. Noon UTC is 14:00 in Berlin, still Friday.
const FRIDAY_NOON = new Date("2026-08-07T12:00:00Z");
// 23:30 UTC on that Friday is already 01:30 Saturday in Berlin.
const FRIDAY_LATE_UTC = new Date("2026-08-07T23:30:00Z");

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

function body(result) {
  return JSON.parse(result.content[0].text);
}

test("weekday and single-day resolution use the city timezone", () => {
  assert.equal(weekdayName("2026-08-07"), "friday");
  assert.equal(weekdayName("2026-08-09"), "sunday");
  assert.equal(weekdayName("not-a-date"), null);

  assert.equal(resolveSingleDay({ when: "tonight" }, FRIDAY_NOON), "2026-08-07");
  assert.equal(resolveSingleDay({ when: "tonight" }, FRIDAY_NOON, "Europe/Berlin"), "2026-08-07");
  assert.equal(resolveSingleDay({ when: "tonight" }, FRIDAY_LATE_UTC), "2026-08-07", "UTC default");
  assert.equal(resolveSingleDay({ when: "tonight" }, FRIDAY_LATE_UTC, "Europe/Berlin"), "2026-08-08", "city-local day wins");
  assert.equal(resolveSingleDay({ when: "sunday" }, FRIDAY_NOON, "Europe/Berlin"), "2026-08-09");
  assert.equal(resolveSingleDay({ when: "2026-08-09" }, FRIDAY_NOON), "2026-08-09");
  assert.equal(resolveSingleDay({ date_from: "2026-08-09", date_to: "2026-08-09" }, FRIDAY_NOON), "2026-08-09");
  assert.equal(resolveSingleDay({ when: "weekend" }, FRIDAY_NOON), null);
  assert.equal(resolveSingleDay({ date_from: "2026-08-07", date_to: "2026-08-09" }, FRIDAY_NOON), null);

  assert.equal(resolveRoundupDay({ date: "2026-08-09" }, FRIDAY_NOON), "2026-08-09");
  assert.equal(resolveRoundupDay({ when: "tomorrow" }, FRIDAY_NOON), "2026-08-08");
  assert.equal(resolveRoundupDay({}, FRIDAY_NOON), "2026-08-07");
  assert.equal(resolveRoundupDay({ city: "berlin" }, FRIDAY_LATE_UTC), "2026-08-08", "the city's timezone decides what today is");
  assert.equal(resolveRoundupDay({ city: "berlin", when: "friday" }, FRIDAY_LATE_UTC), "2026-08-14", "friday from a Berlin Saturday is next week");

  assert.throws(() => resolveRoundupDay({ when: "weekend" }, FRIDAY_NOON), (error) => {
    assert.ok(isToolInputError(error));
    assert.equal(error.code, "invalid_argument");
    assert.equal(error.field, "when");
    assert.match(error.hint, /date=2026-08-07/);
    return true;
  });
  assert.throws(() => resolveRoundupDay({ date: "2026-8-9" }, FRIDAY_NOON), (error) => {
    assert.ok(isToolInputError(error));
    assert.equal(error.field, "date");
    return true;
  });
});

test("unpersonalized day scoring: attendance, featured, time-of-day priors, tickets and tour penalty", () => {
  const score = (overrides) => withDefaultDayScore({ ...dayEvent("x", overrides), recommendation_reasons: ["happens soon"] }, "Europe/Berlin");

  const party = score({ event_types: ["party"], attendance_count: 1000, ticket_url: "https://t.example/x" });
  assert.equal(party.recommendation_score, 37, "30 attendance cap + 6 prime club hours + 1 ticket");
  assert.deepEqual(party.recommendation_reasons, ["strong attendance signal", "prime club hours"]);

  const earlyParty = score({ event_types: ["party"], start_time: "2026-08-07T16:00:00Z" });
  assert.equal(earlyParty.recommendation_score, 0, "18:00 local is not prime club hours");

  const show = score({ event_types: ["live music"], start_time: "2026-08-07T18:00:00Z", ra_pick: true });
  assert.equal(show.recommendation_score, 12, "8 featured + 4 evening show");
  assert.deepEqual(show.recommendation_reasons, ["featured pick", "evening show"]);

  const talk = score({ event_types: ["talk"], start_time: "2026-08-07T10:00:00Z" });
  assert.equal(talk.recommendation_score, 2);
  assert.deepEqual(talk.recommendation_reasons, []);

  const tour = score({ title: "Guided Walking Tour of Kreuzberg" });
  assert.equal(tour.recommendation_score, -8);
  assert.deepEqual(tour.recommendation_reasons, ["tour, not a night out"]);

  const small = score({ attendance_count: 9 });
  assert.equal(small.recommendation_score, 10, "log10(10) * 10 with no attendance reason below 100");
  assert.deepEqual(small.recommendation_reasons, []);
});

test("daily roundup groups the day into top picks and deduped category sections", async () => {
  const events = [
    dayEvent("e1", {
      title: "Techno Basement",
      genres: ["techno"],
      event_types: ["party"],
      attendance_count: 1000,
      price_min: 20,
      currency: "EUR",
      promoters: [{ name: "Klubnacht Crew", slug: "klubnacht" }],
      lineup: Array.from({ length: 10 }, (_, index) => `DJ ${index + 1}`),
      description: "Techno Basement takes place at Somewhere on Friday. DJ 1 and DJ 2 on the lineup. The listed genre is techno."
    }),
    dayEvent("e2", { title: "Jazz Set", event_types: ["live music"], start_time: "2026-08-07T18:00:00Z", ra_pick: true }),
    dayEvent("e3", { title: "Gallery Opening", event_types: ["art"], start_time: "2026-08-07T16:00:00Z" }),
    dayEvent("e4", { title: "Standup Hour", event_types: ["comedy"] }),
    dayEvent("e5", { title: "City Talk", event_types: ["talk"] }),
    dayEvent("e6", { title: "Street Food Market", event_types: ["food"], start_time: "2026-08-07T10:00:00Z" }),
    dayEvent("e7", { title: "Mystery Happening" }),
    dayEvent("e8", { title: "Warehouse Rave", event_types: ["party"], ticket_url: "https://tickets.example/e8" }),
    dayEvent("e9", { title: "Guided Walking Tour of Kreuzberg" })
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
  assert.deepEqual(requestedUrl.searchParams.getAll("genres"), ["techno"], "a typed genre is a real upstream filter");
  assert.equal(requestedUrl.searchParams.has("when"), false);

  assert.equal(roundup.city, "Berlin");
  assert.equal(roundup.city_slug, "berlin");
  assert.equal(roundup.date, "2026-08-07");
  assert.equal(roundup.weekday, "friday");
  assert.equal(roundup.timezone, "Europe/Berlin");
  assert.equal(roundup.total_available, 9);
  assert.equal(roundup.ranking, "popularity_and_time_of_day");

  assert.equal(roundup.top_picks.length, 1);
  const top = roundup.top_picks[0];
  assert.equal(top.id, "e1");
  assert.equal(top.recommendation_score, 36);
  assert.deepEqual(top.recommendation_reasons, ["strong attendance signal", "prime club hours"]);
  assert.equal(top.recommendation_reasons.includes("happens soon"), false);
  assert.ok(top.event_url.startsWith("https://www.dizko.app/events/"));

  // Event summaries carry local times and the display shape.
  assert.equal(top.when, "Fri 7 Aug, 22:00");
  assert.equal(top.starts_at, "2026-08-07T20:00:00Z");
  assert.equal(top.starts_at_local, "2026-08-07T22:00:00+02:00");
  assert.equal(top.timezone, "Europe/Berlin");
  assert.equal(top.city, "Berlin");
  assert.equal(top.city_slug, "berlin");
  assert.equal(top.price, "€20");
  assert.deepEqual(top.promoters, ["Klubnacht Crew"]);
  assert.equal(top.lineup.length, 8);
  assert.equal(top.lineup_count, 10);
  assert.equal(top.description, undefined, "boilerplate descriptions are dropped");
  assert.equal(top.featured, undefined);
  assert.equal(top.pick, undefined);

  assert.deepEqual(roundup.sections.map((section) => [section.key, section.title, section.count]), [
    ["parties", "Parties & club nights", 1],
    ["live_music", "Live music", 1],
    ["art_and_museums", "Art & museums", 1],
    ["comedy_and_theatre", "Comedy & theatre", 1],
    ["talks_and_meetups", "Talks & meetups", 1],
    ["food_and_drink", "Food & drink", 1],
    ["more", "More that day", 2]
  ]);
  const parties = roundup.sections.find((section) => section.key === "parties");
  assert.deepEqual(parties.events.map((event) => event.id), ["e8"], "top pick must not repeat in its section");
  assert.deepEqual(parties.events[0].recommendation_reasons, ["prime club hours"]);
  assert.equal(parties.events[0].recommendation_score, 7);

  const live = roundup.sections.find((section) => section.key === "live_music");
  assert.equal(live.events[0].featured, true);
  assert.deepEqual(live.events[0].recommendation_reasons, ["featured pick", "evening show"]);
  assert.equal(live.events[0].when, "Fri 7 Aug, 20:00");

  const more = roundup.sections.find((section) => section.key === "more");
  assert.deepEqual(more.events.map((event) => event.id), ["e7", "e9"]);
  assert.deepEqual(more.events[1].recommendation_reasons, ["tour, not a night out"]);
  assert.equal(more.events[1].recommendation_score, -8);
});

test("dizko_daily_roundup ranks by saved taste plus that weekday's day_filters without filtering upstream", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dizko-roundup-"));
  const preferencesPath = join(dir, "preferences.json");

  try {
    // A misspelled weekday is refused with the accepted keys rather than
    // silently dropped: a saved rule that quietly vanishes is worse than an
    // error the model can correct on the spot.
    const typo = body(await callTool("dizko_create_profile", {
      consent: true,
      preferences: { genres: ["house"], day_filters: { friday: { genres: ["techno"] }, funday: { genres: ["ignored"] } } }
    }, { preferencesPath }));
    assert.equal(typo.code, "invalid_argument");
    assert.equal(typo.field, "preferences.day_filters.funday");
    assert.deepEqual(typo.allowed, ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]);

    const created = body(await callTool("dizko_create_profile", {
      consent: true,
      preferences: {
        genres: ["house"],
        day_filters: {
          friday: { genres: ["techno"], max_price: 30 }
        }
      }
    }, { preferencesPath }));
    assert.deepEqual(created.profile.preferences.day_filters, { friday: { genres: ["techno"], max_price: 30 } });
    const { profile_id, profile_secret } = created;

    const events = [
      dayEvent("pop-night", { title: "Chart Hits", genres: ["pop"], event_types: ["party"], price_min: 45, currency: "EUR" }),
      dayEvent("techno-night", { title: "Techno Friday", genres: ["techno"], event_types: ["party"], price_min: 20, currency: "EUR" })
    ];
    let requestedUrl = null;
    const fetchDay = async (url) => {
      requestedUrl = new URL(url);
      return Response.json({ count: events.length, events });
    };

    const friday = await callTool("dizko_daily_roundup", {
      city: "berlin",
      profile_id,
      profile_secret,
      top_limit: 1
    }, { preferencesPath, now: FRIDAY_NOON, fetch: fetchDay });
    assert.equal(friday.isError, false);
    const fridayBody = body(friday);

    assert.equal(requestedUrl.searchParams.get("city"), "berlin");
    assert.equal(requestedUrl.searchParams.get("date_from"), "2026-08-07");
    assert.equal(requestedUrl.searchParams.has("genres"), false, "saved and day_filters genres rank, they do not filter");
    assert.equal(requestedUrl.searchParams.has("price_max"), false, "the Friday budget ranks, it does not filter");

    assert.equal(fridayBody.profile.profile_id, profile_id);
    assert.equal(fridayBody.city, "Berlin");
    assert.equal(fridayBody.city_slug, "berlin");
    assert.equal(fridayBody.date, "2026-08-07");
    assert.equal(fridayBody.weekday, "friday");
    assert.equal(fridayBody.timezone, "Europe/Berlin");
    assert.equal(fridayBody.total_available, 2);
    assert.equal(fridayBody.ranking, "saved_and_learned_taste");
    assert.deepEqual(fridayBody.personalization.applied_ranking_hints, { genres: ["house", "techno"], max_price: 30 },
      "friday day_filters join the ranking hints");
    assert.deepEqual(fridayBody.personalization.hard_filters_from_profile, []);
    assert.equal(fridayBody.personalization.applied_preferences, undefined);

    assert.equal(fridayBody.top_picks.length, 1);
    assert.equal(fridayBody.top_picks[0].id, "techno-night");
    assert.ok(fridayBody.top_picks[0].recommendation_reasons.includes("genre match: techno"));
    assert.ok(fridayBody.top_picks[0].recommendation_reasons.includes("within budget"));
    assert.equal(fridayBody.top_picks[0].price, "€20");
    const parties = fridayBody.sections.find((section) => section.key === "parties");
    assert.deepEqual(parties.events.map((event) => event.id), ["pop-night"], "over budget is a penalty, the event still shows");
    assert.ok(parties.events[0].recommendation_reasons.includes("over budget"));
    assert.ok(parties.events[0].recommendation_score < fridayBody.top_picks[0].recommendation_score);
    assert.match(fridayBody.assistant_instruction, /daily digest/i);

    const saturday = body(await callTool("dizko_daily_roundup", {
      city: "berlin",
      date: "2026-08-08",
      profile_id,
      profile_secret,
      top_limit: 1
    }, { preferencesPath, now: FRIDAY_NOON, fetch: fetchDay }));
    assert.equal(saturday.weekday, "saturday");
    assert.equal(saturday.date, "2026-08-08");
    assert.equal(saturday.ranking, "saved_and_learned_taste");
    assert.deepEqual(saturday.personalization.applied_ranking_hints, { genres: ["house"] }, "day_filters stay scoped to their weekday");

    const wrongSecret = await callTool("dizko_daily_roundup", {
      city: "berlin",
      profile_id,
      profile_secret: "dzs_wrong",
      top_limit: 1
    }, { preferencesPath, now: FRIDAY_NOON, fetch: fetchDay });
    assert.equal(wrongSecret.isError, true);
    assert.equal(body(wrongSecret).code, "profile_secret_invalid");

    const missingProfile = await callTool("dizko_daily_roundup", {
      city: "berlin",
      profile_id: "dzk_00000000-0000-0000-0000-000000000000",
      profile_secret
    }, { preferencesPath, now: FRIDAY_NOON, fetch: fetchDay });
    assert.equal(missingProfile.isError, true);
    assert.equal(body(missingProfile).code, "profile_not_found");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("unpersonalized dizko_daily_roundup returns the digest with render instructions", async () => {
  const events = [dayEvent("solo", { event_types: ["party"] })];
  const result = await callTool("dizko_daily_roundup", { city: "berlin" }, {
    now: FRIDAY_NOON,
    fetch: async () => Response.json({ count: 1, events })
  });
  assert.equal(result.isError, false);
  const digest = body(result);
  assert.deepEqual(Object.keys(digest).sort(), [
    "app_download_url", "assistant_instruction", "city", "city_slug", "date", "ranking",
    "sections", "timezone", "top_picks", "total_available", "weekday"
  ]);
  assert.equal(digest.profile, undefined);
  assert.equal(digest.personalization, undefined);
  assert.equal(digest.city, "Berlin");
  assert.equal(digest.city_slug, "berlin");
  assert.equal(digest.date, "2026-08-07");
  assert.equal(digest.weekday, "friday");
  assert.equal(digest.timezone, "Europe/Berlin");
  assert.equal(digest.total_available, 1);
  assert.equal(digest.ranking, "popularity_and_time_of_day");
  assert.deepEqual(digest.top_picks.map((event) => event.id), ["solo"]);
  assert.deepEqual(digest.top_picks[0].recommendation_reasons, ["prime club hours"]);
  assert.deepEqual(digest.sections, [], "the only event is already a top pick");
  assert.match(digest.app_download_url, /^https?:\/\//);
  assert.match(digest.assistant_instruction, /daily digest/i);
  assert.match(digest.assistant_instruction, /Top picks/);
});

test("compact dizko_daily_roundup trims to 3 picks, 4 sections of 3, and short event rows", async () => {
  const party = (id, attendance) => dayEvent(id, { event_types: ["party"], attendance_count: attendance, price_min: 10, currency: "EUR" });
  const at = (id, type, start) => dayEvent(id, { event_types: [type], start_time: start, price_min: 10, currency: "EUR" });
  const events = [
    party("p1", 500), party("p2", 400), party("p3", 300), party("p4", 200), party("p5", 150),
    at("m1", "live music", "2026-08-07T18:00:00Z"), at("m2", "live music", "2026-08-07T18:30:00Z"),
    at("m3", "live music", "2026-08-07T19:00:00Z"), at("m4", "live music", "2026-08-07T19:30:00Z"),
    at("a1", "art", "2026-08-07T15:00:00Z"), at("a2", "art", "2026-08-07T16:00:00Z"),
    at("c1", "comedy", "2026-08-07T18:00:00Z"), at("c2", "comedy", "2026-08-07T19:00:00Z"),
    at("t1", "talk", "2026-08-07T17:00:00Z"),
    at("f1", "food", "2026-08-07T11:00:00Z")
  ];
  const result = await callTool("dizko_daily_roundup", { city: "berlin", compact: true }, {
    now: FRIDAY_NOON,
    fetch: async () => Response.json({ count: events.length, events })
  });
  assert.equal(result.isError, false);
  const digest = body(result);

  assert.equal(digest.total_available, 15);
  assert.deepEqual(digest.top_picks.map((event) => event.id), ["p1", "p2", "p3"]);
  assert.deepEqual(digest.sections.map((section) => [section.key, section.count]), [
    ["parties", 2],
    ["live_music", 3],
    ["art_and_museums", 2],
    ["comedy_and_theatre", 2]
  ], "at most 4 sections of at most 3, talks and food fall off");
  assert.deepEqual(digest.sections[0].events.map((event) => event.id), ["p4", "p5"]);
  assert.deepEqual(digest.sections[1].events.map((event) => event.id), ["m1", "m2", "m3"]);

  const rows = [...digest.top_picks, ...digest.sections.flatMap((section) => section.events)];
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["event_url", "id", "price", "recommendation_reasons", "title", "venue", "when"], row.id);
    assert.equal(row.price, "€10");
    assert.equal(row.venue, "Somewhere");
    assert.match(row.when, /^Fri 7 Aug, \d\d:\d\d$/);
    assert.ok(row.event_url.startsWith("https://www.dizko.app/events/"));
  }
  assert.deepEqual(digest.top_picks[0].recommendation_reasons, ["strong attendance signal", "prime club hours"]);
  assert.match(digest.assistant_instruction, /short digest/i);
});

test("dizko_daily_roundup rejects ranges and malformed dates before any upstream call", async () => {
  let fetchCalled = false;
  const fetch = async () => {
    fetchCalled = true;
    return Response.json({ count: 0, events: [] });
  };

  const weekend = await callTool("dizko_daily_roundup", { city: "berlin", when: "weekend" }, { now: FRIDAY_NOON, fetch });
  assert.equal(weekend.isError, true);
  const weekendBody = body(weekend);
  assert.equal(weekendBody.code, "invalid_argument");
  assert.equal(weekendBody.field, "when");
  assert.match(weekendBody.error, /"weekend" is a range/);
  assert.ok(weekendBody.allowed.includes("today"));
  assert.match(weekendBody.hint, /date=2026-08-07/);
  assert.match(weekendBody.hint, /dizko_search_events/);

  const nextWeek = await callTool("dizko_daily_roundup", { city: "berlin", when: "next week" }, { now: FRIDAY_NOON, fetch });
  assert.equal(nextWeek.isError, true);
  assert.equal(body(nextWeek).field, "when");

  const badDate = await callTool("dizko_daily_roundup", { city: "berlin", date: "08/07/2026" }, { now: FRIDAY_NOON, fetch });
  assert.equal(badDate.isError, true);
  assert.equal(body(badDate).code, "invalid_argument");
  assert.equal(body(badDate).field, "date");
  assert.match(body(badDate).error, /YYYY-MM-DD/);

  const missingCity = await callTool("dizko_daily_roundup", { when: "today" }, { now: FRIDAY_NOON, fetch });
  assert.equal(missingCity.isError, true);
  assert.equal(body(missingCity).field, "city");

  assert.equal(fetchCalled, false);

  // Single-day presets still resolve, so the same inputs minus the range work.
  const single = await callTool("dizko_daily_roundup", { city: "berlin", when: "sunday" }, { now: FRIDAY_NOON, fetch });
  assert.equal(single.isError, false);
  assert.equal(body(single).date, "2026-08-09");
  assert.equal(body(single).weekday, "sunday");
  assert.equal(fetchCalled, true);
});
