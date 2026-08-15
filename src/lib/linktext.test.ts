import assert from 'node:assert/strict';
import { test } from 'node:test';
import { labelInHtml, nameFor } from './linktext.ts';

test('the sentence in front of the link becomes its name', () => {
  assert.equal(
    nameFor('The online catalogue specific to Pinter can be found ', 'here'),
    'The online catalogue specific to Pinter can be found here',
  );
});

test('half a bracket does not come with it', () => {
  assert.equal(
    nameFor('○ The Norman Conquests (click ', 'here'),
    'The Norman Conquests click here',
  );
});

test('only the last sentence, not the whole paragraph', () => {
  assert.equal(
    nameFor('He wrote it in a week. The script is ', 'here'),
    'The script is here',
  );
});

test('a sentence that is only "Click" borrows the one before it', () => {
  assert.equal(
    nameFor('He guided it through three homes. Click ', 'here'),
    'He guided it through three homes. Click here',
  );
});

test('a link with nothing in front of it is left alone', () => {
  assert.equal(nameFor('  ', 'here'), '');
});

test('the name ends with the word on screen, so the two still match', () => {
  assert.match(nameFor('Tickets are available ', 'click here'), /click here$/);
});

test('a blog post, which arrives as a paragraph of unparsed HTML', () => {
  assert.equal(
    labelInHtml(
      '<p>Further details and bookings can be found <strong><a href="https://sjt.uk.com/x">here</a></strong>.</p>',
    ),
    '<p>Further details and bookings can be found <strong><a href="https://sjt.uk.com/x" aria-label="Further details and bookings can be found here">here</a></strong>.</p>',
  );
});

test('a link that already says where it goes is left as typed', () => {
  const html = '<p>Read it at <a href="/x">the Old Vic</a>.</p>';
  assert.equal(labelInHtml(html), html);
});

test('an ampersand in the prose survives as an attribute', () => {
  assert.match(
    labelInHtml(
      '<p>Tickets for Bed &amp; Board are <a href="/x">here</a>.</p>',
    ),
    /aria-label="Tickets for Bed &amp; Board are here"/,
  );
});
