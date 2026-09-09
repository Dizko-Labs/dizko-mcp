import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";
import { ToolInputError } from "./errors.js";

const DEFAULT_PREFS_PATH = "./data/preferences.json";
const DEFAULT_RETENTION_DAYS = 730;
const DEFAULT_MAX_PROFILES = 10000;
const DEFAULT_MAX_PROFILE_BYTES = 98304;
const ABANDONED_PROFILE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const fileQueues = new Map();

// Single-file JSON store. Writes are atomic (temp file + rename) and
// serialized per path within this process. It is a pilot-scale store: two
// replicas sharing a volume would race, so scale-out needs an external
// store behind the same interface (getProfile/createProfile/savePreferences/
// recordFeedback/deleteProfile).
export class FilePreferenceStore {
  constructor(path = process.env.DIZKO_PREFERENCES_PATH || process.env.EVENTCHAT_PREFERENCES_PATH || DEFAULT_PREFS_PATH) {
    this.path = resolve(path);
  }

  async getProfile(profileId) {
    return this.withFileLock(async () => {
      const data = await this.read();
      const { changed } = pruneExpiredProfiles(data);
      if (changed) await this.write(data);
      return data.users[profileId] || null;
    });
  }

  async createProfile(preferences = {}, options = {}) {
    return this.withFileLock(async () => {
      const profileId = `dzk_${randomUUID()}`;
      const profileSecret = randomProfileSecret();
      const data = await this.read();
      pruneExpiredProfiles(data);
      enforceProfileCap(data);
      const now = new Date().toISOString();
      const profile = {
        ...makeProfile(profileId, profileSecret),
        consent: Boolean(options.consent),
        preferences: normalizePreferences(preferences),
        created_at: now,
        updated_at: now
      };

      const stored = fitProfileToBudget(profile);
      data.users[profileId] = stored;
      await this.write(data);
      return { profile: stored, profile_secret: profileSecret };
    });
  }

  async savePreferences(profileId, preferences, options = {}) {
    return this.withFileLock(async () => {
      const data = await this.read();
      pruneExpiredProfiles(data);
      const existing = data.users[profileId] || makeProfile(profileId);
      const mode = options.mode || "merge";
      const nextPreferences = mode === "replace"
        ? compactPreferences(normalizePreferences(preferences))
        : mergePreferences(existing.preferences, normalizePreferences(preferences));

      const profile = {
        ...existing,
        profile_id: profileId,
        consent: Boolean(options.consent ?? existing.consent),
        preferences: nextPreferences,
        updated_at: new Date().toISOString()
      };

      const stored = fitProfileToBudget(profile);
      data.users[profileId] = stored;
      await this.write(data);
      return stored;
    });
  }

  async recordFeedback(profileId, feedback) {
    return this.withFileLock(async () => {
      const data = await this.read();
      pruneExpiredProfiles(data);
      const existing = data.users[profileId] || makeProfile(profileId);
      const entry = {
        event_id: feedback.event_id,
        liked: feedback.liked ?? null,
        rating: feedback.rating ?? null,
        notes: feedback.notes || null,
        attended_at: feedback.attended_at || null,
        event: feedback.event || null,
        created_at: new Date().toISOString()
      };
      const learned = updateLearnedSignals(existing.learned, entry, existing.preferences);
      const profile = {
        ...existing,
        feedback: [...(existing.feedback || []), entry].slice(-250),
        learned,
        updated_at: entry.created_at
      };

      const stored = fitProfileToBudget(profile);
      data.users[profileId] = stored;
      await this.write(data);
      return { profile: stored, feedback: entry };
    });
  }

  async deleteProfile(profileId) {
    return this.withFileLock(async () => {
      const data = await this.read();
      pruneExpiredProfiles(data);
      const existed = Boolean(data.users[profileId]);
      delete data.users[profileId];
      await this.write(data);
      return { deleted: existed };
    });
  }

  async withFileLock(operation) {
    const previous = fileQueues.get(this.path) || Promise.resolve();
    const next = previous.then(operation, operation);
    const queued = next.catch(() => {});
    fileQueues.set(this.path, queued);
    try {
      return await next;
    } finally {
      if (fileQueues.get(this.path) === queued) fileQueues.delete(this.path);
    }
  }

  async read() {
    try {
      const body = await readFile(this.path, "utf8");
      const data = JSON.parse(body);
      return { users: {}, ...data };
    } catch (error) {
      if (error.code === "ENOENT") return { users: {} };
      throw error;
    }
  }

  async write(data) {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temp, JSON.stringify(data, null, 2) + "\n");
    await rename(temp, this.path);
  }
}

export function onboardingQuestions() {
  return [
    "What kinds of events do you generally like? Examples: concerts, club nights, art openings, comedy, festivals, talks, food, sports.",
    "What genres or scenes do you gravitate toward? Examples: techno, house, jazz, indie, experimental, queer nightlife, wellness.",
    "What vibe usually works for you? Examples: underground, intimate, high-energy, social, seated, outdoors, upscale, cheap-and-cheerful.",
    "Do different days call for different things? For example techno on Fridays but something chill on Sundays. I can save per-day filters that only apply on that weekday.",
    "What should I avoid recommending? Examples: huge crowds, mainstream clubs, expensive tickets, late nights, alcohol-focused events.",
    "What budget, neighborhoods, venues, or cities should I remember?",
    "Can I save these preferences and learn from your feedback after events? If yes, I will create a private Dizko preference profile for you."
  ];
}

// options.weekday ("monday".."sunday") applies that day's saved day_filters
// entry on top of general + learned taste. Array fields are additive;
// max_price/free/nightlife for the day override the general values. The
// explicit current request always wins last. The result is a RANKING hint;
// it must never be turned into upstream filters.
export function buildPreferenceHints(profile, current = {}, options = {}) {
  if (!profile) return current;
  const learned = learnedToPreferences(profile.learned);
  let hints = mergeBasePreferences(profile.preferences, learned);
  const dayFilter = options.weekday ? profile.preferences?.day_filters?.[options.weekday] : undefined;
  if (dayFilter) hints = mergeBasePreferences(hints, dayFilter);
  return mergeBasePreferences(hints, normalizeBasePreferences(current));
}

export function publicProfile(profile) {
  if (!profile) return null;
  return {
    profile_id: profile.profile_id,
    consent: profile.consent,
    preferences: profile.preferences,
    learned_preferences: learnedToPreferences(profile.learned),
    learned_scores: learnedScores(profile.learned),
    feedback_count: (profile.feedback || []).length,
    updated_at: profile.updated_at
  };
}

export function verifyProfileSecret(profile, profileSecret) {
  if (!profile) return false;
  if (!profile.profile_secret_hash) {
    return Boolean(process.env.EVENTCHAT_ALLOW_LEGACY_PROFILE_IDS === "true" && !profileSecret);
  }
  if (!profileSecret) return false;

  const expected = Buffer.from(profile.profile_secret_hash, "hex");
  const actual = Buffer.from(hashSecret(profileSecret), "hex");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function preferenceRetentionDays() {
  const configured = Number(process.env.DIZKO_PREFERENCE_RETENTION_DAYS || process.env.EVENTCHAT_PREFERENCE_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_RETENTION_DAYS;
  return configured;
}

function pruneExpiredProfiles(data, now = new Date()) {
  const cutoff = now.getTime() - preferenceRetentionDays() * 24 * 60 * 60 * 1000;
  let changed = false;
  for (const [profileId, profile] of Object.entries(data.users || {})) {
    const timestamp = Date.parse(profile.updated_at || profile.created_at || "");
    if (Number.isFinite(timestamp) && timestamp < cutoff) {
      delete data.users[profileId];
      changed = true;
    }
  }
  return { changed };
}

export function maxProfileBytes() {
  const configured = Number(process.env.DIZKO_MAX_PROFILE_BYTES || process.env.EVENTCHAT_MAX_PROFILE_BYTES || DEFAULT_MAX_PROFILE_BYTES);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_PROFILE_BYTES;
  return Math.floor(configured);
}

// The store is one JSON file rewritten per operation, so a profile's byte
// size is a cost every other caller pays. Feedback is what grows without a
// natural bound - 250 entries of free-text notes plus event snapshots dwarf
// every taste list - and its signal has already been folded into `learned`,
// so the oldest entries are dropped to fit rather than the write refused.
// Only a profile that is still too large with no feedback left is rejected.
function fitProfileToBudget(profile) {
  const budget = maxProfileBytes();
  if (byteSize(profile) <= budget) return profile;

  let feedback = profile.feedback || [];
  while (feedback.length && byteSize({ ...profile, feedback }) > budget) {
    feedback = feedback.slice(Math.max(1, Math.ceil(feedback.length / 8)));
  }

  const trimmed = { ...profile, feedback };
  if (byteSize(trimmed) > budget) {
    throw new ToolInputError("This profile is too large to store.", {
      code: "profile_too_large",
      hint: `Saved preferences must serialize to under ${budget} bytes. Remove some saved terms, or use mode "replace" to start from a smaller set.`
    });
  }
  return trimmed;
}

function byteSize(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function maxStoredProfiles() {
  const configured = Number(process.env.DIZKO_MAX_PROFILES || process.env.EVENTCHAT_MAX_PROFILES || DEFAULT_MAX_PROFILES);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_PROFILES;
  return Math.floor(configured);
}

// Profile creation needs no credential, and every write rewrites the whole
// file, so an unbounded store is both a disk problem and a quadratic-cost
// problem: profile N makes every later call re-serialize N records. When the
// store is full, abandoned profiles go first - created, never used, never
// given consent - oldest first. Only if that frees nothing does creation
// fail, and it fails with an error the caller can act on rather than a
// stack trace.
function enforceProfileCap(data, now = new Date()) {
  const limit = maxStoredProfiles();
  const users = data.users || {};
  if (Object.keys(users).length < limit) return;

  const graceCutoff = now.getTime() - ABANDONED_PROFILE_GRACE_MS;
  // Abandoned means empty and untouched, not unconsented. Every profile the
  // public tool creates has consent - it refuses to create one without it -
  // so filtering on consent made this set permanently empty and the whole
  // mitigation dead code: the store simply hard-failed at the ceiling, which
  // locks out every new user since creation needs no credential.
  const abandoned = Object.entries(users)
    .filter(([, profile]) => !(profile.feedback || []).length && !hasStoredTaste(profile.preferences))
    .map(([profileId, profile]) => ({ profileId, at: Date.parse(profile.updated_at || profile.created_at || "") || 0 }))
    .filter((entry) => entry.at < graceCutoff)
    .sort((a, b) => a.at - b.at);

  for (const entry of abandoned) {
    delete users[entry.profileId];
    if (Object.keys(users).length < limit) return;
  }

  throw new ToolInputError("The preference store is full, so no new profile can be created right now.", {
    code: "profile_limit_reached",
    hint: "Reuse an existing profile_id, or ask an operator to raise DIZKO_MAX_PROFILES or shorten DIZKO_PREFERENCE_RETENTION_DAYS."
  });
}

// createProfile stores the normalized shape, which carries empty arrays for
// every unset list, so a key count says nothing about whether the profile
// holds any taste at all. `false` carries none either: `free: false` and
// `nightlife: false` are the defaults, not a stated preference.
function hasStoredTaste(preferences = {}) {
  return Object.values(preferences).some((value) => {
    if (Array.isArray(value)) return value.length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    if (value === false) return false;
    return value !== undefined && value !== null;
  });
}

function makeProfile(profileId, profileSecret = randomProfileSecret()) {
  const now = new Date().toISOString();
  return {
    profile_id: profileId,
    profile_secret_hash: hashSecret(profileSecret),
    consent: false,
    preferences: {},
    learned: {},
    feedback: [],
    created_at: now,
    updated_at: now
  };
}

function randomProfileSecret() {
  return `dzs_${randomBytes(24).toString("base64url")}`;
}

function hashSecret(profileSecret) {
  return createHash("sha256").update(String(profileSecret)).digest("hex");
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const LIST_KEYS = ["cities", "event_types", "genres", "vibe", "neighborhoods", "venues", "promoters", "featuring", "avoid"];
const SCALAR_KEYS = ["max_price", "free", "nightlife"];

// Taste dimensions need repeated evidence before they become an avoid rule;
// a specific place needs only one bad night.
const AVOID_THRESHOLDS = { genres: -2, vibe: -2, event_types: -2, venues: -1, promoters: -1, notes: -1 };

// Stored-size caps. Per-call schema limits stop one huge argument; these stop
// the slow version, where merge mode appends fresh terms per call until a
// profile is megabytes wide and every read, merge and write pays for it.
// A person's real taste fits inside these numbers many times over.
//
// The per-field caps below are the readable bound; DIZKO_MAX_PROFILE_BYTES is
// the one that actually holds, because feedback notes and event snapshots
// dominate a large profile and no per-field count constrains them.
const MAX_SAVED_TERMS_PER_FIELD = 100;
const MAX_LEARNED_TERMS_PER_KEY = 200;
const MAX_TERM_LENGTH = 120;
const TASTE_KEYS = new Set(["genres", "vibe", "event_types"]);

function normalizePreferences(preferences = {}) {
  const normalized = normalizeBasePreferences(preferences);
  const dayFilters = normalizeDayFilters(preferences.day_filters);
  if (dayFilters) normalized.day_filters = dayFilters;
  return normalized;
}

function normalizeBasePreferences(preferences = {}) {
  return {
    cities: list(preferences.cities || preferences.city),
    event_types: list(preferences.event_types || preferences.event_type),
    genres: list(preferences.genres),
    vibe: list(preferences.vibe),
    neighborhoods: list(preferences.neighborhoods || preferences.neighborhood),
    venues: list(preferences.venues || preferences.venue),
    promoters: list(preferences.promoters || preferences.promoter),
    featuring: list(preferences.featuring),
    avoid: list(preferences.avoid),
    max_price: numberOrUndefined(preferences.max_price ?? preferences.price_max ?? preferences.budget),
    free: preferences.free === undefined ? undefined : Boolean(preferences.free),
    nightlife: preferences.nightlife === undefined ? undefined : Boolean(preferences.nightlife)
  };
}

function normalizeDayFilters(dayFilters) {
  if (!dayFilters || typeof dayFilters !== "object" || Array.isArray(dayFilters)) return undefined;
  const normalized = {};
  for (const [day, filters] of Object.entries(dayFilters)) {
    const key = String(day || "").trim().toLowerCase();
    if (!WEEKDAYS.includes(key) || !filters || typeof filters !== "object" || Array.isArray(filters)) continue;
    const cleaned = compactPreferences(normalizeBasePreferences(filters));
    if (Object.keys(cleaned).length) normalized[key] = cleaned;
  }
  return Object.keys(normalized).length ? normalized : undefined;
}

function mergePreferences(base = {}, incoming = {}) {
  const merged = mergeBasePreferences(base, incoming);
  const dayFilters = mergeDayFilters(base.day_filters, incoming.day_filters);
  if (dayFilters) merged.day_filters = dayFilters;
  return merged;
}

function mergeBasePreferences(base = {}, incoming = {}) {
  const merged = {};
  for (const key of LIST_KEYS) {
    // Newest terms win the tail: a saved list that hits the cap keeps what
    // the user most recently asked for rather than freezing on old entries.
    merged[key] = unique([...(base[key] || []), ...(incoming[key] || [])]).slice(-MAX_SAVED_TERMS_PER_FIELD);
  }
  for (const key of SCALAR_KEYS) {
    merged[key] = incoming[key] !== undefined ? incoming[key] : base[key];
  }
  return compactPreferences(merged);
}

function mergeDayFilters(base, incoming) {
  if (!base && !incoming) return undefined;
  const merged = {};
  for (const day of WEEKDAYS) {
    const combined = mergeBasePreferences(base?.[day] || {}, incoming?.[day] || {});
    if (Object.keys(combined).length) merged[day] = combined;
  }
  return Object.keys(merged).length ? merged : undefined;
}

function compactPreferences(preferences) {
  return Object.fromEntries(Object.entries(preferences).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined;
  }));
}

// Learning rules:
// - A like promotes the event's genres, vibe, types, venue and promoters.
// - A dislike without an explanation blames the specific place (venue,
//   promoters), not the user's taste. Genres and types are only penalized
//   when the notes say the music or lineup was the problem.
// - A term the user saved as a preference can never go negative from
//   learning; the saved preference wins.
export function updateLearnedSignals(learned = {}, feedback, saved = {}) {
  const event = feedback.event || {};
  const rating = Number.isFinite(feedback.rating) ? feedback.rating : null;
  const weight = feedback.liked === false || (rating !== null && rating <= 2) ? -1 : (rating !== null && rating >= 4) || feedback.liked === true ? 1 : 0;
  const noteSignals = extractNoteSignals(feedback.notes, event);
  if (weight === 0 && !noteSignals.positive.length && !noteSignals.negative.length) return learned;

  const next = structuredClone(learned || {});
  const promoters = promoterNames(event.promoters);
  if (weight > 0) {
    increment(next, "genres", event.genres, weight);
    increment(next, "vibe", event.vibe, weight);
    increment(next, "event_types", event.event_types, weight);
    increment(next, "venues", event.venue ? [event.venue] : [], weight);
    increment(next, "promoters", promoters, weight);
  } else if (weight < 0) {
    increment(next, "venues", event.venue ? [event.venue] : [], weight);
    increment(next, "promoters", promoters, weight);
    if (noteSignals.blamesMusic) {
      increment(next, "genres", event.genres, weight);
      increment(next, "event_types", event.event_types, weight);
    }
    if (noteSignals.blamesVibe) {
      increment(next, "vibe", event.vibe, weight);
    }
  }
  // Note signals add at most one unit per key per feedback: when the
  // like/dislike weight already covered a key, the note does not count again.
  const coveredByWeight = new Set(weight > 0
    ? ["genres", "vibe", "event_types", "venues", "promoters"]
    : weight < 0
      ? ["venues", "promoters", ...(noteSignals.blamesMusic ? ["genres", "event_types"] : []), ...(noteSignals.blamesVibe ? ["vibe"] : [])]
      : []);
  for (const signal of noteSignals.positive) {
    if (weight > 0 && coveredByWeight.has(signal.key)) continue;
    increment(next, signal.key, signal.values, 1);
  }
  for (const signal of noteSignals.negative) {
    if (weight < 0 && coveredByWeight.has(signal.key)) continue;
    increment(next, signal.key, signal.values, -1);
  }
  floorSavedTerms(next, saved);
  return plainCounters(next);
}

// The counters are built on null-prototype maps so a term named "constructor"
// or "__proto__" is counted like any other string, but what leaves this
// function is an ordinary object: that is the shape callers compare against
// and the shape a JSON round trip returns. Spread copies own properties, so
// a literal "__proto__" key survives as data rather than reassigning a
// prototype.
function plainCounters(learned) {
  const out = {};
  for (const [key, counters] of Object.entries(learned || {})) {
    out[key] = counters && typeof counters === "object" ? { ...counters } : counters;
  }
  return out;
}

function floorSavedTerms(learned, saved = {}) {
  for (const key of TASTE_KEYS) {
    const savedTerms = new Set(list(saved?.[key]));
    if (!savedTerms.size || !learned[key]) continue;
    for (const term of Object.keys(learned[key])) {
      if (savedTerms.has(term) && learned[key][term] < 0) learned[key][term] = 0;
    }
  }
  for (const key of ["venues", "promoters"]) {
    const savedTerms = new Set(list(saved?.[key]));
    if (!savedTerms.size || !learned[key]) continue;
    for (const term of Object.keys(learned[key])) {
      if (savedTerms.has(term) && learned[key][term] < 0) learned[key][term] = 0;
    }
  }
}

const NEGATION = "(?:not|didn'?t|did not|wasn'?t|was not|weren'?t|disliked|hated|bad|poor|awful|terrible|boring|weak|disappointing|avoid)";
const PRAISE = "(?:liked|loved|great|good|amazing|brilliant|incredible|fantastic|excellent|enjoyed|solid|perfect)";
const MUSIC = "(?:music|sound|dj|djs|lineup|line-up|artist|artists|set|sets|selection|tunes)";
const VIBE = "(?:vibe|energy|atmosphere|crowd|people)";
const PLACE = "(?:venue|space|room|place|club|bar|location)";

export function extractNoteSignals(notes, event = {}) {
  const positive = [];
  const negative = [];
  let text = String(notes || "").toLowerCase();
  if (!text.trim()) return { positive, negative, blamesMusic: false, blamesVibe: false };

  // "not bad", "not too bad", "wasn't bad" are mild praise, not negation.
  text = text.replace(/\b(?:not|wasn'?t|was not|isn'?t)\s+(?:too\s+|that\s+|so\s+)?(?:bad|terrible|awful|the worst)\b/g, " okay ");
  // "not great", "wasn't good" are negations, not praise.
  text = text.replace(/\b(?:not|wasn'?t|was not|isn'?t|never)\s+(?:so\s+|that\s+|very\s+|really\s+|as\s+)?(?:great|good|amazing|brilliant|incredible|fantastic|excellent|solid|perfect)\b/g, " bad ");

  // Judge each clause on its own so "good venue but the music was bad" does
  // not read as praise for the music.
  const clauses = text.split(/[,.;!?]+|\b(?:but|however|though|although|except|whereas)\b/).map((clause) => clause.trim()).filter(Boolean);
  const near = (a, b) => clauses.some((clause) => new RegExp(`\\b${a}\\b.{0,18}\\b${b}\\b`).test(clause));
  const likesMusic = near(PRAISE, MUSIC) || near(MUSIC, PRAISE);
  const likesVibe = near(PRAISE, VIBE) || near(VIBE, PRAISE);
  const likesPlace = near(PRAISE, PLACE) || near(PLACE, PRAISE);
  const blamesMusic = near(NEGATION, MUSIC) || near(MUSIC, NEGATION);
  const blamesVibe = near(NEGATION, VIBE) || near(VIBE, NEGATION);
  const blamesPlace = near(NEGATION, PLACE) || near(PLACE, NEGATION);

  if (likesMusic) positive.push({ key: "genres", values: event.genres });
  if (likesVibe) positive.push({ key: "vibe", values: event.vibe });
  if (likesPlace) positive.push({ key: "venues", values: event.venue ? [event.venue] : [] });
  if (blamesMusic && !likesMusic) negative.push({ key: "genres", values: event.genres });
  if (blamesPlace && !likesPlace) negative.push({ key: "venues", values: event.venue ? [event.venue] : [] });

  if (/\b(too crowded|crowded|packed|huge crowd|rammed|not the crowd|bad crowd|crowd was off)\b/.test(text)) {
    negative.push({ key: "notes", values: ["crowded", "huge crowds"] });
  }
  if (/\b(too expensive|expensive|overpriced|pricey|cost too much|rip-?off)\b/.test(text)) {
    negative.push({ key: "notes", values: ["expensive tickets"] });
  }
  if (/\b(too late|late night|ended too late|started too late)\b/.test(text)) {
    negative.push({ key: "notes", values: ["late nights"] });
  }
  if (/\b(too mainstream|mainstream|too commercial|commercial (?:crowd|music|vibe|club|sound))\b/.test(text)) {
    negative.push({ key: "notes", values: ["mainstream"] });
  }
  if (/\b(alcohol-focused|too drunk|drunk crowd|too much drinking)\b/.test(text)) {
    negative.push({ key: "notes", values: ["alcohol-focused events"] });
  }

  return { positive, negative, blamesMusic: blamesMusic && !likesMusic, blamesVibe: blamesVibe && !likesVibe };
}

export function learnedToPreferences(learned = {}) {
  const preferences = {};
  const avoid = [];
  for (const [key, values] of Object.entries(learned)) {
    const entries = Object.entries(values || {});
    const positive = entries
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([value]) => value);
    if (positive.length) preferences[key] = positive;
    const threshold = AVOID_THRESHOLDS[key] ?? -1;
    const negative = entries
      .filter(([, score]) => score <= threshold)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 8)
      .map(([value]) => value);
    avoid.push(...negative);
  }
  if (avoid.length) preferences.avoid = unique(avoid).slice(0, 12);
  return preferences;
}

function learnedScores(learned = {}) {
  const out = {};
  for (const [key, values] of Object.entries(learned || {})) {
    const entries = Object.entries(values || {}).filter(([, score]) => score !== 0);
    if (entries.length) out[key] = Object.fromEntries(entries);
  }
  return out;
}

function promoterNames(promoters) {
  if (!Array.isArray(promoters)) return [];
  return promoters.map((item) => typeof item === "string" ? item : item?.name).filter(Boolean);
}

function increment(target, key, values, weight) {
  const entries = list(values);
  if (!entries.length) return;
  // A null-prototype map so a genre or venue literally named "constructor"
  // or "__proto__" is counted like any other string. With a plain object,
  // `target[key][value]` resolved to an inherited function, which both
  // skipped the cap and produced "function Object() { [native code] }1" as
  // the stored score.
  if (!target[key] || Object.getPrototypeOf(target[key]) !== null) {
    target[key] = Object.assign(Object.create(null), target[key] || {});
  }
  for (const value of entries) {
    // A term already being tracked always updates. A brand new term only
    // enters while there is room, so a stream of never-seen-before values
    // cannot inflate the profile without bound.
    const current = Object.hasOwn(target[key], value) ? target[key][value] : undefined;
    if (current === undefined && Object.keys(target[key]).length >= MAX_LEARNED_TERMS_PER_KEY) continue;
    target[key][value] = (typeof current === "number" ? current : 0) + weight;
  }
}

function list(value) {
  const values = Array.isArray(value) ? value : [value];
  return unique(values
    .flatMap((item) => String(item || "").split(","))
    .map((item) => item.trim().toLowerCase().slice(0, MAX_TERM_LENGTH))
    .filter(Boolean));
}

function unique(values) {
  return [...new Set(values)];
}

function numberOrUndefined(value) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
