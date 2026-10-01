// How much of an answer an entity actually is.
//
// Name matching alone cannot decide between Ben Klock and BJ Klock: both
// carry "Klock" as a whole word, so the name says they are equally good
// answers. They are not. Ben Klock has nine listed Dizko dates, six of them
// upcoming, eight co-billed artists, twelve press clips and thirty career
// appearances; BJ Klock has one appearance and nothing else. Someone typing
// "Klock" into an event app means the first one.
//
// The upstream catalog cannot make this call for us. Its relevance score put
// Nina Kraviz last of nineteen "Nina" profiles, and its `authority` field is
// the same 0.59 for every artist in the catalog, so both are measured noise.
// These scores are built from the evidence that does vary.
//
// The weights are a judgment call and are deliberately not load-bearing:
// nothing here decides an answer on a narrow margin. Ranking uses the score
// only to order candidates that are already tied on name, and confidence is
// granted only on a decisive gap (see `decisivelyAhead`). A close call stays
// ambiguous and the model asks.

const ESTABLISHED_BONUS = 15;
const RISING_BONUS = 5;

// Real bookings weigh most, because a booked artist is one a user can
// actually go and see. Press and career depth carry the rest: a
// world-touring DJ with no date in a covered city is still the one meant.
export function artistProminence({ insights = {}, directory = {} } = {}) {
  const level = String(directory.experience_level || "").toLowerCase();
  return round(
    3 * count(insights.indexed_events)
    + 2 * count(insights.upcoming_events)
    + size(insights.related_djs)
    + size(insights.top_venues)
    + size(directory.venues_played)
    + 2 * size(directory.press_clips)
    + size(directory.mixes)
    // `appearances` saturates at the API's page size, so it separates a
    // career from a debut but not two careers from each other.
    + size(directory.appearances)
    + (level === "established" ? ESTABLISHED_BONUS : level === "rising" ? RISING_BONUS : 0)
  );
}

// Venues need no extra request: the search rows already carry these. A real
// venue record has a capacity, several genres and a written bio; a stub
// scraped from a map or an encyclopedia has a one-line description and
// nulls, which is why the profile literally named "Berghain" is the thinner
// answer and "Berghain / Panorama Bar" is the real one.
export function venueProminence(profile = {}) {
  const capacity = count(profile.typical_capacity);
  return round(
    (capacity > 0 ? 10 + Math.log10(capacity) * 10 : 0)
    + 2 * size(profile.genres)
    + Math.min(20, String(profile.bio || "").length / 20)
    + (count(profile.founded) > 0 ? 5 : 0)
  );
}

// Promoter rows carry their own upcoming count, so this is free too.
export function promoterProminence(profile = {}) {
  return round(3 * count(profile.upcoming_count ?? profile.upcoming_events) + 2 * size(profile.genres));
}

// Whether the leader is far enough ahead to answer without asking. Requires
// real evidence for the leader and either a runner-up with none at all or a
// leader several times ahead. Two well-known artists who share a name stay
// ambiguous, which is the correct outcome.
export const DECISIVE_MULTIPLE = 3;

export function decisivelyAhead(top, runnerUp) {
  if (!(top > 0)) return false;
  if (!(runnerUp > 0)) return true;
  return top >= runnerUp * DECISIVE_MULTIPLE;
}

function count(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function size(value) {
  return Array.isArray(value) ? value.length : 0;
}

function round(value) {
  return Math.round(value * 10) / 10;
}
