/**
 * The judgement in the timeline transform is all in what it recognises: a date
 * label written five different ways over twenty years, and the difference
 * between a line that opens a date and a line that belongs to the one above.
 * Every fixture below is a shape the archive's fifty-six chronology pages
 * actually use, copied out of `src/content/archive` and trimmed.
 *
 * They go through the real Sätteri pipeline rather than a hand-built tree, so
 * these also cover the things only the pipeline can get wrong — a hard break
 * arriving as `<br>` plus a text node that still carries the source newline,
 * and whether the emitted markup survives being handed back to it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as cheerio from 'cheerio';
import { markdownToHtml } from 'satteri';
import timelinePlugin, { dateOf, whenOf } from './timeline.mjs';

/**
 * One paragraph, written the way the archive writes them: an entry per line,
 * separated by markdown's two-space hard break. Spelt out rather than typed at
 * the end of each line, where it is invisible and a formatter would eat it.
 */
const para = (...lines) => lines.join('  \n');

/** Markdown in, a queryable document out. Each argument is one paragraph. */
const run = (...paras) => {
  /* Synchronous: Sätteri only returns a promise when a plugin is async. */
  const { html } = markdownToHtml(paras.join('\n\n'), {
    hastPlugins: [timelinePlugin],
  });
  const $ = cheerio.load(html, null, false);
  const all = (selector) =>
    $(selector)
      .map((_, node) => $(node).text().trim())
      .get();
  return {
    $,
    html,
    years: () => all('.tl-year'),
    events: () => all('.tl-what'),
    whens: () => all('.tl-when'),
    labels: () => all('.tl-label'),
    timelines: () => $('.timeline').length,
    ids: () =>
      $('.tl-band')
        .map((_, node) => $(node).attr('id'))
        .get(),
  };
};

test('a date is read however the archive wrote it', () => {
  assert.deepEqual(dateOf('April 1985'), { label: 'April 1985', year: 1985 });
  assert.deepEqual(dateOf('30 May 1985'), { label: '30 May 1985', year: 1985 });
  assert.deepEqual(dateOf('○ 1956:'), { label: '1956', year: 1956 });
  assert.deepEqual(dateOf('1939:'), { label: '1939', year: 1939 });
  assert.deepEqual(dateOf('Prior to 1974'), {
    label: 'Prior to 1974',
    year: 1974,
  });
  /* A span, written with and without spaces around the dash, and with a slash
     instead of one. A span is dated by the year it opens in. */
  assert.deepEqual(dateOf('1958 - 1959'), { label: '1958 – 1959', year: 1958 });
  assert.deepEqual(dateOf('1955-1976'), { label: '1955 – 1976', year: 1955 });
  assert.deepEqual(dateOf('Circa late 1970 / early 1971'), {
    label: 'Circa late 1970 / early 1971',
    year: 1970,
  });
  /* A post he has not left, and a month the archivist would not pin down. */
  assert.deepEqual(dateOf('○ 1959 - present:'), {
    label: '1959 – present',
    year: 1959,
  });
  assert.deepEqual(dateOf('Circa mid-March 1974'), {
    label: 'Circa mid March 1974',
    year: 1974,
  });
  assert.deepEqual(dateOf('Mid-1984'), { label: 'Mid 1984', year: 1984 });
  /* A play set in the eighteenth century still bands by year. */
  assert.deepEqual(dateOf('1660'), { label: '1660', year: 1660 });
});

test('a label that only mentions a year is not a date', () => {
  /* Each of these leads a bold line somewhere in the archive. Reading them as
     dates would turn a cast list and a section heading into timelines. */
  for (const label of [
    '1952 (John & Peggy Stanton)',
    'A Chorus Of Approval (1999)',
    'Ayckbourn 2013 Season',
    'Oliviers (London)',
    'As Director',
    'Theatre in the Round at the Library Theatre',
    'In-Depth',
    '',
  ]) {
    assert.equal(dateOf(label), null, label);
  }
});

test('an event shows only what is finer than its year band', () => {
  assert.equal(whenOf('April 1985', 1985), 'April');
  assert.equal(whenOf('30 May 1985', 1985), '30 May');
  assert.equal(whenOf('1986', 1986), '');
  /* Stripping the year would leave "Prior to" and "1958 –", which say less
     than the whole label does. */
  assert.equal(whenOf('Prior to 1974', 1974), 'Prior to 1974');
  assert.equal(whenOf('1958 – 1959', 1958), '1958 – 1959');
});

test('a date and the line under it become one event', () => {
  /* The commonest shape: forty play timelines are written this way, one
     paragraph per entry. */
  const tl = run(
    para('**April 1985**', 'Alan Ayckbourn writes *Woman In Mind*.'),
    para('**30 May 1985**', 'World premiere at the Stephen Joseph Theatre.'),
    para('**1986**', '*Faber & Faber* publishes Woman In Mind.'),
    para('**1987**', 'Recast in the West End.'),
    para('**1990**', 'A Broadway transfer.'),
    para('**1991**', 'A radio adaptation.'),
  );
  assert.deepEqual(tl.years(), ['1985', '1986', '1987', '1990', '1991']);
  /* 1985 is stated once and covers both of its events. */
  assert.deepEqual(tl.whens().slice(0, 2), ['April', '30 May']);
  assert.equal(tl.events().length, 6);
  assert.equal(tl.events()[0], 'Alan Ayckbourn writes Woman In Mind.');
  assert.equal(tl.events()[1], 'World premiere at the Stephen Joseph Theatre.');
});

test('circle-bulleted lines are the events of the year above them', () => {
  /* The National Theatre timeline: a year, then its events, all one paragraph,
     and the bullet arrives bold because the whole line was bolded first. */
  const tl = run(
    para(
      '**1975**',
      '**○** Alan and Hall meet for the first time.',
      '**○** World premiere of *Bedroom Farce*.',
      '**○** Hall visits Scarborough.',
      '**1977**',
      '**○** Bedroom Farce opens in the Lyttelton.',
      '**1978**',
      '**○** Alan offers Hall his next play.',
      '**1979**',
      '**○** Sisterly Feelings opens in Scarborough.',
      '**1980**',
      '**○** Sisterly Feelings opens in the Olivier.',
      '**1981**',
      '**○** Way Upstream is announced.',
    ),
  );
  assert.deepEqual(tl.years(), [
    '1975',
    '1977',
    '1978',
    '1979',
    '1980',
    '1981',
  ]);
  assert.equal(tl.events().length, 8);
  assert.equal(tl.events()[0], 'Alan and Hall meet for the first time.');
  /* The bullet was the marker; it is the node now, not text in the sentence. */
  assert.doesNotMatch(tl.html, /○/);
  /* A bare year needs no label beside its events — the band said it. */
  assert.deepEqual(tl.whens(), []);
});

test('a bare circle bullet works the same as a bold one', () => {
  /* The Communicating Doors chronology types it without the bold. */
  const tl = run(
    para('**Prior to 1974**', '○ Julian kills his own mother.'),
    para(
      '**1974**',
      '○ Reece is 30, Jessica is 25.',
      '○ Reece and Jessica are married.',
    ),
    para('**1975**', '○ Rachel is born on 21 March.'),
    para('**1981**', '○ Julian joins the company.'),
    para('**1982**', '○ Reece marries Ruella.'),
    para('**1983**', '○ Ruella disappears.'),
  );
  assert.deepEqual(tl.years(), ['1974', '1975', '1981', '1982', '1983']);
  /* "Prior to 1974" bands with 1974 but keeps saying what it says. */
  assert.equal(tl.whens()[0], 'Prior to 1974');
  assert.equal(tl.events()[0], 'Julian kills his own mother.');
  assert.doesNotMatch(tl.html, /○/);
});

test('a bullet the bold ran past is still a bullet', () => {
  /* The National Theatre timeline has one of these: "**○ T**echnical". */
  const tl = run(
    para('**1981**', '○ World premiere of *Way Upstream*.'),
    para('**1982**', '**○ T**echnical rehearsals begin; the boat splits.'),
    para('**1983**', '○ The tour opens.'),
    para('**1984**', '○ The tour opens again, without water.'),
    para('**1985**', '○ A first Olivier.'),
    para('**1986**', '○ A sabbatical begins.'),
  );
  assert.equal(tl.events()[1], 'Technical rehearsals begin; the boat splits.');
  assert.doesNotMatch(tl.html, /○/);
});

test('a year wearing a link keeps the link and bands by the year', () => {
  /* The life chronology links every year to its own in-depth page. */
  const tl = run(
    '**[1939:](/life/chronology/pre-1955)** Born 12 April in Hampstead.',
    '**[1946:](/life/chronology/pre-1955)** Attends Wisborough Lodge.',
    '**[1948:](/life/chronology/pre-1955)** First published work.',
    '**[1951:](/life/chronology/pre-1955)** Wins a scholarship.',
    '**[1956:](/life/chronology/1956)** Joins Studio Theatre.',
    '**[1957:](/life/chronology/1957)** Acts at the Library Theatre.',
  );
  assert.deepEqual(tl.years(), [
    '1939',
    '1946',
    '1948',
    '1951',
    '1956',
    '1957',
  ]);
  assert.equal(tl.events()[0], 'Born 12 April in Hampstead.');
  /* The link is the reader's way into that year's own page, and this page's
     whole navigation. The year wears it, as it did in the archive. */
  assert.equal(
    tl.$('.tl-year a').first().attr('href'),
    '/life/chronology/pre-1955',
  );
  assert.equal(tl.$('.tl-year a').length, 6);
});

test('a year with nowhere to go is not a link to itself', () => {
  const tl = run(
    para('**1985**', 'World premiere.'),
    para('**1986**', 'A transfer.'),
    para('**1987**', 'A recast.'),
    para('**1988**', 'A tour.'),
    para('**1989**', 'A broadcast.'),
    para('**1990**', 'A translation.'),
  );
  assert.equal(tl.$('.tl-year a').length, 0);
  /* Still addressable — the band carries the id. */
  assert.deepEqual(tl.ids().slice(0, 2), ['y1985', 'y1986']);
});

test('consecutive entries sharing a year band under it once', () => {
  /* Careers at a glance lists several posts a year, each on its own line. */
  const tl = run(
    para(
      "**○ 1956:** Actor with Sir Donald Wolfit's company",
      '**○ 1956:** Student ASM at the Connaught Theatre',
      '**○ 1957:** Actor at Leatherhead Theatre Club',
      '**○ 1957:** ASM at the Library Theatre, Scarborough',
      '**○ 1957:** Actor at the Oxford Playhouse',
      '**○ 1958 - 1959:** Stage Manager at the Library Theatre',
    ),
  );
  assert.deepEqual(tl.years(), ['1956', '1957', '1958']);
  assert.equal(tl.events().length, 6);
  /* Only the span keeps a label — the plain years are said by the band. */
  assert.deepEqual(tl.whens(), ['1958 – 1959']);
});

test('a section label heads a timeline instead of joining one', () => {
  /* Awards & Honours groups by awarding body; each group is its own run. */
  const tl = run(
    para(
      '**Oliviers (London)**',
      '**1985:** Olivier Best Comedy Award',
      '**2009:** Special Award',
    ),
    para(
      '**Tonys (New York)**',
      '**2009:** Best Revival Of A Play',
      '**2010:** Lifetime Achievement',
      '**2011:** Another one',
      '**2012:** And another',
    ),
  );
  assert.deepEqual(tl.labels(), ['Oliviers (London)', 'Tonys (New York)']);
  /* Two timelines, not one with the labels swallowed as events. */
  assert.equal(tl.timelines(), 2);
  assert.equal(tl.events().length, 6);
});

test('a line indented with dot leaders is the wrap of the line above', () => {
  const tl = run(
    para(
      '**1993:** TMA Award Best Show for Children &',
      "*………*Young People (*Mr A's Amazing Maze Plays*)",
      '**1994:** Yorkshire Man of the Year',
      '**1995:** A third award',
      '**1996:** A fourth',
      '**1997:** A fifth',
      '**1998:** A sixth',
    ),
  );
  assert.equal(
    tl.events()[0],
    "TMA Award Best Show for Children & Young People (Mr A's Amazing Maze Plays)",
  );
  assert.doesNotMatch(tl.html, /………/);
});

test('a page that is not a chronology is left alone', () => {
  /* Three bold years in a cast list is not a timeline, and below the threshold
     nothing on the page is touched at all. */
  const tl = run(
    '**1952** (John & Peggy Stanton)',
    '**1965** (Jenny & Alan)',
    '**1979** (Peggy alone)',
  );
  assert.equal(tl.timelines(), 0);
  assert.equal(tl.$('p').length, 3);
});

test('a gap in the record is marked, and a short one is not', () => {
  const tl = run(
    para('**1985**', 'World premiere.'),
    para('**1986**', 'A West End transfer.'),
    para('**2000**', 'A revival at last.'),
    para('**2001**', 'And a tour.'),
    para('**2002**', 'And a broadcast.'),
    para('**2003**', 'And a translation.'),
  );
  /* One gap: 1985→1986 and 2000→2003 are all under the threshold. */
  assert.equal(tl.$('.tl-gap').length, 1);
  assert.equal(tl.$('.tl-gap').text().trim(), '14 years');
});

test('two sections sharing a year still get their own anchors', () => {
  const tl = run(
    para(
      '**Theatre in the Round at the Library Theatre**',
      '**1961**',
      'Gaslight',
      'David Copperfield',
      '**1962**',
      'The Caretaker',
    ),
    para(
      '**The Stephen Joseph Theatre**',
      '**1961**',
      'A revival',
      '**1976**',
      'Another',
      '**1977**',
      'A third',
      '**1978**',
      'A fourth',
    ),
  );
  assert.deepEqual(tl.ids(), [
    'y1961',
    'y1962',
    'y1961-2',
    'y1976',
    'y1977',
    'y1978',
  ]);
  /* Each untitled line under a year is its own event, not one run-on entry. */
  assert.deepEqual(tl.events().slice(0, 3), [
    'Gaslight',
    'David Copperfield',
    'The Caretaker',
  ]);
});
