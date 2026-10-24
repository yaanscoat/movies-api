// Optional adapter for @p-stream/providers. The package ships TypeScript
// sources, so it only loads under Bun; anywhere else it is skipped quietly.

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "../config.js";
import { tmdb } from "../lib/tmdb.js";

let loading = null;

async function load() {
  loading ??= (async () => {
    let mod;
    try { mod = await import("@p-stream/providers"); }
    catch {
      mod = await import(pathToFileURL(join(ROOT, "node_modules/@p-stream/providers/src/index.ts")).href);
    }
    const { makeProviders, makeStandardFetcher, targets } = mod;
    return makeProviders({ fetcher: makeStandardFetcher(fetch), target: targets.NATIVE, consistentIpForRequests: true });
  })().catch((e) => {
    console.log(`[pstream] unavailable (${e.code || e.message.split("\n")[0]}) — continuing without it`);
    return null;
  });
  return loading;
}

export async function pstreamInfo() {
  const p = await load();
  return p ? { sources: p.listSources(), embeds: p.listEmbeds() } : null;
}

async function media({ type, tmdbId, season, episode }) {
  if (type === "movie") {
    const d = await tmdb(`/movie/${tmdbId}`, { append_to_response: "videos,images,credits,recommendations,similar,release_dates,external_ids", include_image_language: "en,null" });
    return { type: "movie", title: d.title, releaseYear: new Date(d.release_date).getFullYear(), tmdbId: String(d.id), imdbId: d.imdb_id || d.external_ids?.imdb_id || undefined };
  }
  const [show, s] = await Promise.all([
    tmdb(`/tv/${tmdbId}`, { append_to_response: "videos,images,credits,recommendations,similar,content_ratings,external_ids", include_image_language: "en,null" }),
    tmdb(`/tv/${tmdbId}/season/${season}`),
  ]);
  const ep = s.episodes?.find((e) => e.episode_number === Number(episode));
  return {
    type: "show", title: show.name, releaseYear: new Date(show.first_air_date).getFullYear(),
    tmdbId: String(show.id), imdbId: show.external_ids?.imdb_id || undefined,
    season: { number: Number(season), tmdbId: String(s.id) },
    episode: { number: Number(episode), tmdbId: ep ? String(ep.id) : String(episode) },
  };
}

const referer = (h) => h?.Referer || h?.referer || undefined;
const captions = (s) => (s.captions || []).filter((c) => c.url).map((c) => ({ url: c.url, lang: c.language, type: c.type }));

export async function pstream(req) {
  const providers = await load();
  if (!providers) return [];
  const result = await providers.runAll({ media: await media(req) });
  const s = result?.stream;
  if (!s) return [];
  const name = result.sourceId ? `P-Stream ${result.sourceId}` : "P-Stream";
  const base = { providerName: name, referer: referer(s.headers || s.preferredHeaders), captions: captions(s) };
  if (s.type === "hls") return [{ ...base, url: s.playlist, type: "hls" }];
  if (s.type === "file") {
    return Object.entries(s.qualities || {})
      .filter(([, q]) => q?.url)
      .sort(([a], [b]) => (parseInt(b) || 0) - (parseInt(a) || 0))
      .map(([quality, q]) => ({ ...base, url: q.url, type: "file", quality: /^\d+$/.test(quality) ? `${quality}p` : quality }));
  }
  return [];
}
