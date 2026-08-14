/**
 * Three things the archive typed as paragraphs, given back the structure they
 * always had.
 *
 * The original site had one text style, so a page of twenty quotations, a page
 * of questions and answers and a page of essay all came out as the same slab of
 * body text. The markup carried no clue either: a quotation is a paragraph, its
 * source is a line break and an italic, a question is a bold run before another
 * line break. Nothing a reader can scan and nothing a screen reader can name.
 *
 * All three are recognised by shape, narrowly, and nothing else is touched:
 *
 *   quote     text opening with a quotation mark, optionally closing with a
 *             parenthesised source → <blockquote> and its <footer>
 *   note      a paragraph that is entirely italic → the archivist's own aside
 *             to the reader, which is not the page's opening line
 *   question  a bold run ending in "?" before a line break → the question of a
 *             question and answer, on the FAQ pages and in the interviews
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
