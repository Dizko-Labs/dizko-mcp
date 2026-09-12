// Each test here reproduces a bug found by an adversarial review of the
// 0.8.0 refactor. They are grouped in one file so the reproductions stay
// next to the behaviour they pin rather than scattered by module.

import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { resolveDateRange, weekdayName } from "../src/dateRange.js";
import { findPromoter, findVenue, findSceneEntities, venueMatches } from "../src/entities.js";
import { clientIp, isExempt, readJson } from "../src/httpServer.js";
import { FilePreferenceStore, publicProfile } from "../src/preferences.js";
import { validatePurchaseConfirmation } from "../src/tickets.js";
import { callTool } from "../src/tools.js";

const CONFIG = { apiBaseUrl: "https://api.example.test", userAgent: "test" };
const NOW = new Date("2026-09-08T12:00:00Z");

beforeEach(() => clearEventCache());

function eventRow(id, overrides = {}) {
  return {
    id,
    title: `Event ${id}`,
    start_time: "2026-09-09T21:00:00+00:00",
    end_time: "2026-09-10T04:00:00+00:00",
    venue_name: `Venue ${id}`,
    venue_city: "berlin",
    genres: [],
    vibe: [],
    event_types: ["party"],
    lineup: [],
    ...overrides
  };
}

test("paging advances by rows consumed upstream, not rows that survived filtering", async () => {
  // Upstream holds 40 rows; half of them already ended, so the page the
  // caller receives is smaller than the page we read. Advancing the cursor
  // by the smaller number re-reads rows the caller already has.
  const all = Array.from({ length: 500 }, (_, index) => eventRow(`e${index}`, {
    start_time: index % 2 === 0 ? "2026-09-08T02:00:00+00:00" : "2026-09-08T21:00:00+00:00",
    end_time: index % 2 === 0 ? "2026-09-08T05:00:00+00:00" : "2026-09-09T04:00:00+00:00"
  }));

  const page = async (offset) => {
    const response = await callTool("dizko_search_events", { city: "berlin", when: "today", limit: 6, offset }, {
      config: CONFIG,
      now: NOW,
      fetch: async (url) => {
        const start = Number(new URL(url).searchParams.get("offset") || 0);
        const size = Number(new URL(url).searchParams.get("limit") || 12);
        return Response.json({ count: all.length, events: all.slice(start, start + size) });
      }
    });
    return response.structuredContent;
  };

  const first = await page(0);
  const second = await page(first.next_offset);
  const firstIds = first.events.map((event) => event.id);
  const secondIds = second.events.map((event) => event.id);
  const overlap = firstIds.filter((id) => secondIds.includes(id));

  assert.deepEqual(overlap, [], "a second page must not repeat events from the first");
  assert.ok(first.returned < 200, "the page really was filtered down");

  // Non-overlap alone is a weak property: a cursor that skips most of the day
  // also never repeats itself. Walking to exhaustion is what catches that, so
  // this asserts on the whole sequence, not on two pages.
  const seen = [];
  let offset = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const body = await page(offset);
    seen.push(...body.events.map((event) => event.id));
    if (body.next_offset === null) break;
    assert.notEqual(body.next_offset, offset, "a cursor that repeats itself loops forever");
    offset = body.next_offset;
  }

  assert.equal(new Set(seen).size, seen.length, "no event may be delivered twice across the walk");
  // Half the fixture ended before `now`; the rest is everything the caller
  // must be able to reach, capped by what one upstream fetch returns.
  assert.equal(seen.length, 100, "paging must reach every event of the day it fetched, not a sample of them");
});

test("a page whose events were all filtered out never points back at itself", async () => {
  // Everything on the requested day has ended. The old cursor arithmetic
  // returned next_offset === offset, so a client looping on it never stopped.
  const ended = Array.from({ length: 12 }, (_, index) => eventRow(`old${index}`, {
    start_time: "2026-09-08T02:00:00+00:00",
    end_time: "2026-09-08T05:00:00+00:00"
  }));

  const response = await callTool("dizko_search_events", { city: "berlin", when: "tonight", limit: 6, offset: 0 }, {
    config: CONFIG,
    now: NOW,
    fetch: async (url) => Response.json(String(url).includes("date_from")
      ? { count: 12, events: ended }
      : { count: 12, events: ended })
  });

  const body = response.structuredContent;
  assert.equal(body.returned, 0);
  assert.notEqual(body.next_offset, 0, "a cursor that repeats the current offset loops forever");
  assert.equal(body.has_more, false);
  assert.equal(body.next_offset, null);
});

test("taste ranking closes the paging keys instead of omitting them", async () => {
  const response = await callTool("dizko_search_events", { city: "berlin", when: "weekend", rank: "taste", genres: ["techno"] }, {
    config: CONFIG,
    now: NOW,
    fetch: async () => Response.json({ count: 2, events: [eventRow("a", { genres: ["techno"] }), eventRow("b")] })
  });

  const body = response.structuredContent;
  assert.equal(body.has_more, false);
  assert.equal(body.next_offset, null);
  assert.match(body.paging_note, /raise limit/);
});

test("taste ranking and night plans drop the same duplicate the plain search does", async () => {
  // One show, listed by two sources under slightly different venue strings.
  const duplicated = [
    eventRow("ra-1", { title: "Klubnacht", venue_name: "Berghain | Panorama Bar", attendance_count: 900, genres: ["techno"] }),
    eventRow("dice-1", { title: "Klubnacht", venue_name: "Berghain", attendance_count: 10, genres: ["techno"] }),
    eventRow("other", { title: "Something Else", venue_name: "Tresor", genres: ["techno"] })
  ];
  const options = {
    config: CONFIG,
    now: NOW,
    fetch: async () => Response.json({ count: duplicated.length, events: duplicated })
  };

  const taste = await callTool("dizko_search_events", { city: "berlin", when: "weekend", rank: "taste", genres: ["techno"] }, options);
  const tasteIds = taste.structuredContent.events.map((event) => event.id);
  assert.equal(tasteIds.length, 2, `taste mode kept a duplicate: ${tasteIds.join(", ")}`);

  const plan = await callTool("dizko_plan_night", { city: "berlin", when: "weekend" }, options);
  const planIds = plan.structuredContent.events.map((event) => event.id);
  assert.equal(new Set(planIds).size, planIds.length);
  assert.equal(planIds.length, 2, "a plan must not offer the same party as its own alternate");
});

test("next weekend is a Friday-to-Sunday block from every weekday", () => {
  for (let offset = 0; offset < 7; offset += 1) {
    const now = new Date(Date.UTC(2026, 8, 6 + offset, 12, 0, 0));
    const range = resolveDateRange("next weekend", now, "UTC");
    assert.equal(weekdayName(range.date_from), "friday", `from ${now.toISOString()} the block starts on the wrong day`);
    assert.equal(weekdayName(range.date_to), "sunday");
    // It must be genuinely ahead of the weekend that is running or next up.
    const thisWeekend = resolveDateRange("weekend", now, "UTC");
    assert.ok(range.date_from > thisWeekend.date_from, "next weekend must follow this one");
  }
});

test("an unmatched entity search is never reported as a confident match", async () => {
  // The scene index is semantic and always fills the page, so a query with no
  // name match still returns rows. Acting on one as `confident` sends the
  // model to the wrong artist.
  const result = await findVenue({ query: "Berghain Panorama Bar" }, {
    config: CONFIG,
    fetch: async () => Response.json({
      count: 2,
      items: [
        { id: "bar-oz", kind: "venue", name: "Bar", cities: ["Sydney"], matched_text: false },
        { id: "else", kind: "venue", name: "Else", cities: ["Berlin"], matched_text: false }
      ]
    })
  });

  assert.equal(result.best_match.confident, false, "a short generic name is not a confident match");
  assert.match(result.match_note, /No profile name matched/);
});

test("a real name match is still confident", async () => {
  const result = await findVenue({ query: "berghain" }, {
    config: CONFIG,
    fetch: async () => Response.json({
      count: 1,
      items: [{ id: "berghain", kind: "venue", name: "Berghain / Panorama Bar", cities: ["Berlin"], matched_text: true }]
    })
  });

  assert.equal(result.best_match.confident, true);
  assert.equal(result.match_note, undefined);
});

test("two promoters that share a display name stay two entities", async () => {
  const result = await findPromoter({ query: "herrensauna", city: "berlin", kind: "promoter" }, {
    config: CONFIG,
    fetch: async () => Response.json({
      city: "berlin",
      promoters: [
        { slug: "herrensauna", name: "Herrensauna", genres: ["techno"], upcoming_count: 3 },
        { slug: "herrensauna-berlin", name: "Herrensauna", genres: ["ebm"], upcoming_count: 9, next_event_at: "2026-09-11T21:00:00+00:00" }
      ]
    })
  });

  assert.equal(result.entities.length, 2, "merging them reports one promoter's dates under the other's id");
  const ids = result.entities.map((entity) => entity.id).sort();
  assert.deepEqual(ids, ["herrensauna", "herrensauna-berlin"]);
  const first = result.entities.find((entity) => entity.id === "herrensauna");
  assert.equal(first.next_event_at, undefined, "a date from the other promoter must not leak in");
});

test("a legacy entity lookup by id without a kind is rejected, not silently searched", async () => {
  let fetched = 0;
  const result = await findSceneEntities({ id: "berghain" }, {
    config: CONFIG,
    fetch: async () => {
      fetched += 1;
      return Response.json({ count: 0, items: [] });
    }
  });

  assert.equal(fetched, 0, "it must not search upstream for the literal string 'undefined'");
  assert.equal(result.code, "missing_entity_kind");
});

test("tool dispatch does not resolve names inherited from Object.prototype", async () => {
  for (const name of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"]) {
    const response = await callTool(name, { city: "berlin" }, { config: CONFIG, now: NOW, fetch: async () => Response.json({ count: 0, events: [] }) });
    assert.equal(response.isError, true, `${name} must not dispatch`);
    assert.equal(response.structuredContent.code, "unknown_tool", `${name} returned something other than unknown_tool`);
    assert.ok(Array.isArray(response.content), `${name} produced a malformed tool result`);
  }
});

test("a request body split mid-character decodes intact", async () => {
  // Node hands the request stream arbitrary chunk boundaries. Stringifying
  // each chunk on its own turns a multi-byte character split across two
  // chunks into U+FFFD, which silently mangles a city or artist name in a
  // large body instead of failing.
  const body = Buffer.from(JSON.stringify({ city: "São Paulo", notes: "Björk at Sónar" }), "utf8");

  async function* splitEveryByte() {
    for (const byte of body) yield Buffer.from([byte]);
  }

  const parsed = await readJson({ [Symbol.asyncIterator]: splitEveryByte }, 1024 * 1024);
  assert.deepEqual(parsed, { city: "São Paulo", notes: "Björk at Sónar" });

  // The size limit must count bytes, not the length of a corrupted string.
  await assert.rejects(
    readJson({ [Symbol.asyncIterator]: splitEveryByte }, 8),
    /Request body too large/
  );
});

test("the rate-limit client key comes from the proxy, not from the caller", () => {
  const request = (forwarded, socket) => ({ headers: forwarded === null ? {} : { "x-forwarded-for": forwarded }, socket: { remoteAddress: socket } });

  // One proxy in front: the last hop is the one it appended, and the
  // leading entries are whatever the caller claimed.
  assert.equal(clientIp(request("1.2.3.4, 203.0.113.9", "10.0.0.5"), 1), "203.0.113.9");
  assert.equal(clientIp(request("evil, 1.2.3.4, 203.0.113.9", "10.0.0.5"), 1), "203.0.113.9");
  assert.equal(clientIp(request("10.0.0.1, 1.2.3.4, 203.0.113.9", "10.0.0.5"), 2), "1.2.3.4");
  assert.equal(clientIp(request(null, "198.51.100.7"), 1), "198.51.100.7");
  assert.equal(clientIp(request("   ", "198.51.100.7"), 1), "198.51.100.7");

  // The exemption is keyed on the socket peer, which the caller cannot set,
  // so claiming an exempt-looking prefix in the header buys nothing.
  assert.equal(isExempt("10.0.0.7", ["10.0.0."]), true);
  assert.equal(isExempt("203.0.113.9", ["10.0.0."]), false);
  assert.equal(isExempt(undefined, ["10.0.0."]), false);
});

test("a confirmation must name the quantity, not merely contain its digits", () => {
  // "the 12th" is a date, not twelve tickets.
  assert.equal(validatePurchaseConfirmation({ quantity: 12, max_total: null }, "yes, purchase for the 12th").valid, false);
  assert.equal(validatePurchaseConfirmation({ quantity: 2, max_total: null }, "yes buy, budget 2,000").valid, false);
  // Grouped thousands and a comma decimal are the same number to a person.
  assert.equal(validatePurchaseConfirmation({ quantity: 2, max_total: 1000 }, "yes buy 2 tickets, max total 1,000 EUR").valid, true);
  assert.equal(validatePurchaseConfirmation({ quantity: 2, max_total: 12.5 }, "yes buy 2, max total 12,50").valid, true);
  // A number followed by ordinary punctuation still counts.
  assert.equal(validatePurchaseConfirmation({ quantity: 2, max_total: 240 }, "Yes, buy 2 ticket(s), max total USD240.").valid, true);
  // And the original substring holes stay closed.
  assert.equal(validatePurchaseConfirmation({ quantity: 2, max_total: 120 }, "I am the buyer, 20 people, 120 dollars").valid, false);
  assert.equal(validatePurchaseConfirmation({ quantity: 1, max_total: 24 }, "buy 10 tickets max total 2400").valid, false);
});

test("calendar files and ticket quotes honor a self-hosted base URL", async () => {
  const config = { ...CONFIG, webBaseUrl: "https://events.selfhost.test", mcpUrl: "https://mcp.selfhost.test/mcp", appDownloadUrl: "https://selfhost.test/ios" };
  const event = eventRow("e1", { ticket_url: "https://tickets.example.test/e1", price_min: 10, price_max: 10, currency: "EUR" });
  const options = { config, now: NOW, fetch: async () => Response.json(event) };

  const calendar = await callTool("dizko_calendar_file", { event_id: "e1" }, options);
  const ics = calendar.structuredContent.calendar_event;
  assert.match(ics.event_url, /events\.selfhost\.test/);
  assert.match(ics.ics_content, /events\.selfhost\.test/);
  assert.doesNotMatch(ics.ics_content, /www\.dizko\.app/, "a self-hosted deployment must not emit production links");

  const offers = await callTool("dizko_ticket_offers", { event_id: "e1" }, options);
  assert.match(offers.structuredContent.event.event_url, /events\.selfhost\.test/);
  assert.match(offers.structuredContent.event.calendar_url, /mcp\.selfhost\.test/);

  const quote = await callTool("dizko_quote_tickets", { event_id: "e1", quantity: 1 }, options);
  assert.match(quote.structuredContent.quote.event.event_url, /events\.selfhost\.test/);
});

test("a stored profile with no feedback array still reads and writes", async () => {
  const path = `${process.env.RUNNER_TEMP || "/tmp"}/dizko-legacy-${process.pid}-${Date.now()}.json`;
  const store = new FilePreferenceStore(path);
  const { profile, profile_secret: secret } = await store.createProfile({ genres: ["techno"] }, { consent: true });

  // Simulate a record written before `feedback` existed.
  const { readFile, writeFile, rm } = await import("node:fs/promises");
  const data = JSON.parse(await readFile(path, "utf8"));
  delete data.users[profile.profile_id].feedback;
  await writeFile(path, JSON.stringify(data));

  const legacy = await store.getProfile(profile.profile_id);
  assert.equal(publicProfile(legacy).feedback_count, 0, "reading a legacy profile must not throw");

  const recorded = await store.recordFeedback(profile.profile_id, { event_id: "e1", liked: true, event: { genres: ["techno"], venue: "AMT" } });
  assert.equal(recorded.profile.feedback.length, 1);
  assert.ok(secret.startsWith("dzs_"));
  await rm(path, { force: true });
});

test("venue token matching still holds after the entity changes", () => {
  assert.equal(venueMatches("Berghain / Panorama Bar", "Berghain | Panorama Bar | Säule"), true);
  assert.equal(venueMatches("Tresor", "Tresor / Globus"), true);
  assert.equal(venueMatches("BASEMENT", "Pacha NYC Basement"), false);
});

test("the single-day cursor does not shift when an event ends mid-walk", async () => {
  // `offset` used to index the list AFTER events that had ended were dropped.
  // Every event ending between two page fetches shifted that list left, and
  // the caller skipped exactly that many events that were still on.
  const rows = Array.from({ length: 24 }, (_, index) => eventRow(`s${index}`, {
    start_time: "2026-09-08T11:00:00+00:00",
    end_time: new Date(Date.UTC(2026, 8, 8, 12, index + 1)).toISOString()
  }));
  const page = async (offset, now) => {
    const response = await callTool("dizko_search_events", { city: "berlin", when: "today", limit: 6, offset }, {
      config: CONFIG,
      now,
      fetch: async () => Response.json({ count: rows.length, events: rows })
    });
    return response.structuredContent;
  };

  const first = await page(0, new Date("2026-09-08T12:00:00Z"));
  // Six minutes later, six of the events on page one have ended.
  const second = await page(first.next_offset, new Date("2026-09-08T12:06:00Z"));

  assert.deepEqual(first.events.map((event) => event.id), ["s0", "s1", "s2", "s3", "s4", "s5"]);
  assert.deepEqual(second.events.map((event) => event.id), ["s6", "s7", "s8", "s9", "s10", "s11"],
    "the second page must continue where the first stopped, not jump the number of events that ended");
});

test("count means what the caller can page through, and running off the end says so", async () => {
  // `count` was the upstream day total while `offset` indexed a shorter local
  // list, so a model paging by `count` ran past the end and was handed a
  // no_results payload telling it to say the city has nothing on.
  const rows = Array.from({ length: 300 }, (_, index) => eventRow(`e${index}`, {
    start_time: `2026-09-08T${String(13 + (index % 10)).padStart(2, "0")}:00:00+00:00`,
    end_time: "2026-09-09T04:00:00+00:00"
  }));
  const call = async (offset) => {
    const response = await callTool("dizko_search_events", { city: "berlin", when: "today", limit: 12, offset }, {
      config: CONFIG,
      now: NOW,
      fetch: async (url) => {
        const params = new URL(url).searchParams;
        const start = Number(params.get("offset") || 0);
        const size = Number(params.get("limit") || 12);
        return Response.json({ count: rows.length, events: rows.slice(start, start + size) });
      }
    });
    return response.structuredContent;
  };

  const seen = new Set();
  let offset = 0;
  let first = null;
  for (let guard = 0; guard < 60; guard += 1) {
    const body = await call(offset);
    first ??= body;
    body.events.forEach((event) => seen.add(event.id));
    if (body.next_offset === null) break;
    offset = body.next_offset;
  }

  assert.equal(first.count, seen.size, "count must equal what paging actually reaches");
  assert.equal(first.total_listed, 300, "the raw upstream total is still reported, separately");

  const pastEnd = await call(500);
  assert.equal(pastEnd.returned, 0);
  assert.equal(pastEnd.has_more, false);
  assert.equal(pastEnd.no_results, undefined, "past the end of a day is not an empty city");
  assert.match(pastEnd.paging_note, /past the end/);
});

test("an exact date for today behaves exactly like the word today", async () => {
  // "today" took the single-day path (whole day fetched, finished events
  // dropped, local paging) while "2026-09-08" took the multi-day one, so the
  // same evening answered differently depending on how it was named.
  const rows = [
    eventRow("ended", { start_time: "2026-09-08T02:00:00+00:00", end_time: "2026-09-08T05:00:00+00:00" }),
    eventRow("matinee", { start_time: "2026-09-08T14:00:00+00:00", end_time: "2026-09-08T18:00:00+00:00" }),
    eventRow("night", { start_time: "2026-09-08T21:00:00+00:00", end_time: "2026-09-09T04:00:00+00:00" })
  ];
  const call = async (when) => {
    const response = await callTool("dizko_search_events", { city: "berlin", when, limit: 10 }, {
      config: CONFIG,
      now: NOW,
      fetch: async () => Response.json({ count: rows.length, events: rows })
    });
    return response.structuredContent;
  };

  const preset = await call("today");
  const exact = await call("2026-09-08");
  assert.deepEqual(exact.events.map((event) => event.id), preset.events.map((event) => event.id));
  assert.deepEqual(exact.events.map((event) => event.id), ["matinee", "night"], "the event that already ended is dropped either way");
  assert.equal(exact.filter_note, preset.filter_note);
});

test("an evening search for tomorrow drops the matinee and does not talk about today", async () => {
  // The evening filter matched only "tonight" and "evening", so "tomorrow
  // night" returned a 10:00 matinee, under a note about events ending today.
  const rows = [
    eventRow("matinee", { start_time: "2026-09-09T10:00:00+00:00", end_time: "2026-09-09T14:00:00+00:00" }),
    eventRow("clubnight", { start_time: "2026-09-09T22:00:00+00:00", end_time: "2026-09-10T05:00:00+00:00" })
  ];
  const response = await callTool("dizko_search_events", { city: "berlin", when: "tomorrow night", limit: 10 }, {
    config: CONFIG,
    now: NOW,
    fetch: async () => Response.json({ count: rows.length, events: rows })
  });
  const body = response.structuredContent;

  assert.deepEqual(body.events.map((event) => event.id), ["clubnight"]);
  assert.doesNotMatch(body.filter_note, /today/, "a search for tomorrow must not be explained in terms of today");
});
