import { config, assertConfig, ROOT } from "./config.js";
import express from "express";
import cors from "cors";
import { join } from "node:path";
import tmdbRoutes from "./routes/tmdb.js";
import streamRoutes from "./routes/stream.js";
import proxyRoutes from "./routes/proxy.js";
import { enabledProviders } from "./providers/index.js";

const problems = assertConfig();
for (const p of problems) console.warn(`⚠  ${p}`);

const app = express();
app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", true);

app.use(cors());
app.use((_req, res, next) => {
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "strict-origin-when-cross-origin");
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, tmdb: !!config.tmdb.key, providers: enabledProviders(), uptime: Math.round(process.uptime()) });
});
app.use("/api", tmdbRoutes);
app.use("/api", streamRoutes);
app.use("/api", proxyRoutes);
app.use("/api", (_req, res) => res.status(404).json({ error: "not found" }));

app.use(express.static(join(ROOT, "public"), {
  extensions: ["html"],
  setHeaders: (res, path) => {
    // Always revalidate app code so changes show up on refresh.
    if (/\.(js|css|html)$/.test(path)) res.set("Cache-Control", "no-cache");
  },
}));

// JSON errors for the API (Express 5 forwards rejected async handlers here).
app.use((err, req, res, _next) => {
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(`[${req.method} ${req.originalUrl.split("?")[0]}]`, err.message);
  if (res.headersSent) return res.destroy();
  res.status(status).json({ error: status === 500 ? "internal error" : err.message });
});

const server = app.listen(config.port, config.host, () => {
  const shown = config.host === "0.0.0.0" ? "localhost" : config.host;
  console.log(`movies-api listening on http://${shown}:${config.port}  (providers: ${enabledProviders().join(", ") || "none"})`);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
}
