'use strict';
/* K2, narrowed (0.15.1 acceptance): a target is open-ended only when its FIRST
   number is the percentage — "65% max", "80%". A rep count AT a percentage of a
   max ("8 @ 75%", "10 @ 70% 1RM") is still an 8- or 10-rep target: the first
   rule (any `%` anywhere) silently took the guided target, the manual-log
   prefill and the timed schedule away from every plan written as reps at a
   load. A written duration still wins ("80% for 30s" is a 30 s hold). */
const assert = require('node:assert');
const ct = require('../src/counter-target');

const cases = [
  ['65% max', true], ['80%', true], ['max (65%)', true], ['AMRAP @ 70%', true],
  ['8 @ 75%', false], ['10 @ 70% 1RM', false], ['5 @ 82.5%', false], ['12', false], ['45s', false],
];
for (const [t, open] of cases) assert.strictEqual(ct.isOpenEnded(t), open, `isOpenEnded(${JSON.stringify(t)}) should be ${open}`);

assert.deepStrictEqual(ct.targetFromEntry({ target: '8 @ 75%' }), { kind: 'reps', value: 8 }, '"8 @ 75%" is an 8-rep target');
assert.deepStrictEqual(ct.targetFromEntry({ target: '10 @ 70% 1RM' }), { kind: 'reps', value: 10 }, '"10 @ 70% 1RM" is a 10-rep target');
assert.strictEqual(ct.targetFromEntry({ target: '65% max', duration: true }), null, '"65% max" is still open-ended');
assert.deepStrictEqual(ct.targetFromEntry({ target: '80% for 30s', duration: true }), { kind: 'seconds', value: 30 }, 'a written duration still wins');

console.log(`K2 percent load OK (${cases.length} targets: the % must be the first number to make it open-ended)`);
