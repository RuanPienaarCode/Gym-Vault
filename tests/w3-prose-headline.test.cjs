'use strict';
/* B-prose-rows: a collapsed prose row with no caps lead-in used the first 8
   words plus an ellipsis, so a perfectly short sentence read as cut off
   ("Sit tall and breathe. Then drive through the heels and..."). The derived
   headline now ends at the first sentence boundary when that sentence is short
   enough, and otherwise at a word boundary near the 8-word limit. */
require('./f3-stub');
const assert = require('node:assert');
const { chunks } = require('../src/dom');

const label = text => chunks([text])[0].label;
const failures = [];
const test = (name, fn) => { try { fn(); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };

test('B-prose-rows a short first sentence is the whole headline', () => {
  assert.strictEqual(label('Sit tall and breathe. Then drive through the heels and stand up with control.'), 'Sit tall and breathe.');
  assert.strictEqual(label('Rest between sets is part of the work! Take the full ninety seconds before the next one.'), 'Rest between sets is part of the work!');
});
test('B-prose-rows a sentence that just fits (10 words) is not cut', () => {
  assert.strictEqual(label('Keep week one easy so week two can be harder. More text follows here.'),
    'Keep week one easy so week two can be harder.');
});
test('B-prose-rows e.g. / i.e. / decimals do not end the sentence early', () => {
  assert.strictEqual(label('Do 3 sets, e.g. 3 x 8, then rest. More text follows here.'), 'Do 3 sets, e.g. 3 x 8, then rest.');
  assert.strictEqual(label('Add 2.5 kg each week once every set feels easy. Stop if form slips.'),
    'Add 2.5 kg each week once every set feels easy.');
  assert.strictEqual(label('Use a light load, e.g. a 6kg bell, for the first two weeks. Then add weight.'),
    'Use a light load, e.g. a 6kg bell…', 'a long sentence cuts at a word boundary, not at "e.g."');
});
test('B-prose-rows a long sentence stops at a word boundary with an ellipsis, no dangling punctuation', () => {
  assert.strictEqual(label('Leaking or dragging during a run, which can happen when you progress too quickly, means go back a step and get it looked at.'),
    'Leaking or dragging during a run, which can…');
  assert.strictEqual(label('Warm up properly before every single session you do this week no matter what.'),
    'Warm up properly before every single session you…');
  assert.strictEqual(label('Stand tall at the top of every rep, and squeeze your glutes hard.'),
    'Stand tall at the top of every rep…', 'a comma at the cut is dropped, not left dangling');
});
test('B-prose-rows control: no sentence break and a long run keeps the 8-word cut', () => {
  assert.strictEqual(label('One two three four five six seven eight nine ten eleven.'), 'One two three four five six seven eight…');
  assert.strictEqual(label('A short note with no stop'), 'A short note with no stop');
});
test('B-prose-rows control: a caps lead-in is still the headline', () => {
  assert.strictEqual(chunks(['THE WEEK: Mon pull, Wed push.'])[0].label, 'THE WEEK:');
});
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('w3 prose headline OK');
