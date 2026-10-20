'use strict';
/* WAVE 2, item 2 (audit L1-13): A RUN'S TIME SURVIVES THE MINUTES BOX UNCHANGED.

   The run screen holds a run's time as MINUTES (the column is seconds; nobody
   logs a 30-minute run as 1800). timedSetValues wrote it rounded to 0.1 min, and
   buildRows converts back with round(minutes * 60) - so 45 s became 0.8 min and
   was saved as 48 s. The same 0.1 rounding sat on the guided run's
   "last time" prefill (page-session.lastRunForExercise), which re-saved a
   remembered 2745 s run as 2748.

   Two decimals of a minute are enough to give every whole second back exactly
   (the error is at most 0.3 s), and a whole number of minutes still prints as
   "30". ONE conversion, timed-plan.minutesText, serves both directions. */
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
const { buildRows } = require('../src/page-log');
const timedPlan = require('../src/timed-plan');
Module._load = origLoad;

const savedSeconds = (minutes) => {
  const draft = { entries: [{ exercise: 'Easy Run', distance: true, sets: [{ distance_km: '5', minutes, done: true, touched: true }] }] };
  return buildRows(draft)[0].seconds;
};
const entry = { distance: true };

/* 1. the reported case */
{
  const v = timedPlan.timedSetValues(entry, { touched: false }, 45);
  assert.strictEqual(savedSeconds(v.minutes), '45', `a 45 s interval saved as ${savedSeconds(v.minutes)} s (minutes box held "${v.minutes}")`);
}
/* 2. every whole second from 1 s to 24 h comes back exactly */
{
  for (let s = 1; s <= 86400; s++) {
    const v = timedPlan.timedSetValues(entry, { touched: false }, s);
    if (savedSeconds(v.minutes) !== String(s)) assert.fail(`${s} s -> minutes "${v.minutes}" -> ${savedSeconds(v.minutes)} s`);
  }
}
/* 3. a whole number of minutes still reads as a plain number, and 30 min stays 1800 s */
assert.strictEqual(timedPlan.timedSetValues(entry, {}, 1800).minutes, '30');
assert.strictEqual(savedSeconds('30'), '1800');
/* 4. the prefill reader uses the same rule (a note's seconds -> the box) */
assert.strictEqual(typeof timedPlan.minutesText, 'function', 'timed-plan exports minutesText, the one seconds->minutes rule');
assert.strictEqual(timedPlan.minutesText(2745), '45.75');
assert.strictEqual(timedPlan.minutesText(2700), '45');
console.log('w2 run minutes OK');
