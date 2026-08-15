// @ts-check

import { satteri } from '@astrojs/markdown-satteri';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';
import prosePlugin from './src/lib/prose.ts';
import timelinePlugin from './src/lib/timeline.ts';

export default defineConfig({
  site: 'https://alan-ayckbourn.barclaysd.workers.dev',
  output: 'static',
  trailingSlash: 'never',
  build: {
    format: 'directory',
    /* The whole site's CSS is one 13KB file, and it is the only thing that
       blocks the first paint. Fetched, it costs a round trip and then a share
       of a phone's bandwidth against the fonts and the hero photograph, none
       of which can paint until it lands. Inlined it arrives with the HTML that
       needs it. The price is 13KB re-sent on every page rather than served
       from cache on the second — worth it here, where most arrivals are
       somebody following a link to one page. */
    inlineStylesheets: 'always',
  },
  vite: { plugins: [tailwindcss()] },
  /* News heroes live in R2 rather than the repo, and the archive's own blog
     stores whatever WordPress had — mostly 350px thumbnails, but a dozen at
     1000–1800px, one of them 822KB of JPEG rendered into a 416px-tall box.
     Naming the bucket here lets the build put those through the same pipeline
     as every local image: downscaled to the size it is actually shown at, in
     the formats a browser would rather have. Nothing else is fetched from it,
     so this is not a general licence to hotlink. */
  image: { domains: ['pub-4c23c36058c0491eaa4d6d55c25b33de.r2.dev'] },
  /* Astro's own processor, with two plugins added. Both read structure back out
     of prose the original site had no styles to express: chronologies as
     timelines, and quotations, archivist's notes and questions as themselves.
     Timeline first — it claims whole runs of paragraphs, and a paragraph it has
     rebuilt into a timeline is no longer a paragraph for prose to look at. */
  markdown: {
    processor: satteri({ hastPlugins: [timelinePlugin, prosePlugin] }),
  },
  /*
   * `optimizedFallbacks: false` on every family: it makes Astro fetch a font
   * file purely to measure it, and a runner once got a 404 from gstatic for a
   * URL that is in none of Google's current stylesheets — a red build caused
   * by nobody's code. It emitted no fallback @font-face here anyway, so the
   * fetch bought a broken build and nothing else.
   *
   * `fallbacks` is therefore declared here and NOT in global.css. The <Font>
   * component writes `:root{--font-x: …}` in an unlayered <style>, and
   * unlayered beats every @layer — so Tailwind's @theme value, which lives in
   * `@layer theme`, never applies. A fallback list written there is dead text:
   * every family fell through to bare `sans-serif`, which is why body copy set
   * in a serif and headings set in an ultra-condensed face both reflowed on
   * swap. These lists are the ones the browser actually reads.
   */
  fonts: [
    {
      // Display: condensed poster caps, the theatre-playbill tradition.
      provider: fontProviders.google(),
      name: 'Anton',
      cssVariable: '--font-display',
      weights: [400],
      subsets: ['latin'],
      fallbacks: ['Arial Narrow', 'Helvetica Neue', 'sans-serif'],
      optimizedFallbacks: false,
    },
    {
      // Body: long-form reading across ~3,600 pages of archive prose.
      provider: fontProviders.google(),
      name: 'Newsreader',
      cssVariable: '--font-body',
      weights: [400, 500, 600],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['Georgia', 'Times New Roman', 'serif'],
      optimizedFallbacks: false,
    },
    {
      // UI and metadata labels.
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-ui',
      weights: [400, 500, 600, 700],
      /* Roman only. `styles` defaults to both, and the italic was a second
         51KB file for a face used on nav, labels and datelines — the one place
         in the design nothing is ever set in italic. */
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['system-ui', 'Segoe UI', 'Helvetica', 'sans-serif'],
      optimizedFallbacks: false,
    },
  ],
});
