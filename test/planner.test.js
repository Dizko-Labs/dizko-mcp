import assert from "node:assert/strict";
import test from "node:test";
import { buildPlan } from "../src/planner.js";

test("buildPlan keeps a strong primary plus nearby and later fallbacks", () => {
  const events = [
    {
      id: "primary",
      recommendation_score: 90,
      start_time: "2026-08-01T20:00:00Z",
      lat: 52.52,
      lng: 13.405
    },
    {
      id: "later",
      recommendation_score: 80,
      start_time: "2026-08-01T23:00:00Z",
      lat: 52.60,
      lng: 13.50
    },
    {
      id: "nearby",
      recommendation_score: 70,
      start_time: "2026-08-01T19:00:00Z",
      lat: 52.521,
      lng: 13.406
    }
  ];

  const plan = buildPlan(events, { result_limit: 3 });

  assert.deepEqual(plan.map((event) => event.id), ["primary", "nearby", "later"]);
  assert.deepEqual(plan.map((event) => event.plan_role), [
    "primary",
    "nearby_fallback",
    "later_fallback"
  ]);
  assert.equal(plan[1].distance_from_primary_km < 1, true);
  assert.match(plan[1].plan_note, /km from the primary/);
  assert.match(plan[2].plan_note, /Later-starting fallback/);
});

test("buildPlan degrades to ranked alternates without coordinates or dates", () => {
  const plan = buildPlan([
    { id: "primary", recommendation_score: 40 },
    { id: "second", recommendation_score: 30 }
  ], { result_limit: 2 });

  assert.deepEqual(plan.map((event) => event.plan_role), ["primary", "alternate"]);
  assert.equal(plan[1].distance_from_primary_km, null);
});

test("buildPlan does not treat null coordinates as the same location", () => {
  const plan = buildPlan([
    {
      id: "primary",
      recommendation_score: 90,
      start_time: "2026-08-01T20:00:00Z",
      lat: null,
      lng: null
    },
    {
      id: "later",
      recommendation_score: 80,
      start_time: "2026-08-01T23:00:00Z",
      lat: null,
      lng: null
    }
  ], { result_limit: 2 });

  assert.deepEqual(plan.map((event) => event.plan_role), ["primary", "later_fallback"]);
  assert.equal(plan[1].distance_from_primary_km, null);
});
