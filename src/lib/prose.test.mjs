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

/* The two shapes the production pages are built from. Both are runs of
   bold-led lines joined by hard breaks, and both used to render as one
   paragraph of bold-then-roman prose. */

const lines = (...rows) =>
  p(rows.flatMap((row, i) => (i ? [br, ...row] : row)));

test('a run of labelled lines is a data sheet', () => {
  const out = rebuild(
    lines(
      [el('strong', [text('Venue:')]), text(' Birmingham Theatre Centre')],
      [el('strong', [text('Staging:')]), text(' Round')],
      [el('strong', [text('Director:')]), text(' Harold Pinter')],
    ),
  );
  assert.equal(out.tagName, 'dl');
  assert.deepEqual(out.properties.className, ['record']);
  /* Each pair wrapped, so the label stays over its value in the grid. */
  const [dt, dd] = out.children[0].children;
  /* The colon is the label's mark, not part of the label. */
  assert.deepEqual(dt.children, [text('Venue')]);
  assert.deepEqual(dd.children, [text('Birmingham Theatre Centre')]);
  assert.equal(out.children.length, 3);
});

test('a value on its own line stays with the label above it', () => {
  const out = rebuild(
    lines(
      [el('strong', [text('Author:')]), text(' Willis Hall')],
      [el('strong', [text('Director:')])],
      [text('Alan Ayckbourn')],
    ),
  );
  assert.equal(out.children.length, 2);
  assert.equal(
    out.children[1].children[1].children.at(-1).value,
    'Alan Ayckbourn',
  );
});

test('two bold headings over bold-led lines is a table', () => {
  const out = rebuild(
    lines(
      [
        el('strong', [text('Character')]),
        text(' '),
        el('strong', [text('Actor')]),
      ],
      [el('strong', [text('Petey')]), text(' David Campton')],
      [el('strong', [text('Stanley')]), text(' Alan Ayckbourn')],
    ),
  );
  assert.equal(out.tagName, 'table');
  const [caption, thead, tbody] = out.children;
  assert.deepEqual(caption.children, [text('Cast')]);
  assert.equal(thead.children[0].children[0].properties.scope, 'col');
  /* The role is the row's heading, so a cell read alone still names its part. */
  const [role, actor] = tbody.children[1].children;
  assert.equal(role.tagName, 'th');
  assert.equal(role.properties.scope, 'row');
  assert.deepEqual(actor.children, [text('Alan Ayckbourn')]);
});

test('credits above the cast heading are a sheet beside the table', () => {
  const out = rebuild(
    lines(
      [el('strong', [text('Director')]), text(' Alan Ayckbourn')],
      [
        el('strong', [text('Character')]),
        text(' '),
        el('strong', [text('Actor')]),
      ],
      [el('strong', [text('Bertie Wooster')]), text(' Steven Pacey')],
    ),
  );
  const [record, table] = out.children;
  assert.deepEqual(record.properties.className, ['record']);
  assert.deepEqual(record.children[0].children[0].children, [text('Director')]);
  assert.equal(table.tagName, 'table');
  assert.equal(table.children.at(-1).children.length, 1);
});

test('a table that is not a cast gets no caption', () => {
  const out = rebuild(
    lines(
      [el('strong', [text('Act 1')]), text(' '), el('strong', [text('Act 2')])],
      [el('strong', [text('Scene 1')]), text(' The kitchen')],
      [el('strong', [text('Scene 2')]), text(' The garden')],
    ),
  );
  assert.equal(out.children[0].tagName, 'thead');
});

test('prose with a bold lead-in is left alone', () => {
  /* One labelled line is a sentence, not a sheet, and a paragraph whose lines
     do not all carry a label is prose with something emphasised in it. */
  assert.equal(
    rebuild(
      lines([el('strong', [text('Note:')]), text(' first performed in 1959')]),
    ),
    null,
  );
  assert.equal(
    rebuild(
      lines(
        [el('strong', [text('Petey')]), text(' David Campton')],
        [text('The play was toured that winter.')],
      ),
    ),
    null,
  );
});
