'use strict';
/* 0.15.2 acceptance: the new list markers (`* `, `+ `, `1. `, `1) `) must not turn
   a coach's numbered or starred NOTES into exercises. "1. Warm up 5 min" and
   "* keep elbows in" read exactly like "10. Squats", so the only safe line is
   the plan format's own: an exercise written with one of the new markers
   carries its prescription after a `|`. A `- ` bullet keeps its old rule (any
   `- ` line in a day is an exercise), and a bare `* ` is never an empty item.
   Also: the "3X8" shape must not eat the first letter of a word ("5 Xtreme"). */
const assert = require('node:assert');
const { parsePlanBody, serializePlanBody, parsePrescription } = require('../src/plan-parse');

const body = [
  '## A (mon)', '',
  '1. Warm up 5 min easy',
  '2) Mobility flow',
  '* keep elbows in',
  '+ breathe out on the way up',
  '* ',
  '- Squat | 3 x 5',
  '* Dips | 3 x 8',
  '1. Rows | 3X10',
  '- Plain line no pipe',
].join('\n');
const day = parsePlanBody(body).days[0];
assert.deepStrictEqual(day.items.map(i => i.exercise), ['Squat', 'Dips', 'Rows', 'Plain line no pipe'],
  `numbered/starred prose must stay notes, got items ${JSON.stringify(day.items.map(i => i.exercise))}`);
assert.ok(day.notes.some(l => l === '1. Warm up 5 min easy') && day.notes.some(l => l === '* keep elbows in'), 'the prose is kept as notes');
assert.ok(serializePlanBody(parsePlanBody(body)).includes('1. Warm up 5 min easy\n2) Mobility flow\n* keep elbows in\n+ breathe out on the way up\n* \n'),
  'and a save writes the notes back exactly as written');

for (const [t, sets, target] of [['5 Xtreme', null, '5 Xtreme'], ['10 Xs', null, '10 Xs'], ['2 X-ray', null, '2 X-ray'], ['3X8', 3, '8'], ['3 X 8', 3, '8'], ['4 sets of 10', 4, '10']]) {
  const p = parsePrescription(t);
  assert.deepStrictEqual([p.sets, p.target], [sets, target], `parsePrescription(${JSON.stringify(t)})`);
}
console.log('plan prose bullets OK (new markers need a prescription; "X" needs a number after it)');
