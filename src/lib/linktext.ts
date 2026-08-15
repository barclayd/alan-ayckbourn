/**
 * The six hundred links that say "here".
 *
 * The archive writes them the way everybody wrote them: "the online catalogue
 * specific to Pinter can be found here", "The Norman Conquests (click here)".
 * Read in order, the sentence says where the link goes. Read out of order —
 * which is how a screen reader's list of links is read, and how the links of a
 * page are tabbed through — six hundred and seventeen of them say nothing at
 * all, and the reader has to go back into the prose for every one.
 *
 * So each takes the words in front of it as its accessible name: the tail of
 * the sentence it sits at the end of, and then its own word. The page still
 * reads exactly as typed — nothing visible changes, and the name ends with the
 * word on screen so voice control can still say "click here".
 */

import type { Element, ElementContent, Parents, RootContent } from 'hast';
import type { HastPluginDefinition } from 'satteri';

/** The words that are not a destination. Matched against the whole link text. */
const VAGUE =
  /^(click\s+)?(here|this(\s+page)?|link|more|read\s+more)[.,:;)]*$/i;

/** Where a sentence lives — the blocks the archive writes prose in. */
const BLOCK = ['p', 'li', 'td', 'dd', 'figcaption'];

function textOf(node: ElementContent): string {
  if (node.type === 'text') {
    return node.value;
  }
  if (node.type !== 'element') {
    return '';
  }
  /* A line break is a space's worth of gap; without this the line above runs
     into the line below and the last "sentence" is both of them. */
  return node.tagName === 'br' ? ' ' : node.children.map(textOf).join('');
}

/** The last ten words of a run of prose, with the link's own word after them. */
function tail(prose: string, visible: string): string {
  const lead = prose
    .split(' ')
    .filter(Boolean)
    .slice(-10)
    .join(' ')
    /* Half a bracket, left behind by "(click here)", reads as a stray mark. */
    .replaceAll(/[()[\]]/g, '')
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .trim();
  const name = lead === '' ? '' : `${lead} ${visible.trim()}`;
  /* "Click [here]" leaves "Click here", which is the phrase we came to
     replace. No name at all is better than one that pretends to be one. */
  return VAGUE.test(name) ? '' : name;
}

/**
 * The name a link should carry, given the prose in front of it and its own
 * text. The sentence it ends, normally; the one before that as well when the
 * archivist started a fresh one to say "Click here", which on its own says no
 * more than the link did. Empty when there is nothing in front of it worth
 * saying — a link that opens a paragraph has no context to borrow, and a name
 * invented from nowhere is worse than a plain one.
 */
export function nameFor(before: string, visible: string): string {
  const sentences = before
    .replace(/\s+/g, ' ')
    .trimEnd()
    .split(/(?<=[.!?])\s+/);
  return (
    tail(sentences.slice(-1).join(' '), visible) ||
    tail(sentences.slice(-2).join(' '), visible)
  );
}

const ESCAPE: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const ENTITY: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/**
 * The same job done on a string, for the blog.
 *
 * The four hundred and sixty-nine posts came out of WordPress as HTML inside
 * markdown, so a post has no paragraphs to walk: each one arrives whole, as one
 * unparsed string. Tags are stripped to get at the words in front of the link,
 * and the link's opening tag is written back with the name it should have had.
 */
export function labelInHtml(html: string): string {
  const words = (fragment: string) =>
    fragment
      .replaceAll(/<[^>]*>/g, ' ')
      .replaceAll(/&[a-z]+;|&#\d+;/gi, (e) => ENTITY[e.toLowerCase()] ?? ' ');

  return html.replaceAll(
    /<a\b([^>]*)>([\s\S]*?)<\/a>/gi,
    (whole, attrs: string, inner: string, at: number) => {
      const visible = words(inner).replace(/\s+/g, ' ').trim();
      if (!VAGUE.test(visible) || /aria-label=/i.test(attrs)) {
        return whole;
      }
      const name = nameFor(words(html.slice(0, at)), visible);
      return name === ''
        ? whole
        : `<a${attrs} aria-label="${name.replaceAll(/[&<>"]/g, (c) => ESCAPE[c] ?? c)}">${inner}</a>`;
    },
  );
}

/**
 * Sätteri hast plugin.
 *
 * One walk of the whole document rather than a visit per link: a link's own
 * parent is usually the archive's bold or italic rather than the sentence it
 * ends, and the words wanted are the ones already passed. Walking downwards has
 * them in hand by the time the link arrives, however deep the emphasis goes.
 *
 * The four hundred and sixty-nine blog posts are why it is the document and not
 * the paragraph. They came out of WordPress as HTML inside markdown, so a post
 * has no paragraph elements at all: `<p>`, `<a href="…">` and their closing
 * tags are raw text either side of the words, and only a walk that treats a raw
 * tag as a tag can see the link between them.
 */
export default function linkTextPlugin(): HastPluginDefinition {
  return {
    name: 'ayckbourn-link-text',
    element: {
      filter: [...BLOCK, 'a'],
      visit: (node, ctx) => run(node, ctx),
    },
    raw: (node, ctx) => run(node, ctx),
  };
}

/**
 * The document this node belongs to, walked once. Sätteri hands over one node
 * at a time and a blog post has no element worth subscribing to, so the first
 * node of any kind climbs to the root and does the lot.
 */
function run(
  node: Parameters<NonNullable<HastPluginDefinition['raw']>>[0] | Element,
  ctx: Parameters<NonNullable<HastPluginDefinition['raw']>>[1],
): void {
  if (ctx.data.linkText) {
    return;
  }
  let root: Readonly<Parents> | undefined = ctx.parent(node);
  while (root && root.type !== 'root') {
    root = ctx.parent(root);
  }
  if (!root) {
    return;
  }
  ctx.data.linkText = true;

  let before = '';

  const walk = (nodes: readonly RootContent[]) => {
    for (const child of nodes) {
      if (child.type === 'text') {
        before += child.value;
        continue;
      }
      if (child.type === 'raw') {
        const patched = labelInHtml(child.value);
        if (patched !== child.value) {
          ctx.replaceNode(child, { type: 'raw', value: patched });
        }
        /* A block of HTML is a paragraph of its own; nothing carries over. */
        before = '';
        continue;
      }
      if (child.type !== 'element') {
        continue;
      }
      if (child.tagName === 'a') {
        const visible = textOf(child).trim();
        const name = VAGUE.test(visible) ? nameFor(before, visible) : '';
        if (name !== '') {
          ctx.setProperty(child, 'aria-label', name);
        }
        before += visible;
      } else if (child.tagName === 'br') {
        before += ' ';
      } else {
        /* A new block starts a new sentence; emphasis inside one does not. */
        if (BLOCK.includes(child.tagName)) {
          before = '';
        }
        walk(child.children);
      }
    }
  };
  walk(root.children);
}
