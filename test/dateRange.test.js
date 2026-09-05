import assert from "node:assert/strict";
import test from "node:test";
import { resolveDateRange } from "../src/dateRange.js";

// 2026-08-31 is a Monday; the upcoming weekend runs Fri 2026-09-04 through Sun 2026-09-06.
const MONDAY = new Date("2026-08-31T12:00:00Z");

test('"this weekend" and "this-weekend" alias the weekend preset', () => {
  const expected = { date_from: "2026-09-04", date_to: "2026-09-06" };
  assert.deepEqual(resolveDateRange("weekend", MONDAY), expected);
  assert.deepEqual(resolveDateRange("this weekend", MONDAY), expected);
  assert.deepEqual(resolveDateRange("this-weekend", MONDAY), expected);
  assert.deepEqual(resolveDateRange("This Weekend", MONDAY), expected);
});

for (const [day, expectedStart] of [["2026-09-04", "2026-09-04"], ["2026-09-05", "2026-09-05"], ["2026-09-06", "2026-09-06"]]) {
  test(`this weekend on ${day} includes the remaining current weekend`, () => {
    assert.deepEqual(resolveDateRange("this weekend", new Date(`${day}T12:00:00Z`)), {
      date_from: expectedStart,
      date_to: "2026-09-06"
    });
  });
}
