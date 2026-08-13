// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
  site: 'https://alanayckbourn.pages.dev',
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'directory' },
  vite: { plugins: [tailwindcss()] },
  fonts: [
    {
      // Display: condensed poster caps, the theatre-playbill tradition.
      provider: fontProviders.google(),
      name: 'Anton',
      cssVariable: '--font-display',
      weights: [400],
      subsets: ['latin'],
    },
    {
      // Body: long-form reading across ~3,600 pages of archive prose.
      provider: fontProviders.google(),
      name: 'Newsreader',
      cssVariable: '--font-body',
      weights: [400, 500, 600],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
    },
    {
      // UI and metadata labels.
      provider: fontProviders.google(),
      name: 'Inter',
      cssVariable: '--font-ui',
      weights: [400, 500, 600, 700],
      subsets: ['latin'],
    },
  ],
});
