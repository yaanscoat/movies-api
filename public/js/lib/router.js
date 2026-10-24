// Hash router. A route is "#/path/segments?query". Views register patterns
// like "/watch/:type/:id"; the router hands them params + the parsed query.

const routes = [];
const listeners = new Set();
let current = null;

export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return "([^/]+)"; }) + "/?$");
  routes.push({ re, keys, handler, pattern });
}

export function parse(hash = location.hash) {
  const h = hash.replace(/^#/, "") || "/";
  const [path, q = ""] = h.split("?");
  return { path: path || "/", query: Object.fromEntries(new URLSearchParams(q)) };
}

export function href(path, query = {}) {
  const q = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== "")).toString();
  return `#${path}${q ? "?" + q : ""}`;
}

export function go(path, query, { replace = false } = {}) {
  const target = href(path, query);
  if (target === location.hash) return resolve();
  const depth = history.state?.depth || 0;
  if (replace) history.replaceState({ depth }, "", target);
  else history.pushState({ depth: depth + 1 }, "", target);
  resolve();
}

/** Change only the query string (e.g. open/close the details modal) without re-rendering the page. */
export function setQuery(patch, opts) {
  const { path, query } = parse();
  go(path, { ...query, ...patch }, opts);
}

export const currentRoute = () => current;

/** True when there is an in-app page to go back to. */
export const canGoBack = () => (history.state?.depth || 0) > 0;

/** Force the current page to render again. */
export function refresh() {
  current = null;
  resolve();
}
export const onRoute = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

export function resolve() {
  const { path, query } = parse();
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const prev = current;
    current = { path, query, params, pattern: r.pattern };
    // Same page, only the query changed: let listeners react without re-rendering.
    // `title` (the details modal) never re-renders the page underneath.
    const samePage = prev && prev.path === path;
    const pageQueryChanged = samePage && strip(prev.query) !== strip(query);
    for (const fn of listeners) fn(current, prev);
    if (!samePage || (pageQueryChanged && r.handler.rerenderOnQuery)) r.handler(current, prev);
    return;
  }
  go("/browse", {}, { replace: true });
}

function strip(query) {
  const { title, ...rest } = query;
  return new URLSearchParams(rest).toString();
}

export function start() {
  window.addEventListener("popstate", resolve);
  window.addEventListener("hashchange", resolve);
  resolve();
}
