#!/usr/bin/env node
/**
 * Scrapes the archive's *living* half: News, What's On and the Blog.
 *
 * On the original site all three are `<iframe>`s of a WordPress blog, which is
 * why the HTML scraper found three empty pages — the content was never in the
 * markup it fetched. It is a WordPress.com site, so the content comes from the
 * public REST API instead of the rendered page: clean JSON, dates, categories
 * and featured images, no parsing of somebody's theme.
 *
 * Usage:
 *   node scripts/blog.mjs                 # posts + pages, images to R2
 *   node scripts/blog.mjs --no-upload     # skip R2 (offline / iterating)
 *
 * Everything fetched is cached under .cache/blog/, and uploaded object keys are
 * remembered in .cache/blog/uploaded.json — re-runs cost one API call per page
 * of posts and no uploads at all.
 */

import { execFile } from 'node:child_process';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { load } from 'cheerio';
import sharp from 'sharp';
import { slugify } from './scrape.mjs';

const run = promisify(execFile);

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, '.cache/blog');
const ARCHIVE = join(ROOT, 'src/content/archive');
const OUT = join(ROOT, 'src/content/news');
const DATA = join(ROOT, 'src/data');

const SITE = 'archivingayckbourn.home.blog';
const API = `https://public-api.wordpress.com/wp/v2/sites/${SITE}`;
/** Public bucket, created with `wrangler r2 bucket dev-url enable`. */
const BUCKET = 'ayckbourn-media';
const R2 = 'https://pub-4c23c36058c0491eaa4d6d55c25b33de.r2.dev';
/* One wrangler invocation per object, eight at a time: ~1.5s of node startup
   each, so serially this would be half an hour.
   ponytail: the S3 API would do it in one client, but that needs an account API
   token minted by hand. Eight parallel CLI calls run once and are then cached. */
const UPLOAD_CONCURRENCY = 8;

const upload = !process.argv.includes('--no-upload');

/** WordPress writes typographic punctuation as entities even in JSON fields. */
const decode = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&hellip;/g, '…')
    .replace(/&(?:mdash|ndash);/g, '—');

const text = (html) => decode(html.replace(/<[^>]+>/g, '')).trim();

async function cached(key, fetcher, { binary = false } = {}) {
  const path = join(CACHE, key);
  try {
    return await readFile(path, binary ? null : 'utf8');
  } catch {
    // not cached yet
  }
  const body = await fetcher();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return body;
}

const api = async (path, key) =>
  JSON.parse(
    await cached(key, async () => {
      const res = await fetch(`${API}/${path}`);
      if (!res.ok) {
        throw new Error(`${res.status} ${path}`);
      }
      return await res.text();
    }),
  );

/**
 * Every URL the archive publishes, mapped to the route we serve it at. Built
 * from the `source:` frontmatter of the pages the HTML scraper already wrote —
 * the content is its own routing table, so the two scrapers cannot disagree.
 */
async function routeMap() {
  const routes = new Map();
  const titles = new Map();
  const walk = async (dir, trail = '') => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== '_images') {
        await walk(join(dir, entry.name), `${trail}/${entry.name}`);
      } else if (entry.name === 'index.md') {
        const md = await readFile(join(dir, entry.name), 'utf8');
        const source = md.match(/^source: "(.+)"$/m)?.[1];
        const title = md.match(/^title: "(.+)"$/m)?.[1];
        if (source) {
          routes.set(source.replace(/\/$/, ''), trail || '/');
        }
        /* Play titles, for linking What's On listings at our own play pages
           rather than only at the box office. */
        if (title && /^\/plays\/[^/]+$/.test(trail)) {
          titles.set(title.toLowerCase(), trail);
        }
      }
    }
  };
  await walk(ARCHIVE);
  return { routes, titles };
}

/* ---------------------------------------------------------------- media ---- */

/**
 * Post images, mirrored to R2 rather than committed: 1,164 files and 84MB of
 * them, none of which needs to be in git or to go through Astro's pipeline —
 * WordPress has already capped every one at the width it is displayed at.
 *
 * The key keeps the `?w=` variant, because two posts citing the same photograph
 * at 400px and 750px are two different files.
 */
const keyFor = (url) => {
  const { pathname, searchParams } = new URL(url);
  const year = pathname.match(/\/(\d{4})\/\d{2}\//)?.[1] ?? 'undated';
  const raw = decodeURIComponent(pathname.split('/').pop());
  const dot = raw.lastIndexOf('.');
  const width = searchParams.get('w');
  const ext = dot > 0 ? raw.slice(dot).toLowerCase() : '.jpg';
  const stem = slugify(dot > 0 ? raw.slice(0, dot) : raw);
  return `news/${year}/${stem}${width ? `-w${width}` : ''}${ext}`;
};

/** Dimensions come off the bytes we already hold: `<img>` without them shifts. */
async function media(url) {
  const key = keyFor(url);
  const bytes = await cached(
    `media/${key}`,
    async () => {
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`${res.status} ${url}`);
      }
      return Buffer.from(await res.arrayBuffer());
    },
    { binary: true },
  );
  const { width, height } = await sharp(bytes).metadata();
  return { key, url: `${R2}/${key}`, width, height };
}

async function uploadAll(keys) {
  const done = new Set(
    JSON.parse(await cached('uploaded.json', async () => '[]')),
  );
  const pending = keys.filter((k) => !done.has(k));
  let n = 0;
  const worker = async () => {
    for (let i = n++; i < pending.length; i = n++) {
      const key = pending[i];
      await run('bunx', [
        'wrangler',
        'r2',
        'object',
        'put',
        `${BUCKET}/${key}`,
        '--file',
        join(CACHE, 'media', key),
        '--remote',
      ]);
      done.add(key);
      if (done.size % 50 === 0) {
        process.stdout.write(`  uploaded ${done.size}/${keys.length}\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: UPLOAD_CONCURRENCY }, worker)).finally(
    () => writeFile(join(CACHE, 'uploaded.json'), JSON.stringify([...done])),
  );
  return pending.length;
}

/* ------------------------------------------------------------- rewriting --- */

/* WordPress ships a paragraph of provenance on every image and a class on every
   block. None of it survives: our own stylesheet does the styling. */
const NOISE =
  /^(?:data-|aria-|srcset|sizes|style|class|id|loading|decoding|target|rel|width|height)/;

/**
 * A post's body, made ours: images pointed at R2 with dimensions attached,
 * archive links pointed at our routes, and every WordPress class stripped.
 *
 * Kept as HTML rather than converted to Markdown. It arrives as clean semantic
 * blocks — `<p>`, `<figure>`, `<blockquote>` — and `.prose-archive` styles
 * elements, not Markdown, so a converter would be a round trip to nowhere.
 */
function rewrite(html, { images, routes }) {
  const $ = load(html, null, false);

  $('img').each((_, el) => {
    const img = $(el);
    const found = images.get(img.attr('src'));
    for (const name of Object.keys(el.attribs)) {
      if (NOISE.test(name)) {
        img.removeAttr(name);
      }
    }
    if (!found) {
      img.remove();
      return;
    }
    img
      .attr('src', found.url)
      .attr('width', String(found.width))
      .attr('height', String(found.height))
      .attr('loading', 'lazy')
      .attr('decoding', 'async');
  });

  $('a[href]').each((_, el) => {
    const a = $(el);
    const href = a.attr('href') ?? '';
    const route = routes.get(
      href.replace(/\/$/, '').replace(/^https:/, 'http:'),
    );
    if (route) {
      a.attr('href', route);
    } else if (href.startsWith('/')) {
      /* A root-relative href in a post is broken at source — the archivist has
         pasted an Amazon link and lost its host, leaving `/0746312814/ref=…`.
         It resolved to nothing on the blog and would resolve to a 404 here,
         which reads as our bug. Keep the words, drop the dead link — the same
         treatment the images that 404 at source get. */
      a.replaceWith(a.html() ?? '');
      return;
    }
    a.removeAttr('target').removeAttr('rel').removeAttr('class');
  });

  /* `<font color>` from pasted text, and WordPress's habit of nesting a bold
     inside a bold: both are noise that survives into the text otherwise. */
  $('font, span').each((_, el) => $(el).replaceWith($(el).html() ?? ''));
  $('strong strong, em em').each((_, el) =>
    $(el).replaceWith($(el).html() ?? ''),
  );
  $('[class]').removeAttr('class');
  $('[id]').removeAttr('id');
  /* The blog's own footer furniture, which means nothing on our pages. */
  $('.sharedaddy, .wp-block-buttons, .jp-relatedposts, script, style').remove();

  return $.html()
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* --------------------------------------------------------------- parsing --- */

const MONTHS =
  'january february march april may june july august september october november december'.split(
    ' ',
  );
/** Stripped before anything else, so `1.30pm` is not the 1st and the 30th. */
const TIME = /\b\d{1,2}([.:]\d{2})?\s*[ap]\.?m\.?\b/gi;
/** A day, or a month with the year that may follow it. `\b` keeps 2026 whole. */
const TOKEN = /\b(\d{1,2})\b|\b([A-Za-z]{3,9})\.?(?:\s+(\d{4}))?/g;

/**
 * The dates of a run, as far as they can be known: `{from, to}`, either side
 * possibly absent. The listings write a run six ways — `4 September – 3 October
 * 2026`, `10 – 15 August 2026`, `19 – 22, 26 – 29 August 2026`, `Until 19
 * September 2026`, `From 4 September`, a single performance with a curtain-up
 * time — and one of them is `Streaming`, which has no dates at all.
 *
 * Rather than a pattern per form, this reads the days and the months as tokens
 * in the order they are written: each day belongs to the next month named after
 * it, so the split run and the run that crosses a month both fall out of the
 * same rule, and the first and last day are the ends of the run.
 *
 * Parsed here rather than in the page so "is this still on?" is a date
 * comparison at render time instead of a second parser in Astro.
 *
 * `on` is the date the listings page was last updated: the page looks forward,
 * so a month written without a year means its next occurrence.
 */
function runDates(when = '', on) {
  const days = [];
  const months = [];
  for (const match of when.replace(TIME, ' ').matchAll(TOKEN)) {
    const [, day, name, year] = match;
    if (day !== undefined) {
      days.push({ day: Number(day), at: match.index });
      continue;
    }
    const month = MONTHS.findIndex((m) =>
      m.startsWith(name.slice(0, 3).toLowerCase()),
    );
    if (month >= 0) {
      months.push({
        month,
        year: year ? Number(year) : undefined,
        at: match.index,
      });
    }
  }
  /* "Autumn 2026" and "Streaming" have no day; "May 2026" has no run. */
  if (days.length === 0 || months.length === 0) {
    return {};
  }

  const stated = months.at(-1).year ?? on?.getUTCFullYear();
  if (!stated) {
    return {};
  }
  const iso = ({ day, at }, shift) => {
    const owner = months.find((m) => m.at > at) ?? months.at(-1);
    const year = (owner.year ?? stated) + shift;
    return `${year}-${String(owner.month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  };
  /* An inferred year that puts the last night in the past means the next one:
     "11 September" listed in August 2026 is 2026, listed in October is 2027. */
  const inferred = months.at(-1).year === undefined;
  const shift =
    inferred && on && iso(days.at(-1), 0) < on.toISOString().slice(0, 10)
      ? 1
      : 0;

  const first = iso(days[0], shift);
  const last = iso(days.at(-1), shift);
  if (days.length > 1) {
    return { from: first, to: last };
  }
  if (/^\s*(until|to|through)\b/i.test(when)) {
    return { to: last };
  }
  if (/^\s*from\b/i.test(when)) {
    return { from: first };
  }
  /* One date and no preposition is a single performance, not an open run. */
  return { from: first, to: last };
}

/**
 * A news bulletin dates itself `06/08/26`, sometimes as `updated 06/08/26`
 * where the item has been revised since it was first posted. Day first: these
 * are written in Scarborough.
 */
function posted(when = '') {
  const date = when.match(/\b(\d{2})\/(\d{2})\/(\d{2})\b/);
  return date
    ? {
        posted: `20${date[3]}-${date[2]}-${date[1]}`,
        revised: /\bupdated\b/i.test(when),
      }
    : {};
}

/**
 * The two curated pages are one shape: a bullet per item, `◦ Title (when)`,
 * then a line of detail. Parsed into data rather than passed through as prose
 * so the pages can be built as listings — cards with a date, a venue and a
 * link — instead of a wall of bullets.
 */
function bullets(html, { images, routes, on }) {
  const $ = load(html, null, false);
  const items = [];
  let heading = null;

  for (const el of $('p, h1, h2, h3, figure').toArray()) {
    const node = $(el);
    const raw = text(node.html() ?? '');
    if (!raw) {
      continue;
    }
    if (!raw.startsWith('◦')) {
      /* A short bold line with no bullet is a group header: "August 2026",
         "Streaming". Anything longer is the page's own introduction. */
      const bold = text(node.find('strong').first().html() ?? '');
      heading = bold && bold === raw && raw.length < 40 ? raw : heading;
      if (!(bold && bold === raw)) {
        items.push({
          kind: 'intro',
          heading: null,
          html: rewrite(node.toString(), { images, routes }),
        });
      }
      continue;
    }

    /* The <br> is the join between the listing and its detail, so the listing
       line is read from the markup before it. Taking it off the flattened text
       instead glues the two together on the items that carry no dates — "on BBC
       iPlayerThe acclaimed 1985 BBC adaptation". */
    const [lead, ...tail] = (node.html() ?? '').split(/<br\s*\/?>/);
    const body = text(lead).replace(/^◦\s*/, '');
    /* The last parenthesis is the when — dates run "(4 September – 3 October
       2026)" and titles never carry brackets. */
    const when = body.match(/\(([^()]*)\)\s*$|\(([^()]*)\)/);
    const head = (when ? body.slice(0, when.index) : body).trim();
    /* Title is the bold run; the venue is what follows " at ". Titles do
       contain " at " ("Ayckbourn at the Library Theatre"), so the split comes
       off the markup, not the text. */
    const bolded = text(node.find('strong').first().html() ?? '').replace(
      /^◦\s*/,
      '',
    );
    const title = (bolded && head.startsWith(bolded) ? bolded : head)
      .replace(/\s+at$/, '')
      .trim();
    const rest = head
      .slice(title.length)
      .replace(/^\s*at\s+/i, '')
      /* "at the Jubilee Hall" is a phrase; on its own line it is a name. */
      .replace(/^the\b/, 'The')
      .trim();
    /* Detail sits after the <br>: "Directed in-the-round by Alan Ayckbourn".
       Kept as HTML too — a news bulletin's whole point is often the link at the
       end of it ("To view, click here"), which the text form throws away. */
    const after = tail.join('<br>');
    const detail = raw.includes('\n') ? '' : text(after);
    const detailHtml = detail
      ? rewrite(`<p>${after}</p>`, { images, routes })
      : '';

    items.push({
      kind: 'item',
      heading,
      title,
      where: rest,
      when: when ? (when[1] ?? when[2]).trim() : '',
      ...runDates(when ? (when[1] ?? when[2]) : '', on),
      ...posted(when ? (when[1] ?? when[2]) : ''),
      detail,
      detailHtml,
      href: $(el).find('a[href]').first().attr('href') ?? null,
      html: rewrite(node.toString(), { images, routes }),
    });
  }
  return items;
}

/* ------------------------------------------------------------------ main --- */

async function main() {
  const { routes, titles } = await routeMap();
  const report = { posts: 0, images: 0, uploaded: 0, failures: [] };

  /* 469 posts, five calls. `_fields` keeps the cached JSON to what we use. */
  const fields =
    'id,date,slug,title,content,excerpt,categories,jetpack_featured_media_url,link';
  const posts = [];
  for (let page = 1; ; page++) {
    const batch = await api(
      `posts?per_page=100&page=${page}&_fields=${fields}`,
      `posts-${page}.json`,
    );
    posts.push(...batch);
    if (batch.length < 100) {
      break;
    }
  }

  const categories = new Map(
    (
      await api(
        'categories?per_page=100&_fields=id,slug,name',
        'categories.json',
      )
    ).map((c) => [c.id, decode(c.name)]),
  );

  const pages = Object.fromEntries(
    await Promise.all(
      ['news', 'whats-on'].map(async (slug) => [
        slug,
        (
          await api(
            `pages?slug=${slug}&_fields=content,modified`,
            `page-${slug}.json`,
          )
        )[0],
      ]),
    ),
  );

  /* Every image on the blog, fetched once and keyed by the URL the markup uses
     so `rewrite` can look it up. */
  const sources = new Set();
  const collect = (html) => {
    for (const [, src] of html.matchAll(/<img[^>]+src="([^"]+)"/g)) {
      sources.add(src);
    }
  };
  for (const post of posts) {
    collect(post.content.rendered);
    if (post.jetpack_featured_media_url) {
      sources.add(post.jetpack_featured_media_url);
    }
  }
  for (const page of Object.values(pages)) {
    collect(page.content.rendered);
  }

  const images = new Map();
  for (const src of sources) {
    try {
      images.set(src, await media(src));
    } catch (err) {
      report.failures.push({ url: src, error: err.message });
    }
  }
  report.images = images.size;

  if (upload) {
    report.uploaded = await uploadAll([...images.values()].map((i) => i.key));
  }

  /* Posts, newest first in the API; each becomes one hand-editable file. */
  await mkdir(OUT, { recursive: true });
  for (const post of posts) {
    const hero = images.get(post.jetpack_featured_media_url);
    const front = {
      title: decode(post.title.rendered),
      date: post.date,
      /* WordPress truncates its own excerpt and signs the cut with "[…]". */
      excerpt: text(post.excerpt.rendered)
        .replace(/\s*Continue reading.*$/, '')
        .replace(/\s*\[…]\s*$/, '…'),
      categories: post.categories
        .map((id) => categories.get(id))
        .filter(Boolean),
      source: post.link,
      ...(hero
        ? { hero: hero.url, heroWidth: hero.width, heroHeight: hero.height }
        : {}),
    };
    /* Two posts were published without a slug, so WordPress used the post ID:
       `/news/11813` tells a reader nothing and cannot be guessed or read out. */
    const slug = /^\d+$/.test(post.slug) ? slugify(front.title) : post.slug;
    await writeFile(
      join(OUT, `${slug}.md`),
      `${yaml(front)}\n${rewrite(post.content.rendered, { images, routes })}\n`,
    );
    report.posts++;
  }

  /* The curated pages, as data. `titles` links a listed play to our own page
     for it — the blog can only link the box office. */
  const seen = new Set();
  const listings = bullets(pages['whats-on'].content.rendered, {
    images,
    routes,
    on: new Date(pages['whats-on'].modified),
  })
    .map((item) =>
      item.kind === 'item'
        ? { ...item, play: titles.get(item.title.toLowerCase()) ?? null }
        : item,
    )
    /* A run spanning two months is listed under both of them, so The Old Vic's
       How The Other Half Loves appears twice. Our page groups by whether a
       production is on rather than by month, where the second copy would sit
       directly under the first. The month heading of the earlier one wins. */
    .filter((item) => {
      const key = `${item.title}|${item.where}|${item.when}`;
      return item.kind !== 'item' || (!seen.has(key) && seen.add(key));
    });
  await mkdir(DATA, { recursive: true });
  await writeFile(
    join(DATA, 'whats-on.json'),
    `${JSON.stringify({ updated: pages['whats-on'].modified, items: listings }, null, 2)}\n`,
  );
  await writeFile(
    join(DATA, 'news.json'),
    `${JSON.stringify(
      {
        updated: pages.news.modified,
        items: bullets(pages.news.content.rendered, {
          images,
          routes,
          on: new Date(pages.news.modified),
        }),
      },
      null,
      2,
    )}\n`,
  );

  /*
   * The images that 404 do so on the blog itself — the posts show the same
   * broken pictures in a browser. `rewrite` drops those `<img>` tags rather than
   * shipping a broken one, and the loss is written down here rather than being
   * silent: it is a list Simon could act on, not a bug in this scrape.
   */
  await mkdir(dirname(join(ROOT, 'scraped/blog.json')), { recursive: true });
  await writeFile(
    join(ROOT, 'scraped/blog.json'),
    `${JSON.stringify(
      {
        scrapedAt: new Date().toISOString(),
        posts: report.posts,
        images: report.images,
        missingAtSource: report.failures,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    [
      `posts:      ${report.posts}`,
      `images:     ${report.images}`,
      `uploaded:   ${report.uploaded}${upload ? '' : ' (skipped)'}`,
      `listings:   ${listings.filter((i) => i.kind === 'item').length}`,
      `gone:       ${report.failures.length} images 404 on the blog itself`,
    ].join('\n'),
  );
}

/* ponytail: same hand-rolled YAML as the HTML scraper, plus flow arrays for the
   category list — nothing here nests deeper than that. */
function yaml(obj) {
  const scalar = (v) =>
    typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '\\"')}"`;
  return `---\n${Object.entries(obj)
    .map(([k, v]) =>
      Array.isArray(v)
        ? `${k}: [${v.map(scalar).join(', ')}]`
        : `${k}: ${scalar(v)}`,
    )
    .join('\n')}\n---\n`;
}

if (process.argv[1].endsWith('blog.mjs')) {
  await main();
}

export { bullets, decode, keyFor, rewrite, runDates, text };
