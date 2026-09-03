'use strict';
/* A TARGET IS NOT A RESULT (issue #16).

   THE BUG THIS REPRODUCES, end to end through the code that actually saves.

   makeEntry prefills reps and weight from the plan and marks them
   `touched: false` — the day's prescription sitting in the boxes, not
   anything anybody did. When a timed work interval ended, advanceTimed wrote
   the clock and applyCompletion set done AND touched, so the prefill was
   promoted to observed work and buildRows saved it verbatim.

   You did 8 push-ups in 45 seconds. Your history said 15.

   applyCompletion's `measured: false` only ever suppressed the RECORD toast.
   It never touched the save — which is the half that outlives the session and
   the half a user reads back months later as their own training record.

   The rule now lives in timed-plan.timedSetValues, so it can be exercised
   rather than merely described: page-session.js cannot be required in node,
   and a rule about what gets PERSISTED is not one to leave as a comment. */
const assert = require('node:assert');
const Module = require('node:module');

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

const { startDraft, buildRows } = require('../src/page-log');
const { timedSetValues } = require('../src/timed-plan');
Module._load = origLoad;

/* A plan day with a real prescription on every line — the prefills are the
   whole point of the fixture. */
const DAY = {
  name: 'B · Push',
  items: [
    { exercise: 'Push-ups', target: '15', sets: 1 },
    { exercise: 'Bench Press', target: '8 @ 60kg', sets: 1 },
    { exercise: 'Plank', target: '60s', sets: 1 },
  ],
};

const newDraft = () => {
  const ctx = { data: { exercises: [] }, state: {} };
  startDraft(ctx, { name: 'Test' }, DAY);
  return ctx.state.logDraft;
};

/* Exactly what advanceTimed does: take the interval's clock, ask what may be
   written, hand it to the set, and mark it done — applyCompletion's own two
   lines, in its order. `set` is read BEFORE touched is set, which is the only
   order in which "did the user type this" is still answerable. */
const finishInterval = (entry, set, seconds) => {
  const values = timedSetValues(entry, set, seconds);
  Object.assign(set, values);
  set.done = true;
  set.touched = true;
};

/* ---------- 0. the prefills really are there (the setup this depends on) -- */
{
  const draft = newDraft();
  assert.strictEqual(draft.entries[0].sets[0].reps, 15, 'the plan target is prefilled as reps');
  assert.strictEqual(draft.entries[1].sets[0].weight_kg, 60, 'and the prescribed weight as weight_kg');
  assert.strictEqual(draft.entries[0].sets[0].touched, false,
    'and marked untouched — which is what says nobody did it');
}

/* ---------- 1. THE BUG: an untyped interval saves no reps ---------- */
{
  const draft = newDraft();
  const entry = draft.entries[0];
  finishInterval(entry, entry.sets[0], 45);

  const rows = buildRows(draft);
  assert.strictEqual(rows.length, 1, 'the set still counts — it happened, it was just not counted in reps');
  assert.strictEqual(rows[0].exercise, 'Push-ups');
  assert.strictEqual(rows[0].seconds, '45', 'the clock is what this screen measured, so the clock is what it saves');
  assert.strictEqual(rows[0].reps, '',
    'the plan asked for 15 and nobody counted — saving 15 is the app inventing a result');
}

/* ---------- 2. weight goes with reps ---------- */
{
  const draft = newDraft();
  const entry = draft.entries[1];
  finishInterval(entry, entry.sets[0], 40);

  const [row] = buildRows(draft);
  assert.strictEqual(row.seconds, '40');
  assert.strictEqual(row.reps, '');
  assert.strictEqual(row.weight_kg, '',
    '"8 @ 60kg" is ONE prescription — keeping the 60 would leave a weight with no set behind it');
}

/* ---------- 3. WHAT THE USER TYPED IS KEPT ---------- */
{
  const draft = newDraft();
  const entry = draft.entries[0];
  const set = entry.sets[0];
  /* Typing into the box is what page-log's inputs do: write the value and
     mark it touched. */
  set.reps = '8';
  set.touched = true;
  finishInterval(entry, set, 45);

  const [row] = buildRows(draft);
  assert.strictEqual(row.reps, '8',
    'a count the user actually entered must survive — this fix must not eat real data');
  assert.strictEqual(row.seconds, '45');
}

/* ---------- 4. a hold keeps the clock, and the clock alone ---------- */
{
  const draft = newDraft();
  const entry = draft.entries[2];
  assert.strictEqual(entry.duration, true, 'Plank is a duration entry');
  assert.strictEqual(entry.sets[0].seconds, 60, 'prefilled from the 60s target');

  finishInterval(entry, entry.sets[0], 47);
  const [row] = buildRows(draft);
  assert.strictEqual(row.seconds, '47',
    'the measured clock must overwrite the prefilled target, not lose to it');
  assert.strictEqual(row.reps, '', 'a hold has no reps');
}

/* ---------- 5. a run takes minutes, and has nothing to clear ---------- */
{
  /* buildRows reads a distance entry's time from `minutes` and ignores
     `seconds` entirely, so writing seconds would tick the set done and then
     save a row with no distance AND no time — a junk row that counts towards
     the session tally and says nothing. */
  const values = timedSetValues({ distance: true }, { touched: false }, 1800);
  assert.deepStrictEqual(values, { minutes: '30' },
    'a run is measured in minutes; seconds here would save a row that says nothing');
  assert.ok(!('reps' in values),
    'a run has no prefills to clear — makeEntry leaves it empty, because the distance covered is the point');
}

/* ---------- 6. the rule itself, stated plainly ---------- */
{
  const untouched = { reps: '15', weight_kg: '60', touched: false };
  assert.deepStrictEqual(timedSetValues({}, untouched, 45), { seconds: '45', reps: '', weight_kg: '' });

  const typed = { reps: '8', weight_kg: '60', touched: true };
  assert.deepStrictEqual(timedSetValues({}, typed, 45), { seconds: '45' },
    'a touched set is left entirely alone — the user is the authority on what they did');

  /* Rounding is the interval's, not the user's: a 44.6s interval is 45s. */
  assert.strictEqual(timedSetValues({}, typed, 44.6).seconds, '45');
}

console.log('timed persists OK (the clock and what you typed; never the plan\'s target as your result)');
