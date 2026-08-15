/**
 * The section list has two rules with judgement in them: which group opens
 * inside it, and what a page is called once it is in a list. Both are decided by
 * shapes the archive actually contains — a play landing whose children are the
 * section itself, an articles page whose six children are five pages all titled
 * "Articles", and a catalogue too long to put in a column.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { branch, labelOf, type Page, RAIL_MAX } from './branch.ts';

const page = (id: string, title: string, body?: string): Page => ({
  id,
  body,
  data: { title, order: id.length },
});

const play = 'plays/how-the-other-half-loves';
const archive = [
  page(play, 'How The Other Half Loves'),
  page(`${play}/history`, 'History'),
  page(`${play}/articles`, 'Articles'),
  page(
    `${play}/articles/characters`,
    'Character Notes by Alan Ayckbourn',
    'Notes.',
  ),
  page(
    `${play}/articles/windsor-theatre`,
    'Articles',
    '*Written for a revival.*\n\n### How The Other Half Loves\n\nby Alan Ayckbourn',
  ),
  page(
    `${play}/articles/the-morley-factor`,
    'Articles',
    '### The Morley Factor\n\nby Simon Murgatroyd',
  ),
  page('life', 'Life'),
  page('life/chronology', 'Chronology'),
  ...Array.from({ length: RAIL_MAX + 1 }, (_, i) =>
    page(`life/chronology/${1957 + i}`, `Ayckbourn Chronology: ${1957 + i}`),
  ),
  page('encyclopaedia', 'Encyclopaedia'),
  page('encyclopaedia/a-z', 'A–Z'),
  ...'ABCDEFG'
    .split('')
    .map((letter) => page(`encyclopaedia/a-z/${letter}`, `A–Z: ${letter}`)),
];

test('a section head lists its pages once, not twice', () => {
  const { pages, nested } = branch(archive, play);
  assert.deepEqual(
    pages.map((link) => link.id),
    [`${play}/history`, `${play}/articles`],
  );
  assert.deepEqual(nested, []);
});

test('a page with children opens them inside the section', () => {
  const { nested } = branch(archive, `${play}/articles`);
  assert.deepEqual(
    nested.map((link) => link.label),
    [
      'Character Notes by Alan Ayckbourn',
      'How The Other Half Loves',
      'The Morley Factor',
    ],
  );
});

test('a page without children opens the pages either side of it', () => {
  const { pages, nested } = branch(
    archive,
    `${play}/articles/the-morley-factor`,
  );
  /* Still the play's own pages down the side: the article is four levels deep
     and the way back out is the section, not its own empty folder. */
  assert.deepEqual(
    pages.map((link) => link.id),
    [`${play}/history`, `${play}/articles`],
  );
  assert.equal(nested.length, 3);
});

test('a leaf directly under the head opens nothing — it is already in the list', () => {
  assert.deepEqual(branch(archive, `${play}/history`).nested, []);
});

test('a catalogue longer than the column stays off it', () => {
  /* 21 years, one over the line: the page prints them itself instead. */
  assert.deepEqual(branch(archive, 'life/chronology').nested, []);
});

test('an A–Z the page prints itself is not printed again in the column', () => {
  assert.deepEqual(branch(archive, 'encyclopaedia/a-z').nested, []);
});

test('a letter under that A–Z still gets its neighbours', () => {
  assert.equal(branch(archive, 'encyclopaedia/a-z/C').nested.length, 7);
});

test('a page titled after its folder is called by the heading it opens with', () => {
  assert.equal(
    labelOf(
      page('x', 'Articles', '*Standfirst.*\n\n### The Morley Factor\n\nby X'),
      'Articles',
    ),
    'The Morley Factor',
  );
});

test('a page that repeats its parent but has no heading keeps its title', () => {
  assert.equal(
    labelOf(page('x', 'Advocates', 'No heading here.'), 'Advocates'),
    'Advocates',
  );
});

test("a child named after its parent drops the parent's half", () => {
  assert.equal(
    labelOf(
      page('x', 'Alan Ayckbourn Encyclopaedia: A'),
      'Alan Ayckbourn Encyclopaedia',
    ),
    'A',
  );
  /* The section's name written longhand in front of the page's own. */
  assert.equal(
    labelOf(page('x', 'Ayckbourn Chronology: 1957'), 'Chronology'),
    '1957',
  );
});

test('a colon that is part of a name is left where it is', () => {
  assert.equal(
    labelOf(page('x', 'Stephen Joseph: The Man Who Inspired Alan'), 'Life'),
    'Stephen Joseph: The Man Who Inspired Alan',
  );
});
