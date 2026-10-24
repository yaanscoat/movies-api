// Profiles, My List, watch history and per-profile settings — all in localStorage.
//
// Shape (key "movies.v1"):
// {
//   activeId: string | null,
//   profiles: [{
//     id, name, color, face, kids, createdAt,
//     myList:  [{ id, type, title, poster, backdrop, year, addedAt }],
//     history: { "movie:123" | "tv:456": {
//        id, type, title, poster, backdrop, season, episode,   // last thing watched
//        position, duration, updatedAt,
//        episodes?: { "1:3": { position, duration, updatedAt } } } },
//     settings: { volume, muted, autoplayNext, subtitleSize, subtitleLang, speed }
//   }]
// }

const KEY = "movies.v1";
const MAX_PROFILES = 5;
const MAX_HISTORY = 200;
const FINISHED = 0.94; // fraction watched after which a title counts as finished

export const COLORS = [
  ["#e50914", "#7a0008"], ["#2f7bff", "#0b2a8a"], ["#f5b301", "#a35a00"], ["#16c47f", "#04613b"],
  ["#b05cff", "#4a138f"], ["#ff5fa2", "#8f0f4a"], ["#22d3ee", "#075f73"], ["#ff7a1a", "#8a2c00"],
  ["#8b95a7", "#2b313c"], ["#f4f4f5", "#9ca3af"],
];
export const FACES = ["smile", "grin", "cool", "wink"];

const DEFAULT_SETTINGS = { volume: 1, muted: false, autoplayNext: true, subtitleSize: "m", subtitleLang: "en", speed: 1 };

const events = new EventTarget();
const storage = (() => {
  try { const k = "__t"; localStorage.setItem(k, k); localStorage.removeItem(k); return localStorage; }
  catch { return null; } // private mode / blocked storage: run in-memory
})();

let state = load();

function blank() { return { activeId: null, profiles: [] }; }

function load() {
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) || "null");
    if (!parsed || !Array.isArray(parsed.profiles)) return blank();
    parsed.profiles = parsed.profiles.map(normalise);
    return parsed;
  } catch { return blank(); }
}

function normalise(p) {
  return {
    id: p.id || uid(), name: String(p.name || "Profile").slice(0, 24),
    color: Number.isInteger(p.color) ? p.color : 0, face: FACES.includes(p.face) ? p.face : "smile",
    kids: !!p.kids, createdAt: p.createdAt || Date.now(),
    myList: Array.isArray(p.myList) ? p.myList : [],
    history: p.history && typeof p.history === "object" ? p.history : {},
    settings: { ...DEFAULT_SETTINGS, ...(p.settings || {}) },
  };
}

function save(reason) {
  try { storage?.setItem(KEY, JSON.stringify(state)); }
  catch (e) {
    // Quota exceeded: trim the oldest history entries and try once more.
    if (trimHistory(50)) try { storage?.setItem(KEY, JSON.stringify(state)); } catch {}
    console.warn("[store] save failed", e);
  }
  events.dispatchEvent(new CustomEvent("change", { detail: reason }));
}

function trimHistory(keep) {
  let trimmed = false;
  for (const p of state.profiles) {
    const entries = Object.entries(p.history).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    if (entries.length > keep) { p.history = Object.fromEntries(entries.slice(0, keep)); trimmed = true; }
  }
  return trimmed;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Keep tabs in sync.
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  state = load();
  events.dispatchEvent(new CustomEvent("change", { detail: "sync" }));
});

export const onChange = (fn) => {
  const h = (e) => fn(e.detail);
  events.addEventListener("change", h);
  return () => events.removeEventListener("change", h);
};

/* ---------------- profiles ---------------- */

export const profiles = () => state.profiles;
export const canAddProfile = () => state.profiles.length < MAX_PROFILES;
export const active = () => state.profiles.find((p) => p.id === state.activeId) || null;
export const getProfile = (id) => state.profiles.find((p) => p.id === id) || null;

export function setActive(id) {
  state.activeId = getProfile(id) ? id : null;
  save("active");
}

export function createProfile({ name, color, face, kids }) {
  if (!canAddProfile()) throw new Error(`You can have up to ${MAX_PROFILES} profiles.`);
  const p = normalise({ name: name?.trim() || "New Profile", color, face, kids });
  state.profiles.push(p);
  save("profiles");
  return p;
}

export function updateProfile(id, patch) {
  const p = getProfile(id);
  if (!p) return;
  if (patch.name !== undefined) p.name = String(patch.name).trim().slice(0, 24) || p.name;
  if (patch.color !== undefined) p.color = patch.color;
  if (patch.face !== undefined) p.face = patch.face;
  if (patch.kids !== undefined) p.kids = !!patch.kids;
  save("profiles");
}

export function deleteProfile(id) {
  state.profiles = state.profiles.filter((p) => p.id !== id);
  if (state.activeId === id) state.activeId = null;
  save("profiles");
}

/* ---------------- settings ---------------- */

export const settings = () => active()?.settings || { ...DEFAULT_SETTINGS };
export function updateSettings(patch) {
  const p = active();
  if (!p) return;
  Object.assign(p.settings, patch);
  save("settings");
}

/* ---------------- my list ---------------- */

const key = (type, id) => `${type}:${id}`;

export const myList = () => active()?.myList || [];
export const inMyList = (type, id) => myList().some((i) => i.type === type && i.id === id);

/** Toggle an item; returns true when it is now in the list. */
export function toggleMyList(item) {
  const p = active();
  if (!p) return false;
  const i = p.myList.findIndex((x) => x.type === item.type && x.id === item.id);
  if (i >= 0) p.myList.splice(i, 1);
  else p.myList.unshift({ id: item.id, type: item.type, title: item.title, poster: item.poster, backdrop: item.backdrop, year: item.year, addedAt: Date.now() });
  save("mylist");
  return i < 0;
}

/* ---------------- history / progress ---------------- */

export function saveProgress({ id, type, title, poster, backdrop, season, episode, position, duration }) {
  const p = active();
  if (!p || !duration || !Number.isFinite(duration)) return;
  const k = key(type, id);
  const now = Date.now();
  const entry = p.history[k] || { id, type, episodes: type === "tv" ? {} : undefined };
  Object.assign(entry, { id, type, title, poster, backdrop, position, duration, updatedAt: now });
  if (type === "tv") {
    entry.season = season;
    entry.episode = episode;
    entry.episodes ||= {};
    entry.episodes[`${season}:${episode}`] = { position, duration, updatedAt: now };
  }
  entry.finished = position / duration >= FINISHED;
  p.history[k] = entry;

  const keys = Object.keys(p.history);
  if (keys.length > MAX_HISTORY) {
    keys.sort((a, b) => p.history[a].updatedAt - p.history[b].updatedAt);
    for (const old of keys.slice(0, keys.length - MAX_HISTORY)) delete p.history[old];
  }
  save("progress");
}

/** After finishing an episode, point "Continue Watching" at the next one. */
export function setUpNext(id, season, episode) {
  const h = active()?.history[key("tv", id)];
  if (!h) return;
  Object.assign(h, { season, episode, position: 0, duration: 0, finished: false, updatedAt: Date.now() });
  save("progress");
}

export function historyEntry(type, id) {
  return active()?.history[key(type, id)] || null;
}

/** Saved position for a movie or a specific episode, in seconds (0 if none or finished). */
export function resumePoint(type, id, season, episode) {
  const h = historyEntry(type, id);
  if (!h) return 0;
  const rec = type === "tv" ? h.episodes?.[`${season}:${episode}`] : h;
  if (!rec || !rec.duration) return 0;
  if (rec.position / rec.duration >= FINISHED) return 0;
  return rec.position > 15 ? rec.position : 0;
}

export function episodeProgress(id, season, episode) {
  const rec = historyEntry("tv", id)?.episodes?.[`${season}:${episode}`];
  return rec?.duration ? Math.min(1, rec.position / rec.duration) : 0;
}

export function removeFromHistory(type, id) {
  const p = active();
  if (!p) return;
  delete p.history[key(type, id)];
  save("progress");
}

/** Titles to show in "Continue Watching", newest first. Finished movies drop out. */
export function continueWatching() {
  const p = active();
  if (!p) return [];
  return Object.values(p.history)
    .filter((h) => h.type === "tv" || !h.finished)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 20);
}
