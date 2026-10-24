import { config } from "../config.js";
import { TtlCache } from "./cache.js";

const BASE = "https://api.themoviedb.org/3";
const cache = new TtlCache({ ttlMs: config.tmdb.cacheTtlSeconds * 1000, max: 2000 });

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// v3 keys are 32 hex chars and go in the query string; v4 read tokens are JWTs and go in a header.
const isBearer = (k) => k.length > 40 && k.split(".").length === 3;

/** GET a TMDB v3 path. Responses are cached in memory; concurrent identical calls share one request. */
export function tmdb(path, params = {}, { ttlMs } = {}) {
  const key = config.tmdb.key;
  if (!key) return Promise.reject(new HttpError(503, "TMDB_API_KEY is not configured on the server"));

  const url = new URL(BASE + path);
  if (!isBearer(key)) url.searchParams.set("api_key", key);
  if (!("language" in params)) url.searchParams.set("language", config.tmdb.language);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, String(v));

  const cacheKey = url.pathname + "?" + [...url.searchParams].filter(([k]) => k !== "api_key").sort().map(([k, v]) => `${k}=${v}`).join("&");

  return cache.wrap(cacheKey, async () => {
    const res = await fetch(url, {
      headers: { Accept: "application/json", ...(isBearer(key) ? { Authorization: `Bearer ${key}` } : {}) },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      let msg = `TMDB responded ${res.status}`;
      try { const j = await res.json(); if (j.status_message) msg = j.status_message; } catch {}
      throw new HttpError(res.status === 401 ? 502 : res.status, msg);
    }
    return res.json();
  }, { ttlMs });
}
