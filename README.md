<h1 align="center">movies-api</h1>

<p align="center">
  A simple movies API that you can easily add to your website.
</p>

>[!IMPORTANT]
>This is inspired by [x8rr/movies](https://github.com/x8rr/movies) show him some support!

The server finds real HLS/MP4 stream URLs through VidSrc (HTTP + WASM decryption), CineSrc, and, optionally, P-Stream providers. It proxies TMDB for metadata and runs a streaming CORS proxy so the browser can play everything.

## Features

* GOATED Liquid Glass UI
* Custom player
* Profiles
* Backend

## Setup

```sh
cp .env.example .env      # then set TMDB_API_KEY
bun install
bun run dev               # http://localhost:3000, restarts on server changes
```

Get a TMDB key at: https://www.themoviedb.org/settings/api (takes 2 minutes). The server accepts a v3 key or a v4 read token.

`bun start` runs without watch mode. `npm run start:node` works with Node 20+, but the P-Stream providers only load under Bun.

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

## LICENSE

This project is protected by the [MIT LICENSE](LICENSE)
