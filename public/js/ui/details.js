// Details modal, opened by the `?title=type-id` query on any page.

import { html, raw, el, icons, $, fmtRuntime, lazyFade, fadeOut } from "../lib/dom.js";
import { tmdb, img, toItem } from "../lib/api.js";
import * as store from "../lib/store.js";
import { setQuery, go } from "../lib/router.js";
import { remember, toggleList } from "./cards.js";
import { pickLogo, certification } from "./hero.js";

let backdropEl = null;
let openKey = null;
let lastFocus = null;

export function syncDetails(query) {
  const key = query.title || null;
  if (!key) return closeDetails();
  if (key === openKey) return;
  const [type, id] = key.split("-");
  if (!["movie", "tv"].includes(type) || !/^\d+$/.test(id)) return setQuery({ title: null }, { replace: true });
  openDetails(type, Number(id), key);
}

function closeDetails() {
  if (!backdropEl) return;
  const b = backdropEl;
  backdropEl = null;
  openKey = null;
  document.body.classList.remove("no-scroll");
  fadeOut(b);
  lastFocus?.focus?.({ preventScroll: true });
}

const dismiss = () => setQuery({ title: null });

async function openDetails(type, id, key) {
  openKey = key;
  if (!backdropEl) {
    lastFocus = document.activeElement;
    backdropEl = el(`<div class="modal-backdrop" role="dialog" aria-modal="true"><div class="modal glass"><div class="spinner" style="margin:120px auto"></div></div></div>`);
    backdropEl.addEventListener("click", (e) => { if (e.target === backdropEl) dismiss(); });
    document.getElementById("modal-root").append(backdropEl);
    document.body.classList.add("no-scroll");
  } else {
    backdropEl.scrollTo({ top: 0, behavior: "smooth" });
  }

  let d;
  try { d = await tmdb.details(type, id); }
  catch (e) {
    if (openKey !== key) return;
    $(".modal", backdropEl).innerHTML = html`<div class="empty"><h2>Couldn’t load this title</h2><p>${e.message}</p><button class="btn btn-glass glass" data-close>Close</button></div>`.s;
    $("[data-close]", backdropEl).onclick = dismiss;
    return;
  }
  if (openKey !== key || !backdropEl) return;

  const item = remember(toItem({ ...d, media_type: type }, type));
  const modal = render(d, item);
  backdropEl.querySelector(".modal").replaceWith(modal);
  backdropEl.setAttribute("aria-label", item.title);
  lazyFade(modal);
  $(".modal-close", modal).focus({ preventScroll: true });
  if (type === "tv") loadSeason(modal, item, d, store.historyEntry("tv", id)?.season || firstSeason(d));
  startTrailer(modal, d);
}

const firstSeason = (d) => (d.seasons || []).find((s) => s.season_number > 0)?.season_number ?? 1;

function render(d, item) {
  const { type, id } = item;
  const logo = pickLogo(d);
  const cert = certification(d, type);
  const h = store.historyEntry(type, id);
  const resume = type === "movie" ? store.resumePoint("movie", id) : h?.season ? 1 : 0;
  const playLabel = type === "tv" && h?.season ? `Resume S${h.season}:E${h.episode}` : resume ? "Resume" : "Play";
  const cast = (d.credits?.cast || []).slice(0, 14);
  const crew = d.credits?.crew || [];
  const directors = type === "movie" ? crew.filter((c) => c.job === "Director").map((c) => c.name) : (d.created_by || []).map((c) => c.name);
  const recs = (d.recommendations?.results?.length ? d.recommendations.results : d.similar?.results || [])
    .filter((r) => r.backdrop_path).slice(0, 12).map((r) => remember(toItem(r, type)));
  const inList = store.inMyList(type, id);

  const node = el(html`<div class="modal glass">
    <button class="round-btn glass dark modal-close" aria-label="Close">${raw(icons.close)}</button>
    <div class="modal-hero">
      ${d.backdrop_path ? html`<img class="bg" src="${img(d.backdrop_path, "w1280")}" alt="" />` : ""}
      <div class="modal-hero-content">
        ${logo ? html`<img class="hero-logo" src="${logo}" alt="${item.title}" />` : html`<h2 class="hero-title">${item.title}</h2>`}
        <div class="modal-actions">
          <button class="btn btn-primary" data-m="play">${raw(icons.play)} ${playLabel}</button>
          <button class="round-btn glass" data-m="list" aria-label="My List" title="My List">${raw(inList ? icons.check : icons.plus)}</button>
          <button class="round-btn glass modal-mute" data-m="mute" aria-label="Unmute trailer" hidden>${raw(icons.mute)}</button>
        </div>
      </div>
    </div>
    <div class="modal-body">
      <div class="modal-info">
        <div>
          <div class="meta">
            ${item.rating ? html`<span class="match">${Math.round(item.rating * 10)}% Match</span>` : ""}
            ${item.year ? html`<span>${item.year}</span>` : ""}
            ${d.runtime ? html`<span>${fmtRuntime(d.runtime)}</span>` : ""}
            ${d.number_of_seasons ? html`<span>${d.number_of_seasons} Season${d.number_of_seasons > 1 ? "s" : ""}</span>` : ""}
            ${cert ? html`<span class="chip">${cert}</span>` : ""}
            <span class="chip">HD</span>
          </div>
          ${d.tagline ? html`<p class="tagline">${d.tagline}</p>` : ""}
          <p class="overview">${d.overview || "No overview available."}</p>
        </div>
        <div class="facts">
          ${cast.length ? html`<div><b>Cast:</b> ${cast.slice(0, 4).map((c) => c.name).join(", ")}</div>` : ""}
          ${d.genres?.length ? html`<div><b>Genres:</b> ${d.genres.map((g) => g.name).join(", ")}</div>` : ""}
          ${directors.length ? html`<div><b>${type === "movie" ? "Director" : "Created by"}:</b> ${directors.join(", ")}</div>` : ""}
          ${d.vote_count ? html`<div><b>TMDB:</b> ${d.vote_average.toFixed(1)} / 10 · ${d.vote_count.toLocaleString()} votes</div>` : ""}
        </div>
      </div>
      ${type === "tv" ? html`<section class="episodes" style="margin-bottom:34px">
        <div class="episodes-head">
          <h3 class="section-title" style="margin:0">Episodes</h3>
          ${(d.seasons || []).length > 1 ? html`<label class="genre-select"><select aria-label="Season">${(d.seasons || []).filter((s) => s.episode_count > 0).map((s) => html`<option value="${s.season_number}">${s.name}</option>`)}</select>${raw(icons.chevDown)}</label>` : ""}
        </div>
        <div class="ep-list"><div class="spinner"></div></div>
      </section>` : ""}
      ${cast.length ? html`<h3 class="section-title">Cast</h3><div class="cast">${cast.map((c) => html`<div class="cast-member">
          ${c.profile_path ? html`<img src="${img(c.profile_path, "w185")}" alt="" loading="lazy" />` : raw('<div class="ph"></div>')}
          <b>${c.name}</b><span>${c.character || ""}</span></div>`)}</div>` : ""}
      ${recs.length ? html`<h3 class="section-title">More Like This</h3><div class="similar">${recs.map((r) => html`<div class="sim-card" data-sim="${r.type}-${r.id}">
          <div class="img"><img data-fade src="${img(r.backdrop, "w500")}" alt="" loading="lazy" />${r.rating ? html`<span class="chip">${r.rating.toFixed(1)}</span>` : ""}</div>
          <div class="body"><h5>${r.title}</h5><div class="meta">${r.rating ? html`<span class="match">${Math.round(r.rating * 10)}% Match</span>` : ""}<span>${r.year}</span></div><p>${r.overview}</p></div>
        </div>`)}</div>` : ""}
    </div>
  </div>`);

  $(".modal-close", node).onclick = dismiss;
  $('[data-m="play"]', node).onclick = () => {
    if (type === "tv") {
      const s = h?.season || firstSeason(d), e = h?.season ? h.episode : 1;
      go(`/watch/tv/${id}/${s}/${e}`);
    } else go(`/watch/movie/${id}`);
  };
  $('[data-m="list"]', node).onclick = (e) => toggleList(item, e.currentTarget);
  node.addEventListener("click", (e) => {
    const sim = e.target.closest("[data-sim]");
    if (sim) setQuery({ title: sim.dataset.sim });
  });
  const sel = $(".episodes select", node);
  if (sel) {
    sel.value = String(h?.season || firstSeason(d));
    sel.onchange = () => loadSeason(node, item, d, Number(sel.value));
  }
  return node;
}

async function loadSeason(node, item, d, season) {
  const list = $(".ep-list", node);
  if (!list) return;
  list.innerHTML = '<div class="spinner"></div>';
  let s;
  try { s = await tmdb.season(item.id, season); }
  catch (e) { list.innerHTML = html`<p style="color:var(--fg-3)">Couldn’t load episodes: ${e.message}</p>`.s; return; }
  if (!node.isConnected) return;
  const h = store.historyEntry("tv", item.id);
  list.innerHTML = (s.episodes || []).map((ep) => {
    const prog = store.episodeProgress(item.id, season, ep.episode_number);
    const current = h?.season === season && h?.episode === ep.episode_number;
    const still = img(ep.still_path, "w300") || img(d.backdrop_path, "w300");
    return html`<div class="episode${current ? " current" : ""}" data-ep="${ep.episode_number}" tabindex="0" role="button">
      <div class="ep-num">${ep.episode_number}</div>
      <div class="ep-thumb">${still ? html`<img src="${still}" alt="" loading="lazy" />` : ""}<div class="play-ov">${raw(icons.play)}</div>
        ${prog > 0.01 ? html`<div class="progress"><i style="width:${(prog * 100).toFixed(1)}%"></i></div>` : ""}</div>
      <div><div class="ep-top">${ep.name || `Episode ${ep.episode_number}`}<span>${ep.runtime ? fmtRuntime(ep.runtime) : ""}</span></div><p>${ep.overview || ""}</p></div>
    </div>`.s;
  }).join("") || '<p style="color:var(--fg-3)">No episodes yet.</p>';
  list.onclick = (e) => {
    const ep = e.target.closest("[data-ep]");
    if (ep) go(`/watch/tv/${item.id}/${season}/${ep.dataset.ep}`);
  };
  list.onkeydown = (e) => { if (e.key === "Enter") e.target.closest("[data-ep]")?.click(); };
}

function startTrailer(node, d) {
  const vids = d.videos?.results || [];
  const t = vids.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) || vids.find((v) => v.site === "YouTube" && v.type === "Trailer") || vids.find((v) => v.site === "YouTube" && v.type === "Teaser");
  if (!t || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const heroEl = $(".modal-hero", node);
  const muteBtn = $('[data-m="mute"]', node);
  const src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(t.key)}?autoplay=1&mute=1&controls=0&loop=1&playlist=${encodeURIComponent(t.key)}&modestbranding=1&rel=0&playsinline=1&iv_load_policy=3&enablejsapi=1`;
  setTimeout(() => {
    if (!node.isConnected) return;
    const f = el(`<iframe allow="autoplay; encrypted-media" title="Trailer" tabindex="-1"></iframe>`);
    f.src = src;
    f.onload = () => setTimeout(() => { f.classList.add("on"); muteBtn.hidden = false; }, 1400);
    heroEl.insertBefore(f, heroEl.querySelector(".modal-hero-content"));
    let muted = true;
    muteBtn.onclick = () => {
      muted = !muted;
      f.contentWindow?.postMessage(JSON.stringify({ event: "command", func: muted ? "mute" : "unMute", args: [] }), "*");
      muteBtn.innerHTML = muted ? icons.mute : icons.volume;
      muteBtn.setAttribute("aria-label", muted ? "Unmute trailer" : "Mute trailer");
    };
  }, 1200);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && backdropEl) dismiss();
});
