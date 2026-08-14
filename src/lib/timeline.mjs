/**
 * The archive's chronologies, turned into timelines.
 *
 * Fifty-six pages of the original site are chronological lists typed as prose:
 * a bold date, a line break, the event. The archivist wrote them five different
 * ways over twenty years — a bare year, a full date, a year wearing a link, a
 * year with a colon, a year followed by circle-bulleted events — and rendered
 * as markdown they all come out as an undifferentiated wall of bold-then-text.
 *
 * All five reduce to one model: a run of lines, where a line either opens a new
 * date or belongs to the date above it. This finds those runs and rebuilds them
 * as an ordered list banded by year, so a reader can scan the dates alone.
 *
 * Nothing is invented and nothing is dropped: every date label and every event
 * keeps the archivist's own words and links. Only the structure is new.
 */

/* A date label is recognised by exclusion rather than by pattern: it must
   contain a year, and every other word in it must be one a date can contain.
   Matching a pattern instead lets "1952 (John & Peggy Stanton)" through, which
   is a cast list, and "Ayckbourn's 1970s" which is a sentence. */
const YEAR = /^(?:1[6-9]|20)\d{2}$/;
const MONTH = /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?$/i;
const NUMBER = /^\d{1,4}(?:st|nd|rd|th)?$/i;
/* A separator between two halves of one date: "1971 / 1972", "1958 – 1959". */
const DASH = /^[–—/-]$/;
const QUALIFIER =
  /^(?:prior|to|from|between|c|circa|early|mid|late|present|spring|summer|autumn|winter|and|&)\.?$/i;

/* The archivist's bullet: a typed open circle, and the mark this timeline is
   built out of. `*` because a few pages use an asterisk for the same job. */
const BULLET = /^[\s○◦•*]+/;
const ONLY_BULLET = /^[\s○◦•*]+$/;
/* A wrapped line, indented with dot leaders so it lined up in the original:
   "*………*Young People (Mr A's Amazing Maze Plays)". The asterisks are literal —
   markdown does not read a pair wrapping punctuation as emphasis, and the
   archivist meant them as part of the rule. It belongs to the line above. */
const LEADER = /^\*?[.…]{2,}\*?/;

/** Visible text of a hast node, for reading a label. */
function textOf(node) {
  if (node.type === 'text') {
    return node.value;
  }
  return (node.children ?? []).map(textOf).join('');
}

/**
 * The date a label states, or null if it does not state one.
 * `"○ 30 May 1985:"` → `{ label: '30 May 1985', year: 1985 }`
 */
export function dateOf(raw) {
  const label = raw
    .replace(BULLET, '')
    .replace(/:\s*$/, '')
    /* "Mid-March" and "mid March" are the same month written two ways, and the
       hyphen has to go before the span rule below reads it as a range. */
    .replace(/\b(early|mid|late)-/gi, '$1 ')
    /* "1958-1959" and "1958 – 1959" are one span written two ways, and a span
       is dated by the year it opens in either way. */
    .replace(/(\d)\s*[–—-]\s*(\d)/g, '$1 – $2')
    /* Typed as a hyphen, set as an en dash: "1959 - present". */
    .replace(/\s+[–—-]\s+/g, ' – ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = label.split(' ').filter(Boolean);
  const year = words.find((word) => YEAR.test(word));
  if (
    !year ||
    !words.every(
      (word) =>
        NUMBER.test(word) ||
        MONTH.test(word) ||
        DASH.test(word) ||
        QUALIFIER.test(word),
    )
  ) {
    return null;
  }
  return { label, year: Number(year) };
}

/**
 * What to show beside an event when its year is already banded above it.
 * `"30 May 1985"` in the 1985 band → `"30 May"`; a bare `"1986"` → nothing.
 *
 * A label only loses its year when what is left still reads as a date, so
 * "Prior to 1974" and "1958 – 1959" keep theirs rather than becoming "Prior
 * to" and "1958 –".
 */
export function whenOf(label, year) {
  if (label === String(year)) {
    return '';
  }
  const shorter = label.replace(new RegExp(`\\s*\\b${year}\\b\\s*$`), '');
  const last = shorter.split(' ').at(-1) ?? '';
  return shorter && (MONTH.test(last) || NUMBER.test(last)) ? shorter : label;
}

/** Drop edge whitespace from a run of hast children, and empty text nodes. */
function trim(nodes) {
  const out = nodes.slice();
  if (out[0]?.type === 'text') {
    out[0] = { ...out[0], value: out[0].value.replace(/^\s+/, '') };
  }
  if (out.at(-1)?.type === 'text') {
    const last = out.at(-1);
    out[out.length - 1] = { ...last, value: last.value.replace(/\s+$/, '') };
  }
  return out.filter((n) => n.type !== 'text' || n.value !== '');
}

/** A paragraph's children split on `<br>`: the archive writes a line per event. */
function toLines(children) {
  const lines = [[]];
  for (const child of children) {
    if (child.type === 'element' && child.tagName === 'br') {
      lines.push([]);
    } else {
      lines.at(-1).push(child);
    }
  }
  return lines.map(trim).filter((line) => line.length > 0);
}

const isBold = (node) =>
  node?.type === 'element' &&
  (node.tagName === 'strong' || node.tagName === 'b');

/** The href a date label wears, when the archivist linked the year itself. */
function linkOf(node) {
  if (node.type === 'element' && node.tagName === 'a') {
    return node.properties?.href;
  }
  for (const child of node.children ?? []) {
    const href = linkOf(child);
    if (href) {
      return href;
    }
  }
  return undefined;
}

/**
 * What a line is: the start of a date, an event under one, a wrapped
 * continuation of the event above, or a label heading a section.
 */
function readLine(line) {
  const [first, ...rest] = line;

  if (isBold(first)) {
    const date = dateOf(textOf(first));
    if (date) {
      return { kind: 'date', ...date, href: linkOf(first), body: trim(rest) };
    }
    /* The bullet is often bold on its own — `<strong>○</strong> Alan and Hall
       meet…` — because the archivist bolded the whole line and then unbolded
       the sentence. It is the marker, so it goes; the node replaces it. */
    if (ONLY_BULLET.test(textOf(first))) {
      return { kind: 'event', body: trim(rest) };
    }
    /* "**○ T**echnical rehearsals begin": on one page the bold ran a letter
       past the bullet. The mark is still the mark, so it still goes. */
    const inner = first.children ?? [];
    if (inner[0]?.type === 'text' && /^\s*[○◦•]/.test(inner[0].value)) {
      return {
        kind: 'event',
        body: trim([
          {
            ...first,
            children: [
              { ...inner[0], value: inner[0].value.replace(BULLET, '') },
              ...inner.slice(1),
            ],
          },
          ...rest,
        ]),
      };
    }
    /* Bold and nothing else, and not a date: "Oliviers (London)", "As
       Director". It heads the events that follow rather than being one. */
    if (rest.length === 0) {
      return { kind: 'label', body: line };
    }
  }

  /* Before the bullet, because a leader opens with the same asterisk. */
  if (first?.type === 'text' && LEADER.test(first.value.trimStart())) {
    return {
      kind: 'wrap',
      body: trim([
        { ...first, value: first.value.trimStart().replace(LEADER, '') },
        ...rest,
      ]),
    };
  }

  if (first?.type === 'text' && BULLET.test(first.value)) {
    return {
      kind: 'event',
      body: trim([
        { ...first, value: first.value.replace(BULLET, '') },
        ...rest,
      ]),
    };
  }

  return { kind: 'event', body: trim(line) };
}

const el = (tagName, properties, children = []) => ({
  type: 'element',
  tagName,
  properties,
  children,
});

const text = (value) => ({ type: 'text', value });

/**
 * A timeline's date groups banded by year.
 *
 * The archive repeats the year on every entry — "1985 / 1985 / 1985" down the
 * page — because in prose there is nowhere else to put it. Banded, the year is
 * stated once and each event carries only what is finer than it.
 */
function toBands(dates) {
  const bands = [];
  for (const date of dates) {
    if (bands.at(-1)?.year !== date.year) {
      bands.push({ year: date.year, dates: [] });
    }
    bands.at(-1).dates.push(date);
  }
  return bands;
}

/** Years between two bands, when enough passed to be worth saying. */
const GAP_YEARS = 5;

function render(dates, ids) {
  const bands = toBands(dates);
  const children = [];

  for (const [i, band] of bands.entries()) {
    const gap = i > 0 ? band.year - bands[i - 1].year : 0;
    if (gap >= GAP_YEARS) {
      /* An empty stretch is the one thing a list of events cannot show and a
         timeline can: nothing happened to this play between 2000 and 2007. */
      children.push(
        el('li', { className: ['tl-gap'], 'aria-hidden': 'true' }, [
          el('span', {}, [text(`${gap} years`)]),
        ]),
      );
    }

    /* Deep-linkable, and unique even when a page has two 1961s in two sections. */
    let id = `y${band.year}`;
    for (let n = 2; ids.has(id); n += 1) {
      id = `y${band.year}-${n}`;
    }
    ids.add(id);

    const events = band.dates.flatMap((date) => {
      const when = whenOf(date.label, band.year);
      return date.events.map((body, n) =>
        el('li', { className: ['tl-event'] }, [
          /* The date sits in the gutter, and only on the first event it covers:
             three events on one date are one date, not three. Bare years say
             nothing the band above has not said already, so they say nothing. */
          ...(when && n === 0
            ? [el('p', { className: ['tl-when'] }, [text(when)])]
            : []),
          el('div', { className: ['tl-what'] }, body),
        ]),
      );
    });

    /* On the life chronology every year links to that year's own in-depth
       page, and those links are the page's whole navigation. A year with
       nowhere to go stays text rather than becoming a link to itself — the
       band's id already makes it addressable. */
    const href = band.dates.find((date) => date.href)?.href;
    const year = text(String(band.year));

    children.push(
      el('li', { className: ['tl-band'], id }, [
        el('p', { className: ['tl-year'] }, [
          href ? el('a', { href }, [year]) : year,
        ]),
        el('ol', { className: ['tl-events'] }, events),
      ]),
    );
  }

  return el('ol', { className: ['timeline'] }, children);
}

/** How many dated lines a page needs before its lists are read as timelines. */
const MIN_DATES = 6;

/**
 * Rebuild every run of dated paragraphs in a document, in place.
 *
 * A run is one timeline however many paragraphs it is typed across. Forty of
 * the play chronologies put one entry in each of forty paragraphs; read a
 * paragraph at a time they would come out as forty timelines of one date.
 */
function transform(children, ctx) {
  const lines = new Map(
    children
      .filter((node) => node.type === 'element' && node.tagName === 'p')
      .map((node) => [node, toLines(node.children).map(readLine)]),
  );

  /* The threshold is what keeps this off the rest of the archive: three bold
     years in a cast list is not a chronology. Counting page-wide rather than
     paragraph-wide also means the two-award groups on Awards & Honours are
     drawn like the forty-award group below them, not left as prose beside it. */
  const dated = [...lines.values()]
    .flat()
    .filter((line) => line.kind === 'date').length;
  if (dated < MIN_DATES) {
    return;
  }

  /* Anchors are unique per page, not per run. */
  const ids = new Set();
  /* The paragraphs of the open run, and what will stand in for them. */
  let run = [];
  let out = [];
  /* Open date groups within that, flushed as one list when the dates stop. */
  let dates = [];

  const flushDates = () => {
    if (dates.length > 0) {
      out.push(render(dates, ids));
    }
    dates = [];
  };

  const flushRun = () => {
    flushDates();
    if (run.length > 0) {
      ctx.insertBefore(run[0], out);
      for (const node of run) {
        ctx.removeNode(node);
      }
    }
    run = [];
    out = [];
  };

  for (const node of children) {
    /* The newline Sätteri leaves between two paragraphs is not a break in the
       chronology, and neither is it worth removing. */
    if (node.type === 'text' && node.value.trim() === '') {
      continue;
    }

    const read = lines.get(node);
    if (!read?.some((line) => line.kind === 'date')) {
      flushRun();
      continue;
    }
    run.push(node);

    for (const line of read) {
      const open = dates.at(-1);
      if (line.kind === 'date') {
        dates.push({ ...line, events: line.body.length ? [line.body] : [] });
      } else if (line.kind === 'label') {
        /* A section label heads the dates below it: "Oliviers (London)". */
        flushDates();
        out.push(el('p', { className: ['tl-label'] }, line.body));
      } else if (!open) {
        /* A lead-in sentence before the run's first date is just prose. */
        flushDates();
        out.push(el('p', {}, line.body));
      } else if (line.kind === 'wrap' && open.events.length > 0) {
        open.events.at(-1).push(text(' '), ...line.body);
      } else {
        open.events.push(line.body);
      }
    }
  }
  flushRun();
}

/**
 * Sätteri hast plugin.
 *
 * Sätteri dispatches node by node rather than handing over the tree, but a
 * chronology is a property of a whole document — both the threshold below and
 * the run-merging above need to see all of it. So the first paragraph visited
 * reads the document off `ctx.parent()` and does the work for all of them;
 * every later paragraph, including the ones this replaced, falls straight
 * through the flag.
 */
export default function timelinePlugin() {
  return {
    name: 'ayckbourn-timeline',
    element: {
      filter: ['p'],
      visit(node, ctx) {
        if (ctx.data.timeline) {
          return;
        }
        const root = ctx.parent(node);
        /* A pull-out box carries prose, not a chronology. Waiting for a
           paragraph of the document's own body also means the flag is not
           spent on one. */
        if (root?.type !== 'root') {
          return;
        }
        ctx.data.timeline = true;
        transform(root.children, ctx);
      },
    },
  };
}
