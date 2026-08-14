# Alan Ayckbourn — Website Rebuild Plan

## Context

`alanayckbourn.net` is the official Alan Ayckbourn archive: the most comprehensive resource
dedicated to the playwright, researched and written over 20+ years by his archivist
Simon Murgatroyd. It contains ~3,500 pages covering 92 full-length plays, plus biography,
career, encyclopaedia, publications and research sections.

It is also stuck in 2002. The site itself concedes *"this website is configured for desktop
and tablet use"* — there is no responsive layout at all. Content of real scholarly value is
trapped behind an interface that fails on the device most people now use.

**Goal:** rebuild it as a modern, mobile-responsive, theatre-inspired site that reproduces the
existing content faithfully, and is good enough to email to Sir Alan for his thoughts.

**Stack:** Astro (static) + Tailwind v4 + Pagefind, deployed to Cloudflare Workers.

---

## What we're actually dealing with

Findings from exploring the live site — these drive most decisions below.

| | |
|---|---|
| **Backend** | Not WordPress. **RapidWeaver + Stacks 5** (a Mac desktop app) publishing static HTML to Apache. The only WordPress is a separate blog on `archivingayckbourn.home.blog`. |
| **Structure** | **139 separate subdomains.** Every play has its own (`absurdpersonsingular.alanayckbourn.net`). |
| **Scale** | ~22 pages/play × 139 ≈ 3,093 play pages, plus ~550 in the main sections ≈ **3,640 total**. |
| **Enumeration** | Every subdomain publishes its own `sitemap.xml`. Full discovery is mechanical. |
| **Page anatomy** | Consistent `#pageHeader`, `#navcontainer`, `#sidebar`, `#content` on every page. |
| **Markup quality** | Clean-ish: only `h1 h2 em a span br div`. **No `<font>`, no `<center>`, no table layout.** Paragraphs are `<br /><br />`; bold is `<span style="font-weight:bold">`; body text is `<span style="font-size:14px">`. |
| **Images** | `stacks-image-{hash}.{jpg,png}` at **`files/` relative to each page directory** (not site root). ~1,442 unique, avg ~103KB, **all capped at 300×300** — no high-res originals exist. |
| **Alt text** | Uniformly meaningless: `alt="Stacks Image 11642"`. |
| **Externals** | Book Store (`publications.`), A Round Town, Stephen Joseph Theatre, Simon Murgatroyd's site, the blog. |

Because the markup is clean, we can **re-typeset content into a new design system** rather than
iframing or preserving the old look.

### Cloudflare file budget

~3,640 HTML + ~2,900 optimised image variants ≈ **8,000 files**, against the Workers static-asset
limit of 20,000. Comfortable. No sharding needed.

---

## Decisions

### Scope & content
- **Full fidelity.** All ~3,640 pages, scraped and regenerated. Alan can click anything and it works.
- **Flatten the 139 subdomains** into one site with human-readable URLs:
  `/plays/absurd-person-singular/history` instead of `absurdpersonsingular.alanayckbourn.net/styled/`.
  Emit redirects from old paths.
- **Markdown content collections for everything**, with Zod schemas. Type-safe, git-diffable,
  hand-editable afterwards — the site outlives the scrape and Simon could genuinely maintain it.

### Art direction
- **Dark chrome + warm paper reading.** Theatrical near-black for hero, nav and section landings;
  warm off-white for long-form reading pages. Theatre-red accent.
- **Light/dark mode:** chrome stays dramatic in *both* themes so the art direction is never diluted.
  The toggle swaps the reading surface only — paper `#FAF7F0`/ink `#14110F` in light,
  charcoal `#1A1714`/bone `#EDE6DA` in dark. System default, manual override in `localStorage`.
- **Typography:** condensed poster caps for display (Anton / League Gothic register — the same
  tradition as the 1970s playbills in the archive), Newsreader or Source Serif 4 at **19px/1.65**
  for body, Inter for UI and metadata labels. Self-hosted woff2 subsets, no external font requests.
- **Audience constraint:** Sir Alan is 87 and the readership skews older and academic. Generous
  base type, high contrast, large tap targets. Motion is polish, never a gate on reaching content.

### Motion
Astro View Transitions + CSS only. **No animation library.**
- Poster → hero shared-element morph on navigate
- Heading mask-reveal, line by line
- Theatre-curtain wipe on section change
- Count-up on the homepage figures
- Play-list rows stagger in 40ms apart
- Poster hover lift + 2° tilt
- Spring-eased decade scrubber

CSS scroll-driven animations with a small `IntersectionObserver` fallback for Safari/Firefox.
Everything collapses to opacity fades under `prefers-reduced-motion`.

### Key pages
- **Homepage — the oeuvre as hero.** Full-bleed archival image, then "92 plays across sixty-seven
  years" resolving into a scrubable decade timeline. Then What's On, then the four ways in.
- **Plays index — poster grid + filters.** Poster art where it exists; plays without art get a
  generated typographic card in the house style so the grid never looks half-finished. Filter by
  decade, form and premiere venue; A–Z and chronological toggles. Preserves every existing
  category including the Grey Plays and Early Writing.
- **Play template — sticky section nav.** Landing gives facts, synopsis and poster. A sticky
  horizontal scroller (left rail on desktop) persists across all ~18 sections with the current one
  marked. Each section keeps its own URL; view transitions make movement feel instant.

### Search
**Pagefind** — static index built at build time, chunked and lazily fetched. Full-text over all
3,640 pages with no server and no API key. ⌘K command palette plus a results page filtered by
play / decade / section. A genuine upgrade on the current search, which mostly punts to Google.

### Images
- Scraper downloads all ~1,442 originals; Astro's image pipeline emits responsive AVIF/WebP with
  explicit width/height so nothing shifts on load.
- **Serve as static assets** (free, on-CDN, build-time optimised). **R2 holds the ~150MB of raw
  originals** as an archive so they're preserved and reprocessable without bloating git.
- Accessible lightbox with keyboard nav and captions. Note the 300×300 ceiling — present at modest
  size rather than pretending to high resolution.
- **Alt text:** an image the archive already describes — its own italic caption, an Expose
  lightbox's written note, a poster beside its printed title — takes `alt=""`, because repeating
  that text into the alt only reads it out twice. Chrome gets `alt=""` too. Everything left is
  described by hand from the image itself, and the scraper names anything still waiting.

### Everything else
- **News / What's On / Blog** — modelled as proper content collections so entries can be added by
  hand later. Scraped as a point-in-time snapshot, marked "as of Aug 2026".
- **Contact** — designed accessible form posting to a Cloudflare Worker that forwards by email and
  stores nothing, honouring the site's own no-data promise. Honeypot + Turnstile.
- **Externals stay external**, clearly marked as outbound.
- **Credit** — Simon Murgatroyd wrote essentially all of this over two decades; credit him
  prominently, not in small print, including per-section research notes as the current site does.
  Preserve every © Haydonning Ltd notice, the Andrew Higgins portrait credit and the Borthwick
  Institute association.
- **Access** — public URL on Cloudflare Workers, but `X-Robots-Tag: noindex` and a blocking
  `robots.txt` so it never competes with the real site in search. Dismissible banner:
  *"An unofficial design concept — all content © Haydonning Ltd."* No password: Alan just clicks
  the link.

---

## Build order

Deliberately: real content early, so no design work happens against lorem ipsum.

### Phase 1 — Scraper + thin slice
`scripts/scrape.mjs` (Node, `cheerio` + `turndown` with custom rules):
1. Discover subdomains from the plays index → fetch each `sitemap.xml`.
2. Per page: extract `#content`, strip Stacks wrapper divs and inline styles.
3. Normalise: `<br><br>` → paragraphs, `font-weight:bold` spans → `**strong**`, keep `em` and links.
4. Derive title from `h1` (strip the `"PlayName: "` prefix) — robust, unlike the meaningless URLs.
5. Build the section tree from the second-level nav's label→href map.
6. Rewrite internal links to new slugs; download images from the page-relative `files/` dir.
7. Emit Markdown + YAML frontmatter into `src/content/`.

Run over ~5 plays plus Life and Career. **Checkpoint: a link-integrity report** — every internal
link resolves, every image downloaded, every page has a real title.

### Phase 2 — Design system + templates
Tailwind v4 CSS-first `@theme` tokens for both themes. Homepage, plays index, play template,
reading page, section nav, lightbox, search palette, footer. Built against the real scraped text
until it's genuinely beautiful. **Checkpoint: you review on desktop and phone.**

### Phase 3 — Full scrape + deploy
Scraper over all 139 subdomains. Pagefind index. Deploy to Workers, originals to R2, redirects
from old paths.

**Verification:** Lighthouse (targeting 95+ on performance and 100 on accessibility), axe pass,
real-device check at 375px, keyboard-only navigation of the play template, `prefers-reduced-motion`
honoured, search returning sensible results for a few known phrases, and a crawl confirming zero
broken internal links across all 3,640 pages.

---

## Migration status — verified 14 Aug 2026

2,428 pages, 811 images and 6 documents written from 155 hosts. Every number the
scraper reports as a gap has been reconciled against the live original site:

| Reported | What it actually is |
|---|---|
| 119 failures | 107 are second hostnames for pages already scraped — `directing.alanayckbourn.net/page4/pageNN/` is `careers.alanayckbourn.net/page4/pageNN/`, and the archive's own redirect between them is broken. The other two are dead upstream: a href containing the literal string `(null)`, and `directing…/page4.html`. |
| 6 uncrawled hosts | Five are duplicate hosts for content already in the site (`theplays`, `thegirlnextdoor`, `howtheotherloves`, `chloewithlove`, the bare apex). `the-sjt` does not exist — it is a typo in a link on the original site. |
| 2 empty pages | `NewsInDepth.html` under `page-2/` and `page-6/`. Abandoned Stacks pages: the live site serves four unconfigured "Button Label" placeholders and a footer. There is nothing there to migrate. |
| 7 unresolved links | Outbound or dead: the Woman in Black production site, `archiving.` (redirects off-domain to Simon Murgatroyd's own site), and the mistyped SJT hosts. |
| 0 broken internal links | Across 2,902 built pages. |

**Closed:** the alt text. Every original was `alt="Stacks Image 1234"`, and no
`title`, `longdesc` or `<figcaption>` anywhere in the archive says what a
photograph shows — but the archive does answer for most of its own images, and
finding where cut the work from 1,165 images to 133 written by hand:

- **354** were Expose thumbnails standing beside the same document at full size,
  which the lightbox already presents with the archive's own written description.
  Deduplicated away, which is most of how 1,165 images became 810.
- **129** are play posters, described by the templates that render them —
  `Poster artwork for <title>`, with the title printed beside the image either way.
- **80** the archive captions itself, in an italic paragraph set directly beneath
  the image, which is where the lightbox already reads its caption from. An image
  described by the text next to it takes `alt=""`; repeating the caption into the
  alt only reads it out twice.
- **28** looked captioned but were not — `*© Tony Bartholomew*` credits a
  photographer without describing anything, so those stayed on the list. Drawing
  that line is what stopped the chronology from falsely reading as done.
- **2** were the RapidWeaver theme's scroll arrows, pointing at a button list that
  was navigation and already gone. Furniture, not content; dropped in `clean()`.

The remaining **133** are described in `scripts/alt.json`, written by looking at
each image: what is visible and nothing more — no naming an actor the image does
not name — with posters, programme covers, banners, set plans and press cuttings
transcribed, and organisations named for logos. Keyed by content hash, so one
entry covers every page reproducing the same image. `scraped/report.json` still
carries `imagesWithoutAlt`; it now reports 0.

**Closed:** two content losses the word-count audit turned up while checking the
alt text hadn't cost anything. Counting every written page against the cached
original it came from — image syntax and table pipes stripped, since a described
image would otherwise read as content the original never had — the archive now
carries 100.8% of the original's words, and the pages still short of it are short
by exactly the sibling-nav lists the redesign replaces with generated navigation.
Two were real, though:

- The footer credit is sometimes glued to the end of a real paragraph rather than
  set on its own. `father-of-invention` closed its data sheet, its play title and
  the note explaining what a Grey Play is inside the very paragraph carrying the
  copyright notice, and the notice — tested against the whole block — took all of
  it. Matched line by line now, so only the notice leaves; 22 blocks came back.
- `Published / Available to Stage` is a data-sheet key with a slash in it, which
  the key pattern did not admit, so that row stood alone in the prose on 24 pages
  instead of joining the sheet in frontmatter.

**Closed:** the archive's own indexes, which were being read as navigation. The
Play Index prints its chronology as two paragraphs — 1959–1990 and 1991–present —
and on the link-density ratio alone they score 0.633 and 0.583, so the first was
dropped and the second kept. Identical content, decided by a coin flip either
side of a 0.6 threshold. What separates an index from the old sibling-nav is not
how much of it is links (both are almost all links) but whether it organises
itself: an index has rows that label the rows beneath them — `**1959**` over that
year's plays, `**F**` over the F titles, `**As Actor**` over the National Theatre
parts — and sibling-nav is a flat run of links. A label row is bold and holds no
link, which is also what separates it from the FAQ lists, since those bold the
links themselves and are still navigation. One label row is enough, because the
A–Z index sets every letter as its own paragraph.

That rescued one list it should not have. The Related Pages box titles itself
`**Other Perspectives**` over entries like
`○ *[Way Upstream](…/the-nt-paul-allen)*[at the NT by Paul Allen](…/the-nt-paul-allen)`
— the italic title and its suffix are two anchors on the same destination,
because the italic run broke the link in half. Two links to one page is one
entry, so the row points somewhere rather than saying something, and the box is
navigation however it is labelled. With both tests in place the corpus separates
cleanly: 57 blocks and 1,258 lines came back across 9 pages, every rescued label
a key rather than a nav title, and nothing the redesign generates for itself.
The archive now carries **100.8%** of the original's words.

What came back is the site's spine: both A–Z play indexes (`plays/index-title`
and `search/play-index` had been reduced to a handful of letters), the whole
1959–1990 half of the year-by-year Play Index, the National Theatre and Victoria
Theatre credit lists grouped by role and year, the Plays Directed list on both
directing pages, and the three era chronologies on `plays/play-facts` — The
Library Theatre Years, the Stephen Joseph Theatre In The Round Years and the
Stephen Joseph Theatre Years — which is the venue history the site tells its own
chronology through. Restoring them at the scraper meant not re-deriving eras from
each play's `year` on `/plays`: the archive's own three lists say it, verbatim,
where it published them.

One cosmetic residue, deliberately left: `**Director: Related Pages**` now stands
as the surviving title of a box that holds the restored Plays Directed list, on
two pages. It is the archive's own words, and the general fix — treating any bold
run above a heading as chrome — would run over all 2,428 pages to tidy two.

**Closed:** the reconstructed tables. 29 pages whose original three- and
four-column Stacks layouts had been flattening to `**Author** Publication **Date**
Topic` now emit real GFM tables, set like a programme's cast list — column names in
the UI face above an accent rule, hairlines between rows, and the first column
sticky so the play a row is about never scrolls away on a phone. Two-column data
sheets and cast lists stay as `**label** value` pairs, which read better down a
phone than a table of two columns would. Three root-cause fixes came out of it:
~40 career credit pages were pairing a production's credits sheet against the
adjacent cast list into one bogus four-column table (stating the director against
the first character); header rows the archive drew as their own layout row were
being dropped as headings labelling nothing; and one `<a>` spanning several rows
was leaving literal `[`/`](url)` fragments across them.

---

## Risks

| Risk | Mitigation |
|---|---|
| Scrape misses edge-case page layouts | Link-integrity report in Phase 1 surfaces these while the sample is small |
| 300×300 image ceiling limits visual impact | Design around modest image sizes; lean on typography for drama |
| Build time at 3,640 pages | Astro handles this fine; measure in Phase 3, shard only if needed |
| Scraping load on the old host | Rate-limit and cache locally; scrape once, iterate on cached HTML |
| Alt text gaps | Closed: the archive describes most of its own images; the rest written by hand in `scripts/alt.json`, none invented |
