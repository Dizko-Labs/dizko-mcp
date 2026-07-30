import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { dirname, resolve } from "node:path";

const DEFAULT_PREFS_PATH = "./data/preferences.json";
const DEFAULT_RETENTION_DAYS = 730;
const fileQueues = new Map();

export class FilePreferenceStore {
  constructor(path = process.env.EVENTCHAT_PREFERENCES_PATH || DEFAULT_PREFS_PATH) {
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
      const profileId = `upg_${randomUUID()}`;
      const profileSecret = randomProfileSecret();
      const data = await this.read();
      pruneExpiredProfiles(data);
      const now = new Date().toISOString();
      const profile = {
        ...makeProfile(profileId, profileSecret),
        consent: Boolean(options.consent),
        preferences: normalizePreferences(preferences),
        created_at: now,
        updated_at: now
      };

      data.users[profileId] = profile;
      await this.write(data);
      return { profile, profile_secret: profileSecret };
    });
  }

  async savePreferences(profileId, preferences, options = {}) {
    return this.withFileLock(async () => {
      const data = await this.read();
      pruneExpiredProfiles(data);
      const existing = data.users[profileId] || makeProfile(profileId);
      const mode = options.mode || "merge";
      const nextPreferences = mode === "replace"
        ? normalizePreferences(preferences)
        : mergePreferences(existing.preferences, normalizePreferences(preferences));

      const profile = {
        ...existing,
        profile_id: profileId,
        consent: Boolean(options.consent ?? existing.consent),
        preferences: nextPreferences,
        updated_at: new Date().toISOString()
      };

      data.users[profileId] = profile;
      await this.write(data);
      return profile;
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
      const learned = updateLearnedSignals(existing.learned, entry);
      const profile = {
        ...existing,
        feedback: [...existing.feedback, entry].slice(-250),
        learned,
        updated_at: entry.created_at
      };

      data.users[profileId] = profile;
      await this.write(data);
      return { profile, feedback: entry };
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
    await writeFile(this.path, JSON.stringify(data, null, 2) + "\n");
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

// options.weekday ("monday".."sunday") applies that day's saved
// day_filters entry on top of general + learned taste. Array fields are
// additive; max_price/free/nightlife for the day override the general
// values. The explicit current request always wins last.
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
    feedback_count: profile.feedback.length,
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
  const configured = Number(process.env.EVENTCHAT_PREFERENCE_RETENTION_DAYS || DEFAULT_RETENTION_DAYS);
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
  return `ups_${randomBytes(24).toString("base64url")}`;
}

function hashSecret(profileSecret) {
  return createHash("sha256").update(String(profileSecret)).digest("hex");
}

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

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
    featuring: list(preferences.featuring),
    avoid: list(preferences.avoid),
    max_price: numberOrUndefined(preferences.max_price ?? preferences.price_max),
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
  for (const key of ["cities", "event_types", "genres", "vibe", "neighborhoods", "venues", "featuring", "avoid"]) {
    merged[key] = unique([...(base[key] || []), ...(incoming[key] || [])]);
  }
  for (const key of ["max_price", "free", "nightlife"]) {
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

function updateLearnedSignals(learned = {}, feedback) {
  const event = feedback.event || {};
  const rating = Number.isFinite(feedback.rating) ? feedback.rating : null;
  const weight = feedback.liked === false || (rating !== null && rating <= 2) ? -1 : (rating !== null && rating >= 4) || feedback.liked === true ? 1 : 0;
  const noteSignals = extractNoteSignals(feedback.notes, event);
  if (weight === 0 && !noteSignals.positive.length && !noteSignals.negative.length) return learned;

  const next = structuredClone(learned || {});
  if (weight !== 0) {
    increment(next, "genres", event.genres, weight);
    increment(next, "vibe", event.vibe, weight);
    increment(next, "event_types", event.event_types, weight);
    increment(next, "venues", event.venue ? [event.venue] : [], weight);
  }
  for (const signal of noteSignals.positive) {
    increment(next, signal.key, signal.values, 1);
  }
  for (const signal of noteSignals.negative) {
    increment(next, signal.key, signal.values, -1);
  }
  return next;
}

function extractNoteSignals(notes, event = {}) {
  const text = String(notes || "").toLowerCase();
  const positive = [];
  const negative = [];
  if (!text.trim()) return { positive, negative };

  if (/\b(liked|loved|great|good|amazing)\b.{0,24}\b(music|sound|dj|lineup|artist|artists)\b/.test(text)) {
    positive.push({ key: "genres", values: event.genres });
  }
  if (/\b(liked|loved|great|good|amazing)\b.{0,24}\b(vibe|energy|atmosphere|crowd)\b/.test(text)) {
    positive.push({ key: "vibe", values: event.vibe });
  }
  if (/\b(liked|loved|great|good|amazing)\b.{0,24}\b(venue|space|room|place)\b/.test(text)) {
    positive.push({ key: "venues", values: event.venue ? [event.venue] : [] });
  }

  if (/\b(not|didn't|did not|disliked|hated|bad|poor|avoid)\b.{0,30}\b(music|sound|dj|lineup|artist|artists)\b/.test(text)) {
    negative.push({ key: "genres", values: event.genres });
  }
  if (/\b(not|didn't|did not|disliked|hated|bad|poor|avoid)\b.{0,30}\b(venue|space|room|place)\b/.test(text)) {
    negative.push({ key: "venues", values: event.venue ? [event.venue] : [] });
  }
  if (/\b(too crowded|crowded|packed|huge crowd|not the crowd|bad crowd|crowd was off)\b/.test(text)) {
    negative.push({ key: "notes", values: ["crowded", "huge crowds"] });
  }
  if (/\b(too expensive|expensive|overpriced|pricey|cost too much)\b/.test(text)) {
    negative.push({ key: "notes", values: ["expensive tickets"] });
  }
  if (/\b(too late|late night|ended too late|started too late)\b/.test(text)) {
    negative.push({ key: "notes", values: ["late nights"] });
  }
  if (/\b(too mainstream|mainstream|commercial)\b/.test(text)) {
    negative.push({ key: "notes", values: ["mainstream"] });
  }
  if (/\b(alcohol-focused|too drunk|drunk crowd|too much drinking)\b/.test(text)) {
    negative.push({ key: "notes", values: ["alcohol-focused events"] });
  }

  return { positive, negative };
}

function learnedToPreferences(learned = {}) {
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
    const negative = entries
      .filter(([, score]) => score < 0)
      .sort((a, b) => a[1] - b[1])
      .slice(0, 8)
      .map(([value]) => value);
    avoid.push(...negative);
  }
  if (avoid.length) preferences.avoid = unique(avoid).slice(0, 12);
  return preferences;
}

function increment(target, key, values, weight) {
  const entries = list(values);
  if (!entries.length) return;
  target[key] ||= {};
  for (const value of entries) {
    target[key][value] = (target[key][value] || 0) + weight;
  }
}

function list(value) {
  const values = Array.isArray(value) ? value : [value];
  return unique(values
    .flatMap((item) => String(item || "").split(","))
    .map((item) => item.trim().toLowerCase())
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
