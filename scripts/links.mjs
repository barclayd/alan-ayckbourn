/**
 * Link integrity over the built site: every internal href and src has to
 * resolve to a file in `dist`. The plan's release gate is "zero broken internal
 * links across all pages", and with 2,400 pages of scraped links rewritten by
 * hand-written rules, that is not a claim to make by eye.
 *
 * ponytail: regex over the HTML, not a parser. We wrote every one of these
 * attributes ourselves from Astro templates, so there is no hostile markup to
 * be clever about — and it runs over the whole site in under a second. The
 * script is its own check: it exits 1 with the offending pages listed.
 *
 * Usage: node scripts/links.mjs [dist]
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist');

const walk = async (dir) => {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...(await walk(path)));
    } else if (entry.name.endsWith('.html')) {
      found.push(path);
    }
  }
  return found;
};

const exists = async (path) =>
  await stat(path).then(
    (s) => s.isFile(),
    () => false,
  );

/** A URL is served if the file is there, or `.html`, or an `index.html` under it. */
const resolves = async (pathname) => {
  const path = join(DIST, decodeURIComponent(pathname));
  return (
    (await exists(path)) ||
    (await exists(`${path}.html`)) ||
    (await exists(join(path, 'index.html')))
  );
};

const pages = await walk(DIST);
const targets = new Map(); // pathname -> pages linking to it

for (const page of pages) {
  const html = await readFile(page, 'utf8');
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    /* Internal only: anything with a scheme, a protocol-relative host, a bare
       fragment or a mailto is somebody else's to keep alive. */
    if (!url.startsWith('/') || url.startsWith('//')) {
      continue;
    }
    const pathname = url.split(/[?#]/)[0];
    if (pathname === '/') {
      continue;
    }
    const from = targets.get(pathname) ?? [];
    from.push(page.slice(DIST.length + 1));
    targets.set(pathname, from);
  }
}

const broken = [];
for (const [pathname, from] of targets) {
  if (!(await resolves(pathname))) {
    broken.push([pathname, from]);
  }
}

console.log(
  `${pages.length} pages, ${targets.size} distinct internal targets, ${broken.length} broken.`,
);

if (broken.length) {
  /* Sorted by blast radius: the link on a thousand pages is the one to fix. */
  for (const [pathname, from] of broken.sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`\n  ${pathname}  (${from.length} pages)`);
    for (const page of from.slice(0, 5)) {
      console.log(`    from ${page}`);
    }
  }
  process.exit(1);
}
