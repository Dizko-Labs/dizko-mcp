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
