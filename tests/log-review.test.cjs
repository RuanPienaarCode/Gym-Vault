'use strict';
/* THE OVERVIEW MUST NOT SHOW THE PLAN AS WORK DONE (issue #4).

   THE BUG THIS REPRODUCES, from a first-run smoke test. Three sets were
   logged — dips 6, dips 5, pull-ups 5 — and the rest of an 18-set day was
   skipped. The saved note was honest: three rows. History was honest:
   "3 sets · 8 min". The OVERVIEW was not. Every planned exercise still
   showed five rows carrying the plan's own numbers, in boxes that rendered
   identically to a figure you had entered, so it read as five sets of submax
   that were never performed. The reporter thought they had credited
   themselves a full 18-set day.

   makeEntry seeds those boxes from the prescription and marks them
   `touched: false`. stats.setCounts — the SAME rule finishSession saves by —
   has always ignored them. Only the pixels disagreed.

   DIMMED, NOT EMPTIED. Ticking a prefilled set is a real and useful action
   ("I did exactly what the plan said") and setCounts honours it. Emptying
   the boxes would remove that to fix a display problem.

   Distinct from #16, which is the same lie reaching the SAVED FILE through a
   timed interval. This one never reached disk. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

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

/* The reported day: five exercises, five sets each. */
const DAY = {
  name: 'B · Push + Volume',
  items: [
    { exercise: 'Straight-bar Dips', target: 'submax', sets: 5 },
    { exercise: 'Pull-ups', target: 'submax', sets: 5 },
    { exercise: 'Push-ups', target: '15', sets: 5 },
  ],
};

const draftOf = () => {
  const ctx = { data: { exercises: [] }, state: {} };
  startDraft(ctx, { name: 'Get Over The Bar' }, DAY);
  return ctx.state.logDraft;
};

/* ---------- 1. the state the screen has to render honestly ---------- */
{
  const draft = draftOf();
  const dips = draft.entries[0];

  /* The reporter's session: two dips sets and one pull-up, nothing else. */
  dips.sets[0].reps = '6'; dips.sets[0].touched = true;
  dips.sets[1].reps = '5'; dips.sets[1].touched = true;
  draft.entries[1].sets[0].reps = '5'; draft.entries[1].sets[0].touched = true;

  const rows = buildRows(draft);
  assert.strictEqual(rows.length, 3,
    'the note that lands has three rows — this is the figure everything on screen must match');

  /* Push-ups was never touched, yet every set holds the plan's 15. */
  const pushups = draft.entries[2];
  assert.strictEqual(pushups.sets.length, 5);
  assert.ok(pushups.sets.every(s => String(s.reps) === '15'),
    'the boxes really do hold the plan target — this is what was being rendered as work');
  assert.ok(pushups.sets.every(s => !setCounts(s)),
    'and setCounts has always known none of it happened');

  /* THE RULE THE SCREEN NOW FOLLOWS. */
  const isPrefill = s => !s.touched && !s.done;
  assert.ok(pushups.sets.every(isPrefill), 'every untouched set is marked as the plan speaking');
  assert.ok(!isPrefill(dips.sets[0]), 'a set you typed into is yours, not the plan\'s');

  const logged = e => e.sets.some(setCounts);
  assert.deepStrictEqual(draft.entries.map(logged), [true, true, false],
    'Push-ups must be marked as not logged — it is the one nobody did');
}

/* ---------- 2. ticking a prefilled set still counts ---------- */
{
  const draft = draftOf();
  const pushups = draft.entries[2];
  /* No typing — just the tick. "I did exactly what the plan said." */
  pushups.sets[0].done = true;

  assert.ok(setCounts(pushups.sets[0]), 'a ticked set counts, typed into or not');
  const rows = buildRows(draft).filter(r => r.exercise === 'Push-ups');
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].reps, '15',
    'and it saves the prescribed figure — emptying the boxes to fix the display would have lost this');

  const isPrefill = s => !s.touched && !s.done;
  assert.ok(!isPrefill(pushups.sets[0]), 'a ticked set is no longer the plan speaking');
  assert.ok(isPrefill(pushups.sets[1]), 'the four below it still are');
}

/* ---------- 3. the screen is wired to those rules ---------- */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-log.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  assert.match(src, /const isPrefill = !set\.touched && !set\.done;/,
    'a set row must know whether it is showing the plan or the user');
  assert.match(src, /isPrefill \? ' prefill' : ''/,
    'and must say so in its class, or the two look identical');
  assert.match(src, /const logged = entry\.sets\.some\(setCounts\);/,
    'an exercise must ask setCounts — the SAME rule finishSession saves by, so the label and the note cannot disagree');
  assert.match(src, /'not logged yet'/,
    'and an exercise nobody touched must say so');
  assert.match(src, /not yet logged/,
    'including to a screen reader, which cannot see that the box is dimmed');

  /* The boxes keep their values: the fix is visual, and emptying them would
     break tick-to-accept. */
  assert.match(src, /value: set\[key\] \?\? ''/,
    'the prefill stays in the box — ticking it is a real action');

  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.gv-log-set\.prefill \.gv-set-input\s*\{[^}]*color:\s*var\(--gv-ink-dim\)/,
    'the prefill class must actually change how the figure reads, or the class is decoration');
  assert.match(css, /\.gv-log-card\.unlogged/,
    'and an untouched exercise card must be marked');
}

console.log('log review OK (the plan\'s numbers read as the plan\'s; ticking one still logs it)');
