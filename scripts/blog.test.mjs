/**
 * The blog scrape is mostly plumbing over a JSON API. The one piece with
 * judgement in it is `bullets`: the curated News and What's On pages are prose
 * paragraphs that have to come out as data — title, venue, dates, detail —
 * from markup that nests bold inside bold and splits a play title across two
 * anchors. These are the shapes that actually appear on those two pages.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bullets, keyFor, rewrite, runDates } from './blog.mjs';

const empty = { images: new Map(), routes: new Map() };

test('a listing yields title, venue, dates and the director note', () => {
  const [item] = bullets(
    `<p><strong>◦&nbsp;<strong><a href="https://sjt.uk.com/x">The Trial of Romeo Oscar</a></strong> </strong>at the Stephen Joseph Theatre, Scarborough (4 September &#8211; 3 October 2026)<em><br></em>Directed in-the-round by Alan Ayckbourn</p>`,
    empty,
  );
  assert.equal(item.kind, 'item');
  assert.equal(item.title, 'The Trial of Romeo Oscar');
  assert.equal(item.where, 'The Stephen Joseph Theatre, Scarborough');
  assert.equal(item.when, '4 September – 3 October 2026');
  assert.equal(item.detail, 'Directed in-the-round by Alan Ayckbourn');
  assert.equal(item.href, 'https://sjt.uk.com/x');
});

test('a title split across two anchors stays one title', () => {
  /* "Show & Tell" arrives as <a>Show</a> + <a> &amp; Tell</a>, wrapped in a
     <font> and a <u> from pasted text. Splitting on " at " in the text would
     cut it in the wrong place. */
  const [item] = bullets(
    `<p><strong>◦&nbsp;<font color="#2271b1"><a href="https://a.uk/"><span><u>Show</u></span></a></font><strong><a href="https://a.uk/"> &amp; Tell</a></strong> </strong>at the Jubilee Hall, Aldeburgh (10 &#8211; 15 August 2026)</p>`,
    empty,
  );
  assert.equal(item.title, 'Show & Tell');
  assert.equal(item.where, 'The Jubilee Hall, Aldeburgh');
});

test('a listing with no dates still ends its venue at the break', () => {
  /* The streaming items carry no bracketed run, so nothing but the <br> marks
     where the venue stops and the description starts. */
  const [item] = bullets(
    `<p><strong>◦&nbsp;<strong>Absurd Person Singular</strong></strong> on BBC iPlayer<br>The acclaimed 1985 BBC adaptation of the classic play</p>`,
    empty,
  );
  assert.equal(item.title, 'Absurd Person Singular');
  assert.equal(item.where, 'on BBC iPlayer');
  assert.equal(item.when, '');
  assert.equal(
    item.detail,
    'The acclaimed 1985 BBC adaptation of the classic play',
  );
});

test('a short bold line groups the items that follow it', () => {
  const items = bullets(
    `<p><strong>August 2026</strong></p><p><strong>◦&nbsp;One</strong> at A (1 August 2026)</p>` +
      `<p><strong>Streaming</strong></p><p><strong>◦&nbsp;Two</strong> at B (whenever)</p>`,
    empty,
  );
  assert.deepEqual(
    items.map((i) => [i.heading, i.title]),
    [
      ['August 2026', 'One'],
      ['Streaming', 'Two'],
    ],
  );
});

test('a news bulletin keeps its date and its body', () => {
  const [item] = bullets(
    `<p><strong>◦&nbsp;Absurd Person Singular on BBC iPlayer (06/08/26)</strong><em><em><br></em></em>The 1985 BBC adaptation is now available. Click <a href="https://bbc.co.uk/x"><strong>here</strong></a>.</p>`,
    empty,
  );
  assert.equal(item.title, 'Absurd Person Singular on BBC iPlayer');
  assert.equal(item.when, '06/08/26');
  assert.match(item.detail, /^The 1985 BBC adaptation is now available\./);
});

test('the page introduction is not mistaken for a listing', () => {
  const [item] = bullets(
    '<p>This page lists upcoming professional productions of Alan Ayckbourn&#8217;s plays.</p>',
    empty,
  );
  assert.equal(item.kind, 'intro');
  assert.equal(item.title, undefined);
});

test('a run is dated every way the listings write one', () => {
  /* Whether a production is still on is the reader's actual question, so each
     of these has to come out as dates the page can compare against today. */
  assert.deepEqual(runDates('4 September – 3 October 2026'), {
    from: '2026-09-04',
    to: '2026-10-03',
  });
  /* Two days sharing one month, and the year only stated once, at the end. */
  assert.deepEqual(runDates('10 – 15 August 2026'), {
    from: '2026-08-10',
    to: '2026-08-15',
  });
  /* A run over the new year states both years. */
  assert.deepEqual(runDates('20 December 2026 – 10 January 2027'), {
    from: '2026-12-20',
    to: '2027-01-10',
  });
  /* Already open: there is a last night but no first. */
  assert.deepEqual(runDates('Until 19 September 2026'), { to: '2026-09-19' });
  assert.deepEqual(runDates('From 4 September 2026'), { from: '2026-09-04' });
  /* One date, no preposition: a single performance, not an open-ended run. */
  assert.deepEqual(runDates('7 Sept. 2026'), {
    from: '2026-09-07',
    to: '2026-09-07',
  });
  /* A run that breaks for a few nights is still one run, first night to last. */
  assert.deepEqual(runDates('19 – 22, 26 – 29 August 2026'), {
    from: '2026-08-19',
    to: '2026-08-29',
  });
});

test('a curtain-up time is not a pair of dates', () => {
  /* "1.30pm" would otherwise read as the 1st and the 30th, which would make a
     one-off talk look like a month-long run. */
  const on = new Date('2026-08-06T00:00:00Z');
  assert.deepEqual(runDates('11 September at 1.30pm', on), {
    from: '2026-09-11',
    to: '2026-09-11',
  });
  assert.deepEqual(runDates('17 September at 6pm', on), {
    from: '2026-09-17',
    to: '2026-09-17',
  });
});

test('a month with no year means its next occurrence', () => {
  /* The listings page looks forward, so the year comes from when it was last
     updated — and rolls on if that date has already gone by. */
  assert.deepEqual(runDates('4 September', new Date('2026-08-06T00:00:00Z')), {
    from: '2026-09-04',
    to: '2026-09-04',
  });
  assert.deepEqual(runDates('4 September', new Date('2026-10-06T00:00:00Z')), {
    from: '2027-09-04',
    to: '2027-09-04',
  });
  /* A year that is actually written down is never second-guessed. */
  assert.deepEqual(
    runDates('4 September 2026', new Date('2026-10-06T00:00:00Z')),
    { from: '2026-09-04', to: '2026-09-04' },
  );
});

test('an undateable run says so rather than guessing', () => {
  for (const when of ['', 'Streaming', 'Autumn 2026', 'ongoing', 'May 2026']) {
    assert.deepEqual(runDates(when), {}, when);
  }
  /* No year written and no page date to infer one from. */
  assert.deepEqual(runDates('4 September'), {});
});

test('an image keys by width, because two widths are two files', () => {
  const base =
    'https://archivingayckbournhome.wordpress.com/wp-content/uploads/2021/01/1994a-communicating-doors.jpg';
  assert.equal(
    keyFor(`${base}?w=750`),
    'news/2021/1994a-communicating-doors-w750.jpg',
  );
  assert.notEqual(keyFor(`${base}?w=400`), keyFor(`${base}?w=750`));
});

test('an image we could not fetch is dropped, not left broken', () => {
  const html = rewrite(
    '<figure><img src="https://gone.example/x.jpg" alt=""></figure>',
    empty,
  );
  assert.doesNotMatch(html, /<img/);
});

test('a mirrored image carries its dimensions, so nothing shifts', () => {
  const images = new Map([
    [
      'https://wp.example/x.jpg?w=400',
      { url: 'https://r2.example/x.jpg', width: 400, height: 260 },
    ],
  ]);
  const html = rewrite(
    '<img src="https://wp.example/x.jpg?w=400" class="wp-image-1" srcset="x 2x" data-orig-size="9,9">',
    { images, routes: new Map() },
  );
  assert.match(html, /src="https:\/\/r2\.example\/x\.jpg"/);
  assert.match(html, /width="400"/);
  assert.match(html, /height="260"/);
  assert.doesNotMatch(html, /srcset|data-orig-size|wp-image/);
});

test('a link broken at source keeps its words and loses its href', () => {
  /* The archivist pasted an Amazon link and lost the host with it. Root-relative
     on the blog, it points into our site here, where there is nothing at it. */
  const html = rewrite(
    '<p>Buy it <a href="/0746312814/ref=as_li_tl?ie=UTF8">here</a>.</p>',
    empty,
  );
  assert.equal(html, '<p>Buy it here.</p>');
});

test('a link to the archive becomes a link to our route', () => {
  const routes = new Map([
    [
      'http://www.alanayckbourn.net/styled-13/page28.html',
      '/publications/unseen-ayckbourn',
    ],
  ]);
  const html = rewrite(
    '<a href="http://www.alanayckbourn.net/styled-13/page28.html" target="_blank">here</a>',
    { images: new Map(), routes },
  );
  assert.match(html, /href="\/publications\/unseen-ayckbourn"/);
  assert.doesNotMatch(html, /target=/);
});
