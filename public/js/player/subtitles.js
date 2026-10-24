// Subtitle parsing (SRT / WebVTT) and safe cue rendering.

const TIME = /(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})/;

function toSeconds(t) {
  const m = t.match(TIME);
  if (!m) return NaN;
  return (Number(m[1] || 0) * 3600) + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, "0")) / 1000;
}

/** Parse SRT or WebVTT text into [{ start, end, text }], sorted by start. */
export function parseSubtitles(src) {
  const text = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const cues = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    const i = lines.findIndex((l) => l.includes("-->"));
    if (i < 0) continue;
    const [a, b] = lines[i].split("-->");
    const start = toSeconds(a), end = toSeconds(b);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const body = lines.slice(i + 1).join("\n").trim();
    if (body) cues.push({ start, end, text: body });
  }
  return cues.sort((x, y) => x.start - y.start);
}

/** Cues active at time t (cues are sorted by start). */
export function activeCues(cues, t) {
  const out = [];
  // binary search for the last cue starting at or before t, then walk back over overlaps
  let lo = 0, hi = cues.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (let i = idx; i >= 0 && i > idx - 8; i--) if (cues[i].end > t) out.unshift(cues[i]);
  return out;
}

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/** Escape cue text but keep simple <i>/<b>/<u> styling. Strips other tags (VTT voice/class spans, ASS overrides). */
export function cueHTML(text) {
  return text
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/[&<>"]/g, (c) => ESC[c])
    .replace(/&lt;(\/?)([ibu])&gt;/gi, "<$1$2>")
    .replace(/&lt;\/?[^&]*?&gt;/g, "");
}

export function languageName(code) {
  if (!code) return "";
  try { return new Intl.DisplayNames([navigator.language || "en"], { type: "language" }).of(code) || code; }
  catch { return code; }
}
