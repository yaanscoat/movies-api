// Runs every enabled provider in parallel and returns as soon as results are
// in: once the first provider succeeds, the others get a short grace period.

import { config } from "../config.js";
import { TtlCache } from "../lib/cache.js";
import { vidsrc } from "./vidsrc.js";
import { cinesrcExtract } from "./cinesrc.js";
import { pstream } from "./pstream.js";

const GRACE_MS = 1500;

export const PROVIDERS = {
  vidsrc: { name: "VidSrc", run: vidsrc },
  cinesrc: { name: "CineSrc", run: ({ type, tmdbId, season, episode }) => cinesrcExtract(type, tmdbId, season, episode) },
  pstream: { name: "P-Stream", run: pstream },
};

export const enabledProviders = () => config.streams.providers.filter((id) => PROVIDERS[id]);

const cache = new TtlCache({ ttlMs: config.streams.cacheTtlSeconds * 1000, max: 300 });

/** req: { type: "movie" | "tv", tmdbId, season?, episode? } */
export function findStreams(req, { fresh = false } = {}) {
  const key = [req.type, req.tmdbId, req.season, req.episode].filter((x) => x != null).join(":");
  if (fresh) cache.delete(key);
  return cache.wrap(key, () => scrape(req), { keep: (r) => r.streams.length > 0 });
}

async function scrape(req) {
  const ids = enabledProviders();
  const ac = new AbortController();
  const byProvider = new Map();
  const report = [];

  await new Promise((resolve) => {
    let pending = ids.length;
    let grace = null;
    const overall = setTimeout(resolve, config.streams.timeoutMs);
    const finish = () => { clearTimeout(overall); clearTimeout(grace); resolve(); };
    if (!pending) return finish();

    for (const id of ids) {
      const started = Date.now();
      Promise.resolve()
        .then(() => PROVIDERS[id].run({ ...req, signal: ac.signal }))
        .then((list) => {
          const streams = (list || []).filter((s) => s?.url).map((s) => ({ ...s, provider: id, providerName: s.providerName || PROVIDERS[id].name }));
          byProvider.set(id, streams);
          report.push({ id, ok: true, count: streams.length, ms: Date.now() - started });
          if (streams.length && !grace) grace = setTimeout(finish, GRACE_MS);
        })
        .catch((e) => {
          if (e?.name !== "AbortError") console.log(`[${id}] ${e?.message || e}`);
          report.push({ id, ok: false, error: e?.message || String(e), ms: Date.now() - started });
        })
        .finally(() => { if (--pending === 0) finish(); });
    }
  });
  ac.abort();

  // Keep the configured provider order regardless of who answered first.
  const streams = ids.flatMap((id) => byProvider.get(id) || []);
  for (const id of ids) if (!report.some((r) => r.id === id)) report.push({ id, ok: false, error: "timed out" });
  return { streams, report };
}
