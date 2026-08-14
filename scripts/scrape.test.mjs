import assert from 'node:assert/strict';
import { test } from 'node:test';
import { load } from 'cheerio';
import {
  blocksOf,
  clean,
  dropEmptyLabels,
  extractFacts,
  isLabel,
  isPage,
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

test('a fact following a premiere is not swallowed by it', () => {
  const { facts } = extractFacts(
    sheet('**World Premiere:** 1975', '**Play Number:** 18'),
  );
  assert.deepEqual(facts, { 'World Premiere': '1975', 'Play Number': '18' });
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

const row = (left, right) =>
  markdown(`<div class="com_yourhead_stacks_two_columns_stack">
    <div class="s3_row">${left}${right}</div>
  </div>`);

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

test('a column of labels shorter than its values is not paired', () => {
  const uneven = row(
    column(b('Play:'), b('Venue:'), b('Staging:')),
    column('Dad&rsquo;s Tale', 'The Library Theatre'),
  );
  assert.doesNotMatch(uneven, /\*\*Play:\*\* Dad/);
});

test('a table inside a table pairs three columns', () => {
  // The cast-size table: play titles beside a nested cast / breakdown pair.
  assert.equal(
    row(
      column(b('Play'), 'Absent Friends', 'Bedroom Farce'),
      `<div class="s3_column"><div class="com_yourhead_stacks_two_columns_stack">
        <div class="s3_row">
          ${column(b('Cast'), '6', '4')}
          ${column(b('Breakdown'), '3m / 3f', '2m / 2f')}
        </div>
      </div></div>`,
    ),
    '**Play** **Cast** **Breakdown**  \n' +
      '**Absent Friends** **6** 3m / 3f  \n' +
      '**Bedroom Farce** **4** 2m / 2f',
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
