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
| `bun run scrape` | Extract content from the existing site (see [Scraping](#scraping)) |
| `bun run deploy` | Build and `wrangler deploy` |

## Scraping

The original site is RapidWeaver + Stacks 5 static HTML. `scripts/scrape.ts` walks each
subdomain's sitemap, strips the Stacks wrapper soup, and writes one Markdown file per page
into `src/content/archive/<route>/index.md` — plus the page's images alongside it in
`_images/`, so Astro optimises them as relative markdown images.

```sh
bun run scrape                                  # sample: 5 plays + Life + Career
bun run scrape --all                            # every play subdomain
bun run scrape --sites=biography,womaninmind    # named subdomains
```

Every fetch is cached under `.cache/scrape/` (gitignored) and rate-limited to ~5 req/s —
this hits someone else's Apache box, so scrape once and iterate on the cache. Deleting the
cache directory forces a re-fetch.

Notes on the source site, which the scraper works around:

- Only `www` has a valid TLS certificate; every subdomain is fetched over `http`.
- URLs are meaningless (`/styled-22/page48/`), so routes and titles come from the site's
  own anchor text. Filler segments (`page4`, `styled`) are dropped, and directories that
  were never published get their slug from the link that points at them.
- Play data sheets (premiere dates, venues, rights holders) are lifted out of the prose
  into `facts` in the frontmatter.
- The repeated copyright and sibling-navigation blocks are stripped from every body — the
  credits appear once in the footer, the nav is derived from the content tree.

Each run writes `scraped/report.json` — page counts, blocks dropped, and, importantly,
`unresolvedLinks` and `uncrawledHosts`: internal links pointing at subdomains this run
didn't cover. That list is the input to the full scrape.

## Theme model

Chrome — hero, nav, section landings — stays theatrically dark in **both** themes so the
art direction is never diluted. The light/dark toggle swaps only the reading surface:
paper `#FAF7F0` / ink `#14110F` in light, charcoal `#1A1714` / bone `#EDE6DA` in dark.
Defaults to system preference, with a manual override in `localStorage` applied before
first paint.
