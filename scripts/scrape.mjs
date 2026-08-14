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
/* Where the archive's downloadable documents land. Static assets, not an image
   collection: they are served as they are, never resized. */
const FILES = join(ROOT, 'public/resources');
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

// Sites the plays index never lists, reached only by following links from
// inside the archive. `advocates` alone is 83 pages of advocacy writing.
const EXTRA_SITES = {
  advocates: 'career/advocates',
  recordings: 'career/recordings',
  artisticdirector: 'career/artistic-director',
};

/*
 * Two hosts, one site, path for path: `interviews` is the research section under
 * an earlier name, and the seven deadly virtues answers on both its spelt and
 * its numeric host. Folded at the door, so the crawl fetches one copy, every
 * link resolves to it, and neither turns up as a second research section under
 * `career/` nor as a phantom second entry on the plays index.
 *
 * Not aliased: the hosts several plays genuinely share — the Norman Conquests
 * trilogy, Jeeves and By Jeeves, the two Farcicals one-acts. Those pages repeat
 * because two plays really are one site, and each play still needs its own
 * place on the index.
 */
const HOST_ALIASES = {
  interviews: 'research',
  sevendeadlyvirtues: 'the7deadlyvirtues',
};

/*
 * Three pages whose <h1> names a section of the nav bar instead of the page. Two
 * are subdomain roots the archive only ever links from the nav, so the heading
 * they carry is the nav's: 83 essays about Ayckbourn's advocates sit under "Life
 * & Career", the recordings and adaptations under "Encyclopaedia, Research &
 * Other Media". The third is an at-a-glance summary of the careers with their
 * dates, headed "Careers & Timeline" — which is also the name of the section
 * front it sits inside, so untouched it lists itself as one of its own children.
 *
 * A heading correction, not a content one: each replacement is a phrase the
 * archive uses for that page's own subject elsewhere on the site.
 */
const TITLE_FIXES = {
  'http://advocates.alanayckbourn.net/': 'Advocates',
  'http://recordings.alanayckbourn.net/':
    'Recordings & Adaptations in Other Media',
  'http://careers.alanayckbourn.net/styled-16/': 'Careers at a Glance',
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
  /* Some subdomains 301 off the archive — `thesjt` to the theatre's real site,
     `thewomaninblack` to the production's. Those are signposts, not content:
     following one would file a stranger's homepage as an archive page. */
  if (!binary && !new URL(res.url).hostname.endsWith(DOMAIN)) {
    throw new Error(`off-domain redirect: ${res.url}`);
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

/**
 * A URL's last segment as a name we can put on disk: percent-decoded, then
 * slugified without eating the extension. Names arrive off a URL, so they
 * arrive encoded — `%C2%A9` for the © in "APS_700-©-Haydonning-Ltd.jpg" — and
 * Markdown decodes a path before resolving it, so the encoded name on disk and
 * the decoded name Astro hunts for disagree and the build dies over a file
 * sitting right there. One spelling in both places.
 */
const fileName = (url) => {
  const raw = decodeURIComponent(url.split('/').pop() ?? '');
  const dot = raw.lastIndexOf('.');
  const ext = dot > 0 ? raw.slice(dot).toLowerCase() : '';
  return `${slugify(dot > 0 ? raw.slice(0, dot) : raw)}${ext}`;
};

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
  const alias = HOST_ALIASES[subdomain(u.hostname)];
  if (alias) {
    u.hostname = `${alias}.${DOMAIN}`;
  }
  if (!u.pathname.includes('.') && !u.pathname.endsWith('/')) {
    u.pathname += '/';
  }
  return u.toString();
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hostOf = (url) => new URL(url).hostname;
const subdomain = (host) => host.replace(`.${DOMAIN}`, '');
const isInternal = (url) => hostOf(url).endsWith(DOMAIN);

/** The old PHP mailer's four wrappers: general, copyright, memories, one spare. */
const CONTACT_FORM = /(^|\/)contact-form(-\d+)?\//;

/**
 * Files worth mirroring, named by extension rather than by "not a page": the
 * archive's `Contacts.php` is also not a page, and matching by exclusion filed
 * the mail handler as a downloadable document 110 times over.
 */
const DOCUMENT = /\.(pdf|docx?|rtf|zip)$/i;

/**
 * A page, as opposed to a file the archive happens to host. The interview
 * section publishes six of its transcripts as PDFs, and crawling those produced
 * six entries with a title and no body whatsoever — a dead end with our chrome
 * around it. `.php` is the old mail handler, which was never a page either, and
 * neither is the `contact-form/` directory wrapped around it: crawled, it yields
 * a page of field labels with no fields — "Your Name: *", "Spam Protection:
 * Please don't fill this in" — four times over. Anything without an extension is
 * a directory, which is how most of the site is published.
 */
const isPage = (url) => {
  const u = new URL(url);
  if (CONTACT_FORM.test(u.pathname)) {
    return false;
  }
  const last = u.pathname.split('/').pop() ?? '';
  return !last.includes('.') || /\.(html?|shtml)$/i.test(last);
};

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

/**
 * The two ways this site draws a row of columns, as [row, column] selectors.
 * Stacks was upgraded partway through the archive's life and the older pages
 * kept the older markup, so the same table appears under either.
 */
const COLUMN_STACKS = [
  ['div.s3_row', '.s3_column'],
  ['div.columns_stack', '.stacks_div'],
];

const BULLETED = /^[○◦•]/;

/** "Broadcast: 1977" — a label and its value, already a whole row. */
const SHEET_LINE = /^[○◦•\s]*[A-Z][A-Za-z'’ ]{1,28}:\s+\S/;

/*
 * A stop that closes a run and is followed by a capital: one sentence ending and
 * the next beginning, or the number heading a list item. Either way the column is
 * running prose or a numbered list rather than a row of cells — the Backnumbers
 * and Second Helping song lists are twenty titles set in two columns to save
 * paper, and zipping them printed "1. Open for Love" against "11. Jubilee Road".
 *
 * The character before the stop has to be one that ends a run, or the initials in
 * the 1956 Macbeth programme ("A. LeQ. Herbert") read as three sentences and the
 * whole cast list stops looking like a table.
 */
const PROSE = /[a-z0-9)'"’”][.!?][)'"’”]?\s+[A-Z(‘“'"]/;

/**
 * A column's `<br>`-separated lines, each flagged if all of its text is bold.
 * Read before clean() rewrites them, so bold is still a style on a <span>.
 *
 * A <dl> is a table this pass has already zipped, and counts as one line per
 * row: that is what lets a three-column table pair its outer column against
 * the two inner ones.
 */
function brLines($, column, { blanks = false } = {}) {
  const lines = [{ text: '', bold: true }];
  const walk = (node, bold) => {
    for (const n of $(node).contents().toArray()) {
      if (n.type === 'text') {
        lines.at(-1).text += n.data;
        if (n.data.trim()) {
          lines.at(-1).bold &&= bold;
        }
      } else if (n.type === 'tag' && n.tagName === 'br') {
        lines.push({ text: '', bold: true });
      } else if (n.type === 'tag' && /^h[1-6]$/.test(n.tagName)) {
        /* A column heading is a block and a line of its own — the same boundary
           `inlineNode` writes, so the rows counted here are the rows zipped. */
        walk(n, true);
        lines.push({ text: '', bold: true });
      } else if (n.type === 'tag' && n.tagName === 'dl') {
        /* One line per row, carrying the label column's text so an enclosing
           test still sees a header where the table had one. Counted the same way
           the table itself was, or the four-column tables come out as two
           two-column ones: the halves disagree on how many rows they have. */
        const nested = { blanks: $(n).attr('data-padded') !== undefined };
        const [labels, values] = ['dt', 'dd'].map((part) =>
          brLines($, $(n).children(part).get(0), nested),
        );
        const rows = Math.max(labels.length, values.length);
        for (let i = 0; i < rows; i++) {
          if (labels[i]) {
            lines.at(-1).text += labels[i].text;
            lines.at(-1).bold &&= labels[i].bold;
          }
          if (i < rows - 1) {
            lines.push({ text: '', bold: true });
          }
        }
      } else if (n.type === 'tag') {
        walk(
          n,
          bold ||
            n.tagName === 'strong' ||
            n.tagName === 'b' ||
            /font-weight:\s*bold/i.test($(n).attr('style') || ''),
        );
      }
    }
  };
  walk(column, false);
  const all = lines.map(({ text, bold }) => ({
    text: text.replace(/\s+/g, ' ').trim(),
    bold,
  }));
  /* A blank line between two entries is alignment; one at either end is just
     where the column's markup started and stopped, and counting those makes two
     columns of the same table disagree on their length by one. */
  return blanks
    ? trimBlanks(all, (line) => line.text)
    : all.filter((l) => l.text);
}

/** Drops the empty entries at both ends of a list, keeping the interior ones. */
function trimBlanks(list, textOf) {
  let start = 0;
  let end = list.length;
  while (start < end && !textOf(list[start])) {
    start++;
  }
  while (end > start && !textOf(list[end - 1])) {
    end--;
  }
  return list.slice(start, end);
}

/**
 * Does this element's text already end at a line break? Read down the last
 * child, since the break a previous pass added sits inside the wrapper, not
 * beside it — and a second break would read as a paragraph split.
 */
function endsWithBreak($, el) {
  const last = $(el)
    .contents()
    .toArray()
    .filter((n) => n.type !== 'text' || n.data.trim())
    .at(-1);
  if (!last) {
    return false;
  }
  if (last.type === 'tag' && last.tagName === 'br') {
    return true;
  }
  return last.type === 'tag' && endsWithBreak($, last);
}

function clean($) {
  const content = $('#content');
  content
    .find('script, style, noscript, .contentSpacer, .clear, .clearer')
    .remove();
  content.find(NAV_STACKS).remove();

  /*
   * A div is a block, so the flattening at the end of this function has to leave
   * a line break behind or the text either side of the boundary runs together:
   * "Not available" followed by a "Director" stack came out as
   * "Not available**Director**" on 466 pages.
   *
   * It happens here, before the column pairing below, so that the pairing counts
   * the same lines `zipRows` will later split on. Marking the boundaries and
   * unwrapping the wrappers are two passes over the same divs for that reason:
   * pairing needs the wrappers still standing to find the columns.
   */
  for (const el of content.find('div').toArray().reverse()) {
    const $el = $(el);
    const hasNext = $el
      .nextAll()
      .toArray()
      .some((n) => $(n).text().trim());
    if (hasNext && $el.text().trim() && !endsWithBreak($, el)) {
      $el.append('<br>');
    }
  }

  /*
   * Stacks' "two columns" is a layout stack, so flattening it prints the left
   * column and then the right — right for a sidebar, wrong for a table. Two of
   * these rows are tables drawn as columns: one whose left column is nothing
   * but labels ("Play:", "○ 1956:"), and one whose columns are equal-length
   * lists under a bold heading each ("Character" / "Actor"). 187 rows across
   * the career section, where flattening printed all seven labels and then all
   * seven values, and paired no character with an actor.
   *
   * Retagged, not rewritten, so the rest of clean() still runs over the
   * contents. `blocksOf` zips the columns back into rows.
   */
  /* Innermost rows first, then out: a credit page nests its data sheet and its
     cast list inside one outer row, and the cast-size table is three columns
     built as two rows deep. An outer pairing can only be counted once the
     inner table is a column of rows, and retagging takes a row out of the
     `div.s3_row` set it is chosen from. */
  for (let paired = true; paired; ) {
    paired = false;
    for (const [rowSel, colSel] of COLUMN_STACKS) {
      for (const row of content.find(rowSel).toArray()) {
        if ($(row).find(rowSel).length) {
          continue;
        }
        const cols = $(row).children(colSel).toArray();
        if (cols.length !== 2) {
          continue;
        }
        let [left, right] = cols.map((col) => brLines($, col));
        /*
         * The three "Plays Directed" tables align on their blank lines: the Play
         * column carries a bold year above each group and the other three
         * columns hold an empty line beside it, so the rows only match once the
         * blanks are counted. 83 rows a column there, against 71 / 56 / 53 / 53
         * with the blanks dropped — which is why they came out as four
         * disconnected lists.
         */
        const blanks = cols.map((col) => brLines($, col, { blanks: true }));
        /* Preferred over the blank-free reading whenever it holds, because the
           blank lines are the alignment the archivist typed: two of these tables
           pair correctly either way, and only the padded reading also lines them
           up with the other half of the same four-column table. */
        const padded = blanks[0].length === blanks[1].length;
        if (padded) {
          [left, right] = blanks;
        }
        if (left.length < 3 || left.length !== right.length) {
          continue;
        }
        const labelled = left.every((line) => line.text.endsWith(':'));
        const headed =
          left[0].bold &&
          right[0].bold &&
          ![...left.slice(1), ...right.slice(1)].some((line) => line.bold);
        /* Neither, and still a table: the credit sheets run "Director" against
           its name, then "Character"/"Actor" heading a cast list, so the bold
           falls in both columns at once and no single line is a header. Equal
           line counts is the signal left, and it is a strong one — two columns
           of unrelated prose match length by accident, so require every cell to
           be short enough to be a cell. */
        const tabular = [...left, ...right].every(
          (line) => line.text.length <= 80,
        );
        /* A cell carrying one sentence after another is a paragraph, and a row of
           paragraphs is a page layout: the chronology pages set "Notable Events"
           beside "World Premieres", which reads as headed and balances, and
           zipping them printed each year's events interleaved with its premieres.
           Weighed by the column rather than by the cell, because a real table
           does carry the odd sentence: one note in the 83-row directing tables
           would otherwise disqualify all 83. Only the labelled sheets are exempt
           — there a prose value is the point, and the label column says so. */
        const prose = [left, right].some(
          (col) =>
            col.filter((line) => PROSE.test(line.text)).length * 2 > col.length,
        );
        /* A column of finished "Label: value" lines is a data sheet, not half a
           table. One sits beside the cast list on every play's media page, and
           pairing the two prints the sheet and the cast interleaved. */
        const sheet = [left, right].some(
          (col) =>
            col.filter((line) => SHEET_LINE.test(line.text)).length * 2 >
            col.length,
        );
        /* Two columns of the same bulleted list is a long list set in two
           columns to save paper, not a table of pairs. */
        const parallel = [left, right].every((col) =>
          col.every((line) => BULLETED.test(line.text)),
        );
        const table = labelled || (!prose && (headed || tabular));
        if (!table || sheet || parallel) {
          continue;
        }
        row.tagName = 'dl';
        cols[0].tagName = 'dt';
        cols[1].tagName = 'dd';
        if (padded) {
          $(row).attr('data-padded', '');
        }
        paired = true;
      }
    }
  }

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
const LINE_BREAK = /((?:<br>\s*)+)/;

/**
 * Emphasis markers must hug their text (`*foo *bar` is not italic) and must not
 * straddle a line or paragraph break, or the markers end up unbalanced.
 *
 * A break of either length ends the run: Stacks writes a whole bold list as one
 * span, and `**a<br>b**` puts an opening marker on one line and its closing
 * marker on the next, which is nineteen years of the careers timeline in a
 * single unclosed bold run.
 */
function emphasise(inner, marker) {
  if (LINE_BREAK.test(inner)) {
    return inner
      .split(LINE_BREAK)
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

/**
 * The rows of a table clean() found drawn as two columns, one markdown line
 * each: `**label** value`, which is how the archive writes a data sheet when it
 * does not reach for columns — and reads down a phone, which two columns of
 * names never did.
 */
function zipRows($, node, links) {
  /* A table whose columns line up on their blank lines, not on their content:
     see the `padded` branch in clean(). Dropping the blanks there would shift
     every row after the first gap. */
  const padded = $(node).attr('data-padded') !== undefined;
  const [labels, values] = ['dt', 'dd'].map((part) => {
    const lines = inlineMd($, $(node).children(part).get(0), links)
      .split('<br>')
      .map((line) => line.trim());
    return padded ? trimBlanks(lines, (line) => line) : lines.filter(Boolean);
  });
  /* clean() counted the rows in the DOM and a cell can still empty between
     there and here — an image that resolves to nothing, a link whose text was
     only whitespace. Walk the longer column so no cell is dropped. */
  return Array.from(
    { length: Math.max(labels.length, values.length) },
    (_, i) => {
      const label = labels[i];
      /* Already bold, or already a zipped row of its own from a table nested in
         this cell — either way it does not want another pair of asterisks. */
      const bold = !label || label.includes('**') ? label : `**${label}**`;
      return [bold, values[i]].filter(Boolean).join(' ');
    },
  );
}

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
    /* A table nested inside another table's cell: its rows become the cell's
       lines, so the column enclosing it pairs against them one for one. */
    case 'dl':
      return zipRows($, n, links).join('<br>');
    case 'em':
    case 'i':
      return emphasise(inlineMd($, n, links), '*');
    case 'strong':
    case 'b':
      return emphasise(inlineMd($, n, links), '**');
    /* A heading inside a table cell heads the column: the recordings tables put
       an <h2>Title</h2> above the list rather than a bold first line. It is a
       block, so it ends a line — otherwise it merges into the first entry and
       the whole column pairs one row short. */
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return `${emphasise(inlineMd($, n, links), '**')}<br>`;
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
    } else if (tag === 'dl') {
      flush();
      blocks.push({
        type: 'p',
        sheet: true,
        /* A padded table's blank rows hold its columns in step and are dropped
           only here, at the end: the row above already names the group they
           separate, and a nested table still needs them to align. */
        text: zipRows($, node, links).filter(Boolean).join('  \n'),
      });
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

/**
 * A paragraph that is almost entirely links is the old sibling-nav, not prose —
 * unless it is a zipped data sheet, where every value being a link to the play
 * or the venue it names is the sheet doing its job.
 */
const isNavBlock = (block) =>
  block.type === 'p' &&
  !block.sheet &&
  (block.text.match(/\]\(/g) || []).length >= 2 &&
  linkText(block) / Math.max(block.text.replace(/\([^)]*\)/g, '').length, 1) >
    0.6;

/**
 * The Simon Murgatroyd research credit and the Haydonning copyright notice are
 * repeated verbatim on every one of the ~3,640 pages. They belong in the
 * footer, once, prominently — not inline 3,640 times.
 */
/* Haydonning is also Ayckbourn's own production company, so the bare name is a
   value in the "Company" column of the recordings tables. Only the notice is
   boilerplate, and every one of the 2,400 pairs the name with a © or a
   "copyright of". */
const BOILERPLATE =
  /All research and original material|(?:©|\(c\)|copyright(?::| of)?)\s*Haydonning Ltd|do not reproduce (any material|in any form)/i;

/*
 * Directions to chrome that no longer exists: "To navigate, use the links in
 * the bar above or in the right hand column" opens 175 pages, and neither the
 * bar nor the column survives the redesign. Matched only as a whole paragraph —
 * the same sentence sometimes trails a real copyright note ("All articles are
 * copyright of the respective author and can be accessed through the links in
 * the right-hand column"), and that has to stay.
 */
const OLD_CHROME =
  /^(to navigate|click on the links|for [^.]{0,60}click on the links)[^.]*\b(bar above|links above|right[- ]hand[- ]?column|column below|at the right|to the right)\b[^.]*\.$/i;

const plain = (s) => s.replace(/[\\*]/g, '').replace(/\s+/g, ' ').trim();

/**
 * A heading, or a paragraph that is nothing but a bold run — the pull-out boxes
 * title themselves either way. Neither counts as the box's content, so a box
 * left holding only these once its navigation is stripped is an empty box.
 */
const isLabel = (block) =>
  block.type === 'h' ||
  (block.type === 'p' && /^\*\*[^*]+\*\*$/.test(block.text.trim()));

/**
 * A label that labels nothing. The original site titled its navigation lists
 * ("Biographies & Chronology", then the links), so stripping the lists leaves
 * 321 headings standing over empty space across 300 pages. Every drop above
 * could pop its own heading instead, but there are four ways a block leaves and
 * a heading can label several of them — one pass over the survivors catches all
 * of it.
 *
 * A label is kept if anything other than a label appears before the next label
 * of its rank or above, so `## Act 1` / `### Characters` / prose keeps both: the
 * h2's span contains the h3's prose.
 *
 * `counts` widens what a label is. Headings always; pass `isLabel` after the
 * data sheet has been lifted into frontmatter, where a bold run can be orphaned
 * the same way — `**Availability**` on a play landing titled the two lines that
 * are now facts, and stood alone as the page's entire body.
 */
function dropEmptyLabels(blocks, counts = (b) => b.type === 'h') {
  /* A bold run titles only what directly follows it — it never spans a heading
     the way an h2 spans an h3 — so it ranks below every heading level. */
  const rank = (block) => (block.type === 'h' ? block.level : 7);
  return blocks.filter((block, i) => {
    if (!counts(block)) {
      return true;
    }
    for (const next of blocks.slice(i + 1)) {
      if (!counts(next)) {
        return true;
      }
      if (rank(next) <= rank(block)) {
        return false;
      }
    }
    return false;
  });
}

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
    if (
      block.type === 'p' &&
      (BOILERPLATE.test(block.text) ||
        OLD_CHROME.test(plain(block.text).trim()))
    ) {
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
      if (!inner.blocks.some((b) => !isLabel(b))) {
        dropped++;
        continue;
      }
      kept.push({ ...block, blocks: inner.blocks });
      continue;
    }
    kept.push(block);
  }
  const headed = dropEmptyLabels(kept);
  return {
    blocks: headed,
    dropped: dropped + kept.length - headed.length,
    credits,
  };
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
      if (/^Venue$/i.test(key) && /Premiere$/i.test(previous)) {
        key = `${previous} ${key}`.trim();
      }
      /*
       * A key still taken at this point is a second data sheet on the same page:
       * By Jeeves carries one for the 1975 `Jeeves` and one for its 1996
       * rewrite, so `Play Number` genuinely appears twice. Qualifying it with
       * whatever label came before invented facts that read as bugs on the
       * finished data sheet — `Venue Play Number: 18`, `Play Number Published:
       * No`. The line stays in the prose instead, under the heading the archive
       * filed it beneath, which is the only place it means anything.
       */
      if (key in facts) {
        rest.push(line);
        previous = m[1].trim();
        continue;
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
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => normalise(m[1].trim(), `http://${host}/`))
    .filter((u) => u && hostOf(u) === host && isPage(u));
}

/**
 * Walk a host by following its own links, breadth-first from `/`.
 *
 * Needed because these sitemaps cannot be trusted: each was published by
 * RapidWeaver with whatever base URL the project happened to hold, so
 * `plays.` lists `www.` pages, the writing companions list a .com that no
 * longer exists, and a dozen hosts serve no sitemap at all. Where the sitemap
 * yields nothing for the host itself, its own navigation still does.
 */
async function crawlFrom(host, { max = 400 } = {}) {
  const root = `http://${host}/`;
  const seen = new Set([root]);
  const queue = [root];

  while (queue.length && seen.size < max) {
    const url = queue.shift();
    let $;
    try {
      $ = load(await fetchCached(url));
    } catch {
      continue; // A dead link inside the site is not a reason to abandon it.
    }
    for (const el of $('#content a, #navcontainer a').toArray()) {
      const target = normalise($(el).attr('href') || '', url);
      if (
        !target ||
        hostOf(target) !== host ||
        !isPage(target) ||
        seen.has(target)
      ) {
        continue;
      }
      seen.add(target);
      queue.push(target);
    }
  }
  return [...seen];
}

/** Sitemap where it is usable, the host's own links where it is not. */
async function discoverUrls(host) {
  const fromSitemap = await sitemap(host).catch(() => []);
  return fromSitemap.length ? fromSitemap : crawlFrom(host);
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

  const crawlAll = args.includes('--all');
  const requested = flag('sites')?.split(',').filter(Boolean);
  const hosts = requested
    ? requested.map((s) => `${s}.${DOMAIN}`)
    : [
        // The root site: What's On, news, press, FAQs, the copyright notice.
        `www.${DOMAIN}`,
        ...Object.keys(SECTION_SITES)
          .filter((s) => crawlAll || s === 'biography' || s === 'careers')
          .map((s) => `${s}.${DOMAIN}`),
        ...(crawlAll ? [...plays.keys()] : SAMPLE_PLAYS).map(
          (s) => `${s}.${DOMAIN}`,
        ),
      ];

  /** Subdomain → link text that first pointed at it, for hosts no index lists. */
  const discovered = new Map();

  /** Route prefixes already claimed, so an alias host cannot overwrite a real one. */
  const claimed = new Map();

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
    if (sub in EXTRA_SITES) {
      return EXTRA_SITES[sub];
    }
    if (plays.has(sub)) {
      return `plays/${plays.get(sub).slug}`;
    }
    const companion = sub.replace(/^writing/, '');
    if (sub.startsWith('writing') && plays.has(companion)) {
      return `plays/${plays.get(companion).slug}/writing`;
    }
    /*
     * A host found only by following a link. Everything reached this way has
     * turned out to be a play or a production the archive treats as one, so it
     * files under `plays/`, slugged from the link text that introduced it —
     * "Round And Round The Garden", not "roundandroundthegarden".
     */
    const label = discovered.get(sub);
    if (label) {
      return `plays/${slugify(label)}`;
    }
    return null;
  };

  // Pass 1: fetch every page, collect anchor text per URL so slugs come from
  // labels ("History") rather than the meaningless URLs ("styled/page-10/").
  const pages = new Map();
  const labels = new Map();
  const failures = [];

  /*
   * The plays index lists the plays and nothing else, but the archive links
   * sideways constantly — the three Norman Conquests parts, `byjeeves`, the
   * `advocates` essays (83 pages of them) all live on their own subdomains that
   * no index page names. So the host list is a queue, not a list: any
   * same-domain host found in a link joins it, and the crawl runs to closure.
   */
  const queue = [...hosts];
  const queued = new Set(queue);
  const crawled = [];

  for (const host of queue) {
    const prefix = prefixOf(host);
    if (prefix === null) {
      failures.push({ host, error: 'no route mapping' });
      continue;
    }
    /* Two hosts to one route means an alias (`the-girl-next-door` beside
       `thegirlnextdoor`). Writing both would have the second silently
       overwrite the first, so the first one to claim it wins. */
    if (claimed.has(prefix) && claimed.get(prefix) !== host) {
      failures.push({
        host,
        error: `route ${prefix || '/'} already taken by ${claimed.get(prefix)}`,
      });
      continue;
    }
    claimed.set(prefix, host);
    let urls;
    try {
      urls = await discoverUrls(host);
    } catch (err) {
      failures.push({ host, error: `discover: ${err.message}` });
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
          if (!target || !isInternal(target)) {
            return;
          }
          /* "Read more", "click here" — the label describes the act of following
             the link, not what is on the other end, so it cannot name anything. */
          const usable =
            text &&
            text.length <= 60 &&
            !/^(here|click|button|this|more|link)\b/i.test(text);

          // A link to a subdomain we have not visited is more of the archive.
          const linkedHost = hostOf(target);
          if (!queued.has(linkedHost) && crawlAll) {
            queued.add(linkedHost);
            queue.push(linkedHost);
            /* The host's whole route prefix is slugged from this, so a junk
               label filed a play's entire site under `plays/here`. */
            if (usable && !discovered.has(subdomain(linkedHost))) {
              discovered.set(subdomain(linkedHost), text);
            }
          }

          if (!usable) {
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
    crawled.push(host);
    process.stdout.write('✓\n');
  }
  console.log(`Fetched ${pages.size} pages from ${crawled.length} hosts`);

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
    /*
     * `/index.html` *is* the host root, not a page inside it. Left to the parent
     * walk below, the root directory looks like an ancestor we never crawled and
     * so gets a slug invented from a link label — which filed the whole of
     * RolePlay at `plays/roleplay/roleplay`, one level below the route that
     * twenty-two pages across the archive link to.
     */
    if (segments(url).length === 0) {
      return prefixOf(hostOf(url));
    }
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
    page.title =
      TITLE_FIXES[url] ?? page.$('#content h1').first().text().trim();
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
    /*
     * The collapse above assumed a repeated label meant a repeated page. A
     * taken route proves it wrong: this is a distinct page the archive linked
     * by its section's own name — an "Adaptations In Other Media" page whose
     * only link says "Confusions". Reach for its heading before a number,
     * because `-2` would file it as a sibling of the play (a phantom entry on
     * the plays index) rather than a page inside it.
     */
    if (taken.has(route) && page.title) {
      const byTitle = [base, slugify(page.title)].filter(Boolean).join('/');
      if (!taken.has(byTitle)) {
        route = byTitle;
      }
    }
    // Two pages can share a label. Never let one silently overwrite the other.
    for (let n = 2; taken.has(route); n++) {
      route = `${candidate}-${n}`;
    }
    taken.add(route);
    routes.set(url, route);
  }

  /** Uncrawled plays still resolve — to the play's landing page, not a 404. */
  const uncrawled = new Set();
  const written = new Set(routes.values());
  const routeFor = (url) => {
    if (routes.has(url)) {
      return `/${routes.get(url)}`;
    }
    /* Never crawled, by `isPage`. Our own contact page says where enquiries go
       now, which is nearer the mark than the section index the prefix fallback
       below would otherwise pick — "Contact Us" landing on the plays list. */
    if (CONTACT_FORM.test(new URL(url).pathname)) {
      return '/contact';
    }
    uncrawled.add(hostOf(url));
    const prefix = prefixOf(hostOf(url));
    /*
     * A host can have a route prefix and still have nothing at it: it 301s off
     * the archive, or every fetch failed. Falling back to the prefix regardless
     * aimed links at pages that were never written, and a link to a page we do
     * not have is better pointed at the original — which still answers — than
     * at our own 404. This is what `unresolvedLinks` in the report counts.
     */
    if (prefix === null || !written.has(prefix)) {
      return null;
    }
    return `/${prefix}`;
  };

  /* name → source URL for every downloadable document linked from anywhere in
     the archive. One map for the whole run: the research PDFs are linked from
     several pages each and only need fetching once. */
  const documents = new Map();

  const report = {
    scrapedAt: new Date().toISOString().slice(0, 10),
    hosts,
    pages: pages.size,
    written: 0,
    images: 0,
    files: 0,
    navBlocksDropped: 0,
    boilerplateBlocksDropped: 0,
    untitled: [],
    emptyPages: [],
    unresolvedLinks: [],
    imagesWithoutAlt: 0,
    failures,
  };

  /*
   * A full run owns the whole output directory and clears it, so a page the
   * archive has deleted does not linger. `--sites` crawls a handful of hosts
   * and must not: it would delete every page it was not asked to fetch, and
   * the only copy of a host that has since gone offline is the one on disk.
   */
  if (!requested) {
    await rm(OUT, { recursive: true, force: true });
  }

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
      /*
       * A file on the archive's own domain — the six research documents it
       * publishes as PDFs — is not a page and has no route. Mirrored into
       * `public/resources/` and served from here: the documents are part of the
       * content, and left pointing at the original they would be the one thing
       * on the site that stops working the day the old host goes away.
       */
      if (isInternal(target) && DOCUMENT.test(target)) {
        const name = fileName(target);
        documents.set(name, target);
        return `/resources/${name}`;
      }
      /* Anything else that is not a page keeps its absolute URL — except the old
         mailer, whose four wrappers `routeFor` sends to our contact page. */
      if (
        !isInternal(target) ||
        (!isPage(target) && !CONTACT_FORM.test(new URL(target).pathname))
      ) {
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
      const found = pending.find((p) => p.abs === abs);
      if (found) {
        return `./_images/${found.name}`;
      }
      const base = fileName(abs);
      const dot = base.lastIndexOf('.');
      let name = base;
      // Two unlike images can slug alike; the second must not silently win.
      for (let n = 2; pending.some((p) => p.name === name); n++) {
        name =
          dot > 0
            ? `${base.slice(0, dot)}-${n}${base.slice(dot)}`
            : `${base}-${n}`;
      }
      pending.push({ abs, name });
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
    report.boilerplateBlocksDropped += credits;

    // The play landing page and its "In Brief" twin are label:value data sheets.
    const wantsFacts = isPlayIndex || /\/in-brief$/.test(route);
    const { facts, blocks: extracted } = wantsFacts
      ? extractFacts(navless)
      : { facts: {}, blocks: navless };
    /* Lifting the data sheet out can orphan whatever labelled it — the
       `### By Jeeves` sheet is entirely facts, and `**Availability**` on a play
       landing titles two lines that are now frontmatter. Same rule, run again,
       counting bold runs this time because that is what the sheet used. */
    const blocks = wantsFacts ? dropEmptyLabels(extracted, isLabel) : extracted;

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

    /*
     * News, Blog and What's On were the site's dynamic pages — a title and a
     * feed that never reached the static HTML — so nothing survives the strip.
     * With no facts and no pages beneath them either, writing them would add
     * three routes that are a heading over nothing, and three dead ends in the
     * section list of every page above them. A play landing is empty in the
     * same way and stays: its data sheet moved to frontmatter and its scenes,
     * cast and reviews are all still below it.
     */
    const isSection = [...routes.values()].some((r) =>
      r.startsWith(`${route}/`),
    );
    if (!body.trim() && !Object.keys(facts).length && !isSection) {
      report.emptyPages.push(url);
      continue;
    }

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

  /* After the pages, because it is the pages' links that name them. */
  for (const [name, abs] of documents) {
    try {
      const bytes = await fetchCached(abs, { binary: true });
      await mkdir(FILES, { recursive: true });
      await writeFile(join(FILES, name), bytes);
      report.files++;
    } catch (err) {
      failures.push({ url: abs, error: err.message });
    }
  }

  /*
   * Two different gaps, and lumping them together hid both — the old list named
   * `www` and `plays` as uncrawled when they had just been read cover to cover.
   * `uncrawledHosts` is hosts never visited at all, the only real completeness
   * signal. `danglingHosts` were visited but still hold links that route
   * nowhere, which is ordinary: the archive links to pages it has since pulled.
   */
  const visited = new Set(crawled);
  report.uncrawledHosts = [...uncrawled].filter((h) => !visited.has(h)).sort();
  report.danglingHosts = [...uncrawled].filter((h) => visited.has(h)).sort();
  await mkdir(dirname(REPORT), { recursive: true });
  await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);

  console.log(
    [
      `written:        ${report.written} pages`,
      `images:         ${report.images}`,
      `files:          ${report.files} documents`,
      `nav dropped:    ${report.navBlocksDropped} blocks`,
      `untitled:       ${report.untitled.length}`,
      `unresolved:     ${report.unresolvedLinks.length} links`,
      `uncrawled:      ${report.uncrawledHosts.length} hosts never visited`,
      `dangling:       ${report.danglingHosts.length} hosts with dead links`,
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
  brLines,
  clean,
  dropEmptyLabels,
  extractFacts,
  isLabel,
  isPage,
  normalise,
  render,
  segments,
  slugify,
  splitParagraphs,
};
