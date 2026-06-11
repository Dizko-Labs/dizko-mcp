import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearEventCache, searchEvents } from "../src/api.js";

const CONFIG = { apiBaseUrl: "https://api.example.test", userAgent: "test" };

beforeEach(() => clearEventCache());

function countingFetch(bodies) {
  let calls = 0;
  const fn = async () => {
    calls += 1;
    const next = bodies[Math.min(calls - 1, bodies.length - 1)];
    if (next instanceof Error) throw next;
    return Response.json(next);
  };
  fn.calls = () => calls;
  return fn;
}

function dnsError() {
  const error = new TypeError("fetch failed");
  error.cause = Object.assign(new Error("getaddrinfo EAI_AGAIN api.example.test"), { code: "EAI_AGAIN" });
  return error;
}

test("identical searches within the TTL hit the cache, expired ones refetch", async () => {
  let now = 1_000_000;
  const fetch = countingFetch([{ count: 1, events: [{ id: "a", title: "A" }] }]);
  const options = { config: CONFIG, fetch, clock: () => now, cacheTtlMs: 60_000 };

  await searchEvents({ city: "berlin", when: "any" }, options);
  await searchEvents({ city: "berlin", when: "any" }, options);
  assert.equal(fetch.calls(), 1, "second call within TTL must not refetch");

  now += 61_000;
  await searchEvents({ city: "berlin", when: "any" }, options);
  assert.equal(fetch.calls(), 2, "expired entry must refetch");
});

test("different queries do not share cache entries", async () => {
  const fetch = countingFetch([{ count: 0, events: [] }]);
  const options = { config: CONFIG, fetch, cacheTtlMs: 60_000 };
  await searchEvents({ city: "berlin", when: "any" }, options);
  await searchEvents({ city: "paris", when: "any" }, options);
  assert.equal(fetch.calls(), 2);
});

test("stale results are served when the upstream fails with a retryable error", async () => {
  let now = 1_000_000;
  let fail = false;
  let calls = 0;
  const options = {
    config: CONFIG,
    clock: () => now,
    cacheTtlMs: 60_000,
    cacheStaleMs: 3_600_000,
    retries: 0,
    sleep: async () => {},
    fetch: async () => {
      calls += 1;
      if (fail) throw dnsError();
      return Response.json({ count: 1, events: [{ id: "a", title: "Cached" }] });
    }
  };

  await searchEvents({ city: "berlin", when: "any" }, options);
  now += 120_000; // expired but within the stale window
  fail = true;
  const stale = await searchEvents({ city: "berlin", when: "any" }, options);
  assert.equal(stale.events[0].title, "Cached");
  assert.equal(calls, 2, "must try the network before falling back to stale");

  now += 4_000_000; // beyond the stale window
  await assert.rejects(searchEvents({ city: "berlin", when: "any" }, options));
});

test("non-retryable errors are not masked by stale cache", async () => {
  let now = 1_000_000;
  let status = 200;
  const options = {
    config: CONFIG,
    clock: () => now,
    cacheTtlMs: 60_000,
    retries: 0,
    fetch: async () => status === 200
      ? Response.json({ count: 0, events: [] })
      : new Response("unknown city", { status })
  };

  await searchEvents({ city: "atlantis", when: "any" }, options);
  now += 120_000;
  status = 422;
  await assert.rejects(searchEvents({ city: "atlantis", when: "any" }, options), (error) => {
    assert.equal(error.status, 422);
    return true;
  });
});

test("cacheTtlMs 0 disables caching entirely", async () => {
  const fetch = countingFetch([{ count: 0, events: [] }]);
  const options = { config: CONFIG, fetch, cacheTtlMs: 0 };
  await searchEvents({ city: "berlin", when: "any" }, options);
  await searchEvents({ city: "berlin", when: "any" }, options);
  assert.equal(fetch.calls(), 2);
});

test("cached responses are isolated copies, not shared references", async () => {
  const fetch = countingFetch([{ count: 1, events: [{ id: "a", title: "A", genres: ["techno"] }] }]);
  const options = { config: CONFIG, fetch, cacheTtlMs: 60_000 };

  const first = await searchEvents({ city: "berlin", when: "any" }, options);
  first.events[0].title = "MUTATED";
  first.events[0].recommendation_score = 99;

  const second = await searchEvents({ city: "berlin", when: "any" }, options);
  assert.equal(second.events[0].title, "A", "mutations must not leak into the cache");
  assert.equal(second.events[0].recommendation_score, undefined);
});

test("concurrent identical requests share one upstream fetch", async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const options = {
    config: CONFIG,
    cacheTtlMs: 60_000,
    fetch: async () => {
      calls += 1;
      await gate;
      return Response.json({ count: 1, events: [{ id: "a", title: "Shared" }] });
    }
  };

  const first = searchEvents({ city: "berlin", when: "any" }, options);
  const second = searchEvents({ city: "berlin", when: "any" }, options);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1, "followers must join the in-flight request");
  assert.equal(a.events[0].title, "Shared");
  b.events[0].title = "MUTATED";
  assert.equal(a.events[0].title, "Shared", "follower results must be isolated copies");
});

test("default search limit is 12 with offset paging", async () => {
  const urls = [];
  await searchEvents({ city: "berlin", when: "any" }, {
    config: CONFIG,
    cacheTtlMs: 0,
    fetch: async (url) => { urls.push(String(url)); return Response.json({ count: 0, events: [] }); }
  });
  assert.match(urls[0], /limit=12/);
  assert.match(urls[0], /offset=0/);
});
