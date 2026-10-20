'use strict';
/* L1-08 — a hand-typed decimal comma in a table ("7,5") read as 7.
   Accepted ONLY for digits, a comma, then one or two digits. "1,000" is a
   thousands separator or a typo; it is NOT read as 1.0 (it stays what it was). */
const assert = require('node:assert');
const { makeRunner } = require('./gym-fake-vault');
const { num, exerciseBests } = require('../src/stats');
const { check, run } = makeRunner();

check('L1-08 "7,5" reads as 7.5 and "62,25" as 62.25', () => {
  assert.strictEqual(num('7,5'), 7.5);
  assert.strictEqual(num('62,25'), 62.25);
  assert.strictEqual(num(' 7,5 '), 7.5);
});

check('L1-08 "1,000" is NOT read as 1.0 (three digits after the comma is not a decimal)', () => {
  assert.strictEqual(num('1,000'), 1);
  assert.notStrictEqual(num('1,000'), 1000);
});

check('L1-08 every other input reads exactly as before', () => {
  for (const [input, want] of [['7.5', 7.5], ['7', 7], ['', null], [null, null], [undefined, null], ['abc', null], ['12kg', 12], [7.5, 7.5], ['7,', 7], [',5', null], ['7,5,5', 7], ['1.000,5', 1], ['-3,5', -3]]) {
    assert.strictEqual(num(input), want, `num(${JSON.stringify(input)})`);
  }
});

check('L1-08 a comma-decimal weight counts toward a best', () => {
  const w = [{ fm: { date: '2026-10-01' }, rows: [{ exercise: 'Press', weight_kg: '22,5', reps: '8' }] }];
  assert.strictEqual(exerciseBests(w, 'Press').weight, 22.5);
});

run('w1-stats-num');
