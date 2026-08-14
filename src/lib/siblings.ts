import { type CollectionEntry, getCollection } from 'astro:content';

/**
 * The pages that sit alongside this one, and the page they all hang off.
 *
 * Shared because the archive signposts a section twice and in two shapes: a bar
 * that scrolls sideways under the header on a phone, and a right-hand column on
 * a desktop. Same list, two presentations, one query.
 */
export async function siblingsOf(id: string): Promise<{
  root?: CollectionEntry<'archive'>;
  pages: CollectionEntry<'archive'>[];
}> {
  const segments = id.split('/');

  /* A play is its own section — `plays/woman-in-mind` has fourteen pages under
     it. Everything else hangs off its top-level folder: `life`, `career`. */
  const root =
    segments[0] === 'plays' && segments.length > 1
      ? segments.slice(0, 2).join('/')
      : segments[0];

  const all = await getCollection('archive');

  return {
    root: all.find((entry) => entry.id === root),
    pages: all
      .filter(
        (entry) =>
          entry.id.startsWith(`${root}/`) &&
          !entry.id.slice(root.length + 1).includes('/'),
      )
      .sort((a, b) => a.data.order - b.data.order),
  };
}

/** True for the page itself and for anything filed beneath it. */
export const isCurrent = (id: string, candidate: string) =>
  id === candidate || id.startsWith(`${candidate}/`);
