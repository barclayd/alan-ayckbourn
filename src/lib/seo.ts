/**
 * The structured-data half of the head.
 *
 * Every page prints one `@graph`: the two nodes that are true everywhere — the
 * site and the man it is about — followed by the page's own. Nodes reference
 * each other by `@id` rather than repeating themselves, which is what lets a
 * play page say "written by that Alan Ayckbourn" instead of describing him
 * again in every one of the ninety-two.
 *
 * Written honestly. This is an unofficial design concept, so the site node
 * points `isBasedOn` at the real archive and carries the archivist's credit;
 * nothing here claims to be published by Haydonning Ltd.
 */

export const SITE_NAME = 'Alan Ayckbourn';
/* The site's own line, not the page's: a WebSite node describing whichever
   article a reader happened to land on is a node that says something different
   on every one of 2,459 pages. */
export const SITE_DESCRIPTION =
  'The work of Sir Alan Ayckbourn: 92 plays across sixty-seven years.';
export const OFFICIAL = 'https://www.alanayckbourn.net/';
export const CREDIT =
  "All research and original material is by Simon Murgatroyd M.A., Alan Ayckbourn's archivist, and copyright of Haydonning Ltd. This is an unofficial design concept, not affiliated with Haydonning Ltd.";

/** An absolute URL, which every `@id` and `url` in a graph has to be. */
export const abs = (site: URL | undefined, path: string) =>
  new URL(path, site).href;

/** The two nodes every page carries, and the ids the rest point at. */
export const siteGraph = (site: URL | undefined) => [
  {
    '@type': 'WebSite',
    '@id': abs(site, '/#website'),
    url: abs(site, '/'),
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    inLanguage: 'en-GB',
    about: { '@id': abs(site, '/#alan') },
    isBasedOn: OFFICIAL,
    creditText: CREDIT,
    /* Pagefind runs in the browser, but `/search?q=` is a real deep link — the
       palette degrades to it and 4,928 links across the archive point at it. */
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: abs(site, '/search?q={search_term_string}'),
      },
      'query-input': 'required name=search_term_string',
    },
  },
  {
    '@type': 'Person',
    '@id': abs(site, '/#alan'),
    name: 'Alan Ayckbourn',
    honorificPrefix: 'Sir',
    jobTitle: ['Playwright', 'Director'],
    birthDate: '1939-04-12',
    birthPlace: { '@type': 'Place', name: 'Hampstead, London' },
    /* Three that resolve to the same person and can be checked: his own site,
       the encyclopaedia, and the identifier the other two are joined by. */
    sameAs: [
      OFFICIAL,
      'https://en.wikipedia.org/wiki/Alan_Ayckbourn',
      'https://www.wikidata.org/wiki/Q712848',
    ],
  },
];

/** The archivist, credited as the author of his own dispatches. */
export const ARCHIVIST = {
  '@type': 'Person',
  name: 'Simon Murgatroyd',
  jobTitle: "Alan Ayckbourn's archivist",
};

/**
 * A breadcrumb trail. Takes the same `{ href, title }` steps the pages already
 * build for their visible breadcrumbs, so the two cannot drift apart, and adds
 * the home page — a trail that starts halfway up is not a trail.
 */
export const breadcrumb = (
  site: URL | undefined,
  steps: { href: string; title?: string }[],
) => ({
  '@type': 'BreadcrumbList',
  itemListElement: [{ href: '/', title: SITE_NAME }, ...steps].map(
    (step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.title,
      item: abs(site, step.href),
    }),
  ),
});

/** `{ name, href }` pairs as an ordered list — a catalogue, in catalogue order. */
export const itemList = (
  site: URL | undefined,
  name: string,
  items: { name: string; href: string }[],
) => ({
  '@type': 'ItemList',
  name,
  numberOfItems: items.length,
  itemListElement: items.map((item, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name: item.name,
    url: abs(site, item.href),
  })),
});

/**
 * The graph as it goes into the document.
 *
 * `<` is escaped because a page title is user content as far as this file is
 * concerned, and `</script>` inside a JSON string would end the block early and
 * hand the rest of the graph to the HTML parser.
 */
export const ldJson = (graph: unknown[]) =>
  JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(
    /</g,
    '\\u003c',
  );
