import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { load } from 'cheerio';
import {
  blocksOf,
  clean,
  dropEmptyLabels,
  dropNavBlocks,
  extractFacts,
  hasCaption,
  isLabel,
  isPage,
  normalise,
  render,
} from './scrape.mjs';

/*
 * The two judgements in the scraper that decide whether content survives, and
 * neither is visible in the output when it goes wrong: a heading wrongly kept
 * looks like a design choice, and a page wrongly crawled looks like an empty
 * page. ponytail: no framework — `node --test` runs this file as it is.
 */

const h = (level) => ({ type: 'h', level, text: `h${level}` });
const p = { type: 'p', text: 'prose' };

test('a heading labelling nothing is dropped', () => {
  assert.deepEqual(dropEmptyLabels([h(2)]), []);
  assert.deepEqual(dropEmptyLabels([h(2), h(2), h(2)]), []);
});

test('a heading labelling content is kept', () => {
  assert.deepEqual(dropEmptyLabels([h(2), p]), [h(2), p]);
  // The h2's span holds the h3's prose, so both stand.
  assert.deepEqual(dropEmptyLabels([h(2), h(3), p]), [h(2), h(3), p]);
});

test('a heading is not rescued by content under the next section', () => {
  // `## Achievements` / `## Influences` / prose — the prose belongs to the
  // second heading, and the first still labels empty space.
  assert.deepEqual(dropEmptyLabels([h(2), h(2), p]), [h(2), p]);
});

test('a subheading does not rescue the deeper heading above it', () => {
  assert.deepEqual(dropEmptyLabels([h(3), h(2), p]), [h(2), p]);
});

const bold = { type: 'p', text: '**Availability**' };

test('a bold run is only a label when asked to be', () => {
  // In the default pass it is content, and it rescues the heading above it.
  assert.deepEqual(dropEmptyLabels([h(2), bold]), [h(2), bold]);
  // After the data sheet moves to frontmatter it labels nothing and goes too.
  assert.deepEqual(dropEmptyLabels([h(2), bold], isLabel), []);
});

test('a bold run labelling content is kept', () => {
  assert.deepEqual(dropEmptyLabels([bold, p], isLabel), [bold, p]);
  // It titles what directly follows, so it never spans the next heading.
  assert.deepEqual(dropEmptyLabels([bold, h(2), p], isLabel), [h(2), p]);
});

/** The data sheet as the archive writes it: bold label, value, two-space break. */
const sheet = (...lines) => [{ type: 'p', text: lines.join('  \n') }];

test('a bare Venue is qualified by the premiere above it', () => {
  const { facts } = extractFacts(
    sheet(
      '**World Premiere:** 30 May 1985',
      '**Venue:** Stephen Joseph Theatre',
      '**London Premiere:** 3 September 1986',
      '**Venue:** Vaudeville Theatre',
    ),
  );
  assert.deepEqual(facts, {
    'World Premiere': '30 May 1985',
    'World Premiere Venue': 'Stephen Joseph Theatre',
    'London Premiere': '3 September 1986',
    'London Premiere Venue': 'Vaudeville Theatre',
  });
});

test('a second data sheet does not invent qualified keys', () => {
  // By Jeeves: one sheet for the 1975 musical, one for the 1996 rewrite.
  const { facts, blocks } = extractFacts(
    sheet('**Play Number:** 18', '**Published:** No', '**Play Number:** 18'),
  );
  assert.deepEqual(facts, { 'Play Number': '18', Published: 'No' });
  // The duplicate stays in the prose rather than becoming `Published Play Number`.
  assert.equal(blocks.length, 1);
  assert.match(blocks[0].text, /^\*\*Play Number:\*\* 18$/);
});

test('a banner in the data sheet stays in the prose', () => {
  /* How The Other Half Loves files its Old Vic banner in the sheet. Lifted into
     frontmatter it printed its own source at the reader and the file it named
     was never fetched, because the image download matches against the body. */
  const banner =
    '[![The Old Vic, 29 July to 19 September 2026](./_images/banner.png)](http://www.oldvictheatre.com/stage/other-half/)';
  const { facts, blocks } = extractFacts(
    sheet('**Play Number:** 9', `**How the Other Half Loves:** ${banner}`),
  );
  assert.deepEqual(facts, { 'Play Number': '9' });
  assert.match(blocks[0].text, /How the Other Half Loves:\*\* \[!\[/);
});

test('a fact following a premiere is not swallowed by it', () => {
  const { facts } = extractFacts(
    sheet('**World Premiere:** 1975', '**Play Number:** 18'),
  );
  assert.deepEqual(facts, { 'World Premiere': '1975', 'Play Number': '18' });
});

test('a key that asks the question two ways is still a key', () => {
  /* The Grey Play sheets label one row `Published / Available to Stage`, and a key
     charset without the slash left that row alone in the prose on 24 pages. */
  const { facts, blocks } = extractFacts(
    sheet(
      '**Play Description:** Grey Play',
      '**Published / Available to Stage:** No',
    ),
  );
  assert.deepEqual(facts, {
    'Play Description': 'Grey Play',
    'Published / Available to Stage': 'No',
  });
  assert.deepEqual(blocks, []);
});

test('pages and files are told apart', () => {
  for (const url of [
    'http://plays.alanayckbourn.net/',
    'http://careers.alanayckbourn.net/page-80/iframe/page191.html',
    'http://x.alanayckbourn.net/styled/BBC.htm',
  ]) {
    assert.equal(isPage(url), true, url);
  }
  for (const url of [
    'http://interviews.alanayckbourn.net/resources/Playwriting.pdf',
    'http://www.alanayckbourn.net/contact/form.php',
    'http://x.alanayckbourn.net/files/poster.jpg',
  ]) {
    assert.equal(isPage(url), false, url);
  }
});

/*
 * Stacks drew its tables as two layout columns, so flattening them printed
 * every label and then every value: seven labels and then seven values on each
 * of the career credit pages, and a cast list that paired no character with an
 * actor. The pairing is a judgement too — get it wrong and the site states,
 * confidently and in its own voice, that someone played the wrong part.
 */
const column = (...lines) => `
  <div class="s3_column"><div class="text_stack">
    ${lines.join('<br>')}
  </div></div>`;

const rowHtml = (left, right) =>
  `<div class="com_yourhead_stacks_two_columns_stack">
    <div class="s3_row">${left}${right}</div>
  </div>`;

const row = (left, right) => markdown(rowHtml(left, right));

/** A table drawn inside one column of another: the third and fourth columns. */
const nest = (left, right) =>
  `<div class="s3_column">${rowHtml(left, right)}</div>`;

function markdown(html) {
  const $ = load(`<div id="content">${html}</div>`);
  const links = (href) => href;
  links.image = (src) => src;
  return render(blocksOf($, clean($), links));
}

const b = (text) => `<span style="font-weight:bold; ">${text}</span>`;

test('a label column is paired with its values', () => {
  assert.equal(
    row(
      column(b('Play:'), b('Venue:'), b('Staging:')),
      column('Dad&rsquo;s Tale', 'The Library Theatre', 'Round'),
    ),
    '**Play:** Dad’s Tale  \n' +
      '**Venue:** The Library Theatre  \n' +
      '**Staging:** Round',
  );
});

test('two lists under a heading each are paired row by row', () => {
  assert.equal(
    row(
      column(b('Character'), 'Angel', 'Abraham'),
      column(b('Actor'), 'David Jarrett', 'Alan Ayckbourn'),
    ),
    '**Character** **Actor**  \n' +
      '**Angel** David Jarrett  \n' +
      '**Abraham** Alan Ayckbourn',
  );
});

test('columns that are not a table are left as two columns', () => {
  // Two halves of one list, continued in the second column, and a sidebar
  // whose line count happens to match. Zipping either would invent pairs.
  const halves = row(
    column(
      '1. Absent Friends',
      '2. Bedroom Farce',
      '3. Season&rsquo;s Greetings',
    ),
    column('4. Time And Time Again', '5. Way Upstream', '6. Wildest Dreams'),
  );
  assert.match(halves, /^1\. Absent Friends {2}\n2\./);
  assert.doesNotMatch(halves, /\*\*/);
});

test('a column of paragraphs is prose, however neatly it balances', () => {
  // The chronology pages: "Notable Events" beside "World Premieres", each with a
  // heading and the same number of entries. Zipping them printed the year's
  // events interleaved with its premieres, and the credit line that closed the
  // right-hand column then read as boilerplate for the whole merged block.
  const year = row(
    column(
      b('Notable Events'),
      'began work as a Radio Drama Producer at Leeds. He directed more than 50 radio plays there in his first year.',
      'wrote &lsquo;Meet My Father&rsquo; while still working in radio. It was written at Stephen Joseph&rsquo;s suggestion.',
    ),
    column(
      b('World Premieres'),
      '&lsquo;Meet My Father&rsquo;',
      '8 July: Theatre in the Round, Scarborough',
    ),
  );
  assert.match(
    year,
    /^\*\*Notable Events\*\* {2}\nbegan work as a Radio Drama/,
  );
  assert.match(year, /\n\*\*World Premieres\*\* {2}\n‘Meet My Father’/);
});

test('a long cell is still a cell when it is not prose', () => {
  // One Two Weeks With The Queen actor covers eight roles in 137 characters.
  const roles =
    'Aussie Nurse / Flight Attendant / American Tourist / Student Doctor / Cafe Woman / Pommy Nurse / Doctor Graham / Airport Woman';
  assert.match(
    row(
      column(b('Character'), 'Colin', roles),
      column(b('Actor'), 'Tamblyn Lord', 'Dorothy Atkinson'),
    ),
    new RegExp(`\\*\\*${roles.replace(/\//g, '\\/')}\\*\\* Dorothy Atkinson$`),
  );
});

test('a column of labels shorter than its values is not paired', () => {
  const uneven = row(
    column(b('Play:'), b('Venue:'), b('Staging:')),
    column('Dad&rsquo;s Tale', 'The Library Theatre'),
  );
  assert.doesNotMatch(uneven, /\*\*Play:\*\* Dad/);
});

test('a table inside a table is three columns, and a real table', () => {
  /* The cast-size table: play titles beside a nested cast / breakdown pair.
     Three columns run together as pairs — `**Play** **Cast** **Breakdown**` is
     the whole header on one line — so this is where a table earns its markup. */
  assert.equal(
    row(
      column(b('Play'), 'Absent Friends', 'Bedroom Farce'),
      nest(
        column(b('Cast'), '6', '4'),
        column(b('Breakdown'), '3m / 3f', '2m / 2f'),
      ),
    ),
    '| Play | Cast | Breakdown |\n' +
      '| --- | --- | --- |\n' +
      '| Absent Friends | 6 | 3m / 3f |\n' +
      '| Bedroom Farce | 4 | 2m / 2f |',
  );
});

test('a data sheet beside a cast list stays two tables', () => {
  /* Every credit page sets its production credits next to its cast, and the two
     balance row for row by coincidence. Zipped, the four-column result read the
     director against the first character. */
  assert.equal(
    row(
      nest(
        column(b('Director:'), b('Design:'), b('Lighting:')),
        column('Alan Ayckbourn', 'Michael Holt', 'Paul Towson'),
      ),
      nest(
        column(b('Character'), 'Pete', 'Jerry'),
        column(b('Actor'), 'Bill Champion', 'Keith Bartlett'),
      ),
    ),
    '**Director:** Alan Ayckbourn  \n' +
      '**Design:** Michael Holt  \n' +
      '**Lighting:** Paul Towson\n\n' +
      '**Character** **Actor**  \n' +
      '**Pete** Bill Champion  \n' +
      '**Jerry** Keith Bartlett',
  );
});

test('the headings above a table become its header row', () => {
  /* The premieres and directing tables have no header row: the archive drew the
     header as its own layout row, so it arrives as one heading per column. Left
     standing they label nothing — only the last of the three survives
     dropEmptyLabels — and the columns lose the only names they have. */
  assert.equal(
    markdown(
      '<h2>Play</h2><h2>Date</h2><h2>Venue</h2>' +
        rowHtml(
          column('The Square Cat', 'Love After All', 'Dad&rsquo;s Tale'),
          nest(
            column('1959', '1959', '1960'),
            column('Library', 'Library', 'Library'),
          ),
        ),
    ),
    '| Play | Date | Venue |\n' +
      '| --- | --- | --- |\n' +
      '| The Square Cat | 1959 | Library |\n' +
      '| Love After All | 1959 | Library |\n' +
      '| Dad’s Tale | 1960 | Library |',
  );
});

test('a link over several rows links each of them', () => {
  /* Three productions of Absent Friends share one anchor in the directing
     tables, so the link opened on the first row and closed on the third —
     leaving all three carrying the brackets as text. */
  const href = 'http://absentfriends.alanayckbourn.net';
  assert.equal(
    markdown(
      `<div class="text_stack"><a href="${href}">Absent Friends<br>Absent Friends</a></div>`,
    ),
    `[Absent Friends](${href})  \n[Absent Friends](${href})`,
  );
});

test('emphasis does not straddle a line break', () => {
  // One bold span over a whole list is how Stacks wrote the careers timeline;
  // `**a<br>b**` opens on one line and closes on the next, and nineteen years
  // of it rendered as a single unclosed bold run.
  assert.equal(
    markdown(`<div class="text_stack">${b('1956:<br>1957:')}</div>`),
    '**1956:**  \n**1957:**',
  );
});

test('an alias host folds onto the site it mirrors', () => {
  /* Path for path, so the mirror's pages read from the canonical host's cache
     and every link into the mirror resolves to the one copy. */
  assert.equal(
    normalise('http://interviews.alanayckbourn.net/page-4/page18.html'),
    'http://research.alanayckbourn.net/page-4/page18.html',
  );
  assert.equal(
    normalise('http://sevendeadlyvirtues.alanayckbourn.net/'),
    'http://the7deadlyvirtues.alanayckbourn.net/',
  );
  /* A host several plays share is not an alias: folding it would drop a play. */
  assert.equal(
    normalise('http://tablemanners.alanayckbourn.net/'),
    'http://tablemanners.alanayckbourn.net/',
  );
});

test('the old mailer is not a page', () => {
  /* Crawled, it yielded four pages of field labels with no fields. */
  assert.equal(isPage('http://plays.alanayckbourn.net/contact-form/'), false);
  assert.equal(
    isPage('http://plays.alanayckbourn.net/page-7/contact-form-2/'),
    false,
  );
  assert.equal(isPage('http://plays.alanayckbourn.net/page-7/'), true);
});

test('every alt description names an image that exists', () => {
  /* alt.json is written by hand against the images on disk, so a key that
     matches nothing is a description silently applying to no image — and the
     rename or re-scrape that orphaned it left some image undescribed. */
  const names = new Set();
  (function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(dir, entry.name));
      } else {
        names.add(entry.name);
      }
    }
  })(new URL('../src/content/archive', import.meta.url).pathname);

  const alt = JSON.parse(
    readFileSync(new URL('./alt.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(
    Object.keys(alt).filter((name) => !names.has(name)),
    [],
  );
  /* An empty string is `alt=""`, which says "decorative" — a real claim about
     the image, and not one to make by leaving a key blank. Omit it instead. */
  assert.deepEqual(
    Object.entries(alt).filter(([, text]) => !text.trim()),
    [],
  );
});

test('a credit is not a description of the photograph', () => {
  /* The archive's own italic caption is a real description, and an image beside
     one takes `alt=""` rather than repeating it. A caption that only credits the
     photographer describes nothing, though, so those images stay on the review
     list — 28 of them, or the chronology would have looked done. */
  const page = (caption) =>
    `text\n\n![](./_images/stacks-image-abc.jpg)\n\n*${caption}*  \n*© Tony Bartholomew*\n`;

  assert.equal(
    hasCaption(page('Michael Gambon in A Small Family Business.'), 'abc.jpg'),
    true,
  );
  assert.equal(hasCaption(page('© Tony Bartholomew'), 'abc.jpg'), false);
  assert.equal(
    hasCaption(page('(4) Copyright: Scarborough'), 'abc.jpg'),
    false,
  );
  assert.equal(
    hasCaption(page('Image copyright: National Theatre.'), 'abc.jpg'),
    false,
  );
  assert.equal(
    hasCaption(
      page('All research for this page by Simon Murgatroyd.'),
      'abc.jpg',
    ),
    false,
  );
  /* Numbered captions are how the staging pages label a sequence of set designs,
     and they do describe. Only the numbering is skipped, not the caption. */
  assert.equal(
    hasCaption(
      page("(1) Alan Ayckbourn's first set sketch from 1976."),
      'abc.jpg',
    ),
    true,
  );
  /* Prose is not a caption. The paragraph under an image is only one when the
     archive set it in italics on its own. */
  assert.equal(
    hasCaption(
      '![](./_images/stacks-image-abc.jpg)\n\nIn 1984, Peter Hall\n',
      'abc.jpg',
    ),
    false,
  );
});

test('describing an image cannot turn a row of thumbnails into navigation', () => {
  /* The National Theatre page sets ten poster thumbnails in a row, each linking
     to its play. The alt text sits inside the link's own brackets, so measured
     as link text it decided whether the row was content — the row survived
     while the images had no descriptions and vanished when they got them. */
  const row = (alt) => ({
    type: 'p',
    text: [
      'bedroom-farce',
      'sisterly-feelings',
      'way-upstream',
      'a-chorus-of-disapproval',
    ]
      .map((play) => `[![${alt}](./_images/${play}.jpg)](/plays/${play})`)
      .join('    '),
  });
  const kept = (block) => dropNavBlocks([block], 'The National Theatre').blocks;
  assert.deepEqual(kept(row('')), [row('')]);
  const described = row(
    'National Theatre poster: a buttoned pink headboard against a pink ground',
  );
  assert.deepEqual(kept(described), [described]);
  /* And the verdict the markup does earn still stands: one banner image wrapped
     in a link to somewhere off the archive is the promo strip, not content. */
  const banner = (alt) => ({
    type: 'p',
    text: `[![${alt}](./_images/banner.png)](http://www.oldvictheatre.com/stage/other-half/)`,
  });
  assert.deepEqual(kept(banner('')), []);
  assert.deepEqual(kept(banner('At The Old Vic, 29 July to 19 September')), []);
});

test('the footer credit leaves the paragraph it was glued to, not the paragraph', () => {
  /* `father-of-invention` sets its data sheet, its play title, the Grey Plays
     note and the copyright notice as one <br>-separated paragraph. Tested whole,
     the notice took two facts and a paragraph of prose with it. */
  const sheet = [
    '**Play Description:** Grey Play',
    '**Published / Available to Stage:** No',
    '**Father of Invention**',
    '*The Grey Plays are acknowledged miscellaneous pieces by Alan Ayckbourn.*',
  ];
  const notice =
    '*All research and original material in the Father of Invention section is by Simon Murgatroyd M.A. and copyright of Haydonning Ltd.*  \n*To navigate, use the links in the bar above or to the right.*';
  const { blocks, credits } = dropNavBlocks(
    [{ type: 'p', text: `${sheet.join('  \n')}  \n${notice}` }],
    'Father of Invention',
  );
  assert.deepEqual(blocks, [{ type: 'p', text: sheet.join('  \n') }]);
  assert.equal(credits, 0);

  /* A paragraph that is nothing but the notice still goes, and still counts. */
  const alone = dropNavBlocks([{ type: 'p', text: notice }], 'x');
  assert.deepEqual(alone.blocks, []);
  assert.equal(alone.credits, 1);
});

test('an index that labels its own rows is content, not sibling-nav', () => {
  /* The Play Index sets 1959–1990 and 1991–present as two paragraphs of the same
     list; on the link ratio alone they score 0.633 and 0.583, so the first was
     dropped and the second kept. The label rows are what the archive's indexes
     have and its navigation does not. */
  const index = {
    type: 'p',
    text: [
      '**1959**',
      '○ [The Square Cat](/plays/the-square-cat)',
      '○ [Love After All](/plays/love-after-all)',
      '**1960**',
      "○ [Dad's Tale](/plays/dads-tale)",
    ].join('  \n'),
  };
  assert.deepEqual(dropNavBlocks([index], 'Play Titles (by year)').blocks, [
    index,
  ]);
  /* The FAQ lists bold the links themselves, so bold alone would have rescued
     every one of them. They are still navigation. */
  const faq = {
    type: 'p',
    text: [
      '**○ [FAQs: Writing](../../styled-5/styled-12/BiographyFAQWriting.html)**',
      '**○ [FAQs: National Theatre](../../styled-5/styled-14/BiographyFAQNational.html)**',
    ].join('  \n'),
  };
  assert.deepEqual(dropNavBlocks([faq], 'FAQs: Film').blocks, []);
  /* And the Related Pages box does have an unlinked label. What gives it away is
     the entry: an italic title and its suffix are two anchors on one destination,
     so the row points at a page rather than listing one. */
  const related = {
    type: 'p',
    text: [
      '**Other Perspectives**',
      '\u25cb *[Way Upstream](/plays/way-upstream/nt/the-nt-paul-allen)*[at the NT by Paul Allen](/plays/way-upstream/nt/the-nt-paul-allen)',
      '\u25cb *[Way Upstream](/plays/way-upstream/nt/the-nt-alan-ayckbourn)*[at the NT by Alan Ayckbourn](/plays/way-upstream/nt/the-nt-alan-ayckbourn)',
    ].join('  \n'),
  };
  assert.deepEqual(
    dropNavBlocks([related], 'Way Upstream at the NT').blocks,
    [],
  );
});
