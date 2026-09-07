'use strict';
/* THE SESSION SUMMARY MUST REPORT THE BEST SET, NOT THE LAST ONE (0.11.2
   journey audit, finding L6).

   THE BUG THIS REPRODUCES. applyCompletion keeps one row per exercise+kind
   in sess.records so beating the same best twice in a session shows one
   line, not two racing each other — that part is deliberate and stays. But
   the row was overwritten with `existing.val = val` on every later hit, so
   a session that broke 14 reps with a 21 and THEN logged a 20 (still a real
   record, just a smaller one) reported "20 reps (was 14)" on the completion
   screen. The 21 was computed, thrown away, and never seen again.

   Every kind sess.records can hold — reps, weight, seconds — is "bigger is
   better", the same direction records.isRecord() already tests, so the fix
   is keeping the larger of the two values under the same key. */
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

const { applyCompletion } = require(path.join(SRC, 'page-session'));
Module._load = origLoad;

const newCtx = () => ({ view: null, settings: {}, data: { goals: [] } });
const newDraft = () => ({ entries: [] });
const newSess = workoutsAtStart => ({
  workoutsAtStart, records: [], goalCount: 0, muted: true, metGoals: new Set(),
});

/* ---------- 1. THE REPORTED CASE: 21, then 20, same exercise+kind, one
   session — the row must keep the 21 ---------- */
{
  const entry = { exercise: 'Pull-ups' };
  const workoutsAtStart = [{ rows: [{ exercise: 'Pull-ups', reps: '14' }] }];
  const sess = newSess(workoutsAtStart);

  applyCompletion(newCtx(), newDraft(), sess, { reps: '21', touched: true }, entry, { reps: '21' }, { observed: ['reps'] });
  applyCompletion(newCtx(), newDraft(), sess, { reps: '20', touched: true }, entry, { reps: '20' }, { observed: ['reps'] });

  assert.strictEqual(sess.records.length, 1, 'one row per exercise+kind, same as before');
  assert.strictEqual(sess.records[0].val, '21',
    'the row must hold the BEST set of the session, not the most recent one — this is the exact regression reported');
}

/* ---------- 2. the ordinary case still works: a later, BIGGER set replaces
   the row ---------- */
{
  const entry = { exercise: 'Pull-ups' };
  const workoutsAtStart = [{ rows: [{ exercise: 'Pull-ups', reps: '14' }] }];
  const sess = newSess(workoutsAtStart);

  applyCompletion(newCtx(), newDraft(), sess, { reps: '18', touched: true }, entry, { reps: '18' }, { observed: ['reps'] });
  applyCompletion(newCtx(), newDraft(), sess, { reps: '21', touched: true }, entry, { reps: '21' }, { observed: ['reps'] });

  assert.strictEqual(sess.records[0].val, '21', 'a genuinely bigger later set must still update the row');
}

/* ---------- 3. holds two different weight and applies "bigger is better"
   the same way for weight and seconds ---------- */
{
  const entry = { weighted: true, exercise: 'Bench Press' };
  const workoutsAtStart = [{ rows: [{ exercise: 'Bench Press', weight_kg: '50' }] }];
  const sess = newSess(workoutsAtStart);

  applyCompletion(newCtx(), newDraft(), sess, { weight_kg: '60', reps: '5', touched: true }, entry, { reps: '5' }, { observed: ['reps'] });
  applyCompletion(newCtx(), newDraft(), sess, { weight_kg: '55', reps: '5', touched: true }, entry, { reps: '5' }, { observed: ['reps'] });

  assert.strictEqual(sess.records.length, 1);
  assert.strictEqual(sess.records[0].val, '60', 'weight follows the same "keep the biggest" rule as reps');
}

console.log('session record-best-of-session OK (a later, smaller record no longer overwrites the best one this session)');
