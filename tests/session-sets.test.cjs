'use strict';
/* Today's sets: the one field that levels every exercise on the way into a
   session.

   WHAT THIS IS GUARDING. The circuit screen used to carry one stepper per
   exercise — nine near-identical rows all reading the same number. It is now
   a single control, and collapsing nine independent values into one is
   exactly where the quiet bugs live:

   1. A MIXED PLAN MUST NOT BE FLATTENED ON SIGHT. A plan may legitimately
      ask for 3 of the squats and 1 of the plank. Until the control is
      touched, every exercise keeps its own count. Showing a single number
      over a plan that varies — or worse, writing one — would be the "two
      figures derived by different rules" failure this codebase keeps
      finding, and the preview total underneath would contradict the field.

   2. ONE SET IS THE FLOOR. Zero sets is not a lighter session, it is a
      missing exercise; skipping one has its own control inside the session.

   3. WHAT THE PREVIEW SAYS IS WHAT START BUILDS. Both read setsPerEntryFor.
      A preview quoting a total the draft does not honour is the one place
      such a mismatch would go unnoticed longest.

   The screen needs a DOM; these rules do not, so they were split out and are
   tested here directly. */
const assert = require('node:assert');
const Module = require('node:module');

/* obsidian is not installable outside the app; page-log/modals reach for
   several of its classes at require time, so the stub carries shapes rather
   than behaviour. */
const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
};
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));
const mkNode = () => ({
  nodeType: 1, className: '', style: {}, children: [], attrs: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, addEventListener() {}, append() {}, querySelector: () => null,
});
global.document = { createElement: mkNode, createTextNode: t => ({ nodeType: 3, text: String(t) }) };
global.window = global.window || {};

const setup = require('../src/page-session-setup');
const { setsForItem, setsPerEntryFor, uniformSets, mostCommonSets, nextSetsValue, levelSets, SETS_MIN, SETS_MAX } = setup;
Module._load = origLoad;

const ui = (sets = {}) => ({ sets });
/* itemSets() reads `it.sets || 3`, so a null count means "the plan didn't say". */
const day = (...counts) => ({ items: counts.map((n, i) => ({ exercise: `Move ${i + 1}`, sets: n, target: '10' })) });

/* ---------- 1. a mixed plan is left alone until it is touched ---------- */
{
  const d = day(3, 1, 3);
  assert.deepStrictEqual(setsPerEntryFor(d, ui()), [3, 1, 3],
    'with no override every exercise keeps the count the plan gave it');
  assert.strictEqual(uniformSets(d.items, ui()), null,
    'a plan that varies must report Mixed, never a single number it does not have');

  const uniform = day(3, 3, 3);
  assert.strictEqual(uniformSets(uniform.items, ui()), 3, 'a plan that agrees reports its number');

  const unstated = day(null, null);
  assert.deepStrictEqual(setsPerEntryFor(unstated, ui()), [3, 3], 'an unstated count falls back to the default of 3');
  assert.strictEqual(uniformSets(unstated.items, ui()), 3, 'and two defaults are uniform, not mixed');
}

/* ---------- 2. one press levels every exercise ---------- */
{
  const d = day(3, 1, 3);
  const u = ui();
  /* Out of a mixed plan the step starts from the count most exercises carry. */
  const base = mostCommonSets(d.items.map(it => it.sets));
  assert.strictEqual(base, 3, 'two 3s and one 1 starts from 3');
  levelSets(u, d.items.length, nextSetsValue(base, +1));
  assert.deepStrictEqual(setsPerEntryFor(d, u), [4, 4, 4], 'one press must move ALL of them, not just the first');
  assert.strictEqual(uniformSets(d.items, u), 4, 'and the field now has a single number it can honestly show');

  /* Ties break high: the session you were more nearly going to do. */
  assert.strictEqual(mostCommonSets([1, 3]), 3, 'a tie resolves upward');
  assert.strictEqual(mostCommonSets([]), SETS_MIN, 'an empty plan cannot crash the stepper');
}

/* ---------- 3. the floor and the ceiling ---------- */
{
  assert.strictEqual(nextSetsValue(1, -1), SETS_MIN, 'one set is the floor — zero is a missing exercise, not a light day');
  assert.strictEqual(nextSetsValue(SETS_MAX, +1), SETS_MAX, 'and ten is the ceiling against a stuck thumb');
  assert.strictEqual(nextSetsValue(3, -1), 2);
  assert.strictEqual(nextSetsValue(3, +1), 4);

  const d = day(1, 1);
  const u = ui();
  levelSets(u, 2, nextSetsValue(uniformSets(d.items, u), -1));
  assert.deepStrictEqual(setsPerEntryFor(d, u), [1, 1], 'stepping down at the floor changes nothing');
}

/* ---------- 4. clearing the override restores the plan's own counts ------ */
{
  const d = day(3, 1, 3);
  const u = ui();
  levelSets(u, 3, 2);
  assert.deepStrictEqual(setsPerEntryFor(d, u), [2, 2, 2], 'levelled');
  u.sets = {};
  assert.deepStrictEqual(setsPerEntryFor(d, u), [3, 1, 3],
    'Back to the plan must restore the ORIGINAL mixed counts — levelling is not a one-way door');
}

/* ---------- 5. the preview and the draft cannot disagree ---------- */
{
  const d = day(3, 1, 3);
  const u = ui();
  levelSets(u, 3, 4);
  const perEntry = setsPerEntryFor(d, u);
  const previewTotal = perEntry.reduce((n, v) => n + v, 0);
  assert.strictEqual(previewTotal, 12, 'the preview total is the sum of the very array Start hands to startDraft');
  /* Same function, same argument — the guard is that nothing recomputes it
     a second way. */
  assert.deepStrictEqual(setsPerEntryFor(d, u), perEntry);
  d.items.forEach((it, i) => assert.strictEqual(setsForItem(u, it, i), perEntry[i],
    'per-item and whole-day answers must be the same answer'));
}

console.log('session sets OK (a mixed plan survives until levelled, one press moves all, the floor holds, and the preview is the draft)');
