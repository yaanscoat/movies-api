// Watch page: connects the Player to TMDB metadata, stream sources,
// profile progress and the episode list.

import { html, raw, icons, $, fmtRuntime, fmtTime } from "../lib/dom.js";
import { tmdb, streams, img } from "../lib/api.js";
import * as store from "../lib/store.js";
import { go, canGoBack } from "../lib/router.js";
import { Player } from "../player/Player.js";
import { pickLogo } from "../ui/hero.js";
import { toast } from "../ui/toast.js";
import { setAmbient } from "../ui/ambient.js";

const SEARCH_MESSAGES = ["Finding the best stream…", "Checking providers…", "Decrypting stream links…", "Still looking — some providers are slow…", "Almost there…"];
const firstSeason = (d) => (d.seasons || []).find((s) => s.season_number > 0 && s.episode_count > 0)?.season_number ?? 1;
const aired = (ep) => !ep?.air_date || new Date(ep.air_date) <= new Date();

export function playerView(view, { params }) {
  const type = params.type;
  const id = Number(params.id);
  if (!["movie", "tv"].includes(type) || !Number.isInteger(id)) return go("/browse", {}, { replace: true });

  // /watch/tv/:id without an episode: resume where the profile left off, else S1E1.
  if (type === "tv" && !params.season) {
    const h = store.historyEntry("tv", id);
    if (h?.season) return go(`/watch/tv/${id}/${h.season}/${h.episode}`, {}, { replace: true });
    view.innerHTML = '<div class="spinner" style="margin-top:45vh"></div>';
    tmdb.details("tv", id).then((d) => go(`/watch/tv/${id}/${firstSeason(d)}/1`, {}, { replace: true }), () => go("/browse", {}, { replace: true }));
    return;
  }

  const season = Number(params.season) || 0;
  const episode = Number(params.episode) || 0;
  const ctrl = new AbortController();
  const startAt = store.resumePoint(type, id, season, episode);
  const meta = { title: "", poster: null, backdrop: null };
  let details = null;
  let next = null;
  let msgTimer = null;

  view.innerHTML = "";
  setAmbient("");

  const back = () => (canGoBack() ? history.back() : go("/browse", { title: `${type}-${id}` }));

  const player = new Player(view, {
    title: "",
    settings: store.settings(),
    onBack: back,
    onSettings: (patch) => store.updateSettings(patch),
    onRetry: () => loadStreams({ fresh: true }),
    onStart: () => {
      if (startAt > 30) {
        toast(`Resumed from ${fmtTime(startAt)}`, { action: "Start over", onAction: () => player.seek(0), duration: 5000 });
      }
    },
    onProgress: ({ position, duration }) => {
      if (!meta.title) return;
      store.saveProgress({ id, type, title: meta.title, poster: meta.poster, backdrop: meta.backdrop, season, episode, position, duration });
      if (type === "tv" && next && position / duration >= 0.94) store.setUpNext(id, next.season, next.episode);
    },
    onEnded: () => {
      if (next && store.settings().autoplayNext !== false) next.go();
      else if (next && !player.upNextEl) player.showUpNext();
    },
    episodes: type === "tv" ? (node, close) => renderEpisodes(node, close) : null,
  });

  /* ---------- streams (in parallel with metadata) ---------- */

  async function loadStreams({ fresh = false } = {}) {
    let m = 0;
    clearInterval(msgTimer);
    player.loader("loading", { title: meta.title, text: SEARCH_MESSAGES[0] });
    msgTimer = setInterval(() => player.loaderText(SEARCH_MESSAGES[Math.min(++m, SEARCH_MESSAGES.length - 1)]), 3500);
    try {
      const opts = { signal: ctrl.signal, fresh };
      const res = type === "movie" ? await streams.movie(id, opts) : await streams.tv(id, season, episode, opts);
      clearInterval(msgTimer);
      player.setSources(dedupe(res.streams || []), startAt);
    } catch (e) {
      clearInterval(msgTimer);
      if (e.name === "AbortError") return;
      player.loader("error", { title: "Couldn’t reach the server", text: e.message });
    }
  }
  loadStreams();

  /* ---------- metadata ---------- */

  (async () => {
    try {
      details = await tmdb.details(type, id);
      if (ctrl.signal.aborted) return;
      meta.title = details.title || details.name || "";
      meta.poster = details.poster_path;
      meta.backdrop = details.backdrop_path;
      let subtitle = details.release_date?.slice(0, 4) || "";
      if (type === "tv") {
        const s = await tmdb.season(id, season);
        const ep = s.episodes?.find((e) => e.episode_number === episode);
        subtitle = `S${season}:E${episode}${ep?.name ? ` “${ep.name}”` : ""}`;
        next = await findNext(s);
        if (ctrl.signal.aborted) return;
        player.setNext(next);
      }
      document.title = `${meta.title}${type === "tv" ? ` · S${season}:E${episode}` : ""} — Movies`;
      player.setMeta({ title: meta.title, subtitle, backdrop: img(details.backdrop_path, "w1280"), logo: pickLogo(details) });
    } catch (e) {
      console.warn("[watch] metadata", e.message);
    }
  })();

  async function findNext(currentSeason) {
    const eps = currentSeason.episodes || [];
    const i = eps.findIndex((e) => e.episode_number === episode);
    let ep = i >= 0 ? eps[i + 1] : null;
    let ns = season;
    if (!ep) {
      const later = (details.seasons || []).filter((s) => s.season_number > season && s.episode_count > 0).sort((a, b) => a.season_number - b.season_number)[0];
      if (!later) return null;
      const s2 = await tmdb.season(id, later.season_number).catch(() => null);
      ep = s2?.episodes?.[0];
      ns = later.season_number;
    }
    if (!ep || !aired(ep)) return null;
    return {
      season: ns, episode: ep.episode_number,
      title: `S${ns}:E${ep.episode_number} · ${ep.name || "Episode " + ep.episode_number}`,
      still: img(ep.still_path, "w300") || img(details.backdrop_path, "w300"),
      go: () => go(`/watch/tv/${id}/${ns}/${ep.episode_number}`, {}, { replace: true }),
    };
  }

  /* ---------- episode picker (inside the player) ---------- */

  async function renderEpisodes(node, close, s = season) {
    if (!details) { node.innerHTML = '<div class="spinner"></div>'; await tmdb.details(type, id).then((d) => (details = d)).catch(() => {}); }
    const seasons = (details?.seasons || []).filter((x) => x.episode_count > 0);
    node.innerHTML = html`<div class="p-eps-head"><b>${details?.name || ""}</b>
      ${seasons.length > 1 ? html`<label class="genre-select"><select aria-label="Season">${seasons.map((x) => html`<option value="${x.season_number}" ${x.season_number === s ? raw("selected") : ""}>${x.name}</option>`)}</select>${raw(icons.chevDown)}</label>` : ""}
    </div><div class="ep-list"><div class="spinner"></div></div>`.s;
    const sel = $("select", node);
    if (sel) sel.onchange = () => renderEpisodes(node, close, Number(sel.value));
    const data = await tmdb.season(id, s).catch(() => null);
    const list = $(".ep-list", node);
    if (!data || !list) return;
    list.innerHTML = (data.episodes || []).map((ep) => {
      const prog = store.episodeProgress(id, s, ep.episode_number);
      const cur = s === season && ep.episode_number === episode;
      const still = img(ep.still_path, "w300");
      return html`<div class="episode${cur ? " current" : ""}" data-ep="${ep.episode_number}" role="button" tabindex="0">
        <div class="ep-num">${ep.episode_number}</div>
        <div class="ep-thumb">${still ? html`<img src="${still}" alt="" loading="lazy" />` : ""}<div class="play-ov">${raw(icons.play)}</div>
          ${prog > 0.01 ? html`<div class="progress"><i style="width:${(prog * 100).toFixed(1)}%"></i></div>` : ""}</div>
        <div><div class="ep-top">${ep.name || `Episode ${ep.episode_number}`}<span>${ep.runtime ? fmtRuntime(ep.runtime) : ""}</span></div><p>${ep.overview || ""}</p></div>
      </div>`.s;
    }).join("");
    list.querySelector(".current")?.scrollIntoView({ block: "center" });
    list.onclick = (e) => {
      const el = e.target.closest("[data-ep]");
      if (!el) return;
      close();
      const n = Number(el.dataset.ep);
      if (s === season && n === episode) return;
      go(`/watch/tv/${id}/${s}/${n}`, {}, { replace: true });
    };
  }

  return () => {
    ctrl.abort();
    clearInterval(msgTimer);
    player.destroy();
    document.title = "Movies";
  };
}

/** Drop duplicate URLs, keep HLS before progressive files, and number same-named sources ("VidSrc 1", "VidSrc 2"). */
function dedupe(list) {
  const seen = new Set();
  const out = list
    .filter((s) => s?.url && !seen.has(s.url) && seen.add(s.url))
    .map((s, i) => ({ ...s, _i: i }))
    .sort((a, b) => (a.type === "hls" ? 0 : 1) - (b.type === "hls" ? 0 : 1) || a._i - b._i);
  const counts = {};
  for (const s of out) counts[s.providerName] = (counts[s.providerName] || 0) + 1;
  const seenName = {};
  for (const s of out) if (counts[s.providerName] > 1 && !s.quality) s.providerName = `${s.providerName} ${(seenName[s.providerName] = (seenName[s.providerName] || 0) + 1)}`;
  return out;
}
