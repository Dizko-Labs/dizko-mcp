import { getArtistOnboarding } from "./api.js";
import { findSceneEntities } from "./entities.js";
import { ToolInputError } from "./errors.js";

import { WELCOME_QUESTION, SOUNDCLOUD_QUESTION, ONBOARDING_INSTRUCTION } from "./onboardingInstructions.js";

const BUILDER = "https://build.dizko.app";
const link = (path = "") => `${BUILDER}/${path}${path.includes("?") ? "&" : "?"}utm_source=dizko_mcp&utm_medium=ai_assistant`;
const BENEFITS = [
  "A public page for your music, mixes, shows and links.",
  "Discovery through the artists, sounds, cities and lineups you connect with on Dizko.",
  "A shareable EPK with your bio, music, photos, press and booking information.",
  "Release pages and press-release tools; press-release distribution is a separate paid service."
];

export async function getDizkoOnboarding(input = {}, options = {}) {
  const audience = input.audience || (input.soundcloud || input.name ? "artist" : "everyone");
  const result = {
    audience,
    status: "welcome",
    question: !input.audience && !input.soundcloud && !input.name ? WELCOME_QUESTION : SOUNDCLOUD_QUESTION,
    discovery: { label: "For everyone", paid_membership_required: false, next_tool: "search_events", question: "What city and dates are you interested in?" },
    creators: {
      label: "For DJs, artists and musicians",
      also_for: ["venues", "collectives", "promoters"],
      benefits: BENEFITS,
      links: {
        marketing: link(),
        pricing: `${link()}#pricing`,
        onboarding: link("admin"),
        claim: link("admin"),
        billing: link("admin?tab=account"),
        builder: link("page-builder?tab=identity"),
      },
      pricing: {
        advertised: "$6.50/month after the first month free; press-release distribution is $24.99 per release.",
        source_url: `${BUILDER}/#pricing`,
        checked_on: "2026-10-20",
        note: "This is the advertised offer, not a live checkout quote. A card is required to finish signup. Confirm current price, currency, trial eligibility and renewal terms on the website before subscribing.",
      },
    },
    assistant_instruction: ONBOARDING_INSTRUCTION,
  };
  if (input.audience === "everyone" && !input.soundcloud) {
    return { ...result, status: "discovery", question: result.discovery.question, next_steps: ["Ask for city and dates, then search events. Artist setup is optional."] };
  }
  if (["venue", "collective", "promoter"].includes(audience)) {
    const candidates = input.name
      ? await findSceneEntities({ kind: audience, query: input.name, city: input.city, limit: 5 }, options)
      : null;
    return { ...result, status: "scene_pathway", question: "What is your venue, collective or promoter name, and city?", candidates,
      next_steps: [
        "Use the returned directory results to identify the right profile; ask the user to choose.",
        "Open its public profile for any available claim action. Do not promise SoundCloud verification for a venue or collective.",
        "Offer the artist marketing page to explore site building. Confirm the available account type and plan on the website; do not assume the artist price covers organizations."
      ] };
  }
  if (input.name && !input.soundcloud) {
    return { ...result, status: "name_candidates",
      candidates: await findSceneEntities({ kind: "artist", query: input.name, city: input.city, limit: 5 }, options),
      next_steps: ["Ask the user to identify their profile or share SoundCloud for an exact match.", "If none is theirs, offer the marketing onboarding page to create a page."] };
  }
  if (input.soundcloud && !validSoundcloud(input.soundcloud)) {
    throw new ToolInputError("Share a SoundCloud profile URL or handle, not a track, playlist or another website.", { field: "soundcloud" });
  }
  let lookup;
  try {
    lookup = await getArtistOnboarding(input.soundcloud, options);
  } catch (error) {
    if (error.status === 422) throw new ToolInputError("Share a valid SoundCloud profile URL or handle.", { field: "soundcloud" });
    return { ...result, status: "lookup_unavailable", examples: [],
      next_steps: ["The database lookup is unavailable. Retry later or open the marketing page; do not say no profile exists."] };
  }
  return { ...result, ...lookup, next_steps: lookup.status === "matched" || lookup.status === "choose_profile"
    ? [
      "Show the matching profiles and published pages. If there are multiple matches, ask which one is theirs.",
      "A match is not ownership verification. For a claimed profile, sign in with the owner account or use website support; do not promise a new claim. If claimed is null, ownership status is unknown: check it on the website.",
      "For an unclaimed profile, open the website onboarding link, sign in, select the existing artist identity, and verify ownership through SoundCloud. Keep passwords and verification codes on the website.",
      "Explain the page, discovery, EPK and release tools, then offer pricing and billing. The user reviews and completes any subscription on the website."
    ]
    : lookup.status === "not_found"
      ? ["No exact SoundCloud match was found in the database. This does not prove the artist has no page under another identity.",
        "Offer a name search or show the returned published examples, then open the marketing onboarding page to create a page.",
        "Explain the offer and separate press distribution charge before handing off to website signup and payment."]
      : [input.audience ? "Ask for SoundCloud or an artist name to find their profile." : "Ask the welcome question once; for artists ask for SoundCloud or their name.",
        "Show returned published examples if the user wants to see what a page looks like."] };
}

function validSoundcloud(value) {
  const text = value.trim();
  if (/^@?[A-Za-z0-9_-]+$/.test(text)) return true;
  try {
    const url = new URL(text.includes("://") ? text : `https://${text}`);
    return ["http:", "https:"].includes(url.protocol)
      && ["soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"].includes(url.hostname)
      && !url.username && !url.password && !url.port
      && /^\/[A-Za-z0-9_-]+\/?$/.test(url.pathname);
  } catch { return false; }
}
