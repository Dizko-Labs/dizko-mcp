import assert from "node:assert/strict";
import test from "node:test";
import { localTimestamp, localWeekday, timeZoneForCity } from "../src/localTime.js";
import { googleCalendarUrl, summarizeEvent } from "../src/format.js";

test("a late-night event keeps its real local date", () => {
  // The reported case: an 8pm Wednesday show at Madison Square Garden is
  // midnight Thursday in UTC. The upstream description said "Wednesday 26
  // August" and starts_at said 2026-08-27; the description was right.
  const event = {
    id: "msg-1",
    title: "Harry Styles: Together, Together",
    start_time: "2026-08-27T00:00:00+00:00",
    venue_name: "Madison Square Garden",
    venue_city: "new york"
  };
  const summary = summarizeEvent(event);

  assert.equal(summary.starts_at, "2026-08-27T00:00:00+00:00");
  assert.equal(summary.starts_at_local, "2026-08-26T20:00:00-04:00");
  assert.equal(summary.local_weekday, "Wednesday");
});

test("local time follows daylight saving rather than a stored offset", () => {
  assert.equal(localTimestamp("2026-08-27T00:00:00+00:00", "new york"), "2026-08-26T20:00:00-04:00");
  assert.equal(localTimestamp("2026-01-15T02:00:00+00:00", "new york"), "2026-01-14T21:00:00-05:00");
});

test("city lookup folds case, spacing and accents", () => {
  assert.equal(timeZoneForCity("São Paulo"), "America/Sao_Paulo");
  assert.equal(timeZoneForCity("  BERLIN "), "Europe/Berlin");
  assert.equal(timeZoneForCity("Zürich"), null);
});

test("an uncovered or missing city degrades to no local rendering", () => {
  assert.equal(localTimestamp("2026-08-27T00:00:00+00:00", "atlantis"), null);
  assert.equal(localTimestamp("2026-08-27T00:00:00+00:00", undefined), null);
  assert.equal(localWeekday("not-a-date", "new york"), null);
  // The summary still renders, just without the local fields.
  const summary = summarizeEvent({ id: "x", title: "T", start_time: "2026-08-27T00:00:00+00:00", venue_city: "atlantis" });
  assert.equal(summary.starts_at, "2026-08-27T00:00:00+00:00");
  assert.equal(summary.starts_at_local, undefined);
});

test("an end time before its start does not build a backwards calendar range", () => {
  // Upstream carries rows like this - 22 of a 1,200-event sample.
  const url = googleCalendarUrl({
    title: "Harry Styles @ Madison Square Garden",
    starts_at: "2026-08-30T00:00:00+00:00",
    ends_at: "2026-08-29T04:00:00+00:00"
  });

  assert.match(url, /dates=20260830T000000Z%2F20260830T030000Z/);
});

test("a sane end time is still used as given", () => {
  const url = googleCalendarUrl({
    title: "T",
    starts_at: "2026-08-30T00:00:00+00:00",
    ends_at: "2026-08-30T06:00:00+00:00"
  });

  assert.match(url, /dates=20260830T000000Z%2F20260830T060000Z/);
});

test("every supported city has a time zone", async () => {
  const { SUPPORTED_CITIES } = await import("../src/config.js");
  const missing = SUPPORTED_CITIES.filter((city) => !timeZoneForCity(city));
  assert.deepEqual(missing, [], `cities without a time zone: ${missing.join(", ")}`);
});
