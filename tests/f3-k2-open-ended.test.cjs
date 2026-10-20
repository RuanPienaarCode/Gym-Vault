'use strict';
/* K2: a target containing `%` ("65% max") is OPEN-ENDED. The seeded starter plan
   writes `Plank | 3 x 65% max`; the first number in it (65) is a percentage of
   a max nobody has recorded, not 65 seconds. One helper, counter-target.
   isOpenEnded, is read by the guided target, the manual-log prefill and the
   timed schedule. A WRITTEN duration still wins ("80% for 30s" is 30s). */
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
const { startDraft } = require('../src/page-log');
Module._load = origLoad;
const ct = require('../src/counter-target');
const tp = require('../src/timed-plan');

assert.strictEqual(typeof ct.isOpenEnded, 'function', 'counter-target exports isOpenEnded');
assert.strictEqual(ct.isOpenEnded('65% max'), true);
assert.strictEqual(ct.isOpenEnded('80%'), true);
assert.strictEqual(ct.isOpenEnded('65'), false);
assert.strictEqual(ct.isOpenEnded('45s'), false);
assert.strictEqual(ct.isOpenEnded(''), false);
assert.strictEqual(ct.isOpenEnded(null), false);

/* guided: no seconds/reps goal, so no "TARGET 65S" and no "Time reached" meter */
assert.strictEqual(ct.targetFromEntry({ exercise: 'Plank', target: '65% max', duration: true }), null, 'timed hold');
assert.strictEqual(ct.targetFromEntry({ exercise: 'Squat', target: '65% max' }), null, 'rep exercise');
assert.deepStrictEqual(ct.targetFromEntry({ exercise: 'Plank', target: '60s', duration: true }), { kind: 'seconds', value: 60 }, 'control: a real 60s target is untouched');
assert.deepStrictEqual(ct.targetFromEntry({ exercise: 'Plank', target: '80% for 30s', duration: true }), { kind: 'seconds', value: 30 }, 'a written duration still wins');

/* manual log prefill */
{
  const ctx = { data: { exercises: [{ name: 'Plank', fm: { unit: 'seconds' } }, { name: 'Squat', fm: { unit: 'kg' } }] }, state: {} };
  startDraft(ctx, { name: 'P' }, { name: 'D', items: [
    { exercise: 'Plank', target: '65% max', sets: 3 },
    { exercise: 'Squat', target: '65% max', sets: 5 },   // plan-parse has split "5 x 65% max": target is the right-hand side
    { exercise: 'Plank', target: '60s', sets: 1 },
  ] });
  const [plank, squat, ctl] = ctx.state.logDraft.entries;
  assert.ok(plank.sets.every(s => s.seconds === '' && s.reps === ''), `Plank 65% max prefilled ${JSON.stringify(plank.sets[0])}`);
  assert.ok(squat.sets.every(s => s.reps === '' && s.seconds === ''), 'a rep exercise gets no 65-rep prefill either');
  assert.strictEqual(ctl.sets[0].seconds, 60, 'control: 60s still prefills 60');
}

/* timed mode */
assert.strictEqual(tp.workSecondsFor({ exercise: 'Plank', target: '65% max', unit: 'seconds' }, { workSeconds: 45 }), 45,
  'open-ended hold runs the default interval, not 65 s');
assert.strictEqual(tp.workSecondsFor({ exercise: 'Plank', target: '65', unit: 'seconds' }, { workSeconds: 45 }), 65, 'control: bare seconds unchanged');
console.log('f3 K2 open-ended targets OK');
