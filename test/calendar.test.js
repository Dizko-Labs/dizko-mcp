import assert from "node:assert/strict";
import test from "node:test";
import { buildCalendarEvent, buildIcs, escapeIcs, foldLine } from "../src/calendar.js";

const NOW = new Date("2026-09-01T10:00:00Z");

const EVENT = {
  id: "3d0ba4fd-a405-4d09-9d84-2dce75d63e41",
  title: "Loone with Gegen",
  start_time: "2026-09-09T17:00:00Z",
  venue_name: "AMT",
  venue_address: "Dircksenstraße 114, 10178 Berlin",
  venue_city: "berlin",
  lineup: ["Max Shen", "Nymed", "Mar/us"],
  billing: [
    { parts: [{ text: "19:00" }, { artist: "Max Shen" }] },
    { parts: [{ text: "20:00" }, { artist: "Nymed" }] }
  ],
  ticket_url: "https://ra.co/events/2515972",
  price_min: 0,
  genres: ["techno"]
};

// Raw content lines, without the trailing empty string after the final CRLF.
function rawLines(ics) {
  assert.ok(ics.endsWith("\r\n"), "ICS ends with CRLF");
  return ics.slice(0, -2).split("\r\n");
}

// RFC 5545 section 3.1: unfolding removes CRLF followed by a single space.
function unfold(ics) {
  return ics.replace(/\r\n /g, "");
}

function property(ics, name) {
  return unfold(ics).split("\r\n").find((line) => line.startsWith(`${name}:`)) || null;
}

test("DESCRIPTION separates lines with a single-escaped newline", () => {
  const { ics_content: ics } = buildCalendarEvent(EVENT, { now: NOW });
  const description = property(ics, "DESCRIPTION");
  assert.ok(description, "DESCRIPTION present");
  assert.ok(description.includes("(Europe/Berlin)\\nLineup:"), "backslash + n between lines");
  assert.ok(!ics.includes("\\\\n"), "never a double-escaped newline");
  assert.ok(!ics.includes("DESCRIPTION:When: Wed 9 Sep\\, 19:00 (Europe/Berlin)\n"), "never a raw newline inside a value");
});

test("DESCRIPTION carries When, Lineup and Set times when the data exists", () => {
  const { ics_content: ics } = buildCalendarEvent(EVENT, { now: NOW });
  const description = property(ics, "DESCRIPTION");
  assert.ok(description.includes("When: Wed 9 Sep\\, 19:00 (Europe/Berlin)"), description);
  assert.ok(description.includes("\\nLineup: Max Shen\\, Nymed\\, Mar/us"), description);
  assert.ok(description.includes("\\nSet times: 19:00 Max Shen\\, 20:00 Nymed"), description);
  assert.ok(description.includes("\\nEvent: https://www.dizko.app/events/3d0ba4fd-a405-4d09-9d84-2dce75d63e41"), description);
  assert.ok(description.includes("\\nTickets: https://ra.co/events/2515972"), description);

  const bare = buildCalendarEvent({ ...EVENT, lineup: [], billing: undefined }, { now: NOW });
  const bareDescription = property(bare.ics_content, "DESCRIPTION");
  assert.ok(!bareDescription.includes("Lineup:"));
  assert.ok(!bareDescription.includes("Set times:"));
});

test("no content line exceeds 75 octets, even with multi-byte text", () => {
  const long = buildCalendarEvent({
    ...EVENT,
    title: "Loone with Gegen presents a very long night in the Dircksenstraße with Größe, Süße and Straßenmusik until dawn",
    venue_address: "Dircksenstraße 114, 10178 Berlin, Straßenbahnhaltestelle Hackescher Markt, Größere Halle"
  }, { now: NOW });
  const lines = rawLines(long.ics_content);
  assert.ok(lines.length > 15, "the long title and address produce folded lines");
  for (const line of lines) {
    assert.ok(Buffer.byteLength(line, "utf8") <= 75, `${Buffer.byteLength(line, "utf8")} octets: ${JSON.stringify(line)}`);
    assert.ok(!line.includes("�"), "multi-byte characters are never split");
  }
  const folded = lines.filter((line) => line.startsWith(" "));
  assert.ok(folded.length >= 3, "SUMMARY, LOCATION and DESCRIPTION each fold at least once");
});

test("continuation lines start with a single space and unfold to the original text", () => {
  const { ics_content: ics } = buildCalendarEvent(EVENT, { now: NOW });
  for (const line of rawLines(ics)) {
    assert.ok(/^[A-Z][A-Z-]*[:;]/.test(line) || line.startsWith(" "), `content or continuation: ${JSON.stringify(line)}`);
  }
  // A single-space fold marker means the unfolded value is byte-exact.
  assert.equal(property(ics, "LOCATION"), "LOCATION:AMT\\, Dircksenstraße 114\\, 10178 Berlin");
  assert.equal(
    property(ics, "DESCRIPTION"),
    "DESCRIPTION:When: Wed 9 Sep\\, 19:00 (Europe/Berlin)\\nLineup: Max Shen\\, Nymed\\, Mar/us\\nSet times: 19:00 Max Shen\\, 20:00 Nymed\\nEvent: https://www.dizko.app/events/3d0ba4fd-a405-4d09-9d84-2dce75d63e41\\nTickets: https://ra.co/events/2515972"
  );
});

test("foldLine folds at 75 octets on character boundaries", () => {
  assert.equal(foldLine("A".repeat(75)), "A".repeat(75), "exactly 75 octets is not folded");
  assert.equal(foldLine("A".repeat(80)), `${"A".repeat(75)}\r\n ${"A".repeat(5)}`);

  const multibyte = foldLine("ß".repeat(40));
  const lines = multibyte.split("\r\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "ß".repeat(37), "37 two-byte characters = 74 octets");
  assert.equal(lines[1], ` ${"ß".repeat(3)}`);
  for (const line of lines) assert.ok(Buffer.byteLength(line, "utf8") <= 75);
});

test("LOCATION joins the venue and the address", () => {
  const { ics_content: ics, venue, address } = buildCalendarEvent(EVENT, { now: NOW });
  assert.equal(venue, "AMT");
  assert.equal(address, "Dircksenstraße 114, 10178 Berlin");
  assert.equal(property(ics, "LOCATION"), "LOCATION:AMT\\, Dircksenstraße 114\\, 10178 Berlin");

  const noAddress = buildCalendarEvent({ ...EVENT, venue_address: null }, { now: NOW });
  assert.equal(property(noAddress.ics_content, "LOCATION"), "LOCATION:AMT\\, Berlin", "falls back to the city");
});

test("DTEND defaults to DTSTART plus three hours when there is no end_time", () => {
  const entry = buildCalendarEvent(EVENT, { now: NOW });
  assert.equal(entry.starts_at, "2026-09-09T17:00:00Z");
  assert.equal(entry.ends_at, "2026-09-09T20:00:00.000Z");
  assert.equal(property(entry.ics_content, "DTSTART"), "DTSTART:20260909T170000Z");
  assert.equal(property(entry.ics_content, "DTEND"), "DTEND:20260909T200000Z");

  const withEnd = buildCalendarEvent({ ...EVENT, end_time: "2026-09-09T22:30:00Z" }, { now: NOW });
  assert.equal(withEnd.ends_at, "2026-09-09T22:30:00Z");
  assert.equal(property(withEnd.ics_content, "DTEND"), "DTEND:20260909T223000Z");
});

test("escapeIcs escapes commas, backslashes and newlines", () => {
  assert.equal(escapeIcs("a,b"), "a\\,b");
  assert.equal(escapeIcs("c\\d"), "c\\\\d");
  assert.equal(escapeIcs("line one\nline two"), "line one\\nline two");
  assert.equal(escapeIcs("crlf\r\nline"), "crlf\\nline");
  assert.equal(escapeIcs(null), "");
});

test("escapeIcs escapes semicolons", () => {
  assert.equal(escapeIcs("a;b"), "a\\;b");
  assert.equal(escapeIcs("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
});

test("ics_filename is a safe ASCII name derived from the title", () => {
  assert.equal(buildCalendarEvent(EVENT, { now: NOW }).ics_filename, "Loone-with-Gegen.ics");
  assert.equal(buildCalendarEvent({ ...EVENT, title: "Loone with Gegen [FREE ENTRY]" }, { now: NOW }).ics_filename, "Loone-with-Gegen-FREE-ENTRY.ics");
  assert.equal(buildCalendarEvent({ ...EVENT, title: "Röyksopp Café Night" }, { now: NOW }).ics_filename, "Royksopp-Cafe-Night.ics");
  assert.equal(buildCalendarEvent({ ...EVENT, title: "  --Ünderground / Größe--  " }, { now: NOW }).ics_filename, "Underground-Grose.ics");
  assert.equal(buildCalendarEvent({ ...EVENT, title: "" }, { now: NOW }).ics_filename, "event.ics");
});

test("options.now controls DTSTAMP", () => {
  const first = buildCalendarEvent(EVENT, { now: NOW });
  assert.equal(property(first.ics_content, "DTSTAMP"), "DTSTAMP:20260901T100000Z");
  const second = buildCalendarEvent(EVENT, { now: new Date("2026-09-02T23:59:59Z") });
  assert.equal(property(second.ics_content, "DTSTAMP"), "DTSTAMP:20260902T235959Z");
});

test("buildIcs writes the envelope, UID, STATUS and URL", () => {
  const ics = buildIcs({
    uid: "dizko-x@dizko.app",
    title: "Night; one, two",
    starts_at: "2026-09-09T17:00:00Z",
    ends_at: null,
    location: "AMT",
    description: "",
    url: "https://www.dizko.app/events/x",
    status: "TENTATIVE",
    now: NOW
  });
  const lines = rawLines(ics);
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-1), "END:VCALENDAR");
  assert.equal(property(ics, "UID"), "UID:dizko-x@dizko.app");
  assert.equal(property(ics, "DTEND"), "DTEND:20260909T170000Z", "buildIcs itself falls back to DTSTART");
  assert.equal(property(ics, "STATUS"), "STATUS:TENTATIVE");
  assert.equal(property(ics, "URL"), "URL:https://www.dizko.app/events/x");
  assert.equal(property(ics, "DESCRIPTION"), null, "an empty description is omitted");
  assert.ok(property(ics, "SUMMARY").startsWith("SUMMARY:Night"));
});

test("buildCalendarEvent exposes the summary fields and honours status", () => {
  const entry = buildCalendarEvent(EVENT, { now: NOW, status: "TENTATIVE" });
  assert.equal(entry.uid, "dizko-3d0ba4fd-a405-4d09-9d84-2dce75d63e41@dizko.app");
  assert.equal(entry.title, "Loone with Gegen");
  assert.equal(entry.timezone, "Europe/Berlin");
  assert.equal(entry.starts_at_local, "2026-09-09T19:00:00+02:00");
  assert.equal(entry.city, "Berlin");
  assert.equal(entry.status, "TENTATIVE");
  assert.equal(property(entry.ics_content, "STATUS"), "STATUS:TENTATIVE");
  assert.equal(buildCalendarEvent(EVENT, { now: NOW }).status, "CONFIRMED");
});
