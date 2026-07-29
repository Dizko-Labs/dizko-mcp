import assert from "node:assert/strict";
import test from "node:test";
import { rankEvents } from "../src/rank.js";

test("rankEvents promotes matching taste signals with reasons", () => {
  const events = [
    {
      id: "ambient",
      title: "Quiet Listening",
      start_time: "2026-06-20T21:00:00Z",
      genres: ["ambient"],
      vibe: ["seated"],
      event_types: ["concert"]
    },
    {
      id: "techno",
      title: "Basement Techno",
      start_time: "2026-06-10T23:00:00Z",
      genres: ["techno"],
      vibe: ["underground"],
      event_types: ["party"],
      attendance_count: 250
    }
  ];

  const ranked = rankEvents(events, {
    genres: ["techno"],
    vibe: ["underground"],
    nightlife: true
  }, new Date("2026-06-09T12:00:00Z"));

  assert.equal(ranked[0].id, "techno");
  assert.ok(ranked[0].recommendation_score > ranked[1].recommendation_score);
  assert.ok(ranked[0].recommendation_reasons.some((reason) => reason.includes("genre match")));
});

test("rankEvents applies budget, venue, artist, and semantic avoid signals", () => {
  const events = [
    {
      id: "fit",
      title: "Small Room Session",
      venue_name: "Night Room",
      start_time: "2026-06-10T21:00:00Z",
      price_min: 18,
      genres: ["techno"],
      vibe: ["intimate"],
      event_types: ["party"],
      lineup: ["Selector One"],
      attendance_count: 120
    },
    {
      id: "avoid",
      title: "Arena Techno",
      venue_name: "Big Hall",
      start_time: "2026-06-10T22:00:00Z",
      price_min: 70,
      genres: ["techno"],
      vibe: ["high-energy"],
      event_types: ["party"],
      lineup: ["Selector Two"],
      attendance_count: 1200
    }
  ];

  const ranked = rankEvents(events, {
    genres: ["techno"],
    venues: ["Night Room"],
    featuring: ["Selector One"],
    max_price: 25,
    avoid: ["huge crowds", "expensive tickets"]
  }, new Date("2026-06-09T12:00:00Z"));

  assert.equal(ranked[0].id, "fit");
  assert.ok(ranked[0].recommendation_reasons.some((reason) => reason.includes("venue match")));
  assert.ok(ranked[0].recommendation_reasons.some((reason) => reason.includes("artist match")));
  assert.ok(ranked[1].recommendation_reasons.includes("over budget"));
  assert.ok(ranked[1].recommendation_reasons.includes("penalized: huge crowds"));
  assert.ok(ranked[1].recommendation_reasons.includes("penalized: expensive tickets"));
});

test("rankEvents catches avoid terms inside titles and descriptions", () => {
  const ranked = rankEvents([
    {
      id: "mainstream",
      title: "The Mainstream Club Return",
      description: "A commercial festival-sized room.",
      genres: [],
      vibe: [],
      event_types: ["party"]
    }
  ], { avoid: ["mainstream"] });

  assert.ok(ranked[0].recommendation_reasons.includes("penalized: mainstream"));
});
