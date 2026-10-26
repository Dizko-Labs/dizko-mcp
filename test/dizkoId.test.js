import assert from "node:assert/strict";
import test from "node:test";
import { classifyMixUrl, DEFAULT_DIZKO_ID_INSTALL_URL, openMixInDizkoId } from "../src/dizkoId.js";
import { callTool } from "../src/tools.js";
import { surfaceTools } from "../src/surfaces.js";

const MIX = "https://soundcloud.com/julianahuxtable/german-visa-pipeline-dekmantel-mix-288";

const OEMBED = {
  version: 1,
  type: "rich",
  provider_name: "SoundCloud",
  title: "German Visa Pipeline (Dekmantel Mix 288) by Juliana Huxtable",
  author_name: "Juliana Huxtable",
  author_url: "https://soundcloud.com/julianahuxtable",
  thumbnail_url: "https://i1.sndcdn.com/artworks-abc-t500x500.jpg",
  html: "<iframe></iframe>"
};

function recordingFetch(handler) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { fetch, calls };
}

test("classifyMixUrl accepts a SoundCloud track page and strips tracking params", () => {
  assert.deepEqual(classifyMixUrl(`${MIX}?si=abc123&utm_source=clipboard#t=1:00`), { kind: "soundcloud", url: MIX });
  assert.deepEqual(classifyMixUrl("https://m.soundcloud.com/julianahuxtable/german-visa-pipeline-dekmantel-mix-288"), { kind: "soundcloud", url: MIX });
  assert.deepEqual(classifyMixUrl("https://www.soundcloud.com/julianahuxtable/german-visa-pipeline-dekmantel-mix-288/"), { kind: "soundcloud", url: MIX });
});

test("classifyMixUrl refuses links where the extension shows no button", () => {
  for (const raw of [
    "https://soundcloud.com/julianahuxtable",
    "https://soundcloud.com/julianahuxtable/sets/favourites",
    "https://soundcloud.com/julianahuxtable/likes",
    "https://soundcloud.com/discover/sets",
    "https://soundcloud.com/search/sounds"
  ]) {
    assert.equal(classifyMixUrl(raw).code, "not_a_mix", raw);
  }
  assert.equal(classifyMixUrl(`${MIX}/s-AbC123xyz`).code, "private_mix");
});

test("classifyMixUrl names YouTube and Mixcloud as not yet supported", () => {
  const youtube = classifyMixUrl("https://www.youtube.com/watch?v=abc");
  assert.equal(youtube.code, "platform_not_yet_supported");
  assert.equal(youtube.platform, "youtube");
  assert.equal(classifyMixUrl("https://youtu.be/abc").platform, "youtube");
  assert.equal(classifyMixUrl("https://www.mixcloud.com/dj/mix/").platform, "mixcloud");
  assert.equal(classifyMixUrl("https://example.com/mix").code, "platform_not_supported");
  assert.equal(classifyMixUrl("not a url").code, "invalid_mix_url");
  assert.equal(classifyMixUrl("javascript:alert(1)").code, "invalid_mix_url");
});

test("openMixInDizkoId returns the hand-off with SoundCloud's title and uploader", async () => {
  const { fetch, calls } = recordingFetch(() => Response.json(OEMBED));
  const result = await openMixInDizkoId({ mix_url: `${MIX}?si=x` }, { fetch });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(MIX)}`);
  assert.equal(result.supported, true);
  assert.equal(result.open_url, MIX);
  assert.deepEqual(result.mix, {
    url: MIX,
    title: OEMBED.title,
    uploader: "Juliana Huxtable",
    uploader_url: "https://soundcloud.com/julianahuxtable",
    artwork_url: OEMBED.thumbnail_url,
    verified: true
  });
  assert.equal(result.extension.install_url, DEFAULT_DIZKO_ID_INSTALL_URL);
  assert.ok(result.steps.some((step) => /never checks out/.test(step)));
});

test("openMixInDizkoId never sends Dizko's upstream secret to SoundCloud", async () => {
  const { fetch, calls } = recordingFetch(() => Response.json(OEMBED));
  await openMixInDizkoId({ mix_url: MIX }, { fetch, config: { upstreamSecret: "shh" } });
  assert.equal(JSON.stringify(calls[0].init.headers).includes("shh"), false);
});

test("openMixInDizkoId still hands off when SoundCloud cannot be reached", async () => {
  const result = await openMixInDizkoId({ mix_url: MIX }, { fetch: async () => { throw new TypeError("fetch failed"); } });
  assert.equal(result.supported, true);
  assert.deepEqual(result.mix, { url: MIX, verified: false });
});

test("openMixInDizkoId reports a mix SoundCloud does not have", async () => {
  const result = await openMixInDizkoId({ mix_url: MIX }, { fetch: async () => new Response("", { status: 404 }) });
  assert.equal(result.supported, false);
  assert.equal(result.code, "mix_not_found");
});

test("openMixInDizkoId resolves an on.soundcloud.com share link one hop, without following it", async () => {
  const { fetch, calls } = recordingFetch((url) => url.startsWith("https://on.soundcloud.com/")
    ? new Response(null, { status: 302, headers: { location: `${MIX}?ref=clipboard&p=i&c=1` } })
    : Response.json(OEMBED));
  const result = await openMixInDizkoId({ mix_url: "https://on.soundcloud.com/AbCdEf123" }, { fetch });

  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(result.supported, true);
  assert.equal(result.open_url, MIX);
});

test("openMixInDizkoId refuses a share link that redirects off SoundCloud", async () => {
  const { fetch, calls } = recordingFetch(() => new Response(null, { status: 302, headers: { location: "https://evil.example/x" } }));
  const result = await openMixInDizkoId({ mix_url: "https://on.soundcloud.com/AbCdEf123" }, { fetch });
  assert.equal(result.supported, false);
  assert.equal(calls.length, 1);
});

test("open_mix_in_dizko_id honours DIZKO_ID_INSTALL_URL and tells the assistant not to guess tracks", async () => {
  const response = await callTool("open_mix_in_dizko_id", { mix_url: MIX }, {
    fetch: async () => Response.json(OEMBED),
    env: { DIZKO_ID_INSTALL_URL: "https://chromewebstore.google.com/detail/dizko-id/xyz" }
  });
  const body = JSON.parse(response.content[0].text);
  assert.equal(response.isError, false);
  assert.equal(body.extension.install_url, "https://chromewebstore.google.com/detail/dizko-id/xyz");
  assert.match(body.assistant_instruction, /never list or guess tracks/);
});

test("open_mix_in_dizko_id explains an unsupported link without an error flag", async () => {
  const response = await callTool("open_mix_in_dizko_id", { mix_url: "https://www.youtube.com/watch?v=abc" }, { fetch: async () => assert.fail("no network for an unsupported link") });
  const body = JSON.parse(response.content[0].text);
  assert.equal(body.supported, false);
  assert.match(body.error, /SoundCloud/);
});

test("open_mix_in_dizko_id stays off the reviewed ChatGPT surface", () => {
  assert.equal(surfaceTools("openai").some((tool) => tool.name === "open_mix_in_dizko_id"), false);
  assert.equal(surfaceTools("full").some((tool) => tool.name === "open_mix_in_dizko_id"), true);
});
