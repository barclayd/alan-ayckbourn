// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
  site: 'https://alanayckbourn.pages.dev',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'directory' },
  vite: { plugins: [tailwindcss()] },
  /*
   * `optimizedFallbacks: false` on every family: it makes Astro fetch a font
   * file purely to measure it, and a runner once got a 404 from gstatic for a
   * URL that is in none of Google's current stylesheets — a red build caused
   * by nobody's code. It emitted no fallback @font-face here anyway, so the
   * fetch bought a broken build and nothing else. The declared fallbacks in
   * global.css (Arial Narrow, Georgia, system-ui) are metrically close enough.
   */
  fonts: [
    {
      // Display: condensed poster caps, the theatre-playbill tradition.
      provider: fontProviders.google(),
      name: 'Anton',
      cssVariable: '--font-display',
      weights: [400],
      subsets: ['latin'],
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
      optimizedFallbacks: false,
    },
    {
      // UI and metadata labels.
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-ui',
      weights: [400, 500, 600, 700],
      subsets: ['latin'],
      optimizedFallbacks: false,
    },
  ],
});
