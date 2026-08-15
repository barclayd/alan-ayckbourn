/**
 * Five things the archive typed as paragraphs, given back the structure they
 * always had.
 *
 * The original site had one text style, so a page of twenty quotations, a page
 * of questions and answers and a page of essay all came out as the same slab of
 * body text. The markup carried no clue either: a quotation is a paragraph, its
 * source is a line break and an italic, a question is a bold run before another
 * line break. Nothing a reader can scan and nothing a screen reader can name.
 *
 * All five are recognised by shape, narrowly, and nothing else is touched:
 *
 *   quote     text opening with a quotation mark, optionally closing with a
 *             parenthesised source → <blockquote> and its <footer>
 *   note      a paragraph that is entirely italic → the archivist's own aside
 *             to the reader, which is not the page's opening line
 *   question  a bold run ending in "?" before a line break → the question of a
 *             question and answer, on the FAQ pages and in the interviews
 *   record    bold labels ending in a colon, one per line → the production data
 *             sheet, set as the <dl> a play landing already prints
 *   cast      two bold words heading a run of bold role and roman actor →
 *             a real <table>, with the credits above it as a record
 *
 * Nothing is invented and nothing is dropped: the archivist's words, links and
 * emphasis are kept as typed. Only the parentheses around a source go, because
 * they were the only mark saying "this is the source" and the <footer> says it
 * now.
 */

/** Visible text of a hast node. */
function textOf(node) {
  if (node.type === 'text') {
    return node.value;
  }
  return textOfAll(node.children ?? []);
}

const textOfAll = (nodes) => nodes.map(textOf).join('');

const el = (tagName, properties, children = []) => ({
  type: 'element',
  tagName,
  properties,
  children,
});

const isBr = (node) => node.type === 'element' && node.tagName === 'br';

/** Children after the last line break, and everything before it. */
function splitLastLine(children) {
  const at = children.findLastIndex(isBr);
  return at < 0
    ? { body: children, last: [] }
    : { body: children.slice(0, at), last: children.slice(at + 1) };
}

/* A source, as the archive writes one: "(Yorkshire Post, 23 March 2019)", in
   italics or not. Anchored both ends so a quotation merely ending on a
   parenthesis is not mistaken for one. */
const SOURCE = /^\(([^()]*(?:\([^()]*\)[^()]*)*)\)\.?$/;
const YEAR = /\b(1[6-9]\d{2}|20\d{2})\b/g;

/**
 * The source line of a quotation, unwrapped from its parentheses.
 * Returns null when the last line is not one.
 */
export function sourceOf(children) {
  const { body, last } = splitLastLine(children);
  const matched = SOURCE.exec(textOfAll(last).trim());
  if (body.length === 0 || !matched) {
    return null;
  }

  /* The parentheses are the first and last characters of the run, however many
     nodes deep the italics and links go — so they come off the first and last
     text nodes, wherever those are. */
  const inner = structuredClone(last);
  const ends = [];
  const findText = (nodes) => {
    for (const node of nodes) {
      if (node.type === 'text' && node.value.trim() !== '') {
        ends.push(node);
      } else if (node.children) {
        findText(node.children);
      }
    }
  };
  findText(inner);
  if (ends.length > 0) {
    ends[0].value = ends[0].value.replace(/^\s*\(/, '');
    ends.at(-1).value = ends.at(-1).value.replace(/\)\.?\s*$/, '');
  }

  /* The last year named, which for "Modern Dramatists: Alan Ayckbourn, 1983" is
     the date and for "Grinning At The Edge" is nothing at all. */
  const year = matched[1].match(YEAR)?.at(-1);
  return { body, source: inner, year };
}

/** Whether every word of a paragraph is italic — punctuation aside. */
export function isNote(children) {
  let sawItalic = false;
  const walk = (nodes, inEm) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        if (inEm) {
          sawItalic ||= node.value.trim() !== '';
          /* Bare punctuation outside the italics is the full stop the archivist
             left outside the asterisks; bare words are prose. */
        } else if (/[\p{L}\p{N}]/u.test(node.value)) {
          return false;
        }
      } else if (node.children) {
        const em = inEm || (node.type === 'element' && node.tagName === 'em');
        if (!walk(node.children, em)) {
          return false;
        }
      }
    }
    return true;
  };
  return walk(children, false) && sawItalic;
}

/** A paragraph's hard-break lines, without the newlines that joined them. */
function linesOf(children) {
  const lines = [[]];
  for (const node of children) {
    if (isBr(node)) {
      lines.push([]);
    } else {
      lines.at(-1).push(node);
    }
  }
  return lines
    .map((line) =>
      line.filter(
        (node, i) =>
          !(node.type === 'text' && node.value.trim() === '' && i === 0),
      ),
    )
    .filter((line) => line.length > 0);
}

const isStrong = (node) =>
  node?.type === 'element' && node.tagName === 'strong';

/** A line's bold lead and everything after it, or null if it has no lead. */
function labelled(line) {
  const [first, ...rest] = line;
  if (!isStrong(first)) {
    return null;
  }
  /* The space the archivist typed after the label belongs to neither. */
  const value = structuredClone(rest);
  if (value[0]?.type === 'text') {
    value[0].value = value[0].value.replace(/^ /, '');
  }
  return { label: first.children, value };
}

/**
 * The production data sheet: "**Venue:** Birmingham Theatre Centre", a run of
 * them joined by line breaks. The archive typed a table of one production's
 * facts as one paragraph, so a venue, a date and a lighting designer all read
 * as the same sentence. 738 pages carry one.
 *
 * The colon is what marks a label, and it has to be there: a paragraph of bold
 * lead-ins without one is the cast list below, or prose.
 */
function recordOf(lines) {
  const rows = [];
  for (const line of lines) {
    const pair = labelled(line);
    const label = pair && textOfAll(pair.label).trim();
    if (!label?.endsWith(':')) {
      /* A value the archivist put on its own line, under its label. Anything
         else — a line with no label above it — is not a data sheet. */
      if (rows.length === 0 || isStrong(line[0])) {
        return null;
      }
      rows.at(-1).value.push({ type: 'text', value: ' ' }, ...line);
      continue;
    }
    rows.push({
      label: [{ type: 'text', value: label.slice(0, -1) }],
      value: pair.value,
    });
  }

  return rows.length < 2 ? null : sheet(rows);
}

/**
 * A run of label/value pairs, set as the data sheet at the top of a play page.
 *
 * Each pair in its own <div>, which a <dl> allows and which is what keeps the
 * label above its value in a two-column grid; loose, the grid takes them as
 * four separate cells and the sheet becomes a column of labels a hand's width
 * from a column of values.
 */
const sheet = (rows) =>
  el(
    'dl',
    { className: ['record'] },
    rows.map(({ label, value }) =>
      el('div', {}, [el('dt', {}, label), el('dd', {}, value)]),
    ),
  );

/**
 * The cast list: a header of two bold words, then a bold role and the person
 * who played it on every line after. 407 pages carry one, and until now every
 * one of them rendered as bold-then-roman prose — so "Character Actor" read as
 * a job description and the six pairs under it as one long sentence.
 *
 * Recognised by shape rather than by the word "Character", which is what lets
 * the twelve "Characters / Actors" pages, the two team sheets and the running
 * order set as "Act 1 / Act 2" through on the same path.
 */
function tableOf(lines) {
  /* The header is two bold words alone on their line, and it is not always the
     first line: half these pages credit the director or the company above the
     cast, in the same paragraph. Those credits are the data sheet's shape, so
     they are set as one and the table starts where the header is. */
  const columnsOf = (line) => {
    const bold = line.filter(
      (node) => node.type !== 'text' || node.value.trim(),
    );
    return bold.length === 2 && bold.every(isStrong) ? bold : null;
  };
  const at = lines.findIndex(columnsOf);
  const columns = at < 0 ? null : columnsOf(lines[at]);
  if (!columns) {
    return null;
  }

  const credits = lines.slice(0, at).map(labelled);
  const rows = lines.slice(at + 1).map(labelled);
  if (
    rows.length === 0 ||
    rows.some((row) => row === null) ||
    credits.some((row) => row === null)
  ) {
    return null;
  }

  const right = textOfAll(columns[1].children).trim();
  /* Named where the name is true. Nearly all of these are casts, and "Cast" is
     what a reader and a screen reader both want to hear; a running order or a
     team sheet is not one and gets no caption rather than a wrong one. */
  const isCast = /^actors?\b/i.test(right);

  const table = el('table', { className: ['cast'] }, [
    ...(isCast ? [el('caption', {}, [{ type: 'text', value: 'Cast' }])] : []),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, columns[0].children),
        el('th', { scope: 'col' }, columns[1].children),
      ]),
    ]),
    el(
      'tbody',
      {},
      rows.map(({ label, value }) =>
        el('tr', {}, [
          /* The role is the row's own heading, so reading cell by cell gives
             "Stanley, Alan Ayckbourn" rather than two unattached names. */
          el('th', { scope: 'row' }, label),
          el('td', {}, value),
        ]),
      ),
    ),
  ]);

  /* One node goes back to the tree, so a paragraph holding both a credit and a
     cast hands back the pair of them wrapped rather than losing one. */
  return credits.length === 0 ? table : el('div', {}, [sheet(credits), table]);
}

/** The question of a question and answer: bold, ending in "?", then a break. */
function questionOf(children) {
  const [first, second] = children;
  return (
    first?.type === 'element' &&
    first.tagName === 'strong' &&
    textOf(first).trim().endsWith('?') &&
    second !== undefined &&
    isBr(second)
  );
}

/** What a paragraph is rebuilt as, or null to leave it alone. */
export function rebuild(node) {
  const children = node.children ?? [];
  const text = textOf(node).trimStart();
  const cited = sourceOf(children);

  /* Before the quotations: both are runs of bold-led lines and neither can
     start with a quotation mark, so the stricter shapes go first and a
     paragraph that is not one of them falls through unchanged. */
  const lines = children.some(isBr) ? linesOf(children) : [];
  if (lines.length > 1) {
    const tabulated = recordOf(lines) ?? tableOf(lines);
    if (tabulated) {
      return tabulated;
    }
  }

  /* Alan speaking. The quotation mark is what says so, and it is the only thing
     that does — the archive's review extracts are set exactly the same way. */
  if (text.startsWith('"') || text.startsWith('“')) {
    const { body, source, year } = cited ?? { body: children };
    return el('blockquote', { className: ['quote'] }, [
      ...(year
        ? [
            el('span', { className: ['q-year'], 'aria-hidden': 'true' }, [
              { type: 'text', value: year },
            ]),
          ]
        : []),
      el('p', {}, body),
      ...(source ? [el('footer', {}, source)] : []),
    ]);
  }

  if (questionOf(children)) {
    return el('p', { className: ['qa'] }, children);
  }

  /* Somebody else's writing, quoted: a premiere review, a passage from a book.
     Same source line, no dateline — a page of premiere reviews is fourteen
     notices of one first night, so a column of the same year down the margin
     would be fourteen times nothing.

     After a quotation, a parenthesised tail can only be the source. After plain
     prose it is as often the archivist explaining the extract he is about to
     print, and his explanations run longer than the line they follow — so here,
     and only here, a source has to be shorter than what it attributes. */
  if (cited && textOfAll(cited.source).length < textOfAll(cited.body).length) {
    return el('blockquote', { className: ['extract'] }, [
      el('p', {}, cited.body),
      el('footer', {}, cited.source),
    ]);
  }

  if (isNote(children)) {
    return el('p', { className: ['note'] }, children);
  }

  return null;
}

/**
 * Sätteri hast plugin.
 *
 * Body paragraphs only. A pull-out box is a column the width of a caption, and
 * a quotation set in one has nowhere to hang its year; inside one, a paragraph
 * stays a paragraph.
 */
export default function prosePlugin() {
  return {
    name: 'ayckbourn-prose',
    element: {
      filter: ['p'],
      visit(node, ctx) {
        if (ctx.parent(node)?.type !== 'root') {
          return;
        }
        const rebuilt = rebuild(node);
        if (rebuilt) {
          ctx.replaceNode(node, rebuilt);
        }
      },
    },
  };
}
