#!/usr/bin/env node
/**
 * Scrapes alanayckbourn.net (RapidWeaver + Stacks 5 static HTML) into Astro
 * content-collection Markdown.
 *
 * Usage:
 *   node scripts/scrape.mjs                 # sample: 5 plays + Life + Career
 *   node scripts/scrape.mjs --all           # every play subdomain
 *   node scripts/scrape.mjs --sites=biography,relativelyspeaking
 *
 * Every fetch is cached under .cache/scrape/ and rate-limited: this hits
 * someone else's Apache box, so scrape once and iterate on the cache.
 */

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { load } from 'cheerio';

const ROOT = new URL('..', import.meta.url).pathname;
const CACHE = join(ROOT, '.cache/scrape');
const OUT = join(ROOT, 'src/content/archive');
const REPORT = join(ROOT, 'scraped/report.json');
const DELAY_MS = 200;
const DOMAIN = 'alanayckbourn.net';

// Subdomains that are sections of the main site rather than plays.
const SECTION_SITES = {
  biography: 'life',
  careers: 'career',
  encyclopedia: 'encyclopaedia',
  publications: 'publications',
  research: 'research',
};

// One play per era: the 60s hit, the 70s tragi-comedy, the trilogy, the 80s
// psychological piece, the late work. Enough shape variety to trust the parser.
const SAMPLE_PLAYS = [
  'relativelyspeaking',
  'absurdpersonsingular',
  'thenormanconquests',
  'womaninmind',
  'familyalbum',
];

const args = process.argv.slice(2);
const flag = (name) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];

/* ------------------------------------------------------------------ fetching */

let lastFetch = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Subdomains have no valid TLS cert — only www serves https. */
const httpUrl = (u) => u.replace(/^https:\/\/(?!www\.)/, 'http://');

async function fetchCached(url, { binary = false } = {}) {
  const u = new URL(httpUrl(url));
  const path = join(
    CACHE,
    u.hostname,
    u.pathname.endsWith('/') ? `${u.pathname}index` : u.pathname,
  );
  try {
    return await readFile(path, binary ? null : 'utf8');
  } catch {
    // not cached yet
  }

  const wait = DELAY_MS - (Date.now() - lastFetch);
  if (wait > 0) {
    await sleep(wait);
  }
  lastFetch = Date.now();

  const res = await fetch(u, {
    headers: { 'user-agent': 'alanayckbourn-modernisation/1.0' },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${u}`);
  }
  const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);
  return body;
}

/* -------------------------------------------------------------- url → route */

const slugify = (s) =>
  s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f\u2018\u2019\u201c\u201d'"]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70) || 'page';

/** Strips query/hash and normalises to a trailing-slash-or-file path. */
function normalise(href, base) {
  let u;
  try {
    u = new URL(href, base);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return null;
  }
  u.hash = '';
  u.search = '';
  u.protocol = 'http:';
  if (!u.pathname.includes('.') && !u.pathname.endsWith('/')) {
    u.pathname += '/';
  }
  return u.toString();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hostOf = (url) => new URL(url).hostname;
const subdomain = (host) => host.replace(`.${DOMAIN}`, '');
const isInternal = (url) => hostOf(url).endsWith(DOMAIN);

/** The containing directory of a page URL, or null at the site root. */
function parentOf(url) {
  const u = new URL(url);
  const parts = u.pathname.split('/').filter(Boolean);
  if (!parts.length) {
    return null;
  }
  parts.pop();
  return normalise(`/${parts.map((p) => `${p}/`).join('')}`, url);
}

/** Path segments of a page URL, dropping the trailing filename's extension. */
function segments(url) {
  const parts = new URL(url).pathname.split('/').filter(Boolean);
  const last = parts.at(-1);
  if (last?.includes('.')) {
    // index.html and friends are the directory itself, not a child page.
    if (/^(index|default)\./i.test(last)) {
      parts.pop();
    } else {
      parts[parts.length - 1] = last.replace(/\.[^.]+$/, '');
    }
  }
  return parts;
}

/* ---------------------------------------------------------------- extraction */

// Stacks nav furniture: the right-hand button rail and the "flat buttons",
// both of which only duplicate links that already exist in the prose.
const NAV_STACKS =
  '.com_yourhead_stack_button_stack, .com_elixir_stacks_flatbutton2_stack, .flat_button_2_alignment';

function clean($) {
  const content = $('#content');
  content
    .find('script, style, noscript, .contentSpacer, .clear, .clearer')
    .remove();
  content.find(NAV_STACKS).remove();

  // Pull-out boxes ("Behind The Scenes: …") become semantic asides. The box is
  // the inner `*_float` div — its parent stack also holds the page's main flow.
  for (const el of content.find('[id$="_float"]').toArray()) {
    el.tagName = 'aside';
  }

  for (const el of content.find('span').toArray().reverse()) {
    const $el = $(el);
    if (/font-weight:\s*bold/i.test($el.attr('style') || '')) {
      el.tagName = 'strong';
      el.attribs = {};
    } else {
      $el.replaceWith($el.contents());
    }
  }

  // Every original <span> was its own bold run, so a single bold phrase arrives
  // as a dozen adjacent <strong>s. Merge them or the markdown fills with `****`.
  for (const tag of ['strong', 'em']) {
    for (const el of content.find(tag).toArray()) {
      let next = el.nextSibling;
      while (next?.type === 'tag' && next.tagName === tag) {
        $(el).append($(next).contents());
        const after = next.nextSibling;
        $(next).remove();
        next = after;
      }
    }
  }

  // Flatten the Stacks wrapper soup (and with it the desktop-only columns).
  for (const el of content.find('div').toArray().reverse()) {
    const $el = $(el);
    $el.replaceWith($el.contents());
  }
  return content;
}

const PARA_BREAK = /((?:<br>\s*){2,})/;

/**
 * Emphasis markers must hug their text (`*foo *bar` is not italic) and must not
 * straddle a line or paragraph break, or the markers end up unbalanced.
 */
function emphasise(inner, marker) {
  if (PARA_BREAK.test(inner)) {
    return inner
      .split(PARA_BREAK)
      .map((part, i) => (i % 2 ? part : emphasise(part, marker)))
      .join('');
  }
  const [, before, text, after] = inner.match(
    /^((?:\s|<br>)*)([\s\S]*?)((?:\s|<br>)*)$/,
  );
  // Italicising a lone full stop is meaningless and produces `****` collisions.
  if (!text.trim() || /^[\s.,;:!?'"()‘’“”–—-]+$/.test(text)) {
    return inner;
  }
  return `${before}${marker}${text}${marker}${after}`;
}

const escapeMd = (text) =>
  text
    .replace(/[\u00a0\u2007\u202f\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/([\\`*[\]<>])/g, '\\$1');

/** Serialises one node, keeping `<br>` as a marker for the block split. */
function inlineNode($, n, links) {
  if (n.type === 'text') {
    return escapeMd(n.data);
  }
  if (n.type !== 'tag') {
    return '';
  }
  switch (n.tagName) {
    case 'br':
      return '<br>';
    case 'em':
    case 'i':
      return emphasise(inlineMd($, n, links), '*');
    case 'strong':
    case 'b':
      return emphasise(inlineMd($, n, links), '**');
    case 'a': {
      const t = inlineMd($, n, links).trim();
      const href = $(n).attr('href');
      if (!t) {
        return '';
      }
      if (!href || href.startsWith('#')) {
        return t;
      }
      const target = links(href);
      return target ? `[${t}](${target})` : t;
    }
    case 'img': {
      const src = links.image($(n).attr('src'));
      return src ? `![](${src})` : '';
    }
    default:
      return inlineMd($, n, links);
  }
}

/** Serialises a node's children. */
function inlineMd($, node, links) {
  return $(node)
    .contents()
    .toArray()
    .map((n) => inlineNode($, n, links))
    .join('');
}

/** `<br><br>` is how Stacks writes a paragraph break; a single one is a line break. */
function splitParagraphs(run) {
  return run
    .split(PARA_BREAK)
    .filter((_p, i) => i % 2 === 0)
    .map((p) =>
      p
        .split('<br>')
        .map((line) => line.trim())
        .filter(Boolean)
        .join('  \n'),
    )
    .filter(Boolean);
}

function blocksOf($, root, links) {
  const blocks = [];
  let run = '';
  const flush = () => {
    for (const text of splitParagraphs(run)) {
      blocks.push({ type: 'p', text });
    }
    run = '';
  };

  for (const node of $(root).contents().toArray()) {
    if (node.type === 'text') {
      run += escapeMd(node.data);
      continue;
    }
    if (node.type !== 'tag') {
      continue;
    }
    const tag = node.tagName;
    if (/^h[1-4]$/.test(tag)) {
      flush();
      const text = inlineMd($, node, links).replace(/<br>/g, ' ').trim();
      if (text) {
        blocks.push({ type: 'h', level: Number(tag[1]), text });
      }
    } else if (tag === 'aside') {
      flush();
      blocks.push({ type: 'aside', blocks: blocksOf($, node, links) });
    } else if (tag === 'img') {
      flush();
      const src = links.image($(node).attr('src'));
      if (src) {
        blocks.push({ type: 'img', src });
      }
    } else if (tag === 'p') {
      flush();
      run = inlineMd($, node, links);
      flush();
    } else if (tag === 'ul' || tag === 'ol') {
      flush();
      blocks.push({
        type: 'list',
        ordered: tag === 'ol',
        items: $(node)
          .children('li')
          .toArray()
          .map((li) => inlineMd($, li, links).replace(/<br>/g, ' ').trim())
          .filter(Boolean),
      });
    } else {
      run += inlineNode($, node, links);
    }
  }
  flush();
  return blocks;
}

const linkText = (block) =>
  (block.text.match(/\[[^\]]*\]\([^)]*\)/g) || [])
    .join('')
    .replace(/\([^)]*\)/g, '').length;

/** A paragraph that is almost entirely links is the old sibling-nav, not prose. */
const isNavBlock = (block) =>
  block.type === 'p' &&
  (block.text.match(/\]\(/g) || []).length >= 2 &&
  linkText(block) / Math.max(block.text.replace(/\([^)]*\)/g, '').length, 1) >
    0.6;

/**
 * The Simon Murgatroyd research credit and the Haydonning copyright notice are
 * repeated verbatim on every one of the ~3,640 pages. They belong in the
 * footer, once, prominently — not inline 3,640 times.
 */
const BOILERPLATE =
  /All research and original material|Haydonning Ltd|do not reproduce (any material|in any form)/i;

const plain = (s) => s.replace(/[\\*]/g, '').replace(/\s+/g, ' ').trim();

function dropNavBlocks(blocks, title) {
  const kept = [];
  let dropped = 0;
  let credits = 0;
  for (const block of blocks) {
    // The page's own <h1> becomes the template heading; don't repeat it in the body.
    if (
      kept.length === 0 &&
      block.type === 'h' &&
      plain(block.text) === plain(title)
    ) {
      continue;
    }
    if (block.type === 'p' && BOILERPLATE.test(block.text)) {
      credits++;
      continue;
    }
    if (isNavBlock(block)) {
      dropped++;
      if (kept.at(-1)?.type === 'h') {
        kept.pop();
      }
      continue;
    }
    // The old sibling-nav lists live inside the float boxes, so recurse — and
    // drop a box that turns out to have held nothing but navigation.
    if (block.type === 'aside') {
      const inner = dropNavBlocks(block.blocks, title);
      dropped += inner.dropped;
      credits += inner.credits;
      if (!inner.blocks.some((b) => b.type !== 'h')) {
        dropped++;
        continue;
      }
      kept.push({ ...block, blocks: inner.blocks });
      continue;
    }
    kept.push(block);
  }
  return { blocks: kept, dropped, credits };
}

function render(blocks, depth = 0) {
  return blocks
    .map((b) => {
      if (b.type === 'h') {
        return `${'#'.repeat(Math.min(b.level + 1, 6))} ${b.text}`;
      }
      if (b.type === 'img') {
        return `![](${b.src})`;
      }
      if (b.type === 'list') {
        return b.items
          .map((it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${it}`)
          .join('\n');
      }
      if (b.type === 'aside') {
        return depth > 0
          ? render(b.blocks, depth + 1)
          : `<aside>\n\n${render(b.blocks, depth + 1)}\n\n</aside>`;
      }
      return b.text;
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * `**World Premiere:** 26 June 1972` lines are data, not prose. The label must
 * be a plain bold run — anything with nested emphasis is a sentence, not a key.
 */
const FACT_LINE = /^\*\*([A-Z][A-Za-z' ]{1,30}?):?\*\*:?\s*(.+)$/;

function extractFacts(blocks) {
  const facts = {};
  const kept = [];
  let previous = '';
  for (const block of blocks) {
    if (block.type !== 'p') {
      kept.push(block);
      continue;
    }
    const rest = [];
    for (const line of block.text.split('  \n')) {
      const m = line.match(FACT_LINE);
      const value = m?.[2]?.replace(/\*\*/g, '').trim();
      if (!value) {
        rest.push(line);
        continue;
      }
      // Three "Venue:" lines follow the three premiere dates — qualify each with
      // the premiere it belongs to, or the last one would eat the other two.
      let key = m[1].trim();
      if (key in facts || /Premiere$/i.test(previous)) {
        key = `${previous} ${key}`.trim();
      }
      facts[key] = value;
      previous = m[1].trim();
    }
    if (rest.join('').trim()) {
      kept.push({ ...block, text: rest.join('  \n') });
    }
  }
  return { facts, blocks: kept };
}

/* -------------------------------------------------------------------- crawl */

async function sitemap(host) {
  const xml = await fetchCached(`http://${host}/sitemap.xml`);
  return (
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
      .map((m) => normalise(m[1].trim(), `http://${host}/`))
      // .php endpoints are the old mail handlers, not pages (PR 8 rebuilds the form).
      .filter((u) => u && hostOf(u) === host && !u.endsWith('.php'))
  );
}

async function discoverPlays() {
  const html = await fetchCached(`http://plays.${DOMAIN}/`);
  const $ = load(html);
  const plays = new Map();
  $('#content a').each((_, el) => {
    const href = normalise($(el).attr('href') || '', `http://plays.${DOMAIN}/`);
    const name = $(el).text().trim();
    if (!href || !name) {
      return;
    }
    const sub = subdomain(hostOf(href));
    if (
      !sub ||
      sub === 'plays' ||
      sub.startsWith('www') ||
      sub in SECTION_SITES
    ) {
      return;
    }
    if (!plays.has(sub)) {
      plays.set(sub, { name, slug: slugify(name), order: plays.size });
    }
  });
  return plays;
}

function main() {
  return run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

async function run() {
  const plays = await discoverPlays();
  console.log(`Discovered ${plays.size} play subdomains`);

  const requested = flag('sites')?.split(',').filter(Boolean);
  const hosts = requested
    ? requested.map((s) => `${s}.${DOMAIN}`)
    : [
        ...Object.keys(SECTION_SITES)
          .filter(
            (s) =>
              args.includes('--all') || s === 'biography' || s === 'careers',
          )
          .map((s) => `${s}.${DOMAIN}`),
        ...(args.includes('--all') ? [...plays.keys()] : SAMPLE_PLAYS).map(
          (s) => `${s}.${DOMAIN}`,
        ),
      ];

  /** host → route prefix, e.g. `plays/absurd-person-singular`. */
  const prefixOf = (host) => {
    const sub = subdomain(host);
    if (host === DOMAIN || sub === 'www') {
      return '';
    }
    if (sub === 'plays' || sub === 'theplays') {
      return 'plays';
    }
    if (sub in SECTION_SITES) {
      return SECTION_SITES[sub];
    }
    if (plays.has(sub)) {
      return `plays/${plays.get(sub).slug}`;
    }
    const companion = sub.replace(/^writing/, '');
    if (sub.startsWith('writing') && plays.has(companion)) {
      return `plays/${plays.get(companion).slug}/writing`;
    }
    return null;
  };

  // Pass 1: fetch every page, collect anchor text per URL so slugs come from
  // labels ("History") rather than the meaningless URLs ("styled/page-10/").
  const pages = new Map();
  const labels = new Map();
  const failures = [];

  for (const host of hosts) {
    if (prefixOf(host) === null) {
      failures.push({ host, error: 'no route mapping' });
      continue;
    }
    let urls;
    try {
      urls = await sitemap(host);
    } catch (err) {
      failures.push({ host, error: `sitemap: ${err.message}` });
      continue;
    }
    process.stdout.write(`${host}: ${urls.length} pages `);
    for (const url of urls) {
      try {
        const html = await fetchCached(url);
        const $ = load(html);
        pages.set(url, { host, $ });
        $('#content a, #navcontainer a').each((_, el) => {
          const target = normalise($(el).attr('href') || '', url);
          const text = $(el).text().trim();
          if (!target || !isInternal(target) || !text || text.length > 60) {
            return;
          }
          if (/^(here|click|button|this|more|link)\b/i.test(text)) {
            return;
          }
          if (!labels.has(target)) {
            labels.set(target, { text, order: labels.size });
          }
        });
      } catch (err) {
        failures.push({ url, error: err.message });
      }
    }
    process.stdout.write('✓\n');
  }
  console.log(`Fetched ${pages.size} pages`);

  // Pass 2: every crawled URL gets its new route, so links can be rewritten.
  // Routes are built parent-first so the old hierarchy survives even though the
  // intermediate directories ("page-80/") are meaningless.
  const routes = new Map();
  const taken = new Set();
  const depth = (url) => segments(url).length;
  const isFile = (url) => new URL(url).pathname.split('/').at(-1).includes('.');

  // Section landings are often published as a file inside the section directory
  // (`styled/BBC.html`) while the directory itself is never crawled. Where a
  // directory has exactly one such file, it stands in for the directory — else
  // every page below it loses its place in the hierarchy.
  const files = new Map();
  for (const url of pages.keys()) {
    const parent = parentOf(url);
    if (parent && isFile(url) && !pages.has(parent)) {
      files.set(parent, [...(files.get(parent) ?? []), url]);
    }
  }
  const landingOf = new Map(
    [...files]
      .filter(([, urls]) => urls.length === 1)
      .map(([dir, urls]) => [dir, urls[0]]),
  );

  const baseOf = (url) => {
    let parent = parentOf(url);
    if (!parent) {
      return prefixOf(hostOf(url));
    }
    if (!pages.has(parent) && landingOf.get(parent) !== url) {
      parent = landingOf.get(parent) ?? parent;
    }
    const known = routes.get(parent);
    if (known !== undefined) {
      return known;
    }
    const label = labels.get(parent)?.text;
    return [baseOf(parent), label && slugify(label)].filter(Boolean).join('/');
  };

  const order = [...pages.keys()].sort(
    (a, b) => depth(a) - depth(b) || Number(isFile(b)) - Number(isFile(a)),
  );
  for (const url of order) {
    const page = pages.get(url);
    page.title = page.$('#content h1').first().text().trim();
    const base = baseOf(url);
    const seg = segments(url).at(-1);
    const label = labels.get(url)?.text;
    // Unlabelled Stacks filler ("styled-17", "page26") carries no meaning, so
    // fall back to the page's own heading.
    const slug = seg
      ? slugify(
          label ||
            (/^(page|styled)[-_]?\d*$/i.test(seg) ? page.title || seg : seg),
        )
      : '';
    // A leaf .html file often repeats its parent's label; don't say it twice.
    const parts =
      !slug || base.endsWith(`/${slug}`) || base === slug
        ? [base]
        : [base, slug];
    const candidate = parts.filter(Boolean).join('/');
    let route = candidate;
    // Two pages can share a label. Never let one silently overwrite the other.
    for (let n = 2; taken.has(route); n++) {
      route = `${candidate}-${n}`;
    }
    taken.add(route);
    routes.set(url, route);
  }

  /** Uncrawled plays still resolve — to the play's landing page, not a 404. */
  const uncrawled = new Set();
  const routeFor = (url) => {
    if (routes.has(url)) {
      return `/${routes.get(url)}`;
    }
    const prefix = prefixOf(hostOf(url));
    if (prefix === null) {
      return null;
    }
    uncrawled.add(hostOf(url));
    return `/${prefix}`;
  };

  const report = {
    scrapedAt: new Date().toISOString().slice(0, 10),
    hosts,
    pages: pages.size,
    written: 0,
    images: 0,
    navBlocksDropped: 0,
    creditBlocksDropped: 0,
    untitled: [],
    unresolvedLinks: [],
    imagesWithoutAlt: 0,
    failures,
  };

  await rm(OUT, { recursive: true, force: true });

  for (const [url, page] of pages) {
    const route = routes.get(url);
    const dir = join(OUT, route);
    const $ = page.$;
    const pending = [];

    const links = (href) => {
      const target = normalise(href, url);
      if (!target) {
        return href.startsWith('mailto:') || href.startsWith('tel:')
          ? href
          : null;
      }
      if (!isInternal(target)) {
        return target;
      }
      const to = routeFor(target);
      if (!to) {
        report.unresolvedLinks.push({ from: url, to: target });
      }
      return to || target;
    };
    links.image = (src) => {
      // The original publishes a handful of `src="(null)"` images. Drop them.
      if (!src || src.includes('(null)')) {
        return '';
      }
      const abs = normalise(src, url);
      if (!abs) {
        return src;
      }
      const name = abs.split('/').pop();
      if (!pending.some((p) => p.abs === abs)) {
        pending.push({ abs, name });
      }
      return `./_images/${name}`;
    };

    const content = clean($);
    const raw = blocksOf($, content, links);
    const isPlayIndex = /^plays\/[^/]+$/.test(route);
    const {
      blocks: navless,
      dropped,
      credits,
    } = dropNavBlocks(raw, page.title);
    report.navBlocksDropped += dropped;
    report.creditBlocksDropped += credits;

    // The play landing page and its "In Brief" twin are label:value data sheets.
    const wantsFacts = isPlayIndex || /\/in-brief$/.test(route);
    const { facts, blocks } = wantsFacts
      ? extractFacts(navless)
      : { facts: {}, blocks: navless };

    // "Absurd Person Singular: History" → "History"; the play name is context,
    // supplied by the route. Only strip a prefix we can positively identify.
    const playName = plays.get(subdomain(page.host))?.name;
    const title =
      page.title
        .replace(/\s*\(\d{4}\)\s*$/, '')
        .replace(
          new RegExp(
            `^(${[playName, 'Alan Ayckbourn'].filter(Boolean).map(escapeRe).join('|')}):\\s*`,
            'i',
          ),
          '',
        )
        .trim() ||
      labels.get(url)?.text ||
      'Untitled';
    if (!page.title.trim()) {
      report.untitled.push(url);
    }

    const play = route.startsWith('plays/') ? route.split('/')[1] : undefined;
    const year = page.title.match(/\((\d{4})\)/)?.[1];
    const poster = isPlayIndex
      ? blocks.find((b) => b.type === 'img')?.src
      : undefined;
    const body = render(
      poster ? blocks.filter((b) => b.src !== poster) : blocks,
    );

    for (const { abs, name } of pending) {
      try {
        const bytes = await fetchCached(abs, { binary: true });
        await mkdir(join(dir, '_images'), { recursive: true });
        await writeFile(join(dir, '_images', name), bytes);
        report.images++;
        report.imagesWithoutAlt++; // every original alt is "Stacks Image 1234"
      } catch (err) {
        failures.push({ url: abs, error: err.message });
      }
    }

    const frontmatter = {
      title,
      source: url,
      order: labels.get(url)?.order ?? 9999,
      ...(play ? { play } : {}),
      ...(year ? { year: Number(year) } : {}),
      ...(poster ? { poster } : {}),
      ...(Object.keys(facts).length ? { facts } : {}),
    };

    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'index.md'), `${yaml(frontmatter)}\n${body}\n`);
    report.written++;
  }

  // Hosts linked to but not crawled: exactly the list PR 9's full run must cover.
  report.uncrawledHosts = [...uncrawled].sort();
  await mkdir(dirname(REPORT), { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    [
      `written:        ${report.written} pages`,
      `images:         ${report.images}`,
      `nav dropped:    ${report.navBlocksDropped} blocks`,
      `untitled:       ${report.untitled.length}`,
      `unresolved:     ${report.unresolvedLinks.length} links`,
      `uncrawled:      ${report.uncrawledHosts.length} linked hosts`,
      `failures:       ${failures.length}`,
      `report:         scraped/report.json`,
    ].join('\n'),
  );
}

/* ponytail: hand-rolled YAML — frontmatter is flat strings/numbers only. */
function yaml(obj, indent = '') {
  const scalar = (v) =>
    typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '\\"')}"`;
  const lines = Object.entries(obj).map(([k, v]) =>
    v && typeof v === 'object'
      ? `${indent}${k}:\n${yaml(v, `${indent}  `)}`
      : `${indent}${k}: ${scalar(v)}`,
  );
  return indent ? lines.join('\n') : `---\n${lines.join('\n')}\n---\n`;
}

if (process.argv[1].endsWith('scrape.mjs')) {
  await main();
}

export {
  blocksOf,
  clean,
  extractFacts,
  render,
  segments,
  slugify,
  splitParagraphs,
};
