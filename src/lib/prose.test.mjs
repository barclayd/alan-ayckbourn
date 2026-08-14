import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNote, rebuild, sourceOf } from './prose.mjs';

const text = (value) => ({ type: 'text', value });
const br = { type: 'element', tagName: 'br', properties: {}, children: [] };
const el = (tagName, children) => ({
  type: 'element',
  tagName,
  properties: {},
  children,
});
const p = (children) => el('p', children);

test('a quotation becomes a blockquote, its source a footer', () => {
  const out = rebuild(
    p([
      text('“Never look forward!”'),
      br,
      el('em', [text('(The Press, 2019)')]),
    ]),
  );
  assert.equal(out.tagName, 'blockquote');
  const [year, quote, source] = out.children;
  assert.deepEqual(year.children, [text('2019')]);
  assert.equal(year.properties['aria-hidden'], 'true');
  assert.deepEqual(quote.children, [text('“Never look forward!”')]);
  assert.equal(source.tagName, 'footer');
  /* Parentheses off, italics and everything inside them kept as typed. */
  assert.equal(source.children[0].tagName, 'em');
  assert.deepEqual(source.children[0].children, [text('The Press, 2019')]);
});

test('a quotation keeps its own line breaks and needs no source', () => {
  const out = rebuild(p([text('"One."'), br, text('"Two."')]));
  assert.equal(out.tagName, 'blockquote');
  assert.equal(out.children.length, 1, 'no year, no footer');
  assert.deepEqual(out.children[0].children, [
    text('"One."'),
    br,
    text('"Two."'),
  ]);
});

test('a source with no year hangs nothing in the gutter', () => {
  const out = rebuild(p([text('"Yes."'), br, text('(Grinning At The Edge)')]));
  assert.deepEqual(
    out.children.map((c) => c.tagName),
    ['p', 'footer'],
  );
});

test('a quotation merely ending on a parenthesis keeps it', () => {
  const out = rebuild(p([text('"A play"'), br, text('"(and its sequel)"')]));
  assert.equal(out.children.length, 1);
});

test('a source names the last year in it', () => {
  const { year } = sourceOf([
    text('"x"'),
    br,
    text('(Modern Dramatists: Alan Ayckbourn, 1983)'),
  ]);
  assert.equal(year, '1983');
});

test('a cited extract that is not a quotation takes no dateline', () => {
  const out = rebuild(
    p([
      text(
        'Must have Ayckbourn. Many dramatists have told me how much he has influenced them.',
      ),
      br,
      el('em', [text('(The Guardian, 3 September 1997)')]),
    ]),
  );
  assert.deepEqual(out.properties.className, ['extract']);
  assert.deepEqual(
    out.children.map((c) => c.tagName),
    ['p', 'footer'],
  );
});

test('a parenthesis longer than the line it follows is not a source', () => {
  /* The archivist introducing an extract, not citing one. */
  const out = rebuild(
    p([
      el('strong', [text('Ever Ever Land')]),
      text(' (by Michael Billington)'),
      br,
      el('em', [
        text(
          '(In September 1997, the critic Michael Billington wrote an article for The Guardian naming his top ten British plays of the 20th century.)',
        ),
      ]),
    ]),
  );
  assert.equal(out, null);
});

test('a wholly italic paragraph is a note, prose is not', () => {
  assert.ok(isNote([el('em', [text('This page contains reviews.')])]));
  /* The full stop the archivist left outside the asterisks. */
  assert.ok(
    isNote([
      el('em', [text('Quotes are ')]),
      el('strong', [el('em', [text('here')])]),
      text('.'),
    ]),
  );
  assert.ok(
    !isNote([el('em', [text('Absent Friends')]), text(' opened in 1974.')]),
  );
  assert.ok(!isNote([text('In 1972, Alan became Artistic Director.')]));
});

test('a bold question before a break is a question and answer', () => {
  const out = rebuild(
    p([el('strong', [text('Can I cut the play?')]), br, text('No.')]),
  );
  assert.deepEqual(out.properties.className, ['qa']);
  /* A bold label that is not a question is left alone. */
  assert.equal(
    rebuild(p([el('strong', [text('Cast:')]), br, text('7m / 6f')])),
    null,
  );
});
