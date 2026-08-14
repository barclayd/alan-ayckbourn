import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dropEmptyLabels, extractFacts, isLabel, isPage } from './scrape.mjs';

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
