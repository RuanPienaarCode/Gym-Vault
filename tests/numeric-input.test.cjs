'use strict';
/* A 4.3 KM RUN MUST BE LOGGABLE.

   THE BUG, reported live: "running i can add 4,3 km i can only add 4 or 5 no
   decimals". Every logged figure was an `<input type="number">` carrying
   inputmode:'decimal'. Two separate things were wrong with that, and both
   ended with a figure the user entered not being there.

   1. type="number" defaults to step="1", and a value off the step is
      INVALID. inputmode only picks the on-screen keyboard — it says nothing
      about what the field will accept. Verified in a browser: 4.3 in such a
      field reports checkValidity() === false.

   2. type="number" accepts exactly ONE decimal separator, the period,
      whatever the device locale is. Typing "4,3" — how a comma-decimal
      locale writes it, South Africa included — leaves `.value` as an EMPTY
      STRING. The distance did not come out wrong; it disappeared. Also
      verified in a browser.

   So the fields are text inputs with inputmode:'decimal' and the value is
   normalised in dom.numericInput. Text will hold anything, which makes this
   normaliser the thing that stops it: buildRows writes the box's contents
   straight into the note's markdown table.

   AND EVERY FIELD TAKES A DECIMAL, reps and seconds included. A first
   attempt made those two whole-number and it was WORSE than the bug:
   keystrokes arrive one at a time, so "12.5" reached the field as "12",
   "12." and then "125" — the separator was stripped as it was typed and the
   digits joined. A count that silently becomes ten times itself beats no
   sensible alternative. That regression is pinned below. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? { setIcon: () => {} } : origLoad(req, ...rest));
const { normaliseNumber } = require('../src/dom');
Module._load = origLoad;

/* ---------- 1. THE REPORTED CASE ---------- */
{
  assert.strictEqual(normaliseNumber('4,3'), '4.3',
    'a comma is a decimal point — this is the exact value the report could not enter');
  assert.strictEqual(normaliseNumber('4.3'), '4.3', 'and so is a period');
  assert.strictEqual(parseFloat(normaliseNumber('4,3')), 4.3,
    'and it has to survive as a NUMBER, not just as text that looks right');
}

/* ---------- 2. TYPED ONE CHARACTER AT A TIME ---------- */

/* The only way this is really used. A normaliser that is correct on the
   finished string and wrong halfway through it is wrong: every intermediate
   state is a state the field is actually in. */
const typed = text => {
  let box = '';
  for (const ch of text) box = normaliseNumber(box + ch);
  return box;
};

{
  assert.strictEqual(typed('4,3'), '4.3', 'keystroke by keystroke, a comma still lands as a point');
  assert.strictEqual(typed('4.3'), '4.3');
  assert.strictEqual(typed('27.5'), '27.5');
  assert.strictEqual(typed('2,5'), '2.5');
  assert.strictEqual(typed('10'), '10');
  assert.strictEqual(typed('0.5'), '0.5');

  /* THE REGRESSION THAT MADE A COUNT TEN TIMES ITSELF. */
  assert.strictEqual(typed('12.5'), '12.5',
    'stripping the separator as it is typed would join the digits into 125 — a wrong number, '
    + 'which is worse than recording half a rep');
  assert.notStrictEqual(typed('12.5'), '125');

  /* The half-typed states are all reachable, and none of them may throw away
     what came before. */
  assert.strictEqual(normaliseNumber('4'), '4');
  assert.strictEqual(normaliseNumber('4.'), '4.',
    'the trailing point must survive, or the next digit has nothing to attach to');
  assert.strictEqual(parseFloat('4.'), 4, 'and it still reads as a number if the field is left there');
}

/* ---------- 3. WHAT MUST NEVER REACH THE NOTE ---------- */
{
  /* buildRows writes String(set.distance_km).trim() straight into a markdown
     table. A text input will hold anything; this is what stops it. */
  for (const [raw, want] of [
    ['abc', ''],
    ['4a3', '43'],
    ['4 km', '4'],
    ['| 9 |', '9'],
    ['<b>5</b>', '5'],
    ['\n5\n', '5'],
    ['', ''],
    [null, ''],
    [undefined, ''],
  ]) {
    assert.strictEqual(normaliseNumber(raw), want,
      `${JSON.stringify(raw)} must be reduced to ${JSON.stringify(want)} — this string ends up in the note's table`);
  }

  /* A pipe would break the markdown table itself. */
  assert.ok(!normaliseNumber('4|3').includes('|'), 'a pipe must never survive into a table cell');
}

/* ---------- 4. one separator, one sign ---------- */
{
  assert.strictEqual(normaliseNumber('4.3.7'), '4.37',
    'a second separator is a slip — dropping it keeps the digits, which beats emptying the field mid-edit');
  assert.strictEqual(normaliseNumber('4,3,7'), '4.37');
  assert.strictEqual(normaliseNumber('-2.5'), '-2.5', 'a leading minus is kept');
  assert.strictEqual(normaliseNumber('2-5'), '25', 'a minus anywhere else is not a sign');
  assert.strictEqual(normaliseNumber('--5'), '-5');
}

/* ---------- 5. every logging field goes through it ---------- */
{
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const f of ['page-log.js', 'page-session.js']) {
    const src = read(f);
    assert.ok(!/type: 'number'/.test(src),
      `${f}: type="number" is what refused 4.3 and discarded "4,3" — no logging field may use it`);
    assert.match(src, /numericInput\(/, `${f}: its fields must go through the shared input`);
  }

  /* All five: the manual log's rows, the guided weight, distance and
     minutes, and the timed field. */
  const session = read('page-session.js');
  assert.strictEqual((session.match(/numericInput\(/g) || []).length, 4,
    'weight, distance, minutes and the timed field');
  assert.match(read('page-log.js'), /const numInput = \(key, placeholder, cls\) => numericInput\(\{/,
    'and the manual log builds every one of its boxes from it');

  const dom = read('dom.js');
  assert.match(dom, /type: 'text',/, 'a text input is what accepts a comma at all');
  assert.match(dom, /inputmode: 'decimal',/, 'and inputmode is what gives a phone the separator key');
  assert.match(dom, /input\.setSelectionRange\(to, to\)/,
    'rewriting the value moves the caret to the end — it has to be put back, or editing mid-string is unusable');
}

console.log('numeric input OK (4,3 km lands as 4.3; nothing but a number reaches the note; 12.5 never becomes 125)');
