'use strict';
/* "LOG RUN" WITH EVERY BOX EMPTY MUST NOT SAVE AN ALL-BLANK ROW (journey
   audit finding 4).

   THE BUG THIS REPRODUCES. A distance entry's set counts as "worth saving"
   under stats.setCounts the moment it is ticked done, whatever its own two
   fields hold. Ticking Done on a run with neither a distance nor minutes
   typed in used to sail straight through buildRows and write
   `distance_km: '', seconds: ''` into the saved note — a row with nothing
   in it, saved as if it were a logged run.

   THE FIX must not touch the plain reps case: `reps: '0'` is a real
   "I failed the set" signal, and setCounts already treats a ticked or typed
   0 as worth saving — that decision is Ruan's, not this finding's. */
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
const { setCounts } = require('../src/stats');
Module._load = origLoad;

const draftOf = () => {
  const ctx = { data: { exercises: [{ name: 'Easy Run', fm: { unit: 'km' } }] }, state: {} };
  startDraft(ctx, { name: 'Cardio' }, {
    name: 'Run day', items: [{ exercise: 'Easy Run', target: '', sets: 1 }],
  });
  return ctx.state.logDraft;
};

/* ---- 1. a ticked run with both boxes empty saves nothing ---- */
{
  const draft = draftOf();
  const set = draft.entries[0].sets[0];
  assert.strictEqual(set.distance_km, '');
  assert.strictEqual(set.minutes, '');
  set.done = true; // "Log run" with every box empty
  assert.ok(setCounts(set), 'setCounts alone still says this was ticked — that half of the contract is unchanged');
  const rows = buildRows(draft);
  assert.strictEqual(rows.length, 0,
    'a distance row with neither a distance nor minutes must not be saved — it is junk history');
}

/* ---- 2. a distance filled in (even with no minutes) still saves ---- */
{
  const draft = draftOf();
  const set = draft.entries[0].sets[0];
  set.distance_km = '5'; set.touched = true;
  const rows = buildRows(draft);
  assert.strictEqual(rows.length, 1, 'a real distance, even without a time, is worth saving');
  assert.strictEqual(rows[0].distance_km, '5');
}

/* ---- 3. minutes alone (no distance) still saves ---- */
{
  const draft = draftOf();
  const set = draft.entries[0].sets[0];
  set.minutes = '20'; set.touched = true;
  const rows = buildRows(draft);
  assert.strictEqual(rows.length, 1, 'a real duration, even without a distance, is worth saving');
  assert.strictEqual(rows[0].seconds, '1200');
}

/* ---- 4. the plain reps: 0 case is untouched — this finding does not own it */
{
  const ctx = { data: { exercises: [{ name: 'Squats', fm: { unit: null } }] }, state: {} };
  startDraft(ctx, { name: 'Legs' }, { name: 'Day', items: [{ exercise: 'Squats', target: '10', sets: 1 }] });
  const draft = ctx.state.logDraft;
  const set = draft.entries[0].sets[0];
  set.reps = '0'; set.touched = true;
  assert.ok(setCounts(set), 'a typed 0 still counts — "I failed the set" is a real signal');
  const rows = buildRows(draft);
  assert.strictEqual(rows.length, 1, 'a reps:0 row must still be saved — this finding only touches distance rows');
  assert.strictEqual(rows[0].reps, '0');
}

/* ---- 5. the on-screen tally uses the SAME rule as buildRows ----
   "what you see is what lands" is the documented contract for this
   function — a tally that still counted the blank tick while buildRows
   silently dropped it would show "1 set" for a session that saved 0. */
{
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-log.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const tally = src.match(/let doneSets = 0[\s\S]{0,300}/)[0];
  assert.match(tally, /setWorthSaving\(entry, set\)/,
    'the tally must gate on the same rule buildRows saves by, not the bare setCounts');
}

console.log('log blank-distance OK (an all-blank "Log run" tick saves nothing; reps:0 is untouched)');
