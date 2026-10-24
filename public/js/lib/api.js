// Client for the backend API. GET responses are memoised for the session and
// concurrent requests for the same path share one in-flight promise.

const TTL = 10 * 60 * 1000;
const cache = new Map(); // path -> { at, promise }

export class ApiError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

async function request(path, { signal } = {}) {
  const res = await fetch(path, { signal, headers: { Accept: "application/json" } });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) throw new ApiError(body?.error || `Request failed (${res.status})`, res.status);
  return body;
}

export function get(path, { fresh = false, signal } = {}) {
  const hit = cache.get(path);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.promise;
  const promise = request(path, { signal }).catch((e) => { cache.delete(path); throw e; });
  cache.set(path, { at: Date.now(), promise });
  return promise;
}

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
};

export const tmdb = {
  trending: (type = "all", window = "week", page) => get(`/api/trending/${type}/${window}${qs({ page })}`),
  list: (type, category, page) => get(`/api/list/${type}/${category}${qs({ page })}`),
  discover: (type, params = {}) => get(`/api/discover/${type}${qs(params)}`),
  genres: (type) => get(`/api/genres/${type}`),
  details: (type, id) => get(`/api/${type}/${id}`),
  season: (id, season) => get(`/api/tv/${id}/season/${season}`),
  search: (query, page) => get(`/api/search/multi${qs({ query, page })}`),
};

export const streams = {
  // Not memoised here: stream tokens expire.
  // fresh: skip the server's short-lived scrape cache (used by "Try again").
  movie: (id, { signal, fresh } = {}) => request(`/api/stream/movie/${id}${qs({ fresh: fresh ? 1 : null })}`, { signal }),
  tv: (id, season, episode, { signal, fresh } = {}) => request(`/api/stream/tv/${id}/${season}/${episode}${qs({ fresh: fresh ? 1 : null })}`, { signal }),
};

export const proxied = (url, referer) =>
  `/api/proxy${qs({ url, referer })}`;

const IMG = "https://image.tmdb.org/t/p/";
export const img = (path, size = "w780") => (path ? IMG + size + path : "");

/** Normalise a TMDB movie/tv result into the small shape the UI works with. */
export function toItem(r, fallbackType) {
  const type = r.media_type || fallbackType || (r.first_air_date !== undefined || r.name ? "tv" : "movie");
  const date = r.release_date || r.first_air_date || "";
  return {
    id: r.id,
    type,
    title: r.title || r.name || r.original_title || r.original_name || "Untitled",
    overview: r.overview || "",
    poster: r.poster_path || null,
    backdrop: r.backdrop_path || null,
    year: date ? date.slice(0, 4) : "",
    rating: r.vote_average || 0,
    votes: r.vote_count || 0,
    genreIds: r.genre_ids || (r.genres || []).map((g) => g.id),
    adult: !!r.adult,
  };
}

export const isPlayable = (r) => r && (r.media_type === undefined || r.media_type === "movie" || r.media_type === "tv");

/** Genre id -> name lookup, loaded once for both media types. */
let genreMap = null;
export async function genres() {
  if (genreMap) return genreMap;
  const [m, t] = await Promise.all([tmdb.genres("movie").catch(() => ({ genres: [] })), tmdb.genres("tv").catch(() => ({ genres: [] }))]);
  genreMap = new Map([...m.genres, ...t.genres].map((g) => [g.id, g.name]));
  return genreMap;
}
export const genreNames = (ids, map) => (map ? ids.map((id) => map.get(id)).filter(Boolean) : []);
