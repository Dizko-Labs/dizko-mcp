import assert from "node:assert/strict";
import test from "node:test";
import { buildEventQuery, EventChatAPIError, getEvent, searchEvents } from "../src/api.js";

test("buildEventQuery maps structured filters to API params", () => {
  const params = buildEventQuery({
    city: "berlin",
    when: "weekend",
    genres: ["techno", "house"],
    vibe: "underground",
    free: true,
    limit: 5
  }, new Date("2026-06-09T12:00:00Z"));

  assert.equal(params.get("city"), "berlin");
  assert.equal(params.get("date_from"), "2026-06-12");
  assert.equal(params.get("date_to"), "2026-06-14");
  assert.deepEqual(params.getAll("genres"), ["techno", "house"]);
  assert.deepEqual(params.getAll("vibe"), ["underground"]);
  assert.equal(params.get("free"), "true");
  assert.equal(params.get("limit"), "5");
});

test("searchEvents calls /events and returns JSON", async () => {
  const calls = [];
  const response = await searchEvents({ city: "paris" }, {
    config: { apiBaseUrl: "https://api.example.test", userAgent: "test" },
    fetch: async (url) => {
      calls.push(String(url));
      return Response.json({ events: [], count: 0, limit: 25, offset: 0 });
    }
  });

  assert.equal(response.count, 0);
  assert.match(calls[0], /^https:\/\/api\.example\.test\/events\?/);
  assert.match(calls[0], /city=paris/);
});

test("searchEvents times out slow upstream calls", async () => {
  await assert.rejects(
    searchEvents({ city: "berlin" }, {
      config: { apiBaseUrl: "https://api.example.test", userAgent: "test", apiTimeoutMs: 5 },
      fetch: async (_url, init) => {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(resolve, 50);
          init.signal.addEventListener("abort", () => {
            clearTimeout(timer);
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        });
      }
    }),
    (error) => {
      assert.equal(error instanceof EventChatAPIError, true);
      assert.equal(error.status, 504);
      assert.match(error.message, /timed out/);
      return true;
    }
  );
});

test("getEvent URL-encodes event ids", async () => {
  const calls = [];
  await getEvent("ra/events 123", {
    config: { apiBaseUrl: "https://api.example.test", userAgent: "test" },
    fetch: async (url) => {
      calls.push(String(url));
      return Response.json({ id: "ra/events 123", title: "Test" });
    }
  });

  assert.equal(calls[0], "https://api.example.test/events/ra%2Fevents%20123");
});
