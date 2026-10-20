'use strict';
/* R1-01: with no records the Records page still drew its search box, and typing
   in it threw "Cannot access 'draw' before initialization" (the handler closed
   over a `const draw` declared after the early return). With nothing to search
   there is no search box; and if a handler exists it must not throw. */
const assert = require('node:assert');
const T = require('./f3-stub');
const records = require('../src/page-records');

const ctx = { app: {}, data: { workouts: [], exercises: [{ name: 'Push-ups', fm: { unit: 'reps' } }] }, state: {}, nav() {}, backTo: f => f, back() {}, rerender() {}, settings: { rewards: false } };
const root = T.render(records, ctx);
assert.ok(/No records yet/.test(root.textContent), 'the empty state is shown');
for (const s of T.findAll(root, 'gv-search')) {
  assert.doesNotThrow(() => { s.value = 'pu'; (s.listeners.input || []).forEach(f => f({ target: s })); }, 'typing in the search box must not throw');
}
assert.strictEqual(T.findAll(root, 'gv-search').length, 0, 'no search box when there is nothing to search');
console.log('f3 records empty OK');
