// Loads .env (without overriding variables already set in the environment),
// validates it and exposes a typed, frozen config object.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let [, key, val] = m;
    if (/^(['"]).*\1$/.test(val)) {
      const q = val[0];
      val = val.slice(1, -1);
      if (q === '"') val = val.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else {
      val = val.replace(/\s+#.*$/, "").trim(); // strip inline comments on unquoted values
    }
    out[key] = val;
  }
  return out;
}

function loadEnvFiles() {
  // Later files win over earlier ones; real environment variables win over all.
  const mode = process.env.NODE_ENV || "development";
  const files = [".env", `.env.${mode}`, ".env.local"];
  const merged = {};
  for (const f of files) {
    const p = join(ROOT, f);
    if (existsSync(p)) Object.assign(merged, parseEnv(readFileSync(p, "utf8")));
  }
  for (const [k, v] of Object.entries(merged)) if (process.env[k] === undefined || process.env[k] === "") process.env[k] = v;
}

loadEnvFiles();

const env = process.env;
const int = (name, def) => {
  const v = env[name];
  if (v === undefined || v === "") return def;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${v}")`);
  return n;
};
const bool = (name, def) => {
  const v = (env[name] ?? "").toLowerCase();
  if (!v) return def;
  return ["1", "true", "yes", "on"].includes(v);
};
const list = (name, def) => (env[name] ? env[name].split(",").map((s) => s.trim()).filter(Boolean) : def);

export const config = Object.freeze({
  env: env.NODE_ENV || "development",
  port: int("PORT", 3000),
  host: env.HOST || "0.0.0.0",
  tmdb: Object.freeze({
    key: env.TMDB_API_KEY || "",
    language: env.TMDB_LANGUAGE || "en-US",
    region: env.TMDB_REGION || "US",
    cacheTtlSeconds: int("TMDB_CACHE_TTL", 600),
  }),
  streams: Object.freeze({
    providers: list("PROVIDERS", ["vidsrc", "cinesrc", "pstream"]),
    cacheTtlSeconds: int("STREAM_CACHE_TTL", 180),
    timeoutMs: int("STREAM_TIMEOUT_MS", 20000),
  }),
  proxy: Object.freeze({
    // Refuse to proxy to private/loopback addresses (SSRF guard). Disable only on trusted LANs.
    blockPrivate: bool("PROXY_BLOCK_PRIVATE", true),
  }),
  trustProxy: bool("TRUST_PROXY", false),
});

export function assertConfig() {
  const problems = [];
  if (!config.tmdb.key) problems.push("TMDB_API_KEY is not set — copy .env.example to .env and add your key (https://www.themoviedb.org/settings/api).");
  if (config.port < 1 || config.port > 65535) problems.push(`PORT ${config.port} is out of range.`);
  return problems;
}
