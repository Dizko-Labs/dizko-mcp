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

test("buildEventQuery accepts natural week phrasing", () => {
  const params = buildEventQuery({
    city: "los angeles",
    when: "this week",
    limit: 5
  }, new Date("2026-06-10T12:00:00Z"));

  assert.equal(params.get("date_from"), "2026-06-10");
  assert.equal(params.get("date_to"), "2026-06-16");
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

function undiciDnsError(code = "EAI_AGAIN", hostname = "backend.example.test") {
  const error = new TypeError("fetch failed");
  error.cause = Object.assign(new Error(`getaddrinfo ${code} ${hostname}`), {
    code,
    syscall: "getaddrinfo",
    hostname
  });
  return error;
}

test("searchEvents retries transient DNS failures and succeeds", async () => {
  let calls = 0;
  const slept = [];
  const response = await searchEvents({ city: "los angeles", when: "any" }, {
    config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
    sleep: async (ms) => slept.push(ms),
    fetch: async () => {
      calls += 1;
      if (calls < 3) throw undiciDnsError();
      return Response.json({ events: [{ id: "evt-1", title: "Recovered" }], count: 1 });
    }
  });

  assert.equal(calls, 3);
  assert.equal(slept.length, 2, "should back off before each retry");
  assert.ok(slept[1] > slept[0], "backoff should grow between attempts");
  assert.equal(response.count, 1);
});

test("searchEvents surfaces DNS details and retryable=true after exhausting retries", async () => {
  let calls = 0;
  await assert.rejects(
    searchEvents({ city: "los angeles", when: "any" }, {
      config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
      sleep: async () => {},
      fetch: async () => {
        calls += 1;
        throw undiciDnsError();
      }
    }),
    (error) => {
      assert.equal(error.name, "EventChatNetworkError");
      assert.equal(error instanceof EventChatAPIError, true);
      assert.equal(error.code, "EAI_AGAIN");
      assert.equal(error.classification, "dns");
      assert.equal(error.retryable, true);
      assert.equal(error.status, null);
      assert.equal(error.hostname, "backend.example.test");
      assert.match(error.url, /^https:\/\/backend\.example\.test\/events\?/);
      assert.match(error.message, /DNS lookup for backend\.example\.test failed \(EAI_AGAIN\)/);
      return true;
    }
  );
  assert.equal(calls, 3, "default policy is 2 retries = 3 attempts");
});

test("searchEvents retries temporary 5xx responses and succeeds", async () => {
  let calls = 0;
  const response = await searchEvents({ city: "berlin", when: "any" }, {
    config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
    sleep: async () => {},
    fetch: async () => {
      calls += 1;
      if (calls < 3) return new Response("upstream unavailable", { status: 503 });
      return Response.json({ events: [], count: 0 });
    }
  });
  assert.equal(calls, 3);
  assert.equal(response.count, 0);
});

test("searchEvents marks an exhausted 5xx as retryable", async () => {
  await assert.rejects(
    searchEvents({ city: "berlin", when: "any" }, {
      config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
      retries: 1,
      sleep: async () => {},
      fetch: async () => new Response("bad gateway", { status: 502 })
    }),
    (error) => {
      assert.equal(error.status, 502);
      assert.equal(error.retryable, true);
      assert.match(error.url, /^https:\/\/backend\.example\.test\/events\?/);
      return true;
    }
  );
});

test("searchEvents does not retry client errors", async () => {
  let calls = 0;
  await assert.rejects(
    searchEvents({ city: "atlantis", when: "any" }, {
      config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
      sleep: async () => {},
      fetch: async () => {
        calls += 1;
        return new Response("unknown city", { status: 422 });
      }
    }),
    (error) => {
      assert.equal(error.status, 422);
      assert.equal(error.retryable, false);
      return true;
    }
  );
  assert.equal(calls, 1, "client errors must not be retried");
});

test("retries can be disabled with retries: 0", async () => {
  let calls = 0;
  await assert.rejects(
    searchEvents({ city: "berlin", when: "any" }, {
      config: { apiBaseUrl: "https://backend.example.test", userAgent: "test" },
      retries: 0,
      fetch: async () => {
        calls += 1;
        throw undiciDnsError();
      }
    })
  );
  assert.equal(calls, 1);
});
