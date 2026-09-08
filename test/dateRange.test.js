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

// ---------------------------------------------------------------------------
// Timezone-aware presets (AUDIT_2026-09-08.md Appendix B: resolveDateRange
// was only ever exercised at noon UTC).
// ---------------------------------------------------------------------------
import { isoDate, resolveSingleDay } from "../src/dateRange.js";
import { ToolInputError } from "../src/errors.js";

// 01:00 UTC on Saturday 2026-09-12 is still Friday evening in Los Angeles.
const LATE_UTC = new Date("2026-09-12T01:00:00Z");
// 2026-09-08 is a Tuesday; 2026-09-11 is the Friday of that week.
const TUESDAY = new Date("2026-09-08T12:00:00Z");
const FRIDAY = new Date("2026-09-11T12:00:00Z");

test('"tonight" resolves in the city timezone, not the server clock', () => {
  assert.deepEqual(resolveDateRange("tonight", LATE_UTC, "UTC"), { date_from: "2026-09-12", date_to: "2026-09-12" });
  assert.deepEqual(resolveDateRange("tonight", LATE_UTC, "Europe/Berlin"), { date_from: "2026-09-12", date_to: "2026-09-12" });
  assert.deepEqual(resolveDateRange("tonight", LATE_UTC, "America/Los_Angeles"), { date_from: "2026-09-11", date_to: "2026-09-11" });
  assert.deepEqual(resolveDateRange("today", LATE_UTC, "America/Los_Angeles"), { date_from: "2026-09-11", date_to: "2026-09-11" });
});

test('"weekend" on a Los Angeles Friday evening is Fri-Sun', () => {
  assert.deepEqual(resolveDateRange("weekend", LATE_UTC, "America/Los_Angeles"), { date_from: "2026-09-11", date_to: "2026-09-13" });
  assert.deepEqual(resolveDateRange("weekend", LATE_UTC, "UTC"), { date_from: "2026-09-12", date_to: "2026-09-13" });
});

test('"next weekend" from a Tuesday skips the coming weekend', () => {
  assert.deepEqual(resolveDateRange("next weekend", TUESDAY, "Europe/Berlin"), { date_from: "2026-09-18", date_to: "2026-09-20" });
  assert.deepEqual(resolveDateRange("weekend", TUESDAY, "Europe/Berlin"), { date_from: "2026-09-11", date_to: "2026-09-13" });
});

test("weekday names resolve to the nearest such day", () => {
  const friday = { date_from: "2026-09-11", date_to: "2026-09-11" };
  assert.deepEqual(resolveDateRange("friday", TUESDAY, "Europe/Berlin"), friday);
  assert.deepEqual(resolveDateRange("Fri", TUESDAY, "Europe/Berlin"), friday);
  assert.deepEqual(resolveDateRange("this friday", TUESDAY, "Europe/Berlin"), friday);
  assert.deepEqual(resolveDateRange("friday night", TUESDAY, "Europe/Berlin"), friday);
  assert.deepEqual(resolveDateRange("next friday", TUESDAY, "Europe/Berlin"), friday, '"next" only skips when today is that weekday');
});

test('"next friday" said on a Friday means a week out, "friday" means today', () => {
  assert.deepEqual(resolveDateRange("next friday", FRIDAY, "Europe/Berlin"), { date_from: "2026-09-18", date_to: "2026-09-18" });
  assert.deepEqual(resolveDateRange("friday", FRIDAY, "Europe/Berlin"), { date_from: "2026-09-11", date_to: "2026-09-11" });
});

test('"next week" is the coming Monday through Sunday', () => {
  assert.deepEqual(resolveDateRange("next week", TUESDAY, "Europe/Berlin"), { date_from: "2026-09-14", date_to: "2026-09-20" });
});

test('"month" runs from today to the end of the month', () => {
  assert.deepEqual(resolveDateRange("month", TUESDAY, "Europe/Berlin"), { date_from: "2026-09-08", date_to: "2026-09-30" });
});

test("an exact date is a single day and open presets are empty", () => {
  assert.deepEqual(resolveDateRange("2026-09-30", TUESDAY, "Europe/Berlin"), { date_from: "2026-09-30", date_to: "2026-09-30" });
  assert.deepEqual(resolveDateRange("any", TUESDAY, "Europe/Berlin"), {});
  assert.deepEqual(resolveDateRange(undefined, TUESDAY, "Europe/Berlin"), {});
});

test("unknown presets and impossible dates throw a ToolInputError on `when`", () => {
  assert.throws(() => resolveDateRange("someday", TUESDAY, "Europe/Berlin"), (error) =>
    error instanceof ToolInputError
    && error.field === "when"
    && error.code === "invalid_argument"
    && Array.isArray(error.allowed)
    && error.allowed.includes("tonight")
    && error.allowed.includes("next weekend"));
  assert.throws(() => resolveDateRange("2026-13-45", TUESDAY, "Europe/Berlin"), (error) =>
    error instanceof ToolInputError && error.field === "when" && /YYYY-MM-DD/.test(error.message));
});

test("isoDate and resolveSingleDay follow the requested timezone", () => {
  assert.equal(isoDate(LATE_UTC, "America/Los_Angeles"), "2026-09-11");
  assert.equal(isoDate(LATE_UTC, "UTC"), "2026-09-12");
  assert.equal(isoDate(LATE_UTC), "2026-09-12", "defaults to UTC");
  assert.equal(resolveSingleDay({ when: "tonight" }, LATE_UTC, "America/Los_Angeles"), "2026-09-11");
  assert.equal(resolveSingleDay({ when: "weekend" }, LATE_UTC, "America/Los_Angeles"), null, "multi-day ranges are not a single day");
  assert.equal(resolveSingleDay({ date_from: "2026-09-11", date_to: "2026-09-11" }, LATE_UTC, "UTC"), "2026-09-11");
  assert.equal(resolveSingleDay({ when: "someday" }, LATE_UTC, "UTC"), null, "invalid presets do not throw here");
});
