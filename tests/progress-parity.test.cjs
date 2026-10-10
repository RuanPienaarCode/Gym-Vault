'use strict';
/* TODAY PREDICTS THE KIND A SESSION WILL CLAIM, AND THE TWO MUST AGREE.

   progress.entryShape lets Today ask "which record would a session claim for
   this plan line?" without building a draft. page-log.makeEntry is the code
   that actually decides, when the draft is built. Two rules for one fact is
   this codebase's recurring bug, so this file builds REAL drafts through
   page-log.startDraft for a spread of units and written targets and requires
   classifyKind(entryShape(...)) to equal classifyKind(real entry) every time.
   If makeEntry's duration / weighted / distance rule changes and entryShape
   does not follow, the PB-in-reach nudge starts promising records the session
   will not celebrate - and this fails by name. */
const assert = require('node:assert');
const Module = require('node:module');

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {}, ItemView: class {},
  Plugin: class {}, PluginSettingTab: class {}, TFile: class {}, normalizePath: p => p,
} : origLoad(req, ...rest));
global.document = global.document || { createElement() { return {}; }, createTextNode: t => ({ nodeType: 3, text: t }) };
global.window = global.window || {};
const { startDraft } = require('../src/page-log');
const { entryShape, classifyKind } = require('../src/progress');
Module._load = origLoad;

const UNITS = ['reps', 'kg', 'seconds', 'km', undefined];
const TARGETS = ['', '8', '8-12', 'AMRAP', 'submax', '30s', '45 sec', '2 min', '30 min easy', '8 @ 20kg', '5 @ 60 kg', '20s @ 10kg', '1 x 40s'];

let n = 0;
for (const unit of UNITS) {
  for (const target of TARGETS) {
    const exercise = unit === undefined ? null : { name: 'X', fm: { unit } };
    const ctx = { data: { exercises: exercise ? [exercise] : [] }, state: {} };
    startDraft(ctx, { name: 'P' }, { name: 'D', items: [{ exercise: 'X', sets: 1, target }] });
    const real = ctx.state.logDraft.entries[0];
    const predicted = entryShape(exercise, target);
    assert.strictEqual(
      classifyKind(predicted), classifyKind(real),
      `unit=${unit} target=${JSON.stringify(target)}: Today predicts ${classifyKind(predicted)} but the session builds ${classifyKind(real)}`);
    assert.deepStrictEqual(
      predicted, { distance: real.distance, duration: real.duration, weighted: real.weighted },
      `unit=${unit} target=${JSON.stringify(target)}: the three flags must match makeEntry exactly`);
    n++;
  }
}
console.log(`progress parity OK (${n} unit x target combinations agree with page-log.makeEntry)`);
