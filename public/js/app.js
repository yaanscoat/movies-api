// App shell: routes, profile gate, navigation bar and global listeners.

import { html, raw, icons, $, $$, debounce, trackSheen } from "./lib/dom.js";
import * as store from "./lib/store.js";
import { route, start, go, onRoute, currentRoute, parse, refresh } from "./lib/router.js";
import { avatar } from "./ui/avatar.js";
import { initCardInteractions, closePreview } from "./ui/cards.js";
import { syncDetails } from "./ui/details.js";
import { profilesView, editSheet } from "./views/profiles.js";
import { homeView, typeView, newView, myListView, searchView } from "./views/browse.js";
import { playerView } from "./views/player.js";

const view = document.getElementById("view");
const nav = document.getElementById("nav");
const tabs = document.getElementById("mobile-tabs");
let cleanup = null;

/** Wrap a view: run the previous view's cleanup, gate on an active profile, reset scroll. */
function page(fn, { gated = true, chrome = true, section } = {}) {
  const handler = (ctx, prev) => {
    if (gated && !store.active()) return go("/profiles", { next: ctx.path + (ctx.query.q ? `?q=${ctx.query.q}` : "") }, { replace: true });
    const samePage = prev && prev.path === ctx.path;
    try { cleanup?.(); } catch (e) { console.warn(e); }
    cleanup = null;
    closePreview(true);
    nav.hidden = !chrome;
    if (section !== "search") { searchInput.value = ""; searchForm.classList.remove("open"); }
    tabs.hidden = !chrome;
    setActiveNav(section);
    if (!samePage) scrollTo({ top: 0, behavior: "instant" });
    const result = fn(view, ctx, prev);
    if (typeof result === "function") cleanup = result;
    renderProfileChip();
  };
  handler.rerenderOnQuery = !!fn.rerenderOnQuery;
  return handler;
}

route("/", page(() => go("/browse", {}, { replace: true }), { gated: false }));
route("/profiles", Object.assign(page(profilesView, { gated: false, chrome: false }), { rerenderOnQuery: true }));
route("/browse", page(homeView, { section: "browse" }));
route("/tv", page(typeView("tv"), { section: "tv" }));
route("/movies", page(typeView("movie"), { section: "movies" }));
route("/new", page(newView, { section: "new" }));
route("/mylist", page(myListView, { section: "mylist" }));
route("/search", page(searchView, { section: "search" }));
route("/watch/:type/:id", page(playerView, { chrome: false }));
route("/watch/:type/:id/:season/:episode", page(playerView, { chrome: false }));

// The details modal lives on top of whatever page is showing.
onRoute((r) => {
  if (r.path.startsWith("/watch") || r.path.startsWith("/profiles")) return syncDetails({});
  if (store.active()) syncDetails(r.query);
});

/* ---------------- nav ---------------- */

function setActiveNav(section) {
  for (const a of $$("[data-nav]")) a.classList.toggle("active", a.dataset.nav === section);
}

addEventListener("scroll", () => nav.classList.toggle("solid", scrollY > 40), { passive: true });

const searchForm = $("#search");
const searchInput = $("#search-input");
const openSearch = () => { searchForm.classList.add("open"); searchInput.focus(); };
$(".search-toggle", searchForm).addEventListener("click", () => {
  if (searchForm.classList.contains("open") && searchInput.value) return runSearch();
  searchForm.classList.contains("open") ? searchForm.classList.remove("open") : openSearch();
});
const runSearch = () => {
  const q = searchInput.value.trim();
  const onSearch = currentRoute()?.path === "/search";
  if (!q && !onSearch) return;
  go("/search", q ? { q } : {}, { replace: onSearch });
};
searchInput.addEventListener("input", debounce(runSearch, 350));
searchForm.addEventListener("submit", (e) => { e.preventDefault(); runSearch(); });
searchInput.addEventListener("blur", () => { if (!searchInput.value) searchForm.classList.remove("open"); });
document.addEventListener("keydown", (e) => {
  if (e.key === "/" && !nav.hidden && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { e.preventDefault(); openSearch(); }
});

const chip = $("#profile-chip");
const menu = $("#profile-menu");

function renderProfileChip() {
  const p = store.active();
  if (!p) { chip.innerHTML = ""; return; }
  chip.innerHTML = avatar(p) + icons.chevDown;
  chip.setAttribute("aria-label", `Profile: ${p.name}`);
  if (parse().path === "/search" && parse().query.q) searchForm.classList.add("open");
}

function renderMenu() {
  const p = store.active();
  const others = store.profiles().filter((x) => x.id !== p?.id);
  menu.innerHTML = html`
    ${others.map((o) => html`<button class="menu-item" role="menuitem" data-switch="${o.id}">${raw(avatar(o))}<span>${o.name}</span></button>`)}
    ${others.length ? raw("<hr />") : ""}
    <button class="menu-item" role="menuitem" data-menu="edit">${raw(icons.edit)} Edit profile</button>
    <button class="menu-item" role="menuitem" data-menu="manage">${raw(icons.user)} Manage profiles</button>
    <hr />
    <button class="menu-item" role="menuitem" data-menu="switch">${raw(icons.logout)} Switch profile</button>`.s;
}

function toggleMenu(open = menu.hidden) {
  if (open) renderMenu();
  menu.hidden = !open;
  chip.setAttribute("aria-expanded", String(open));
}
chip.addEventListener("click", (e) => { e.stopPropagation(); toggleMenu(); });
document.addEventListener("click", (e) => { if (!menu.hidden && !menu.contains(e.target)) toggleMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) toggleMenu(false); });
menu.addEventListener("click", (e) => {
  const sw = e.target.closest("[data-switch]");
  const act = e.target.closest("[data-menu]")?.dataset.menu;
  toggleMenu(false);
  if (sw) { store.setActive(sw.dataset.switch); return currentRoute()?.path === "/browse" ? reload() : go("/browse"); }
  if (act === "edit") editSheet(store.active(), () => { renderProfileChip(); reload(); });
  if (act === "manage") go("/profiles", { manage: "1" });
  if (act === "switch") { store.setActive(null); go("/profiles"); }
});

/** Re-render the current page (e.g. after switching or editing a profile). */
const reload = () => refresh();

// Keep My List page in sync when items are toggled from the preview or modal.
store.onChange((reason) => {
  const r = currentRoute();
  if (reason === "mylist" && r?.path === "/mylist" && !r.query.title) myListView(view);
  if (reason === "profiles" || reason === "sync") renderProfileChip();
});

trackSheen();
initCardInteractions();
start();
