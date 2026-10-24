import { el, html, fadeOut } from "../lib/dom.js";

/** Glass toast at the bottom of the screen. Optional action button. */
export function toast(message, { action, onAction, duration = 3200 } = {}) {
  const root = document.getElementById("toasts");
  const t = el(html`<div class="toast glass" role="status"><span>${message}</span>${action ? html`<button type="button">${action}</button>` : ""}</div>`);
  root.append(t);
  let timer;
  const close = () => {
    clearTimeout(timer);
    fadeOut(t);
  };
  t.querySelector("button")?.addEventListener("click", () => { onAction?.(); close(); });
  timer = setTimeout(close, duration);
  return close;
}
