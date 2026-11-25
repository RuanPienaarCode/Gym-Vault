'use strict';
/* AUDIT 25 NOV 2026, #28 (Medium, Records half): a record could not take you
   to the session behind it.

   What this pins:
     R1  Each record row carries a link to the session that set it: History
         opened on that session (History's own in-place `session` param), as a
         step, so Back returns to Records.
     R2  The session is found through the loaded workouts by the record's DATE
         (stats.workoutDate, so `2026-11-10T07:30` is that day) and EXERCISE
         (stats.sameName, so case and spaces do not matter), holding the
         record's value in its kind's column.
     R3  Two sessions that day: the one that holds the record, not merely the
         first that has the exercise.
     R4  No session found (an undated note): the row has no session link.
     R5  The row itself still opens the exercise page; the session link does
         not also do that. */
const assert = require('node:assert');
const T = require('./f3-stub');
const page = require('../src/page-records');

const w = (name, date, rows) => ({ name, fm: { date }, rows, file: { path: `Gym/Workouts/${name}.md` } });
const row = (exercise, o) => Object.assign({ exercise, set: 1, reps: '', weight_kg: '', seconds: '', distance_km: '' }, o);
const ex = (name, unit) => ({ name, fm: { unit }, file: { path: `Gym/Exercises/${name}.md` } });

const WORKOUTS = [
  w('Upper 1', '2026-11-01', [row('Push-ups', { reps: '10' })]),
  w('Upper 2', '2026-11-10T07:30', [row('push-ups ', { reps: '12' })]),
  w('Lunch 2', '2026-11-10', [row('Push-ups', { reps: '15' })]),     // same day, the record
  w('Plank day', '2026-11-12', [row('Plank', { seconds: '90' })]),
  w('Old notes', '', [row('Dips', { reps: '8' })]),                     // undated: no session to point at
];
const navs = [];
const ctx = {
  app: {}, data: { workouts: WORKOUTS, exercises: [ex('Push-ups', 'reps'), ex('Plank', 'seconds'), ex('Dips', 'reps')] },
  state: {}, settings: { rewards: false }, backTo: f => f, back() {}, rerender() {},
  nav: (...a) => navs.push(a),
};
const root = T.render(page, ctx);
const rows = T.findAll(root, 'gv-recrow');
const rowOf = (name, kind) => rows.find(r => T.findAll(r, 'gv-recrow-name')[0].textContent.trim() === name && T.findAll(r, 'gv-recrow-was')[0].textContent.includes(kind));
const linkOf = r => T.findAll(r, 'gv-recrow-session')[0];

const failures = [];
const test = (name, fn) => {
  navs.length = 0;
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
};

test('R1 a record row links to History opened on its session', () => {
  const r = rowOf('Push-ups', 'reps');
  assert.ok(r, 'no Push-ups reps row');
  const link = linkOf(r);
  assert.ok(link, 'the row has no session link');
  assert.strictEqual(link.tag, 'button');
  assert.strictEqual(link.getAttribute('type'), 'button');
  assert.ok(/session/i.test(link.getAttribute('aria-label') || ''), 'the link must say it opens the session');
  link.click();
  assert.strictEqual(navs.length, 1);
  const [pg, params, opts] = navs[0];
  assert.strictEqual(pg, 'history');
  assert.deepStrictEqual(params, { session: 'Lunch 2' });
  assert.ok(!(opts && opts.reset), 'a reset nav would leave Back nowhere to go');
});
test('R2 found by the day and the exercise name, whatever the case or time of day', () => {
  const link = linkOf(rowOf('Plank', 'hold'));
  assert.ok(link, 'the Plank record has no session link');
  link.click();
  assert.deepStrictEqual(navs[0][1], { session: 'Plank day' });
  /* "push-ups " logged at 07:30 on the 10th: still that exercise, still that day */
  assert.strictEqual(page.sessionFor(WORKOUTS, { exercise: 'PUSH-UPS', kind: 'reps', value: 12, date: '2026-11-10' }).name, 'Upper 2');
});
test('R3 two sessions that day: the one holding the record', () => {
  linkOf(rowOf('Push-ups', 'reps')).click();
  assert.strictEqual(navs[0][1].session, 'Lunch 2', 'linked to the first session of the day, not the record');
});
test('R4 no session found: no link', () => {
  const r = rowOf('Dips', 'reps');
  assert.ok(r, 'no Dips row');
  assert.strictEqual(linkOf(r), undefined, 'an undated record must not be a link');
});
test('R5 the row still opens the exercise, and the link does not', () => {
  const r = rowOf('Push-ups', 'reps');
  (r.listeners.click || []).forEach(fn => fn({ target: { closest: () => null } }));
  assert.deepStrictEqual(navs[0].slice(0, 2), ['exercise', { exercise: 'Push-ups', path: 'Gym/Exercises/Push-ups.md' }]);
  navs.length = 0;
  linkOf(r).click();
  assert.ok(navs.every(n => n[0] !== 'exercise'), 'the session link also opened the exercise');
});
test('R1 the sessionFor helper is exported for other lanes and the export', () => {
  assert.strictEqual(typeof page.sessionFor, 'function');
  assert.strictEqual(page.sessionFor(WORKOUTS, { exercise: 'Push-ups', kind: 'reps', value: 10, date: '2026-11-01' }).name, 'Upper 1');
  assert.strictEqual(page.sessionFor(WORKOUTS, { exercise: 'Push-ups', kind: 'reps', value: 99, date: '2026-11-01' }), null);
});

if (failures.length) { console.log(`audit-1125 pages records: ${failures.length} FAILED`); process.exit(1); }
console.log('audit-1125 pages records OK');
