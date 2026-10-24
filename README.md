# movies

A self-hosted movie and TV streaming API with a Netflix-style web app built from Liquid Glass surfaces. It's based on [x8rr/movies](https://github.com/x8rr/movies).

The server finds real HLS/MP4 stream URLs through VidSrc (HTTP + WASM decryption), CineSrc, and, optionally, P-Stream providers. It proxies TMDB for metadata and runs a streaming CORS proxy so the browser can play everything.

## What's new compared to upstream

- **UI**: Netflix layout with Liquid Glass materials: a rotating hero billboard with title logos, Top 10 rows, hover preview cards, a details modal with a trailer, episodes, cast and "More like this", genre pages, New & Popular, search, and a mobile tab bar.
- **Custom player**: HLS.js engine with automatic fallback between sources, quality/speed/source menus, subtitles (stream tracks, provider captions, or a local `.srt`/`.vtt` file, with size and timing offset), episode picker, an up-next card with autoplay countdown, resume prompt, PiP, fullscreen, Media Session, keyboard shortcuts (`?`) and touch gestures (double-tap to seek).
- **Profiles**: up to 5 profiles stored in `localStorage`. Each profile has its own My List, Continue Watching (per-episode progress), player settings and an optional **Kids** filter. Profiles sync across tabs.
- **Backend**: `.env` loader with validation, in-memory TMDB cache with request de-duplication, allow-listed query params, a parallel provider runner with a grace period and a short result cache, and a streaming proxy that supports Range requests, rewrites `URI="…"` key/subtitle tags, propagates the referer and blocks private addresses (SSRF).

## Setup

```sh
cp .env.example .env      # then set TMDB_API_KEY
bun install
bun run dev               # http://localhost:3000, restarts on server changes
```

Get a TMDB key at https://www.themoviedb.org/settings/api. The server accepts a v3 key or a v4 read token.

`bun start` runs without watch mode. `npm run start:node` works with Node 20+, but the P-Stream providers only load under Bun.

### Environment

| Variable | Default | |
|---|---|---|
| `TMDB_API_KEY` | — | **required** |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | |
| `TMDB_LANGUAGE` / `TMDB_REGION` | `en-US` / `US` | |
| `TMDB_CACHE_TTL` | `600` | seconds |
| `PROVIDERS` | `vidsrc,cinesrc,pstream` | order = priority |
| `STREAM_CACHE_TTL` | `180` | seconds a successful scrape is reused |
| `STREAM_TIMEOUT_MS` | `20000` | |
| `PROXY_BLOCK_PRIVATE` | `true` | refuse private/loopback targets |
| `TRUST_PROXY` | `false` | set behind nginx/Caddy/Cloudflare |

Real environment variables override `.env`. `.env.<NODE_ENV>` and `.env.local` are loaded on top of `.env` when present.

## API

| Endpoint | |
|---|---|
| `GET /api/health` | status and enabled providers |
| `GET /api/stream/movie/:tmdbId` | scrape movie streams (`?fresh=1` skips the cache) |
| `GET /api/stream/tv/:tmdbId/:season/:episode` | scrape episode streams |
| `GET /api/proxy?url=&referer=` | streaming CORS proxy; rewrites m3u8 playlists |
| `GET /api/sources` | enabled providers |
| `GET /api/search/:type?query=&page=` | `multi`, `movie`, `tv`, `person` |
| `GET /api/trending/:type/:window` | `all\|movie\|tv`, `day\|week` |
| `GET /api/list/:type/:category` | `popular`, `top_rated`, `now_playing`, `upcoming`, `on_the_air`, `airing_today` |
| `GET /api/discover/:type?with_genres=&sort_by=…` | allow-listed discover params |
| `GET /api/genres/:type` | genre list |
| `GET /api/movie/:id`, `GET /api/tv/:id` | details + videos, images, credits, recommendations, ratings |
| `GET /api/tv/:id/season/:season` | season episodes |

Stream responses look like `{ streams: [{ url, type: "hls"|"file", provider, providerName, quality?, referer?, captions? }], providers: [{ id, ok, count, ms }] }`.

## Layout

```
src/
  config.js            .env loading + validation
  index.js             express app
  lib/                 tmdb client, ttl cache
  providers/           vidsrc, cinesrc, pstream, parallel runner
  routes/              tmdb, stream, proxy
public/
  css/                 app.css (glass design system), player.css
  js/app.js            shell: routes, nav, profile gate
  js/lib/              dom helpers, api client, router, profile store
  js/ui/               cards/rows/preview, hero, details modal, toasts
  js/views/            profiles, browse pages, watch page
  js/player/           Player engine/UI, subtitle parsing
```
