import assert from "node:assert/strict";
import test from "node:test";
import { callTool, getPrompt, tools } from "../src/tools.js";
import { MCP_SERVER_INSTRUCTIONS } from "../src/config.js";
import { handleMcpRequest } from "../src/mcpServer.js";

const options = (body) => ({ retries: 0, fetch: async () => Response.json(body) });
const onboarding = (input, opts) => callTool("get_dizko_onboarding", input, opts);

test("onboarding is discoverable, read-only and part of first setup", async () => {
  const tool = tools.find((item) => item.name === "get_dizko_onboarding");
  assert.equal(tool.annotations.readOnlyHint, true);
  assert.deepEqual(tool.securitySchemes, [{ type: "noauth" }]);
  const server = await handleMcpRequest({ method: "initialize" });
  assert.match(server.instructions, /get_dizko_onboarding/);
  assert.match(MCP_SERVER_INSTRUCTIONS, /skip it for a concrete event request/);
  const prompt = await getPrompt("dizko_onboarding");
  assert.match(prompt.messages[0].content.text, /what's your SoundCloud/);
});

test("everyone can skip artist onboarding without a database request", async () => {
  const result = await onboarding({ audience: "everyone" }, {
    fetch: () => { throw new Error("must not fetch"); }
  });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.status, "discovery");
  assert.equal(result.structuredContent.discovery.paid_membership_required, false);
});

test("a SoundCloud match carries the real page, claim steps and explicit pricing handoff", async () => {
  let requested;
  const result = await onboarding({ audience: "dj", soundcloud: "https://soundcloud.com/mara?utm_source=test" }, {
    fetch: async (url, init) => {
      requested = url;
      assert.equal(init.method, undefined, "only GETs are allowed");
      return Response.json({
        status: "matched",
        matches: [{ id: "mara", name: "Mara", claimed: false, pages: [{ handle: "mara-music", url: "https://www.dizko.app/mara-music" }] }],
        examples: [{ handle: "published-example", url: "https://www.dizko.app/published-example" }]
      });
    }
  });
  const body = result.structuredContent;
  assert.equal(requested.pathname, "/scene/artist-onboarding");
  assert.equal(requested.searchParams.get("soundcloud"), "https://soundcloud.com/mara?utm_source=test");
  assert.equal(body.status, "matched");
  assert.equal(body.matches[0].pages[0].handle, "mara-music");
  assert.match(body.next_steps.join(" "), /verify ownership through SoundCloud/);
  assert.match(body.creators.pricing.advertised, /\$6\.50\/month/);
  assert.match(body.creators.pricing.advertised, /\$24\.99 per release/);
  assert.match(body.creators.pricing.note, /not a live checkout quote/);
  for (const url of Object.values(body.creators.links)) assert.equal(new URL(url).hostname, "build.dizko.app");
});

test("missing profiles offer creation without implying a lookup proved global absence", async () => {
  const result = await onboarding({ soundcloud: "@new-artist" }, options({ status: "not_found", matches: [], examples: [] }));
  assert.equal(result.structuredContent.status, "not_found");
  assert.match(result.structuredContent.next_steps.join(" "), /does not prove/);
  assert.match(result.structuredContent.next_steps.join(" "), /create a page/);
  assert.deepEqual(result.structuredContent.examples, []);
});

test("ambiguous and already-claimed matches never authorize taking ownership", async () => {
  const result = await onboarding({ soundcloud: "mara" }, options({
    status: "choose_profile", matches: [{ id: "a", claimed: true }, { id: "b", claimed: false }], examples: []
  }));
  const steps = result.structuredContent.next_steps.join(" ");
  assert.match(steps, /multiple matches, ask/);
  assert.match(steps, /owner account or use website support/);
  assert.match(steps, /not ownership verification/);
});

test("a database outage is never a missing artist or invented example", async () => {
  const result = await onboarding({ soundcloud: "mara" }, { retries: 0, fetch: async () => new Response("", { status: 503 }) });
  assert.equal(result.structuredContent.status, "lookup_unavailable");
  assert.equal(result.structuredContent.matches, undefined);
  assert.deepEqual(result.structuredContent.examples, []);
});

test("invalid, hostile and non-profile SoundCloud input fails before networking", async () => {
  for (const soundcloud of ["https://evil.test/mara", "https://soundcloud.com.evil.test/mara", "https://soundcloud.com/mara/track", "https://soundcloud.com@evil.test/mara", "https://me:secret@soundcloud.com/mara", "https://soundcloud.com:8443/mara", "   "]) {
    const result = await onboarding({ soundcloud }, { fetch: () => { throw new Error("must not fetch"); } });
    assert.equal(result.isError, true, soundcloud);
  }
});

test("venues and collectives get their own pathway without requiring SoundCloud", async () => {
  for (const audience of ["venue", "collective", "promoter"]) {
    const result = await onboarding({ audience }, { fetch: () => { throw new Error("must not fetch"); } });
    assert.equal(result.structuredContent.status, "scene_pathway");
    assert.match(result.structuredContent.next_steps.join(" "), /do not assume the artist price covers organizations/);
  }
});
