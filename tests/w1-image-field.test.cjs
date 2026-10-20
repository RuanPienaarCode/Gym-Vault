'use strict';
/* L2-15 — the exercise Edit form's Images box split on EVERY comma, so a URL
   containing a comma (…/a.jpg?w=1,2) came back as two broken entries after one
   save. Commas still separate entries; a comma INSIDE a URL (or inside an
   unclosed [[wikilink]]) does not. */
const assert = require('node:assert');
const { makeDocument } = require('./plans-dom-stub');
const { loadSrc, makeRunner } = require('./gym-fake-vault');
global.document = makeDocument();
const { parseImages } = loadSrc('page-exercises.js');
const { check, run } = makeRunner();

check('L2-15 a URL containing a comma stays one entry', () => {
  assert.strictEqual(parseImages('https://img.example/a.jpg?sizes=100,200'), 'https://img.example/a.jpg?sizes=100,200');
});

check('L2-15 two URLs, one with a comma inside, still come out as two and survive a form round trip', () => {
  const list = ['https://img.example/a.jpg?sizes=100,200', 'https://img.example/b.jpg'];
  assert.deepStrictEqual(parseImages(list.join(', ')), list);
  assert.deepStrictEqual(parseImages(list.join(',')), list, 'no space after the separator');
});

check('L2-15 a wikilink with a comma in its name is not split', () => {
  assert.strictEqual(parseImages('[[Attachments/Bench, flat/a.jpg]]'), '[[Attachments/Bench, flat/a.jpg]]');
  assert.deepStrictEqual(parseImages('[[Attachments/Bench, flat/a.jpg]], [[Attachments/Bench, flat/b.jpg]]'), ['[[Attachments/Bench, flat/a.jpg]]', '[[Attachments/Bench, flat/b.jpg]]']);
});

check('L2-15 everything that split before still splits the same way', () => {
  assert.strictEqual(parseImages(''), '');
  assert.strictEqual(parseImages('  '), '');
  assert.strictEqual(parseImages('Gym/a.jpg'), 'Gym/a.jpg');
  assert.deepStrictEqual(parseImages('Gym/a.jpg, Gym/b.jpg'), ['Gym/a.jpg', 'Gym/b.jpg']);
  assert.deepStrictEqual(parseImages('Gym/a.jpg,Gym/b.jpg'), ['Gym/a.jpg', 'Gym/b.jpg']);
  assert.deepStrictEqual(parseImages('Gym/a.jpg,  https://x.example/b.jpg ,'), ['Gym/a.jpg', 'https://x.example/b.jpg']);
  assert.deepStrictEqual(parseImages('https://x.example/0.jpg, https://x.example/1.jpg'), ['https://x.example/0.jpg', 'https://x.example/1.jpg']);
});

run('w1-image-field');
