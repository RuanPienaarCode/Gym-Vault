'use strict';
/* AN exercise-duration GOAL MUST NOT DISAGREE WITH THE RECORDS PAGE ABOUT
   THE SAME "HOLD" (journey audit finding 2, goals-side half).

   THE BUG THIS REPRODUCES. goalCurrent (stats.js) reads
   exerciseBests(...).seconds straight off for an exercise-duration goal.
   page-log.buildRows deliberately fills `seconds` for a REP exercise too —
   a timed circuit measures real time on a push-up interval on purpose (see
   records.claimableKinds's header). Records.allRecords now refuses to call
   that a "hold" for a rep exercise, but page-goals read the raw figure
   regardless, so a duration goal pointed at Push-ups still reported a
   circuit's 45-second interval as progress toward a hold nobody ever
   attempted — the Records page and the Goals page confidently disagreeing
   about the same underlying number.

   THE FIX gates page-goals' reading through records.claimableKinds, the
   SAME gate the Records page uses, so the two cannot come to disagree. */
const assert = require('node:assert');
const Module = require('node:module');

const domStub = { setIcon: () => {}, requestUrl: async () => ({}) };
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { ...domStub, Notice: class {}, Modal: class {}, Setting: class {}, normalizePath: p => p, Platform: { isMobile: false } }
  : origLoad(req, ...rest));

/* A DOM stub thorough enough for page-goals.render(): it builds an SVG ring
   (createElementNS + appendChild) as well as ordinary elements. */
function mkNode(tag) {
  const node = {
    nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { node.attrs[k] = v; },
    addEventListener() {}, querySelector: () => null,
    append(...kids) { node.children.push(...kids); },
    appendChild(kid) { node.children.push(kid); return kid; },
  };
  return node;
}
global.document = {
  createElement: mkNode,
  createElementNS: (ns, tag) => mkNode(tag),
  createTextNode: t => ({ nodeType: 3, text: String(t) }),
};
global.window = global.window || {};
const { render } = require('../src/page-goals');
Module._load = origLoad;

/* Collect every text node under a stub tree, in document order. */
function texts(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (node.nodeType === 3) { out.push(node.text); return out; }
  if (typeof node.textContent === 'string' && node.textContent) out.push(node.textContent);
  for (const c of node.children || []) texts(c, out);
  return out;
}

function renderGoals(exercises, workouts, goals) {
  const ctx = {
    data: { exercises, workouts, body: [], goals },
    settings: { weekStart: 'mon' },
    app: {}, state: {},
    nav: () => {}, notice: () => {}, reload: () => {}, openFile: () => {},
  };
  const root = mkNode('div');
  render(ctx, root);
  return texts(root, []);
}

const wk = (date, rows) => ({ fm: { date }, rows });

/* ---- 1. a duration goal on a REP exercise reads "no data", not the
   circuit's clock reading ---- */
{
  const exercises = [{ name: 'Push-ups', fm: { unit: 'reps' } }];
  const workouts = [wk('2026-03-01', [{ exercise: 'Push-ups', reps: '15', seconds: '45' }])];
  const goals = [{ name: 'Hold a plank push-up', fm: { metric: 'exercise-duration', exercise: 'Push-ups', target: 30, direction: 'increase' } }];
  const out = renderGoals(exercises, workouts, goals).join(' | ');
  assert.ok(!out.includes('45s'),
    `a rep exercise's circuit-clock seconds must not be read as duration-goal progress — rendered: ${out}`);
  assert.ok(out.includes('log a workout to start tracking') || out.includes('—'),
    'with the figure gated out this must read as "no data", not a silent zero');
}

/* ---- 2. a duration goal on a GENUINELY timed exercise still works ---- */
{
  const exercises = [{ name: 'Plank', fm: { unit: 'seconds' } }];
  const workouts = [wk('2026-03-01', [{ exercise: 'Plank', seconds: '45' }])];
  const goals = [{ name: 'Hold a minute', fm: { metric: 'exercise-duration', exercise: 'Plank', target: 60, direction: 'increase' } }];
  const out = renderGoals(exercises, workouts, goals).join(' | ');
  assert.ok(out.includes('45s'),
    `a real hold on a seconds exercise must still show its progress — rendered: ${out}`);
}

console.log('log goal-duration-gate OK (a rep exercise\'s circuit clock is not duration-goal progress)');
