import { Router } from "express";
import { findStreams, enabledProviders, PROVIDERS } from "../providers/index.js";
import { pstreamInfo } from "../providers/pstream.js";
import { HttpError } from "../lib/tmdb.js";

const router = Router();

const num = (v, name) => {
  if (!/^\d{1,10}$/.test(v)) throw new HttpError(400, `${name} must be numeric`);
  return Number(v);
};

const send = (res, result) => {
  res.set("Cache-Control", "no-store");
  res.json({ streams: result.streams, providers: result.report });
};

router.get("/sources", async (_req, res) => {
  res.json({
    enabled: enabledProviders().map((id) => ({ id, name: PROVIDERS[id].name })),
    pstream: await pstreamInfo(),
  });
});

router.get("/stream/movie/:tmdbId", async (req, res) => {
  const tmdbId = num(req.params.tmdbId, "tmdbId");
  send(res, await findStreams({ type: "movie", tmdbId }, { fresh: req.query.fresh === "1" }));
});

router.get("/stream/tv/:tmdbId/:season/:episode", async (req, res) => {
  const tmdbId = num(req.params.tmdbId, "tmdbId");
  const season = num(req.params.season, "season");
  const episode = num(req.params.episode, "episode");
  send(res, await findStreams({ type: "tv", tmdbId, season, episode }, { fresh: req.query.fresh === "1" }));
});

export default router;
