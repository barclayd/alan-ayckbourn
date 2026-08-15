/**
 * The order the plays come in.
 *
 * One definition, because two places print it: the index, and the band at the
 * foot of a play landing that hands the reader the next one. A reader who works
 * through the archive by that band should arrive at the same sequence they would
 * have got by reading the grid left to right.
 */

/** As much of a play as the order looks at. */
export type Play = { data: { title: string; year?: number } };

/** Files "The Norman Conquests" under N, as a library would. */
export const sortKey = (title: string) => title.replace(/^(the|a|an)\s+/i, '');

/**
 * Chronological: it is the shape of a working life. Undated works sort to the
 * end rather than to 1959, and same-year plays fall back to the shelf order —
 * the Play Number would be the obvious tie-break, but only 94 of the 149
 * landings carry one, so it would order some years and not others.
 */
export const byYear = (a: Play, b: Play) =>
  (a.data.year ?? Number.POSITIVE_INFINITY) -
    (b.data.year ?? Number.POSITIVE_INFINITY) ||
  sortKey(a.data.title).localeCompare(sortKey(b.data.title));
