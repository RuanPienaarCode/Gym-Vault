'use strict';
/* L4-13: a goal card was a bare div with a click listener - unreachable and
   unannounced for keyboard and switch-control users. It is now a real
   role=button, tabindex 0, with an accessible name, Enter/Space opens the note,
   and the nested Edit/Delete buttons still fire on their own. */
const assert = require('node:assert');
const T = require('./f3-stub');
const goals = require('../src/page-goals');

const opened = [];
const g = { name: 'Ten pull-ups', file: { path: 'Gym/Goals/Ten.md' }, fm: { metric: 'workouts-per-week', target: 3 } };
const ctx = {
  data: { goals: [g], workouts: [], body: [], exercises: [] }, settings: { weekStart: 'mon' },
  app: {}, state: {}, nav() {}, notice() {}, reload() {}, openFile: f => opened.push(f.path), io: {},
};
const root = T.render(goals, ctx);
const card = T.findAll(root, 'gv-goal-card')[0];

const failures = [];
const test = (name, fn) => { try { fn(); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };

test('L4-13 the goal card is a focusable button with a name', () => {
  assert.strictEqual(card.getAttribute('role'), 'button', 'role=button');
  assert.strictEqual(card.getAttribute('tabindex'), '0', 'tabindex 0');
  assert.ok(/Ten pull-ups/.test(card.getAttribute('aria-label') || ''), `aria-label names the goal: ${card.getAttribute('aria-label')}`);
});
test('L4-13 Enter and Space open the goal note; a nested button does not', () => {
  opened.length = 0;
  const key = k => (card.listeners.keydown || []).forEach(fn => fn({ key: k, preventDefault() {}, target: { closest: () => null } }));
  key('Enter'); key(' '); key('a');
  assert.strictEqual(opened.length, 2, `Enter and Space only: ${opened.length}`);
  (card.listeners.click || []).forEach(fn => fn({ target: { closest: sel => (sel === 'button' ? {} : null) } }));
  assert.strictEqual(opened.length, 2, 'a click on a nested button must not open the note');
  (card.listeners.click || []).forEach(fn => fn({ target: { closest: () => null } }));
  assert.strictEqual(opened.length, 3, 'a plain click still opens it');
});
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('w3 goal card button OK');
