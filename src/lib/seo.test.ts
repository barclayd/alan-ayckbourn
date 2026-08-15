/**
 * Three things in the graph can be got wrong silently: an `@id` that is not
 * absolute (which un-joins every reference to it), a trail that starts halfway
 * up, and a title carrying markup out of the archive into a `<script>` block.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { abs, breadcrumb, itemList, ldJson, siteGraph } from './seo.ts';

const site = new URL('https://example.test');

test('every id and url in the site graph is absolute', () => {
  const graph = siteGraph(site);
  const urls = JSON.stringify(graph).match(/"https?:[^"]*"|"\/[^"]*"/g) ?? [];

  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.match(url, /^"https?:\/\//, `relative URL in the graph: ${url}`);
  }
});

test('the page nodes point at the site node that is actually emitted', () => {
  const [website, person] = siteGraph(site);

  assert.equal(website['@id'], 'https://example.test/#website');
  assert.equal(person['@id'], 'https://example.test/#alan');
  assert.deepEqual(website.about, { '@id': person['@id'] });
});

test('a trail starts at the home page and numbers from one', () => {
  const { itemListElement } = breadcrumb(site, [
    { href: '/news', title: 'News' },
    { href: '/news/a-post', title: 'A post' },
  ]);

  assert.deepEqual(
    itemListElement.map((step) => [step.position, step.name, step.item]),
    [
      [1, 'Alan Ayckbourn', 'https://example.test/'],
      [2, 'News', 'https://example.test/news'],
      [3, 'A post', 'https://example.test/news/a-post'],
    ],
  );
});

test('a list counts what it contains', () => {
  const list = itemList(site, 'Plays', [
    { name: 'Woman in Mind', href: '/plays/woman-in-mind' },
    { name: 'Bedroom Farce', href: '/plays/bedroom-farce' },
  ]);

  assert.equal(list.numberOfItems, 2);
  assert.equal(list.itemListElement[1].url, abs(site, '/plays/bedroom-farce'));
});

test('a title cannot close the script block it is printed inside', () => {
  const json = ldJson([{ '@type': 'WebPage', name: '</script><img>' }]);

  assert.ok(!json.includes('</script>'));
  assert.equal(JSON.parse(json)['@graph'][0].name, '</script><img>');
});
