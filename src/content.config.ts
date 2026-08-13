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
    generateId: ({ entry }) => entry.replace(/\/?index\.md$/, ''),
  }),
  schema: z.object({
    title: z.string().min(1),
    /** Original URL, kept so any page can be re-scraped or diffed. */
    source: z.string().url(),
    /** Position in the original site's own navigation. */
    order: z.number().int(),
    /** Slug of the play this page belongs to, for pages under `plays/`. */
    play: z.string().optional(),
    year: z.number().int().min(1950).max(2100).optional(),
    poster: z.string().optional(),
    /** `World Premiere`, `Venue`, `Cast`… label/value pairs from the data sheets. */
    facts: z.record(z.string(), z.string()).optional(),
  }),
});

export const collections = { archive };
