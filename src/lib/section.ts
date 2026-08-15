import { getCollection } from 'astro:content';
import { branch } from './branch.ts';

export {
  anchorOf,
  isCurrent,
  labelOf,
  printsOwnIndex,
  RAIL_MAX,
} from './branch.ts';

/** The section list for a page — see `branch`, which is where the rules live. */
export const branchOf = async (id: string) =>
  branch(await getCollection('archive'), id);
