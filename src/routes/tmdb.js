// TMDB metadata endpoints. Inputs are validated against allow-lists so the
// server never forwards arbitrary paths or parameters to TMDB.

import { Router } from "express";
import { tmdb, HttpError } from "../lib/tmdb.js";
import { config } from "../config.js";

const router = Router();
const DAY = 24 * 60 * 60 * 1000;

const LIST_CATEGORIES = {
  movie: new Set(["popular", "top_rated", "now_playing", "upcoming"]),
  tv: new Set(["popular", "top_rated", "on_the_air", "airing_today"]),
};
const DISCOVER_PARAMS = new Set([
  "with_genres", "without_genres", "sort_by", "page", "with_original_language", "vote_count.gte", "vote_average.gte",
  "primary_release_year", "first_air_date_year", "with_watch_providers", "watch_region",
  "certification_country", "certification.lte", "certification", "with_keywords", "with_networks", "with_companies",
]);
const SORTS = new Set([
  "popularity.desc", "popularity.asc", "vote_average.desc", "vote_count.desc", "revenue.desc",
  "primary_release_date.desc", "primary_release_date.asc", "first_air_date.desc", "first_air_date.asc",
]);

const mediaType = (t) => {
  if (t !== "movie" && t !== "tv") throw new HttpError(400, "type must be 'movie' or 'tv'");
  return t;
};
const page = (p) => {
  if (p === undefined) return undefined;
  const n = Number(p);
  if (!Number.isInteger(n) || n < 1 || n > 500) throw new HttpError(400, "page must be 1-500");
  return n;
};
const numericId = (id, name = "id") => {
  if (!/^\d{1,10}$/.test(id)) throw new HttpError(400, `${name} must be numeric`);
  return id;
};

// Browsers can cache metadata briefly; the server cache does the heavy lifting.
router.use((_req, res, next) => { res.set("Cache-Control", "public, max-age=300"); next(); });

router.get("/search/:type", async (req, res) => {
  const { type } = req.params;
  if (!["multi", "movie", "tv", "person"].includes(type)) throw new HttpError(400, "invalid search type");
  const query = String(req.query.query || "").trim().slice(0, 200);
  if (!query) throw new HttpError(400, "query required");
  res.json(await tmdb(`/search/${type}`, { query, page: page(req.query.page), include_adult: false }));
});

router.get("/trending/:type/:window", async (req, res) => {
  const { type, window } = req.params;
  if (!["all", "movie", "tv"].includes(type)) throw new HttpError(400, "type must be all, movie or tv");
  if (!["day", "week"].includes(window)) throw new HttpError(400, "window must be day or week");
  res.json(await tmdb(`/trending/${type}/${window}`, { page: page(req.query.page) }));
});

router.get("/list/:type/:category", async (req, res) => {
  const type = mediaType(req.params.type);
  const { category } = req.params;
  if (!LIST_CATEGORIES[type].has(category)) throw new HttpError(400, `category must be one of: ${[...LIST_CATEGORIES[type]].join(", ")}`);
  res.json(await tmdb(`/${type}/${category}`, { page: page(req.query.page), region: type === "movie" ? config.tmdb.region : undefined }));
});

router.get("/discover/:type", async (req, res) => {
  const type = mediaType(req.params.type);
  const params = { include_adult: false };
  for (const [k, v] of Object.entries(req.query)) {
    if (!DISCOVER_PARAMS.has(k) || typeof v !== "string") continue;
    if (k === "sort_by" && !SORTS.has(v)) throw new HttpError(400, "invalid sort_by");
    if (!/^[\w.,|:-]{1,100}$/.test(v)) throw new HttpError(400, `invalid value for ${k}`);
    params[k] = v;
  }
  params.page = page(params.page);
  res.json(await tmdb(`/discover/${type}`, params));
});

router.get("/genres/:type", async (req, res) => {
  const type = mediaType(req.params.type);
  res.set("Cache-Control", "public, max-age=86400");
  res.json(await tmdb(`/genre/${type}/list`, {}, { ttlMs: DAY }));
});

const DETAIL_APPEND = {
  movie: "videos,images,credits,recommendations,similar,release_dates,external_ids",
  tv: "videos,images,credits,recommendations,similar,content_ratings,external_ids",
};

router.get("/movie/:id", async (req, res) => {
  res.json(await tmdb(`/movie/${numericId(req.params.id)}`, { append_to_response: DETAIL_APPEND.movie, include_image_language: "en,null" }));
});

router.get("/tv/:id", async (req, res) => {
  res.json(await tmdb(`/tv/${numericId(req.params.id)}`, { append_to_response: DETAIL_APPEND.tv, include_image_language: "en,null" }));
});

router.get("/tv/:id/season/:season", async (req, res) => {
  res.json(await tmdb(`/tv/${numericId(req.params.id)}/season/${numericId(req.params.season, "season")}`));
});

export default router;
