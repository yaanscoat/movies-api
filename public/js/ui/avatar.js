import { COLORS } from "../lib/store.js";

let n = 0;

const FACES = {
  smile: `<circle cx="36" cy="44" r="5"/><circle cx="64" cy="44" r="5"/><path d="M30 62c6 9 14 13 20 13s14-4 20-13" stroke-width="6" fill="none"/>`,
  grin: `<rect x="31" y="38" width="10" height="12" rx="5"/><rect x="59" y="38" width="10" height="12" rx="5"/><path d="M28 60h44c0 12-10 19-22 19S28 72 28 60z"/>`,
  cool: `<path d="M22 40h56v6c0 6-5 10-11 10h-6c-5 0-8-4-9-8h-4c-1 4-4 8-9 8h-6c-6 0-11-4-11-10z"/><path d="M34 66c5 6 11 8 16 8s11-2 16-8" stroke-width="6" fill="none"/>`,
  wink: `<circle cx="36" cy="44" r="5"/><path d="M58 45h12" stroke-width="6" fill="none"/><path d="M32 62c6 8 12 11 18 11s12-3 18-11" stroke-width="6" fill="none"/>`,
};

/** Rounded-square profile avatar: gradient background with a simple face. */
export function avatar(profile, cls = "") {
  const [a, b] = COLORS[profile?.color ?? 0] || COLORS[0];
  const id = `av${++n}`;
  const ink = (profile?.color ?? 0) === 9 ? "#1f2937" : "#fff";
  return `<span class="avatar ${cls}"><svg viewBox="0 0 100 100" aria-hidden="true">
    <defs>
      <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
      <radialGradient id="${id}h" cx="0.3" cy="0" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="100" height="100" fill="url(#${id})"/>
    <rect width="100" height="100" fill="url(#${id}h)"/>
    <g fill="${ink}" stroke="${ink}" stroke-linecap="round">${FACES[profile?.face] || FACES.smile}</g>
  </svg></span>`;
}
