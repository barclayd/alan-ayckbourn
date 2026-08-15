import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byYear, sortKey } from './plays.ts';

const play = (title: string, year?: number) => ({ data: { title, year } });

test('sortKey files a leading article under the next word', () => {
  assert.equal(sortKey('The Norman Conquests'), 'Norman Conquests');
  assert.equal(sortKey('A Chorus of Disapproval'), 'Chorus of Disapproval');
  assert.equal(sortKey('An Islander'), 'Islander');
  assert.equal(sortKey('Theatre Games'), 'Theatre Games');
});

test('byYear runs chronologically, then alphabetically within a year', () => {
  const plays = [
    play('The Jollies', 2002),
    play('Damsels in Distress', 2001),
    play('Bedside Manners', 2001),
  ];
  assert.deepEqual(
    [...plays].sort(byYear).map((p) => p.data.title),
    ['Bedside Manners', 'Damsels in Distress', 'The Jollies'],
  );
});

test('byYear sends undated works to the end', () => {
  const plays = [play('Untitled'), play('Relatively Speaking', 1965)];
  assert.deepEqual(
    [...plays].sort(byYear).map((p) => p.data.title),
    ['Relatively Speaking', 'Untitled'],
  );
});
