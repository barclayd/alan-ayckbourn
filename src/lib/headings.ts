/**
 * The archive's subheads, given the rank they actually hold.
 *
 * Every page of the original site was typed with `###` for its top-level
 * subhead — 3,507 of them against thirty `##` — because the software it was
 * written in styled that one and the levels above it were the site's own
 * furniture. Rendered straight, the page's title is an h1 and its first
 * section is an h3: a level skipped on nearly three thousand pages, which is
 * the one heading fault Lighthouse actually scores, and a reader moving by
 * heading is told a section is missing that never existed.
 *
 * So the ranks are read as a shape rather than as numbers: the first heading
 * of a page is level 2 whatever it was typed as, and each one nested under it
 * is one deeper. `###` under `###` stays a sibling; a lone `#####` under a
 * `###` becomes the h3 it was standing in for. The archivist's own hierarchy
 * is kept exactly — only its offset from the page title is corrected.
 *
 * The cost, paid deliberately: on the fifteen dozen pages that merge a whole
 * section into one scroll, a merged page's own subheads now sit level with the
 * band that introduces them rather than under it. The same markdown serves
 * both a merged page and the page it still has of its own, and Astro compiles
 * it once — so one of the two contexts has to be the one the ranks are right
 * for. It is the one with 2,750 pages in it.
 */

import type { Element } from 'hast';
import type { HastPluginDefinition } from 'satteri';

/**
 * The rank each heading should print at, given the ranks as typed. Exported
 * for the test; the plugin below is the same walk with a hast node attached.
 */
export function rerank(levels: number[]): number[] {
  const open: number[] = [];
  return levels.map((level) => {
    while (open.length > 0 && (open.at(-1) ?? 0) >= level) {
      open.pop();
    }
    open.push(level);
    /* +1 because the page's own title is the h1 and nothing in the prose is. */
    return Math.min(open.length + 1, 6);
  });
}

/**
 * Sätteri hast plugin. A factory rather than an object, so the open-heading
 * stack is per document — see `hastPlugins`, which calls it once per compile.
 */
export default function headingPlugin(): HastPluginDefinition {
  const open: number[] = [];
  return {
    name: 'ayckbourn-headings',
    element: {
      filter: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'],
      visit(node, ctx) {
        const level = Number(node.tagName.slice(1));
        while (open.length > 0 && (open.at(-1) ?? 0) >= level) {
          open.pop();
        }
        open.push(level);
        const to = Math.min(open.length + 1, 6);
        if (to === level) {
          return;
        }
        const replacement: Element = {
          type: 'element',
          tagName: `h${to}`,
          properties: node.properties,
          children: node.children,
        };
        ctx.replaceNode(node, replacement);
      },
    },
  };
}
