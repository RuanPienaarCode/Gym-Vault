'use strict';
/* AUDIT 16 NOV 2026, finding #44 (Low): a Running records row whose exercise note
   was deleted dropped you in the Exercises list.

   "By exercise" lists every exercise that has a run row, whether or not a note
   still exists for it (run-records.byExercise adds names that appear only in a
   logged row). Tapping such a row reached exercise detail, which redirects to the
   Exercises list and leaves a dead entry on the back stack. The Plans page made
   its rows inert for exactly this (page-plans planItemRow): when no exercise note
   resolves for the row's name, the row is drawn without a tap target.

   Also pinned: Records (page-records.js) never draws such a row, because its rows
   are built from the exercise notes, so it needs no change. */
const assert = require('node:assert');
const T = require('./f3-stub');
const runPage = require('../src/page-run-records');
const recordsPage = require('../src/page-records');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
};

const KEPT = { name: 'Easy Run', file: { path: 'Gym/Exercises/Easy Run.md' }, fm: { unit: 'km', type: 'cardio' }, body: '' };
const workouts = [
  { name: 'w1', fm: { date: '2026-11-01' }, rows: [
    { exercise: 'Easy Run', set: '1', distance_km: '5', seconds: '1800' },
    { exercise: 'Deleted Trail Run', set: '1', distance_km: '8', seconds: '2900' },
  ] },
];

function mount(page) {
  const navs = [];
  const ctx = {
    app: {}, data: { workouts, exercises: [KEPT] }, settings: { weekStart: 'mon', rewards: false }, state: {},
    nav: (...a) => navs.push(a), back() {}, backTo: f => f, rerender() {}, reload() {}, notice() {},
  };
  return { root: T.render(page, ctx), navs };
}
const rowFor = (root, name) => T.findAll(root, 'gv-recrow').find(r => T.findAll(r, 'gv-recrow-name').some(n => n.textContent.trim() === name));

check('a row whose exercise note exists still opens the exercise (control)', () => {
  const { root, navs } = mount(runPage);
  const row = rowFor(root, 'Easy Run');
  assert.ok(row, 'the Easy Run row is drawn');
  assert.strictEqual(row.attrs.role, 'button', 'it is a tap target');
  (row.listeners.click || []).forEach(f => f({ target: { closest: () => null }, stopPropagation() {} }));
  assert.deepStrictEqual(navs, [['exercise', { exercise: 'Easy Run', path: 'Gym/Exercises/Easy Run.md' }]]);
});

check('a row whose exercise note was deleted is drawn, but with no tap target', () => {
  const { root, navs } = mount(runPage);
  const row = rowFor(root, 'Deleted Trail Run');
  assert.ok(row, 'the row is still shown (the runs happened)');
  assert.notStrictEqual(row.attrs.role, 'button', 'it must not be a button');
  assert.strictEqual(row.attrs.tabindex, undefined, 'and not a tab stop');
  assert.strictEqual((row.listeners.click || []).length, 0, 'and has no click handler');
  assert.ok(!/^Open /.test(row.attrs['aria-label'] || ''), `its label still says "${row.attrs['aria-label']}"`);
  assert.deepStrictEqual(navs, [], 'nothing navigated');
});

check('the inert row still carries its figures', () => {
  const { root } = mount(runPage);
  const row = rowFor(root, 'Deleted Trail Run');
  assert.ok(/1 run/.test(row.textContent) && /8 km/.test(row.textContent), `row text: ${row.textContent.replace(/\s+/g, ' ')}`);
});

check('Records never draws a row for an exercise with no note (nothing to guard there)', () => {
  const lifts = [{ name: 'w', fm: { date: '2026-11-01' }, rows: [{ exercise: 'Ghost Lift', set: '1', reps: '10' }, { exercise: 'Real Lift', set: '1', reps: '5' }] }];
  const ctx = {
    app: {}, data: { workouts: lifts, exercises: [{ name: 'Real Lift', file: { path: 'Gym/Exercises/Real Lift.md' }, fm: { unit: 'reps' }, body: '' }] },
    settings: { weekStart: 'mon', rewards: false }, state: {}, nav() {}, back() {}, backTo: f => f, rerender() {},
  };
  const root = T.render(recordsPage, ctx);
  const names = T.findAll(root, 'gv-recrow-name').map(n => n.textContent.trim());
  assert.deepStrictEqual(names, ['Real Lift']);
});

if (failed) { console.error(`audit-1116 content run records: ${failed} check(s) FAILED`); process.exit(1); }
console.log('audit-1116 content run records OK');
