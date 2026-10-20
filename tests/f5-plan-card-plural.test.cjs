'use strict';
/* B-L4-09: a plan card read "1 exercises" for a one-exercise plan (the days
   count was already pluralised, the exercise count was not). */
const assert = require('node:assert');
const Module = require('node:module');
const { makeDocument, flat, hasClass, obsidianStub } = require('./plans-dom-stub');

global.document = makeDocument();
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? obsidianStub : origLoad(req, ...rest));
const { render } = require('../src/page-plans');
Module._load = origLoad;

const day = (name, weekday, n) => {
  const items = Array.from({ length: n }, (_, i) => ({ exercise: `Move ${i}`, sets: 3, target: '10' }));
  return { name, weekday, notes: [], items, parts: items.map(item => ({ kind: 'item', item })) };
};
const plan = (name, days) => ({ name, file: { path: `Gym/Plans/${name}.md` }, fm: { active: false }, model: { intro: [], days } });
const plans = [plan('One', [day('A', 'mon', 1)]), plan('Many', [day('A', 'mon', 2), day('B', 'wed', 1)])];
const ctx = {
  data: { plans, exercises: [] }, app: {}, state: { params: {} }, io: {}, nav() {}, rerender() {}, reload() {}, notice() {},
  activePlan: () => plans[0], mainPlans: () => plans, backTo: f => f, back() {},
};
const root = document.createElement('div');
render(ctx, root);
const metas = flat(root).filter(n => hasClass(n, 'gv-plan-meta')).map(n => n.textContent);

let failed = 0;
const check = (name, fn) => { try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); } };
check('B-L4-09 a one-exercise plan says "1 exercise", a longer one "3 exercises"', () => {
  assert.ok(metas.some(m => /1 day \/ week · 1 exercise$/.test(m)), `plan card says: ${JSON.stringify(metas)}`);
  assert.ok(metas.some(m => /2 days \/ week · 3 exercises$/.test(m)), `plan card says: ${JSON.stringify(metas)}`);
});
if (failed) { console.log('F5 plan card plural: FAILED'); process.exit(1); }
console.log('F5 plan card plural OK');
