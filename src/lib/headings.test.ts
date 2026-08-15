import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rerank } from './headings.ts';

test('the archive page: every subhead typed as h3', () => {
  assert.deepEqual(rerank([3, 3, 3]), [2, 2, 2]);
});

test('a hierarchy the archivist did type keeps its shape', () => {
  assert.deepEqual(rerank([2, 3, 3, 2, 3]), [2, 3, 3, 2, 3]);
});

test('the one page that jumps h3 to h5 loses the gap, not the nesting', () => {
  assert.deepEqual(rerank([3, 3, 5, 3]), [2, 2, 3, 2]);
});

test('a page opening deeper than it goes on still starts at 2', () => {
  assert.deepEqual(rerank([4, 3]), [2, 2]);
});

test('nesting past h6 stops there rather than printing an h7', () => {
  assert.deepEqual(rerank([1, 2, 3, 4, 5, 6]), [2, 3, 4, 5, 6, 6]);
});
