// Dizko ID is Dizko's Chrome extension that identifies the tracks in a DJ mix
// (Shazam fingerprints taken in the user's browser) and fills their Beatport
// or Bandcamp cart from their own logged-in session. None of that can run
// here: Shazam rate-limits a network after a few hundred lookups and the
// carts need the user's logins. So this module only checks the mix link and
// hands it over: the extension puts a "Dizko ID" button on every SoundCloud
// track page, and pressing it opens the panel and starts identifying.

export const DIZKO_ID_STORE_ID = "cgbljjfheappcaekegpegkdfhapabgii";
export const DEFAULT_DIZKO_ID_INSTALL_URL = `https://chromewebstore.google.com/detail/${DIZKO_ID_STORE_ID}`;

// First path segments that are SoundCloud's own pages, never a user. Mirrors
// NOT_A_TRACK in the extension's launcher, which decides where the button shows.
const NOT_A_USER = /^(discover|stations|search|you|feed|charts|upload|settings|messages|notifications|pages|terms-of-use|tags|n)$/i;
const SUBPAGES = new Set(["sets", "tracks", "likes", "reposts", "albums", "popular-tracks", "followers", "following", "comments"]);

const COMING_LATER = {
  youtube: "YouTube",
  mixcloud: "Mixcloud"
};

/**
 * Classify a mix link. Returns { kind: "soundcloud", url } for a public
 * SoundCloud track page (cleaned of tracking params), { kind: "short", url }
 * for an on.soundcloud.com share link that still needs resolving, or
 * { kind: "unsupported", reason, code } otherwise.
 */
export function classifyMixUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    return { kind: "unsupported", code: "invalid_mix_url", reason: "Pass the full link to the mix, like https://soundcloud.com/<dj>/<mix>." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { kind: "unsupported", code: "invalid_mix_url", reason: "Pass the full link to the mix, like https://soundcloud.com/<dj>/<mix>." };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "on.soundcloud.com") return { kind: "short", url: `https://on.soundcloud.com${url.pathname}` };
  if (host === "soundcloud.com" || host === "m.soundcloud.com") {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 3 && /^s-[A-Za-z0-9]+$/.test(parts[2])) {
      return { kind: "unsupported", code: "private_mix", reason: "This is a private SoundCloud link. Dizko ID works on public mixes." };
    }
    if (parts.length !== 2 || NOT_A_USER.test(parts[0]) || SUBPAGES.has(parts[1].toLowerCase())) {
      return { kind: "unsupported", code: "not_a_mix", reason: "That SoundCloud link is not a single mix. Pass the link to one track page, like https://soundcloud.com/<dj>/<mix>." };
    }
    return { kind: "soundcloud", url: `https://soundcloud.com/${parts[0]}/${parts[1]}` };
  }
  const platform = host.endsWith("youtube.com") || host === "youtu.be" ? "youtube" : host.endsWith("mixcloud.com") ? "mixcloud" : null;
  if (platform) {
    return {
      kind: "unsupported",
      code: "platform_not_yet_supported",
      platform,
      reason: `Dizko ID identifies SoundCloud mixes in its current release. ${COMING_LATER[platform]} is planned for a later update.`
    };
  }
  return { kind: "unsupported", code: "platform_not_supported", reason: "Dizko ID works on SoundCloud mixes." };
}

/** One redirect hop of an on.soundcloud.com share link, read from Location and never followed off SoundCloud. */
async function resolveShortLink(shortUrl, { fetch: doFetch = fetch, timeoutMs = 8000 } = {}) {
  const response = await doFetch(shortUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
  const location = response.headers.get("location");
  if (!location) return null;
  const next = classifyMixUrl(new URL(location, shortUrl).href);
  return next.kind === "soundcloud" || next.kind === "unsupported" ? next : null;
}

/**
 * SoundCloud's public oEmbed for a track page: title, uploader and artwork,
 * with no key. 404 means the mix is gone or private. Network trouble returns
 * null so the hand-off still works; the extension reads the page itself.
 */
async function soundcloudOembed(mixUrl, { fetch: doFetch = fetch, timeoutMs = 8000 } = {}) {
  const url = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(mixUrl)}`;
  const response = await doFetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404 || response.status === 403) return { missing: true };
  if (!response.ok) return null;
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") return null;
  const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);
  return {
    title: text(data.title),
    uploader: text(data.author_name),
    uploader_url: text(data.author_url),
    artwork_url: text(data.thumbnail_url)
  };
}

export async function openMixInDizkoId(input = {}, options = {}) {
  const config = options.config || {};
  const timeoutMs = options.timeoutMs ?? config.apiTimeoutMs ?? 8000;
  const net = { fetch: options.fetch || fetch, timeoutMs };
  const installUrl = config.dizkoIdInstallUrl || DEFAULT_DIZKO_ID_INSTALL_URL;

  let target = classifyMixUrl(input.mix_url);
  if (target.kind === "short") {
    target = (await resolveShortLink(target.url, net).catch(() => null))
      ?? { kind: "unsupported", code: "unresolved_short_link", reason: "That SoundCloud share link could not be opened. Pass the mix's full soundcloud.com link." };
  }
  if (target.kind !== "soundcloud") {
    const { kind: _kind, reason, ...rest } = target;
    return { supported: false, ...rest, error: reason };
  }

  const meta = await soundcloudOembed(target.url, net).catch(() => null);
  if (meta?.missing) {
    return { supported: false, code: "mix_not_found", error: "SoundCloud has no public mix at that link. It may be private, removed or mistyped." };
  }

  return {
    supported: true,
    mix: {
      url: target.url,
      ...(meta?.title ? { title: meta.title } : {}),
      ...(meta?.uploader ? { uploader: meta.uploader } : {}),
      ...(meta?.uploader_url ? { uploader_url: meta.uploader_url } : {}),
      ...(meta?.artwork_url ? { artwork_url: meta.artwork_url } : {}),
      verified: Boolean(meta)
    },
    open_url: target.url,
    extension: {
      name: "Dizko ID",
      install_url: installUrl,
      requires: "Google Chrome on a computer (not mobile)"
    },
    steps: [
      "Install Dizko ID from the Chrome Web Store (once).",
      "Open the mix link in Chrome.",
      "Press the Dizko ID button under the waveform, then choose Whole mix or a section.",
      "Tick the tracks you want and press Add to cart. Dizko ID fills your Beatport cart, falling back to Bandcamp.",
      "Review the carts and press Buy yourself. Dizko ID never checks out."
    ]
  };
}
