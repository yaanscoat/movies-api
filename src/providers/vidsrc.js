// VidSrc scraper: plain HTTP + WASM decryption (no headless browser).

import { UA } from "./ua.js";

const wasmCache = new Map();

async function getWasmModule(vs) {
  if (vs.wasm_url) {
    const key = `u:${vs.w ?? vs.wasm_url}`;
    if (!wasmCache.has(key)) {
      wasmCache.set(key, fetch(vs.wasm_url).then((r) => r.arrayBuffer()).then((b) => WebAssembly.compile(b)));
    }
    return wasmCache.get(key).catch((e) => { wasmCache.delete(key); throw e; });
  }
  if (vs.wasm) {
    const key = `b:${vs.w ?? vs.wasm.length}`;
    if (!wasmCache.has(key)) wasmCache.set(key, WebAssembly.compile(Buffer.from(vs.wasm, "base64")));
    return wasmCache.get(key);
  }
  return null;
}

async function decryptStreamUrls(encB64, vs) {
  const mod = await getWasmModule(vs);
  if (!mod) return null;
  const inst = await WebAssembly.instantiate(mod, {});
  const { alloc, decrypt, memory } = inst.exports;
  const enc = Buffer.from(encB64, "base64");
  const ptr = alloc(enc.length);
  new Uint8Array(memory.buffer, ptr, enc.length).set(enc);
  const outLen = decrypt(ptr, enc.length);
  const text = new TextDecoder().decode(new Uint8Array(memory.buffer, ptr + 12, outLen));
  return text.split("\n").filter(Boolean);
}

const get = (url, referer, signal) => fetch(url, { headers: { "User-Agent": UA, Referer: referer }, signal });

async function hostToken(host, signal) {
  try {
    const t = await fetch(host + "/generate.php", { headers: { "User-Agent": UA, Accept: "application/json" }, signal }).then((r) => r.text());
    try {
      const j = JSON.parse(t);
      return typeof j === "string" ? j : j.token || j.data || j.string || j.result || "";
    } catch { return t.trim(); }
  } catch { return ""; }
}

export async function vidsrc({ type, tmdbId, season, episode, signal }) {
  const isTV = type === "tv";
  const srcPath = isTV ? `${tmdbId}/${season}/${episode}` : String(tmdbId);

  const { src } = await get(`https://vidsrc.sh/vs_src.php?type=${isTV ? "tv" : "movie"}&id=${srcPath}`, "https://vidsrc.sh/", signal).then((r) => r.json());
  if (!src) return [];

  const landHtml = await get(src, "https://vidsrc.sh/", signal).then((r) => r.text());
  const cfgMatch = landHtml.match(/window\.CFG\s*=\s*(\{[^}]+\})/);
  if (!cfgMatch) return [];
  const cfg = JSON.parse(cfgMatch[1]);
  const origin = new URL(src).origin;

  const playerHtml = await get(origin + cfg.playerUrl, origin + "/", signal).then((r) => r.text());
  const configMatch = playerHtml.match(/window\.CONFIG\s*=\s*(\{.*?\});/s);
  if (!configMatch) return [];
  const pc = JSON.parse(configMatch[1]);
  if (!pc.apiToken) return [];

  const q = isTV ? `type=tv&tmdb=${tmdbId}&season=${season}&episode=${episode}` : `type=movie&tmdb=${tmdbId}`;
  const json = await get(`https://data.vidsrc.sh/api.php?${q}&stream_urls&api_token=${encodeURIComponent(pc.apiToken)}`, origin + "/", signal).then((r) => r.json());
  if (String(json.status_code) !== "200" || !json.data) return [];

  let urls;
  if (typeof json.data.stream_urls === "string" && json.vs) urls = await decryptStreamUrls(json.data.stream_urls, json.vs);
  else if (Array.isArray(json.data.stream_urls)) urls = json.data.stream_urls;
  if (!urls?.length) return [];

  const tokens = new Map();
  for (const u of urls) {
    const host = new URL(u).origin;
    if (!tokens.has(host)) tokens.set(host, hostToken(host, signal));
  }

  const out = [];
  for (const raw of urls) {
    const token = await tokens.get(new URL(raw).origin);
    const url = token ? raw + (raw.includes("?") ? "&" : "?") + "token=" + token : raw;
    out.push({ url, type: raw.includes(".m3u8") ? "hls" : "file", providerName: "VidSrc" });
  }
  return out;
}
