// Rotating billboard at the top of browse pages.

import { html, raw, el, icons, $, $$ } from "../lib/dom.js";
import { tmdb, img, toItem } from "../lib/api.js";
import { remember, play, openDetails } from "./cards.js";
import { setAmbient } from "./ambient.js";

const ROTATE_MS = 11000;

export function pickLogo(details) {
  const logos = details?.images?.logos || [];
  const best = logos.find((l) => l.iso_639_1 === "en") || logos.find((l) => !l.iso_639_1) || logos[0];
  return best ? img(best.file_path, "w500") : "";
}

export function certification(details, type) {
  if (type === "movie") {
    const us = details?.release_dates?.results?.find((r) => r.iso_3166_1 === "US");
    return us?.release_dates?.find((d) => d.certification)?.certification || "";
  }
  return details?.content_ratings?.results?.find((r) => r.iso_3166_1 === "US")?.rating || "";
}

/** items: TMDB results (already normalised or raw). Returns the hero element. */
export function hero(loadItems) {
  const node = el(`<section class="hero" aria-roledescription="carousel">
    <div class="hero-slides"></div>
    <div class="hero-side"><div class="hero-dots glass" role="tablist"></div><div class="rating-flag" hidden></div></div>
  </section>`);
  const slidesEl = $(".hero-slides", node);
  const dotsEl = $(".hero-dots", node);
  const flag = $(".rating-flag", node);
  let list = [];
  let index = -1;
  let timer = null;
  const detailCache = new Map();

  const details = (it) => {
    const k = `${it.type}:${it.id}`;
    if (!detailCache.has(k)) detailCache.set(k, tmdb.details(it.type, it.id).catch(() => null));
    return detailCache.get(k);
  };

  async function show(i) {
    if (!list.length) return;
    index = (i + list.length) % list.length;
    const it = list[index];
    $$(".hero-dots button", node).forEach((b, j) => b.classList.toggle("active", j === index));
    setAmbient(img(it.backdrop, "w780"));

    const d = await details(it);
    if (list[index] !== it) return; // user moved on while loading
    const logo = pickLogo(d);
    const cert = certification(d, it.type);
    const meta = [
      it.rating ? html`<span class="match">${Math.round(it.rating * 10)}% Match</span>` : "",
      it.year ? html`<span>${it.year}</span>` : "",
      d?.number_of_seasons ? html`<span>${d.number_of_seasons} Season${d.number_of_seasons > 1 ? "s" : ""}</span>` : "",
      d?.runtime ? html`<span>${Math.floor(d.runtime / 60)}h ${d.runtime % 60}m</span>` : "",
      html`<span class="chip">${it.type === "tv" ? "Series" : "Film"}</span>`,
    ];

    const slide = el(html`<div class="hero-slide">
      <img class="bg" src="${img(it.backdrop, "original")}" alt="" fetchpriority="high" />
      <div class="hero-content">
        ${logo ? html`<img class="hero-logo" src="${logo}" alt="${it.title}" />` : html`<h1 class="hero-title">${it.title}</h1>`}
        <div class="hero-meta">${meta}</div>
        <p class="hero-overview">${it.overview}</p>
        <div class="hero-actions">
          <button class="btn btn-primary" data-hero="play">${raw(icons.play)} Play</button>
          <button class="btn btn-glass glass" data-hero="info">${raw(icons.info)} More Info</button>
        </div>
      </div>
    </div>`);
    slide.querySelector('[data-hero="play"]').onclick = () => play(it);
    slide.querySelector('[data-hero="info"]').onclick = () => openDetails(it.type, it.id);

    const bg = slide.querySelector("img.bg");
    const reveal = () => {
      const old = $$(".hero-slide", slidesEl);
      slidesEl.append(slide);
      requestAnimationFrame(() => requestAnimationFrame(() => slide.classList.add("active")));
      old.forEach((o) => { o.classList.remove("active"); setTimeout(() => o.remove(), 1200); });
    };
    if (bg.complete) reveal(); else { bg.onload = reveal; bg.onerror = reveal; }

    flag.hidden = !cert;
    flag.textContent = cert;
    schedule();
  }

  function schedule() {
    clearTimeout(timer);
    if (list.length > 1) timer = setTimeout(() => { if (node.isConnected && !document.hidden) show(index + 1); else schedule(); }, ROTATE_MS);
  }

  dotsEl.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b) show(Number(b.dataset.i));
  });

  (async () => {
    try {
      const raw_ = await loadItems();
      list = raw_.filter((r) => r.backdrop && r.overview).slice(0, 6).map(remember);
      if (!list.length) return node.remove();
      dotsEl.innerHTML = list.map((it, i) => `<button role="tab" data-i="${i}" aria-label="Slide ${i + 1}"></button>`).join("");
      list.forEach(details); // warm detail cache for logos
      show(0);
    } catch (e) {
      console.warn("[hero]", e.message);
      node.remove();
    }
  })();

  return node;
}

export const heroFrom = (fetcher, type) => () => fetcher().then((d) => d.results.map((r) => toItem(r, type)));
