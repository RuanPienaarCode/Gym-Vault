'use strict';
/* FIX WAVE F2, item 10: THE CROSS-LANE CONTRACTS THIS LANE CALLS.

   K1 (lane F3 owns stats.goalCurrent): the goal check inside a session must hand
      goalCurrent the exercise library (`exercises`), so a goal the Records page
      refuses to claim (claimableKinds) cannot be "met" by a live session either.
   K5 (lane F3 owns page-log.sessionMinutes): the completion tile's minutes come
      from the ONE rule that also writes duration_min, not a second copy inline.
   K2 (lane F3 owns counter-target): a "65% max" target is open-ended. Everything
      here that turns a plan entry into a target already goes through
      counter-target.targetFromEntry; this pins that it STAYS that way, so F3's
      change to that one function is the whole of K2 on this side.

   This file passes whether or not lane F3 has merged: it checks the CALLS this
   lane makes (against stand-ins for F3's names), not F3's behaviour. */
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');

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
const mkNode = (tag) => {
  const node = {
    tagName: tag, nodeType: 1, className: '', children: [],
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    attrs: {}, setAttribute(k, v) { node.attrs[k] = v; }, addEventListener() {},
    append(...kids) { node.children.push(...kids.flat().filter(Boolean)); },
    querySelector: () => null, insertBefore() {}, remove() {}, removeChild() {},
  };
  return node;
};
global.document = {
  createElement: mkNode, createTextNode: t => ({ nodeType: 3, text: String(t) }),
  addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
};
global.window = global.window || { setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout };

/* K1: record what goalCurrent is handed. Patched BEFORE page-session loads, since it destructures at require time. */
const stats = require(path.join(SRC, 'stats'));
const realGoalCurrent = stats.goalCurrent;
const seen = [];
stats.goalCurrent = (goal, c) => { seen.push(c); return realGoalCurrent(goal, c); };

const pageLog = require(path.join(SRC, 'page-log'));
const { applyCompletion, renderComplete } = require(path.join(SRC, 'page-session'));
Module._load = origLoad;

const results = [];
const check = (name, fn) => { try { fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };

const textOf = n => (!n ? '' : n.nodeType === 3 ? n.text : (n.children || []).map(textOf).join(''));

check('F2-10a. K1: the in-session goal check hands goalCurrent `exercises` (before AND after)', () => {
  seen.length = 0;
  const exercises = [{ name: 'Plank', fm: { unit: 'seconds' } }];
  const ctx = {
    view: null, settings: {}, data: {
      exercises,
      goals: [{ name: 'Hold a minute', fm: { metric: 'exercise-duration', exercise: 'Plank', target: 60, direction: 'increase' } }],
    },
  };
  const sess = { workoutsAtStart: [], records: [], goalCount: 0, muted: true, metGoals: new Set() };
  const draft = { date: '2026-10-20', day: 'D', entries: [{ exercise: 'Plank', duration: true, sets: [{ seconds: '', done: false, touched: false }] }] };
  applyCompletion(ctx, draft, sess, draft.entries[0].sets[0], draft.entries[0], { seconds: '70' }, { observed: ['seconds'] });
  assert.strictEqual(seen.length, 2, 'goalCurrent was asked for the before and the after');
  for (const c of seen) assert.strictEqual(c.exercises, exercises, 'each call carries the library so F3\'s gate can resolve the exercise');
});

check('F2-10b. K5: the completion tile\'s minutes come from page-log.sessionMinutes(draft)', () => {
  const had = Object.prototype.hasOwnProperty.call(pageLog, 'sessionMinutes');
  const prev = pageLog.sessionMinutes;
  const calls = [];
  pageLog.sessionMinutes = d => { calls.push(d); return 77; };
  try {
    const draft = { startedAt: Date.now() - 5000, entries: [{ sets: [{ done: true, touched: true, reps: '10' }] }] };
    const root = mkNode('div');
    renderComplete({ view: null, settings: {}, data: { goals: [] }, state: {}, app: {}, nav: () => {} }, root, draft,
      { records: [], goalCount: 0, muted: true, completionCelebrated: false, confettiStop: null });
    assert.strictEqual(calls.length, 1, 'sessionMinutes was called once');
    assert.strictEqual(calls[0], draft, 'with the draft');
    assert.ok(/77 min/.test(textOf(root)), `the tile shows the contract's number: ${JSON.stringify(textOf(root))}`);
  } finally {
    if (had) pageLog.sessionMinutes = prev; else delete pageLog.sessionMinutes;
  }
});

check('F2-10c. K5: until F3 lands, the tile falls back to the old floor-at-1 elapsed minutes instead of throwing', () => {
  const had = Object.prototype.hasOwnProperty.call(pageLog, 'sessionMinutes');
  const prev = pageLog.sessionMinutes;
  delete pageLog.sessionMinutes;
  try {
    const draft = { startedAt: Date.now() - 5000, entries: [{ sets: [{ done: true, touched: true, reps: '10' }] }] };
    const root = mkNode('div');
    renderComplete({ view: null, settings: {}, data: { goals: [] }, state: {}, app: {}, nav: () => {} }, root, draft,
      { records: [], goalCount: 0, muted: true, completionCelebrated: false, confettiStop: null });
    assert.ok(/1 min/.test(textOf(root)));
  } finally {
    if (had) pageLog.sessionMinutes = prev;
  }
});

check('F2-10d. K2: page-session turns an entry into a target ONLY through counter-target (no private parse of "65% max")', () => {
  const src = fs.readFileSync(path.join(SRC, 'page-session.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/targetFirstNumber|targetDurationSeconds|targetWeight\b|targetIsDuration/.test(src),
    'page-session reads a plan target through plan-parse directly - a second parser that F3\'s open-ended rule would not reach');
  const uses = src.match(/counterTarget\.targetFromEntry\(/g) || [];
  assert.ok(uses.length >= 2, 'the reps screen and the hold screen both build their target here');
});

check('F2-10e. K2: when counter-target exposes isOpenEnded (lane F3), a "65% max" entry builds no target on either screen', () => {
  const counterTarget = require(path.join(SRC, 'counter-target'));
  if (typeof counterTarget.isOpenEnded !== 'function') { console.log('      (lane F3\'s counter-target.isOpenEnded is not in this tree yet: behaviour half skipped, shape half above holds)'); return; }
  assert.strictEqual(counterTarget.targetFromEntry({ exercise: 'Plank', duration: true, target: '65% max' }), null);
  assert.strictEqual(counterTarget.targetFromEntry({ exercise: 'Push-ups', target: '65% max' }), null);
});

let bad = 0;
for (const [name, err] of results) {
  if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
  else console.log(`ok    ${name}`);
}
if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
console.log(`f2 contracts OK (${results.length} cases)`);
