// Streaming CORS proxy for HLS playlists, segments, keys, subtitles and MP4s.
// Playlists are rewritten so every nested URI also goes through the proxy.

import { Router } from "express";
import { Readable } from "node:stream";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { config } from "../config.js";
import { HttpError } from "../lib/tmdb.js";
import { UA } from "../providers/ua.js";

const router = Router();
const FORWARD_REQ = ["range", "if-range", "accept", "accept-language"];
const FORWARD_RES = ["content-type", "content-length", "content-range", "accept-ranges", "last-modified", "etag"];

/* ---------------- SSRF guard ---------------- */

function isPrivateAddress(ip) {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

const hostChecks = new Map(); // hostname -> Promise<boolean> (cached for the process lifetime, capped)

async function assertPublic(url) {
  if (!config.proxy.blockPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new HttpError(403, "blocked host");
  if (isIP(host)) { if (isPrivateAddress(host)) throw new HttpError(403, "blocked address"); return; }
  if (!hostChecks.has(host)) {
    if (hostChecks.size > 5000) hostChecks.clear();
    hostChecks.set(host, lookup(host, { all: true }).then((addrs) => addrs.every((a) => !isPrivateAddress(a.address)), () => true));
  }
  if (!(await hostChecks.get(host))) throw new HttpError(403, "blocked address");
}

/* ---------------- playlist rewriting ---------------- */

function proxify(target, base, ctx) {
  let abs;
  try { abs = new URL(target, base); } catch { return target; }
  if (ctx.token && !abs.searchParams.has("token")) abs.searchParams.set("token", ctx.token);
  let out = `/api/proxy?url=${encodeURIComponent(abs.href)}`;
  if (ctx.referer) out += `&referer=${encodeURIComponent(ctx.referer)}`;
  return out;
}

export function rewritePlaylist(text, base, ctx) {
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith("#")) return line.replace(/URI="([^"]+)"/g, (_, u) => `URI="${proxify(u, base, ctx)}"`);
    return proxify(t, base, ctx);
  }).join("\n");
}

const looksLikePlaylist = (ct, url) => /mpegurl/i.test(ct) || /\.m3u8?$/i.test(url.pathname);

/* ---------------- route ---------------- */

router.get("/proxy", async (req, res) => {
  const raw = req.query.url;
  if (typeof raw !== "string" || !raw) throw new HttpError(400, "url required");
  let url;
  try { url = new URL(raw); } catch { throw new HttpError(400, "invalid url"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new HttpError(400, "only http(s) urls");
  await assertPublic(url);

  let referer = typeof req.query.referer === "string" ? req.query.referer : "";
  try { if (referer) new URL(referer); } catch { referer = ""; }

  const headers = { "User-Agent": UA, Referer: referer || url.origin + "/", Origin: referer ? new URL(referer).origin : url.origin };
  for (const h of FORWARD_REQ) if (req.headers[h]) headers[h] = req.headers[h];

  const ac = new AbortController();
  res.on("close", () => ac.abort());

  let upstream;
  try {
    upstream = await fetch(url, { headers, signal: ac.signal, redirect: "follow" });
  } catch (e) {
    if (ac.signal.aborted) return;
    throw new HttpError(502, `upstream fetch failed: ${e.cause?.code || e.message}`);
  }

  res.set("Access-Control-Allow-Origin", "*");
  if (!upstream.ok && upstream.status !== 206) {
    res.status(upstream.status === 404 ? 404 : 502).json({ error: `upstream responded ${upstream.status}` });
    upstream.body?.cancel().catch(() => {});
    return;
  }

  const ct = upstream.headers.get("content-type") || "";
  const finalUrl = new URL(upstream.url || url.href);

  if (looksLikePlaylist(ct, finalUrl) || looksLikePlaylist(ct, url)) {
    const text = await upstream.text();
    if (text.trimStart().startsWith("#EXTM3U")) {
      const token = url.searchParams.get("token");
      res.set("Content-Type", "application/vnd.apple.mpegurl");
      res.set("Cache-Control", "no-store");
      return res.send(rewritePlaylist(text, finalUrl.href, { token, referer }));
    }
    res.set("Content-Type", ct || "text/plain");
    return res.send(text);
  }

  res.status(upstream.status);
  // fetch() transparently decompresses, so a compressed upstream's length no longer applies.
  const decoded = !!upstream.headers.get("content-encoding");
  for (const h of FORWARD_RES) {
    const v = upstream.headers.get(h);
    if (v && !(decoded && h === "content-length")) res.set(h, v);
  }
  // Some hosts disguise media segments as HTML/images; never serve them back as a page.
  if (/text\/html/i.test(ct)) res.set("Content-Type", "application/octet-stream");
  res.set("Cache-Control", "public, max-age=3600");
  if (!upstream.body) return res.end();
  Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
});

export default router;
