export const WELCOME_QUESTION = "Are you here to discover events, or are you a DJ, artist, musician, venue, or collective? You can do both.";
export const SOUNDCLOUD_QUESTION = "Hey, are you a DJ? If so, what's your SoundCloud? Artists and musicians can share one too, or use their name.";
export const ONBOARDING_INSTRUCTION = [
  "On first setup or when the user asks to get started with Dizko, call get_dizko_onboarding and ask its welcome question once.",
  "Offer For everyone (event discovery) and For DJs, artists and musicians (claim or create a page), including venue, collective and promoter pathways.",
  "Onboarding is optional: skip it for a concrete event request, and do not repeat it after the user chooses or declines.",
  "For artists ask for SoundCloud; call get_dizko_onboarding with soundcloud for an exact database lookup. A name search returns candidates, not proof of ownership.",
  "Explain the matched profile and ask the user to choose when there is more than one. Use returned public examples, benefits, pricing and website links.",
  "Claims require verification on the website. Open or offer the relevant website link when requested; never claim ownership, create an account, subscribe, pay or publish through this read-only tool.",
  "If lookup is unavailable, say it could not be checked; do not say the artist is missing. Discovery stays available without a paid artist membership."
].join(" ");
