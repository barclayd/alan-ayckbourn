import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Every scraped page of the original site, keyed by its new route:
 * `plays/absurd-person-singular/history`, `life/school-days`, `career/actor`.
 * Written by `scripts/scrape.mjs` — hand-editable afterwards, which is the point.
 */
const archive = defineCollection({
  loader: glob({
    pattern: '**/index.md',
    base: './src/content/archive',
    /*
     * `plays/woman-in-mind/index.md` → `plays/woman-in-mind`. The archive's own
     * front page would strip to the empty string, which Astro rejects as an ID,
     * and it cannot keep `/` anyway — that is our homepage now. It becomes
     * `welcome`: the page introduces itself that way, and it carries the
     * archivist's credit and The Stage's endorsement, which are not ours to drop.
     */
    generateId: ({ entry }) => entry.replace(/\/?index\.md$/, '') || 'welcome',
  }),
  /* `image()` resolves `./_images/…` against the entry, so posters go through
     Astro's pipeline and arrive with intrinsic dimensions. */
  schema: ({ image }) =>
    z.object({
      title: z.string().min(1),
      /** Original URL, kept so any page can be re-scraped or diffed. */
      source: z.string().url(),
      /** Position in the original site's own navigation. */
      order: z.number().int(),
      /** Slug of the play this page belongs to, for pages under `plays/`. */
      play: z.string().optional(),
      year: z.number().int().min(1950).max(2100).optional(),
      poster: image().optional(),
      /** `World Premiere`, `Venue`, `Cast`… label/value pairs from the data sheets. */
      facts: z.record(z.string(), z.string()).optional(),
    }),
});

export const collections = { archive };
