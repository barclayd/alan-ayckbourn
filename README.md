# alan-ayckbourn

A modern, mobile-responsive rebuild of [alanayckbourn.net](https://www.alanayckbourn.net) —
the official Alan Ayckbourn archive.

> **This is an unofficial design concept.** All content is © Haydonning Ltd and the
> research is the work of Alan Ayckbourn's archivist, Simon Murgatroyd. The site is
> served `noindex` and must never compete with the official site in search results.

See [PLAN.md](./PLAN.md) for the full plan, findings about the existing site, and decisions.

## Stack

- **Astro 7** (static output) — ~3,600 pages generated at build time
- **Tailwind v4** (CSS-first `@theme`) with light/dark reading surfaces
- **Pagefind** — static full-text search, no server
- **Cloudflare Workers** static assets; **R2** archives the raw scraped originals
- **Biome** for lint and format, **lefthook** for pre-commit

Fonts (Anton, Newsreader, Inter) are self-hosted and subset automatically by Astro's
Fonts API — no external font requests.

## Getting started

```sh
bun install
bunx lefthook install   # once, for pre-commit hooks
bun run dev
```

## Scripts

| Command | Does |
|---|---|
| `bun run dev` | Dev server |
| `bun run build` | Build to `dist/` and generate the Pagefind index |
| `bun run preview` | Serve the built output |
| `bun run lint` / `lint:fix` | Biome |
| `bun run types` | `astro sync` + `tsc --noEmit` |
| `bun run scrape` | Extract content from the existing site (see PR 2) |
| `bun run deploy` | Build and `wrangler deploy` |

## Theme model

Chrome — hero, nav, section landings — stays theatrically dark in **both** themes so the
art direction is never diluted. The light/dark toggle swaps only the reading surface:
paper `#FAF7F0` / ink `#14110F` in light, charcoal `#1A1714` / bone `#EDE6DA` in dark.
Defaults to system preference, with a manual override in `localStorage` applied before
first paint.
