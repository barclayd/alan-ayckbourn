/**
 * Which pages the section list shows, and what to call them.
 *
 * Kept apart from the collection so the rules can be tested against fixtures —
 * `section.ts` is the wrapper that hands them the real thing.
 */

/** As much of an archive entry as any of these rules looks at. */
export type Page = {
  id: string;
  body?: string;
  data: { title: string; order: number };
};

export type Link = { id: string; label: string };

/**
 * The most pages the section list will carry.
 *
 * Seven pages in the archive hold more children than this — the encyclopaedia's
 * cast lists, the chronology's years — and a rail of a hundred names is a
 * scrollbar, not a way around. Those pages lay their own contents out instead.
 * Nothing in the archive has between sixteen and twenty-five children, so the
 * line falls in empty space rather than through the middle of anything.
 */
export const RAIL_MAX = 20;

/**
 * What to call a page in a list of its siblings.
 *
 * The original site titled a page after the folder it sat in, so 324 pages carry
 * their parent's title instead of their own: five of How The Other Half Loves'
 * six articles are all called "Articles". The real title is the heading the
 * article opens with, which 319 of those 324 have. Another 403 file the section
 * in front of their own name — "Ayckbourn Chronology: 1957" under "Chronology" —
 * and in a list of that section's pages the front half is the only thing every
 * row has in common. A colon whose left side does not end in the parent's name
 * is somebody's actual title ("Stephen Joseph: The Man Who Inspired Alan
 * Ayckbourn") and is left alone.
 *
 * `parent` is the parent page's title.
 */
export const labelOf = (entry: Page, parent?: string) => {
  const title = entry.data.title;
  if (!parent) {
    return title;
  }
  if (title === parent) {
    const heading = entry.body?.match(/^#{2,3}\s+(.+?)\s*$/m)?.[1];
    return heading?.replace(/[*_]/g, '') ?? title;
  }
  const [prefix, ...rest] = title.split(': ');
  return rest.length > 0 && prefix.endsWith(parent) ? rest.join(': ') : title;
};

/**
 * Whether a page lays its own contents out instead of leaving them to the
 * column. True of the seven catalogues too long for a column, and of the two
 * A–Zs: twenty-six letters are a keyboard, not a reading list, and both of those
 * pages tell the reader in prose to click on a letter.
 *
 * Asked of the same labels in both places, so a page's children are listed once
 * and in one shape.
 */
export const printsOwnIndex = (labels: string[]) =>
  labels.length > RAIL_MAX ||
  (labels.length > 6 && labels.every((label) => label.length <= 5));

/**
 * The pages filed one level under `id`, in the archive's own order.
 */
const under = (all: Page[], id: string) =>
  all
    .filter(
      (entry) =>
        entry.id.startsWith(`${id}/`) &&
        !entry.id.slice(id.length + 1).includes('/'),
    )
    .sort((a, b) => a.data.order - b.data.order);

const linksTo = (all: Page[], id: string): Link[] => {
  const parent = all.find((entry) => entry.id === id)?.data.title;
  return under(all, id).map((entry) => ({
    id: entry.id,
    label: labelOf(entry, parent),
  }));
};

/**
 * The section list a page shows, as a disclosure on a phone and a right-hand
 * column on a desktop. Same query, two presentations.
 *
 * `pages` is the section: everything hanging off the head, which for a play is
 * the play itself and otherwise the top-level folder. `nested` is the one group
 * that opens inside it — the current page's own children, or, on a page that has
 * none, the pages either side of it. It opens because the reader is standing in
 * it, so there is no toggle to set and no state to get wrong.
 *
 * 208 pages of the archive's own prose say some version of "click on a link in
 * the right-hand column", and what they mean by it is that page's children. A
 * column of siblings alone would leave every one of those sentences pointing at
 * the wrong list.
 */
export function branch(all: Page[], id: string) {
  const segments = id.split('/');

  /* A play is its own section — `plays/woman-in-mind` has fourteen pages under
     it. Everything else hangs off its top-level folder: `life`, `career`. */
  const rootId =
    segments[0] === 'plays' && segments.length > 1
      ? segments.slice(0, 2).join('/')
      : segments[0];

  const own = linksTo(all, id);
  const parent = id.slice(0, id.lastIndexOf('/'));

  /* On the head itself the children are the section, and printing them twice a
     centimetre apart says nothing the once did not. A leaf directly under the
     head is already in `pages` for the same reason, so it opens nothing and
     falls back to the section around it. */
  let nested: Link[] = [];
  if (id !== rootId) {
    if (own.length > 0) {
      nested = printsOwnIndex(own.map((link) => link.label)) ? [] : own;
    } else if (parent !== rootId) {
      nested = linksTo(all, parent);
    }
  }

  return {
    root: all.find((entry) => entry.id === rootId),
    pages: linksTo(all, rootId),
    nested: nested.length > RAIL_MAX ? [] : nested,
  };
}

/**
 * True for the page itself and for anything filed beneath it.
 */
export const isCurrent = (id: string, candidate: string) =>
  id === candidate || id.startsWith(`${candidate}/`);
