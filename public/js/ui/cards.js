// Cards, horizontally scrolling rows, and the Netflix-style hover preview.

import { html, raw, el, icons, lazyFade, $, fadeOut } from "../lib/dom.js";
import { img, genres, genreNames } from "../lib/api.js";
import * as store from "../lib/store.js";
import { setQuery, go } from "../lib/router.js";
import { toast } from "./toast.js";

/* ---------------- item registry ----------------
   Cards only carry data-key="type:id"; the full item lives here so the
   preview, My List and play buttons can find it. */
const items = new Map();
export const remember = (item) => (items.set(`${item.type}:${item.id}`, item), item);
export const lookup = (key) => items.get(key);

export const openDetails = (type, id) => setQuery({ title: `${type}-${id}` });

export function play(item) {
  if (item.type === "tv") {
    const h = store.historyEntry("tv", item.id);
    if (h?.season) return go(`/watch/tv/${item.id}/${h.season}/${h.episode}`);
    return go(`/watch/tv/${item.id}`);
  }
  go(`/watch/movie/${item.id}`);
}

export function toggleList(item, btn) {
  const added = store.toggleMyList(item);
  if (btn) btn.innerHTML = added ? icons.check : icons.plus;
  toast(added ? `Added “${item.title}” to My List` : `Removed from My List`, {
    action: "Undo", onAction: () => { store.toggleMyList(item); if (btn) btn.innerHTML = added ? icons.plus : icons.check; },
  });
  return added;
}

/* ---------------- card markup ---------------- */

export function card(item, { progress, removable } = {}) {
  remember(item);
  const src = img(item.backdrop, "w780") || img(item.poster, "w500");
  return html`<div class="card${progress != null ? " has-progress" : ""}" data-key="${item.type}:${item.id}" tabindex="0" role="button" aria-label="${item.title}">
    ${src ? html`<img data-fade src="${src}" alt="" loading="lazy" decoding="async" />` : ""}
    <div class="card-title">${item.title}</div>
    ${progress != null ? html`<div class="progress"><i style="width:${Math.max(3, progress * 100).toFixed(1)}%"></i></div>` : ""}
    ${removable ? html`<button class="round-btn glass remove" data-remove title="Remove from row" aria-label="Remove">${raw(icons.close)}</button>` : ""}
  </div>`;
}

export function poster(item) {
  remember(item);
  return html`<div class="card poster" data-key="${item.type}:${item.id}" tabindex="0" role="button" aria-label="${item.title}">
    ${item.poster ? html`<img data-fade src="${img(item.poster, "w342")}" alt="" loading="lazy" decoding="async" />` : html`<div class="card-title">${item.title}</div>`}
  </div>`;
}

function top10(item, i) {
  remember(item);
  return html`<div class="top10" data-key="${item.type}:${item.id}" tabindex="0" role="button" aria-label="#${i + 1} ${item.title}">
    <span class="num" aria-hidden="true">${i + 1}</span>
    <div class="card poster">${item.poster ? html`<img data-fade src="${img(item.poster, "w342")}" alt="" loading="lazy" />` : ""}</div>
  </div>`;
}

const skeletons = (kind) =>
  Array.from({ length: 8 }, () => `<div class="card ${kind === "card" ? "" : "poster"} skeleton"></div>`).join("");

/* ---------------- rows ---------------- */

const lazyRows = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    lazyRows.unobserve(e.target);
    e.target._load?.();
  }
}, { rootMargin: "600px 0px" });

/**
 * A titled, horizontally scrolling row.
 * load: async () => item[] | { items, progress? }   kind: "card" | "poster" | "top10" | "continue"
 */
export function row({ title, load, kind = "card", moreHref, eager = false }) {
  const node = el(html`<section class="row" data-kind="${kind}">
    <div class="row-head"><h2 class="row-title">${title}</h2>${moreHref ? html`<a class="row-more" href="${moreHref}">Explore all ›</a>` : ""}</div>
    <div class="track-wrap">
      <button class="arrow left" aria-label="Scroll left" disabled><span class="glass">${raw(icons.chevLeft)}</span></button>
      <div class="track">${raw(skeletons(kind === "card" || kind === "continue" ? "card" : "poster"))}</div>
      <button class="arrow right" aria-label="Scroll right"><span class="glass">${raw(icons.chevRight)}</span></button>
    </div>
  </section>`);

  const track = $(".track", node);
  const [left, right] = node.querySelectorAll(".arrow");
  const updateArrows = () => {
    left.disabled = track.scrollLeft < 8;
    right.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 8;
  };
  const page = (dir) => track.scrollBy({ left: dir * (track.clientWidth - 120), behavior: "smooth" });
  left.onclick = () => page(-1);
  right.onclick = () => page(1);
  track.addEventListener("scroll", updateArrows, { passive: true });

  node._load = async () => {
    try {
      const list = await load();
      if (!list?.length) return node.remove();
      track.innerHTML = list.map((it, i) =>
        kind === "top10" ? top10(it, i)
        : kind === "poster" ? poster(it)
        : kind === "continue" ? card(it, { progress: it.progress, removable: true })
        : card(it)).join("");
      lazyFade(track);
      track.scrollLeft = 0;
      requestAnimationFrame(updateArrows);
    } catch (e) {
      console.warn(`[row] ${title}:`, e.message);
      node.remove();
    }
  };
  if (eager) node._load(); else lazyRows.observe(node);
  return node;
}

/* ---------------- interactions (delegated once) ---------------- */

let previewTimer = null;
let previewEl = null;
let previewFor = null;
const canHover = matchMedia("(hover: hover) and (pointer: fine)");

function closePreview(immediate = false) {
  clearTimeout(previewTimer);
  previewFor = null;
  const p = previewEl;
  previewEl = null;
  if (!p) return;
  if (immediate) return p.remove();
  fadeOut(p);
}

async function showPreview(target) {
  const key = target.dataset.key;
  const item = lookup(key);
  if (!item) return;
  closePreview(true);
  previewFor = target;

  const map = await genres();
  if (previewFor !== target) return;
  const g = genreNames(item.genreIds, map).slice(0, 3);
  const inList = store.inMyList(item.type, item.id);
  const p = el(html`<div class="preview glass" data-key="${key}">
    <div class="preview-media" data-act="info">
      ${item.backdrop || item.poster ? html`<img src="${img(item.backdrop, "w780") || img(item.poster, "w500")}" alt="" />` : ""}
      <h4>${item.title}</h4>
    </div>
    <div class="preview-body">
      <div class="preview-actions">
        <button class="round-btn solid" data-act="play" aria-label="Play">${raw(icons.play)}</button>
        <button class="round-btn glass" data-act="list" aria-label="My List">${raw(inList ? icons.check : icons.plus)}</button>
        <span class="spacer"></span>
        <button class="round-btn glass" data-act="info" aria-label="More info">${raw(icons.chevDown)}</button>
      </div>
      <div class="preview-meta">
        ${item.rating ? html`<span class="match">${Math.round(item.rating * 10)}% Match</span>` : ""}
        ${item.year ? html`<span>${item.year}</span>` : ""}
        <span class="chip">${item.type === "tv" ? "Series" : "Film"}</span>
        ${item.rating >= 7.8 && item.votes > 1500 ? html`<span class="chip red">Top Rated</span>` : ""}
      </div>
      ${g.length ? html`<div class="preview-genres">${g.map((n) => html`<span>${n}</span>`)}</div>` : ""}
    </div>
  </div>`);

  const r = target.getBoundingClientRect();
  const w = Math.max(r.width * 1.45, 300);
  const margin = 16;
  let x = r.left + r.width / 2 - w / 2;
  x = Math.min(Math.max(margin, x), innerWidth - w - margin);
  let y = r.top + r.height / 2 - (w * 9 / 16) / 2 - 24;
  y = Math.max(70, y);
  Object.assign(p.style, { width: `${w}px`, left: `${x + scrollX}px`, top: `${y + scrollY}px` });
  p.addEventListener("mouseleave", () => closePreview());
  document.getElementById("preview-root").append(p);
  previewEl = p;
}

export function initCardInteractions() {
  document.addEventListener("click", (e) => {
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      e.stopPropagation();
      const c = remove.closest("[data-key]");
      const [type, id] = c.dataset.key.split(":");
      store.removeFromHistory(type, Number(id));
      const row = c.closest(".row");
      c.remove();
      if (row && !row.querySelector("[data-key]")) row.remove();
      toast("Removed from Continue Watching");
      return;
    }

    const act = e.target.closest("[data-act]");
    const holder = e.target.closest("[data-key]");
    if (!holder) return;
    const item = lookup(holder.dataset.key);
    if (!item) return;

    if (act && holder.classList.contains("preview")) {
      const a = act.dataset.act;
      if (a === "play") { closePreview(true); play(item); }
      else if (a === "list") toggleList(item, act);
      else { closePreview(true); openDetails(item.type, item.id); }
      return;
    }
    if (holder.closest(".track, .grid") || holder.classList.contains("top10")) {
      closePreview(true);
      // Continue Watching cards jump straight back into playback.
      if (holder.closest('[data-kind="continue"]')) return play(item);
      openDetails(item.type, item.id);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const holder = e.target.closest?.(".track [data-key], .grid [data-key]");
    if (holder && e.target === holder) { e.preventDefault(); holder.click(); }
  });

  document.addEventListener("mouseover", (e) => {
    if (!canHover.matches) return;
    const target = e.target.closest(".track .card[data-key], .track .top10, .grid .card[data-key]");
    if (!target || target === previewFor) return;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => { if (target.matches(":hover")) showPreview(target); }, 520);
  });
  document.addEventListener("mouseout", (e) => {
    const from = e.target.closest?.(".track .card[data-key], .track .top10, .grid .card[data-key]");
    if (from && !from.contains(e.relatedTarget) && !e.relatedTarget?.closest?.(".preview")) {
      clearTimeout(previewTimer);
      if (previewFor === from) closePreview();
    }
  });
  addEventListener("scroll", () => previewEl && closePreview(), { passive: true });
}

export { closePreview };
