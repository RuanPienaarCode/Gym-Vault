'use strict';
/* AUDIT 25 NOV 2026, Goals page.

   #28 (Medium, Goals half): a goal card's only tap opened the goal's markdown
   note in another tab, leaving the app; the exercise page with its Progression
   and Recent was one step away and nothing pointed at it.
     G1  A goal tied to an exercise opens that exercise's page INSIDE the app,
         through ctx.nav (a step, so Back returns to Goals), carrying the note's
         path the way the exercise library does.
     G2  "Open note" is a small secondary button on that card, beside Edit and
         Delete; it opens the note and does not also navigate.
     G3  A goal with no exercise (workouts a week, body weight) keeps opening
         the note, and grows no redundant Open note button.
     G4  A goal naming an exercise that has no note (renamed, deleted) cannot
         open an exercise page, so it opens the note as before.

   #52 (Low): "workouts a week" accepted any number above zero. A target of
   4.4 made the week ring ("Week done" at 4) and the goal (91%) disagree.
     W1  For that metric only, a whole number of at least 1, with a plain
         message. Other metrics keep their decimals (62.5 kg is a real target). */
const assert = require('node:assert');
const T = require('./f3-stub');
const goals = require('../src/page-goals');

const navs = [];
const opened = [];
const pull = { name: 'Pull-ups', fm: { unit: 'reps' }, file: { path: 'Gym/Exercises/Back/Pull-ups.md' } };
const gEx = { name: 'Ten pull-ups', file: { path: 'Gym/Goals/Ten pull-ups.md' }, fm: { metric: 'exercise-reps', exercise: 'pull-ups', target: 10 } };
const gWeek = { name: 'Four a week', file: { path: 'Gym/Goals/Four a week.md' }, fm: { metric: 'workouts-per-week', target: 4 } };
const gGone = { name: 'Dips goal', file: { path: 'Gym/Goals/Dips goal.md' }, fm: { metric: 'exercise-reps', exercise: 'Dips', target: 20 } };
const ctx = {
  data: { goals: [gEx, gWeek, gGone], workouts: [], body: [], exercises: [pull] }, settings: { weekStart: 'mon' },
  app: {}, state: {}, notice() {}, reload() {}, io: {},
  nav: (...a) => navs.push(a), openFile: f => opened.push(f.path),
};
const root = T.render(goals, ctx);
const cards = T.findAll(root, 'gv-goal-card');
const cardOf = name => cards.find(c => /./.test(c.textContent) && c.textContent.includes(name));
const tap = card => (card.listeners.click || []).forEach(fn => fn({ target: { closest: () => null } }));
const reset = () => { navs.length = 0; opened.length = 0; };

const failures = [];
const test = (name, fn) => {
  reset();
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
};

test('G1 tapping an exercise goal opens the exercise page in the app', () => {
  tap(cardOf('Ten pull-ups'));
  assert.deepStrictEqual(opened, [], 'the note was opened in another tab');
  assert.strictEqual(navs.length, 1, 'no in-app route');
  const [page, params, opts] = navs[0];
  assert.strictEqual(page, 'exercise');
  assert.deepStrictEqual(params, { exercise: 'Pull-ups', path: 'Gym/Exercises/Back/Pull-ups.md' }, 'the exercise note, by its own name and path');
  assert.ok(!(opts && opts.reset), 'a reset nav would leave Back nowhere to return to');
  assert.ok(/Pull-ups/.test(cardOf('Ten pull-ups').getAttribute('aria-label')), 'the card\'s name says where it goes');
});
test('G2 the exercise goal card has a small Open note button that opens the note only', () => {
  const card = cardOf('Ten pull-ups');
  const btn = T.findAll(card, 'gv-goal-note')[0];
  assert.ok(btn, 'no Open note button');
  assert.strictEqual(btn.tag, 'button');
  assert.strictEqual(btn.getAttribute('type'), 'button');
  assert.ok(/Open note/.test(btn.textContent), `the button reads "${btn.textContent.trim()}"`);
  const actions = T.findAll(card, 'gv-card-actions')[0];
  assert.ok(T.findAll(actions, 'gv-goal-note').length === 1, 'it sits with Edit and Delete');
  btn.click();
  assert.deepStrictEqual(opened, ['Gym/Goals/Ten pull-ups.md']);
  assert.deepStrictEqual(navs, []);
});
test('G3 a goal with no exercise keeps opening its note', () => {
  tap(cardOf('Four a week'));
  assert.deepStrictEqual(opened, ['Gym/Goals/Four a week.md']);
  assert.deepStrictEqual(navs, []);
  assert.strictEqual(T.findAll(cardOf('Four a week'), 'gv-goal-note').length, 0, 'the card itself already opens the note');
});
test('G4 a goal whose exercise has no note opens the note', () => {
  tap(cardOf('Dips goal'));
  assert.deepStrictEqual(opened, ['Gym/Goals/Dips goal.md']);
  assert.deepStrictEqual(navs, []);
});

test('W1 workouts a week needs a whole number of at least 1', () => {
  assert.strictEqual(typeof goals.validateGoal, 'function', 'validateGoal is not exported for the guard');
  const v = target => goals.validateGoal({ metric: 'workouts-per-week', exercise: '', target, challenge: false });
  for (const bad of ['4.4', '0.5', '2,5', '0', '-3']) {
    const msg = v(bad);
    assert.ok(msg && /whole number/i.test(msg), `${bad} a week was accepted (${msg})`);
  }
  assert.strictEqual(v('4'), null);
  assert.strictEqual(v('1'), null);
  assert.strictEqual(v('7'), null);
});
test('W1 other metrics keep their decimals', () => {
  assert.strictEqual(goals.validateGoal({ metric: 'exercise-weight', exercise: 'Bench', target: '62.5', challenge: false }), null);
  assert.strictEqual(goals.validateGoal({ metric: 'body-weight', exercise: '', target: '78.4', challenge: false }), null);
});

if (failures.length) { console.log(`audit-1125 pages goals: ${failures.length} FAILED`); process.exit(1); }
console.log('audit-1125 pages goals OK');
