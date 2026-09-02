import assert from "node:assert/strict";
import test from "node:test";
import { getArtistPage } from "../src/artistPage.js";
import { callTool, tools } from "../src/tools.js";

const PUBLISHED = {
  slug: "avalon-emerson",
  published_at: "2026-09-01T10:00:00Z",
  page: {
    schemaVersion: 1,
    slug: "avalon-emerson",
    blocks: [
      { id: "hdr", type: "header", payload: { name: "Avalon Emerson", city: "Berlin", tagline: "", imageUrl: "" } },
      { id: "mix-9000", type: "embed", payload: { title: "9000 Dreams live", provider: "soundcloud", url: "https://soundcloud.com/avalonemerson/9000" } },
      { id: "vid-1", type: "embed", payload: { title: "Boiler Room set", provider: "youtube", url: "https://youtube.com/watch?v=x" } },
      { id: "bio", type: "bio", payload: { heading: "About", body: "DJ and producer." } }
    ]
  }
};

function fetchReturning(response) {
  return async () => response;
}

test("getArtistPage projects only embed blocks from the published payload", async () => {
  const result = await getArtistPage({ handle: "AvalonEmerson" }, { fetch: fetchReturning(Response.json(PUBLISHED)) });

  assert.equal(result.published, true);
  assert.equal(result.handle, "AvalonEmerson");
  assert.equal(result.slug, "avalon-emerson");
  assert.deepEqual(result.embeds, [
    { id: "mix-9000", title: "9000 Dreams live", provider: "soundcloud", url: "https://soundcloud.com/avalonemerson/9000" },
    { id: "vid-1", title: "Boiler Room set", provider: "youtube", url: "https://youtube.com/watch?v=x" }
  ]);
});

test("getArtistPage maps 404 to published:false", async () => {
  const result = await getArtistPage({ handle: "AvalonEmerson" }, { fetch: fetchReturning(new Response("Not found", { status: 404 })) });

  assert.deepEqual(result, { published: false, handle: "AvalonEmerson", embeds: [] });
});

test("getArtistPage rejects invalid handles without a request", async () => {
  let called = false;
  const result = await getArtistPage({ handle: "no/slash" }, {
    fetch: async () => { called = true; return new Response("x"); }
  });

  assert.equal(result.published, false);
  assert.equal(result.error_code, "invalid_artist_handle");
  assert.equal(called, false);
});

test("get_artist_page tool emits deep-link instructions for a published page", async () => {
  const result = await callTool("get_artist_page", { handle: "AvalonEmerson" }, { fetch: fetchReturning(Response.json(PUBLISHED)) });

  assert.equal(result.isError, false);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.published, true);
  assert.equal(body.page_url, "https://www.dizko.app/AvalonEmerson");
  assert.match(body.assistant_instruction, /\?mix=/);
  assert.equal(body.embeds.length, 2);
});

test("get_artist_page tool steers to fallback when nothing is published", async () => {
  const result = await callTool("get_artist_page", { handle: "AvalonEmerson" }, { fetch: fetchReturning(new Response("Not found", { status: 404 })) });

  const body = JSON.parse(result.content[0].text);
  assert.equal(body.published, false);
  assert.match(body.assistant_instruction, /SoundCloud/);
});

test("get_artist_page is registered as a read-only tool", () => {
  const descriptor = tools.find((tool) => tool.name === "get_artist_page");

  assert.ok(descriptor);
  assert.equal(descriptor.annotations.readOnlyHint, true);
  assert.notEqual(descriptor.annotations.destructiveHint, true);
});
