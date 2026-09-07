'use strict';
/* THE OBSERVED-KIND CONTRACT (0.11.2 journey audit, findings #2 and #3 — the
   session half of a cross-cutting "two figures derived by different rules"
   cluster; the timed half is built by another lane against this same
   contract).

   THE TWO BUGS THIS REPRODUCES.

   #2 — weightedBody prefills set.weight_kg from the plan's `@ 60kg` or the
   last-used weight, untouched. The set-by-set reps screen's Done button
   completes with `{ reps: N }` — the tap counter watched the REPS, nobody
   watched the WEIGHT — but the old rule (`opts.measured` defaulting true
   for every set-by-set completion) claimed a weight record anyway, because
   the screen it happened to be "always observes".

   #3 — a timed interval's "measured" clock for a duration entry is just the
   scheduled interval length: `iv.seconds` is the WRITTEN target, so an
   interval that counts down and ends has "measured" a hold whether or not
   it was actually held. The old rule's blanket `kind === 'seconds'`
   exception treated the clock elapsing as an observed hold regardless.

   THE FIX, restated as the contract every call site now has to honour:
   `opts.observed` is the list of record kinds THIS SCREEN watched the user
   produce, and a figure is claimable only if its kind is in that list, OR
   the user typed it themselves (typedByUser, read before this call touches
   set.touched). This drives applyCompletion directly — the pure decision,
   without standing up a render — with the exact opts shape each real call
   site now passes. */
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
};
const motionStub = { motionAvailable: () => false, startMotionCounter: async () => () => {} };

const origLoad = Module._load;
Module._load = (req, ...rest) => {
  if (req === 'obsidian') return stub;
  if (req === './motion-source') return motionStub;
  return origLoad(req, ...rest);
};

const mkNode = () => ({
  nodeType: 1, className: '', style: { setProperty() {}, removeProperty() {} }, children: [], attrs: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, addEventListener() {}, append() {}, querySelector: () => null,
  insertBefore() {}, remove() {}, removeChild() {},
});
global.document = {
  createElement: mkNode, createTextNode: t => ({ nodeType: 3, text: String(t) }),
  addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
};
global.window = global.window || { setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout };

const { applyCompletion, classifyKind } = require(path.join(SRC, 'page-session'));
Module._load = origLoad;

/* ---------- 0. classifyKind, the switch everything else keys off ---------- */
{
  assert.strictEqual(classifyKind({ distance: true }), null, 'no record concept for a run');
  assert.strictEqual(classifyKind({ duration: true }), 'seconds');
  assert.strictEqual(classifyKind({ weighted: true }), 'weight');
  assert.strictEqual(classifyKind({}), 'reps');
}

const newCtx = () => ({ view: null, settings: {}, data: { goals: [] } });
const newDraft = () => ({ entries: [] });
const newSess = (workoutsAtStart) => ({
  workoutsAtStart, records: [], goalCount: 0, muted: true, metGoals: new Set(),
});

/* ---------- 1. #2: a weighted entry's Done button never watched the weight,
   whatever the reps did — observed:['reps'], as repsBody's doneBtn now
   always passes regardless of whether the entry is plain reps or weighted */
{
  const entry = { weighted: true, exercise: 'Bench Press' };
  const workoutsAtStart = [{ rows: [{ exercise: 'Bench Press', weight_kg: '55' }] }];

  /* Untouched: the plan's 60kg (or last-used 60kg) prefill, never typed. */
  {
    const sess = newSess(workoutsAtStart);
    const set = { weight_kg: '60', reps: '', touched: false };
    const callouts = applyCompletion(newCtx(), newDraft(), sess, set, entry, { reps: '5' }, { observed: ['reps'] });
    assert.deepStrictEqual(sess.records, [],
      'an untouched weight prefill must not claim a record just because the reps beside it were real');
    assert.deepStrictEqual(callouts, [], 'and no NEW BEST callout either');
  }

  /* Touched: the user actually typed the weight before completing the set. */
  {
    const sess = newSess(workoutsAtStart);
    const set = { weight_kg: '60', reps: '', touched: true };
    const callouts = applyCompletion(newCtx(), newDraft(), sess, set, entry, { reps: '5' }, { observed: ['reps'] });
    assert.strictEqual(sess.records.length, 1, 'a typed weight IS the user\'s own word for what happened, and stays claimable');
    assert.strictEqual(sess.records[0].kind, 'weight');
    assert.ok(callouts.some(c => c.includes('NEW BEST')));
  }
}

/* ---------- 2. #3: a timed interval's clock is not an observed hold ------- */
{
  const entry = { duration: true, exercise: 'Plank' };
  const workoutsAtStart = [{ rows: [{ exercise: 'Plank', seconds: '60' }] }];

  /* Untouched: advanceTimed's real call shape — observed: [] — with a clock
     figure (90s) that would beat the 60s best if merely elapsing counted. */
  {
    const sess = newSess(workoutsAtStart);
    const set = { seconds: '90', touched: false };
    const callouts = applyCompletion(newCtx(), newDraft(), sess, set, entry, { seconds: '90' }, { observed: [] });
    assert.deepStrictEqual(sess.records, [],
      'an interval that merely counted down to zero must not claim a hold record — the clock elapsing is not an observed hold');
    assert.deepStrictEqual(callouts, []);
  }

  /* Touched: the user typed the real held time into the new seconds box
     (timedFigures), which is what legitimately claims the record. */
  {
    const sess = newSess(workoutsAtStart);
    const set = { seconds: '90', touched: true };
    const callouts = applyCompletion(newCtx(), newDraft(), sess, set, entry, {}, { observed: [] });
    assert.strictEqual(sess.records.length, 1, 'a typed hold time must still be claimable');
    assert.strictEqual(sess.records[0].kind, 'seconds');
    assert.ok(callouts.some(c => c.includes('NEW BEST')));
  }
}

/* ---------- 3. the set-by-set hold DOES observe the clock (durationBody's
   own stopwatch, observed:['seconds']) — the legitimate case #3 must not
   collateral-damage */
{
  const entry = { duration: true, exercise: 'Plank' };
  const workoutsAtStart = [{ rows: [{ exercise: 'Plank', seconds: '60' }] }];
  const sess = newSess(workoutsAtStart);
  const set = { seconds: '', touched: false };
  applyCompletion(newCtx(), newDraft(), sess, set, entry, { seconds: '75' }, { observed: ['seconds'] });
  assert.strictEqual(sess.records.length, 1,
    'the set-by-set stopwatch genuinely ran the clock — this is the one case where an untouched seconds figure IS a record');
}

/* ---------- 4. no opts at all defaults to nothing observed, not everything
   — a caller that forgets opts must not silently regain the old blanket
   trust */
{
  const entry = {};
  const sess = newSess([{ rows: [{ exercise: 'Push-ups', reps: '10' }] }]);
  const set = { reps: '15', touched: false };
  applyCompletion(newCtx(), newDraft(), sess, set, entry, { reps: '15' });
  assert.deepStrictEqual(sess.records, [],
    'omitting opts entirely must default to observed:[] — never fall back to "trust everything"');
}

console.log('session observed-kind contract OK (a screen only claims a record for what it actually watched, or what the user typed)');
