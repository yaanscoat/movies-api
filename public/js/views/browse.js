// Browse pages: Home, Shows, Movies, New & Popular, genre grids, My List, Search.

import { html, raw, el, icons, $, lazyFade } from "../lib/dom.js";
import { tmdb, toItem, isPlayable, genres, img } from "../lib/api.js";
import * as store from "../lib/store.js";
import { go } from "../lib/router.js";
import { row, card } from "../ui/cards.js";
import { hero } from "../ui/hero.js";
import { setAmbient } from "../ui/ambient.js";

const MOVIE_GENRES = [
  [28, "Action & Adventure"], [35, "Comedies"], [878, "Sci-Fi"], [27, "Horror"], [53, "Thrillers"],
  [10749, "Romance"], [16, "Animation"], [99, "Documentaries"], [80, "Crime"], [14, "Fantasy"],
];
const TV_GENRES = [
  [18, "TV Dramas"], [80, "Crime TV"], [10765, "Sci-Fi & Fantasy Series"], [35, "TV Comedies"],
  [10759, "Action & Adventure Series"], [16, "Animated Series"], [99, "Docuseries"], [10764, "Reality TV"], [9648, "Mysteries"],
];
const KIDS_MOVIE_GENRES = [[16, "Animated Movies"], [10751, "Family Movies"], [12, "Adventures"], [35, "Comedies"], [14, "Fantasy"]];
const KIDS_TV_GENRES = [[10762, "Kids’ TV"], [16, "Cartoons"], [10751, "Family TV"]];

const isKids = () => !!store.active()?.kids;

/* ---------------- data helpers ---------------- */

const results = (type) => (d) => (d.results || []).filter(isPlayable).filter((r) => r.backdrop_path || r.poster_path).map((r) => toItem(r, type));

/** Discover with the kids filter applied when the profile needs it. */
function discover(type, params = {}) {
  const p = { ...params };
  if (isKids()) {
    if (type === "movie") Object.assign(p, { certification_country: "US", "certification.lte": "PG" });
    else p.with_genres = [p.with_genres, "10762|10751|16"].filter(Boolean).join(",");
  }
  return tmdb.discover(type, p).then(results(type));
}

function trending(type, window = "week") {
  if (isKids()) return discover(type === "all" ? "movie" : type, { sort_by: "popularity.desc" });
  return tmdb.trending(type, window).then(results(type === "all" ? undefined : type));
}

function list(type, category) {
  if (isKids()) return discover(type, { sort_by: category === "top_rated" ? "vote_average.desc" : "popularity.desc", "vote_count.gte": 200 });
  return tmdb.list(type, category).then(results(type));
}

const genreRow = (type) => ([id, title]) => row({
  title, moreHref: `#/${type === "movie" ? "movies" : "tv"}?genre=${id}`,
  load: () => discover(type, { with_genres: id, sort_by: "popularity.desc", "vote_count.gte": 80 }),
});

function continueRow(profile) {
  const entries = store.continueWatching();
  if (!entries.length) return null;
  return row({
    title: `Continue Watching for ${profile.name}`, kind: "continue", eager: true,
    load: async () => entries.map((h) => ({
      id: h.id, type: h.type, title: h.type === "tv" && h.season ? `${h.title} · S${h.season}:E${h.episode}` : h.title,
      poster: h.poster, backdrop: h.backdrop, year: "", rating: 0, votes: 0, genreIds: [],
      progress: h.duration ? h.position / h.duration : 0,
    })),
  });
}

function myListRow() {
  const l = store.myList();
  if (!l.length) return null;
  return row({ title: "My List", moreHref: "#/mylist", load: async () => l.map((i) => ({ ...i, rating: 0, votes: 0, genreIds: [] })) });
}

/** "Because you watched X" from the most recent history entry. */
function becauseRow() {
  const last = store.continueWatching()[0];
  if (!last) return null;
  return row({
    title: `Because you watched ${last.title}`,
    load: () => tmdb.details(last.type, last.id).then((d) => (d.recommendations?.results || []).filter((r) => r.backdrop_path).map((r) => toItem(r, last.type))),
  });
}

function footer() {
  return el(`<footer class="footer">Data from <a href="https://www.themoviedb.org" target="_blank" rel="noopener">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</footer>`);
}

function mount(view, nodes) {
  view.innerHTML = "";
  const page = el(`<div class="page"></div>`);
  const rows = el(`<div class="rows"></div>`);
  for (const n of nodes) if (n) (n.classList.contains("hero") ? page : rows).append(n);
  page.append(rows, footer());
  view.append(page);
  return page;
}

/* ---------------- pages ---------------- */

export function homeView(view) {
  const p = store.active();
  const kids = isKids();
  mount(view, [
    hero(() => trending("all", "day")),
    continueRow(p),
    row({ title: "Trending Now", load: () => trending("all") }),
    row({ title: "Top 10 Movies Today", kind: "top10", load: () => trending("movie", "day").then((l) => l.slice(0, 10)) }),
    myListRow(),
    row({ title: kids ? "Popular with Kids" : "Popular Movies", moreHref: "#/movies", load: () => list("movie", "popular") }),
    row({ title: "Top 10 Shows Today", kind: "top10", load: () => trending("tv", "day").then((l) => l.slice(0, 10)) }),
    becauseRow(),
    row({ title: "Binge-worthy TV", moreHref: "#/tv", load: () => list("tv", "top_rated") }),
    ...(kids ? KIDS_MOVIE_GENRES : MOVIE_GENRES).slice(0, 4).map(genreRow("movie")),
    row({ title: "Critically Acclaimed Films", kind: "poster", load: () => list("movie", "top_rated") }),
    ...(kids ? KIDS_TV_GENRES : TV_GENRES).slice(0, 3).map(genreRow("tv")),
    ...(kids ? [] : MOVIE_GENRES.slice(4).map(genreRow("movie"))),
  ]);
}

export function typeView(type) {
  const fn = (view, { query }) => {
    if (query.genre) return genreGrid(view, type, query.genre);
    const kids = isKids();
    const page = mount(view, [
      hero(() => trending(type, "week")),
      row({ title: type === "movie" ? "Popular Movies" : "Popular Shows", load: () => list(type, "popular") }),
      row({ title: `Top 10 ${type === "movie" ? "Movies" : "Shows"} This Week`, kind: "top10", load: () => trending(type, "week").then((l) => l.slice(0, 10)) }),
      type === "movie"
        ? row({ title: "New Releases", load: () => kids ? discover("movie", { sort_by: "primary_release_date.desc", "vote_count.gte": 50 }) : list("movie", "now_playing") })
        : row({ title: "On the Air", load: () => kids ? discover("tv", { sort_by: "first_air_date.desc", "vote_count.gte": 20 }) : list("tv", "on_the_air") }),
      row({ title: "Top Rated", kind: "poster", load: () => list(type, "top_rated") }),
      ...(type === "movie" ? (kids ? KIDS_MOVIE_GENRES : MOVIE_GENRES) : (kids ? KIDS_TV_GENRES : TV_GENRES)).map(genreRow(type)),
    ]);
    page.prepend(genreBar(type));
  };
  fn.rerenderOnQuery = true;
  return fn;
}

/** Floating genre picker that sits over the hero, like Netflix's category header. */
function genreBar(type, selected) {
  const bar = el(html`<div class="page-head" style="position:absolute;z-index:10;top:calc(var(--nav-h) + 26px);left:0;right:0">
    <h1>${type === "movie" ? "Movies" : "Shows"}</h1>
    <label class="genre-select"><select aria-label="Genre"><option value="">Genres</option></select>${raw(icons.chevDown)}</label>
  </div>`);
  const sel = $("select", bar);
  const source = type === "movie" ? "movie" : "tv";
  tmdb.genres(source).then((g) => {
    sel.insertAdjacentHTML("beforeend", g.genres.map((x) => html`<option value="${x.id}">${x.name}</option>`.s).join(""));
    if (selected) sel.value = String(selected);
  }).catch(() => {});
  sel.onchange = () => go(`/${type === "movie" ? "movies" : "tv"}`, sel.value ? { genre: sel.value } : {});
  return bar;
}

function genreGrid(view, type, genre) {
  const page = mount(view, []);
  page.classList.add("page-pad");
  const head = genreBar(type, genre);
  head.style.cssText = "";
  page.prepend(head);
  infiniteGrid(page.querySelector(".rows"), (n) => discover(type, { with_genres: genre, sort_by: "popularity.desc", "vote_count.gte": 30, page: n }));
  genres().then((m) => { const name = m.get(Number(genre)); if (name) $("h1", head).textContent = name; });
}

/** Grid that pages in more results as you scroll. fetchPage(n) -> items */
function infiniteGrid(container, fetchPage, { empty } = {}) {
  const grid = el(`<div class="grid"></div>`);
  const sentinel = el(`<div class="sentinel"></div>`);
  const spin = el(`<div class="spinner"></div>`);
  container.append(grid, spin, sentinel);
  const seen = new Set();
  let pageNo = 0, busy = false, done = false;
  const more = async () => {
    if (busy || done) return;
    busy = true;
    try {
      const items = (await fetchPage(++pageNo)).filter((i) => !seen.has(`${i.type}:${i.id}`) && seen.add(`${i.type}:${i.id}`));
      if (!items.length) done = true;
      grid.insertAdjacentHTML("beforeend", items.map((i) => card(i).s).join(""));
      lazyFade(grid);
      if (pageNo === 1 && !items.length && empty) container.replaceChildren(empty);
      if (pageNo === 1 && items[0]) setAmbient(img(items[0].backdrop, "w780"));
    } catch (e) {
      done = true;
      grid.insertAdjacentHTML("afterend", html`<p class="empty">${e.message}</p>`.s);
    } finally {
      busy = false;
      spin.hidden = done;
      if (done) io.disconnect();
      else if (sentinel.getBoundingClientRect().top < innerHeight + 800) more();
    }
  };
  const io = new IntersectionObserver((e) => e[0].isIntersecting && more(), { rootMargin: "800px 0px" });
  io.observe(sentinel);
  more();
}

export function newView(view) {
  const kids = isKids();
  const page = mount(view, [
    row({ title: "🔥 Everyone’s Watching", eager: true, load: () => trending("all", "day") }),
    row({ title: "New on Movies", load: () => kids ? discover("movie", { sort_by: "primary_release_date.desc", "vote_count.gte": 50 }) : list("movie", "now_playing") }),
    row({ title: "Top 10 Shows Today", kind: "top10", load: () => trending("tv", "day").then((l) => l.slice(0, 10)) }),
    kids ? null : row({ title: "Coming Soon", load: () => list("movie", "upcoming") }),
    row({ title: "Top 10 Movies Today", kind: "top10", load: () => trending("movie", "day").then((l) => l.slice(0, 10)) }),
    kids ? null : row({ title: "Airing Today", load: () => list("tv", "airing_today") }),
    row({ title: "Worth the Wait", kind: "poster", load: () => trending("all", "week") }),
  ]);
  page.classList.add("page-pad");
  page.prepend(el(`<div class="page-head"><h1>New &amp; Popular</h1></div>`));
  trending("all", "day").then((l) => l[0] && setAmbient(img(l[0].backdrop, "w780"))).catch(() => {});
}

export function myListView(view) {
  const items = store.myList();
  const page = mount(view, []);
  page.classList.add("page-pad");
  page.prepend(el(html`<div class="page-head"><h1>My List</h1><p>${items.length ? `${items.length} title${items.length > 1 ? "s" : ""}` : ""}</p></div>`));
  const rows = $(".rows", page);
  if (!items.length) {
    setAmbient("");
    rows.append(el(html`<div class="empty glass">${raw(icons.plus)}<h2>Your list is empty</h2><p>Add shows and movies to keep track of what you want to watch.</p><a class="btn btn-primary btn-sm" href="#/browse">Browse titles</a></div>`));
    return;
  }
  setAmbient(img(items[0].backdrop, "w780"));
  const grid = el(`<div class="grid"></div>`);
  grid.innerHTML = items.map((i) => card({ ...i, rating: 0, votes: 0, genreIds: [] }).s).join("");
  rows.append(grid);
  lazyFade(grid);
}

export function searchView(view, { query }) {
  const q = (query.q || "").trim();
  const input = document.getElementById("search-input");
  if (input && document.activeElement !== input) input.value = q;
  const page = mount(view, []);
  page.classList.add("page-pad");
  const rows = $(".rows", page);
  if (!q) {
    page.prepend(el(`<div class="page-head"><h1>Search</h1></div>`));
    rows.append(row({ title: "Popular Searches", eager: true, load: () => trending("all", "week") }));
    return;
  }
  page.prepend(el(html`<div class="page-head"><h1>Results for “${q}”</h1></div>`));
  const kids = isKids();
  infiniteGrid(rows, async (n) => {
    const d = await tmdb.search(q, n);
    if (n > (d.total_pages || 1)) return [];
    const out = [];
    for (const r of d.results || []) {
      if (r.media_type === "person") out.push(...(r.known_for || []).filter((k) => k.media_type !== "person"));
      else out.push(r);
    }
    return out
      .filter((r) => (r.backdrop_path || r.poster_path) && !r.adult)
      .filter((r) => !kids || (r.genre_ids || []).some((g) => [16, 10751, 10762].includes(g)))
      .map((r) => toItem(r));
  }, {
    empty: el(html`<div class="empty glass">${raw(icons.search)}<h2>No matches</h2><p>Nothing found for “${q}”. Try a different title, person or genre.</p></div>`),
  });
}
searchView.rerenderOnQuery = true;
