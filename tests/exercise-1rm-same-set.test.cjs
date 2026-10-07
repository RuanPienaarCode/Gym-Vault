'use strict';
/* "EST. 1RM" COMES FROM ONE SET — NEVER THE BEST WEIGHT OF ONE SET WITH THE
   BEST REPS OF ANOTHER.

   THE BUG THIS REPRODUCES (0.12.0 audit, L1-01). page-exercise-detail.js fed
   exerciseBests(...).weight and exerciseBests(...).reps — two independent
   maxima, usually from different sets — into epley1RM. A heavy single
   (140 kg x 1) and a light back-off set (60 kg x 20) printed 233.3 kg: a lift
   nobody did and no formula supports. The best single-set estimate is 144.7.

   The same file already refuses this shape for running ("longest time is
   deliberately NOT divided by longest distance to make a pace"); the 1RM was
   the one place that rule was not kept.

   Two halves, because "the function is right" and "the page calls it" are two
   different claims:
     1. stats.best1RM — the rule, on synthetic workouts.
     2. the real page-exercise-detail.render() against a DOM stub — the figure
        that reaches the screen. */
const assert = require('node:assert');
const Module = require('node:module');

/* ---------- DOM + obsidian stub (house pattern, see today-draft-render) ---------- */

const mkNode = tag => ({
  nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, parent: null,
  hidden: false, disabled: false, value: '',
  classList: {
    add(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.add(c); this.owner.className = [...s].join(' '); },
    remove(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.delete(c); this.owner.className = [...s].join(' '); },
    contains(c) { return String(this.owner.className).split(/\s+/).includes(c); },
    toggle() {},
  },
  setAttribute(k, v) { this.attrs[k] = String(v); },
  getAttribute(k) { return this.attrs[k]; },
  addEventListener(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); },
  append(...kids) { for (const k of kids) { if (k && k.nodeType === 1) k.parent = this; this.children.push(k); } },
  appendChild(k) { this.append(k); return k; },
  get childNodes() { return this.children; },
  get textContent() {
    if (this._text !== undefined) return this._text;
    return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join('');
  },
  set textContent(v) { this._text = v; this.children = []; },
  querySelector(sel) {
    const want = sel.replace(/^\./, '');
    const byTag = sel.charAt(0) !== '.';
    const walk = n => {
      for (const c of n.children || []) {
        if (c.nodeType !== 1) continue;
        if (byTag ? c.tag === want : String(c.className).split(/\s+/).includes(want)) return c;
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this);
  },
});
global.document = {
  createElement(tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createElementNS(_ns, tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createTextNode(t) { return { nodeType: 3, tag: '#text', text: String(t) }; },
};
global.window = global.window || {};

const origLoad = Module._load;
const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {}, TFolder: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
  MarkdownRenderer: null,
};
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));

const stats = require('../src/stats');
const detail = require('../src/page-exercise-detail');

/* ---------- synthetic fixtures ---------- */

const row = (exercise, reps, weight_kg) => ({ exercise, set: 1, reps: String(reps), weight_kg: weight_kg === '' ? '' : String(weight_kg), seconds: '', note: '', distance_km: '' });
const session = (date, rows) => ({ name: date, fm: { date }, rows });

/* A heavy single and a light high-rep back-off set: an ordinary training week. */
const HEAVY_AND_LIGHT = [
  session('2026-09-01', [row('Back Squat', 1, 140)]),
  session('2026-09-03', [row('Back Squat', 20, 60)]),
];

function pageTiles(workouts, exerciseFm) {
  const ex = { name: 'Back Squat', fm: exerciseFm || { unit: 'kg', type: 'strength' }, body: '', file: { path: 'Gym/Exercises/Back Squat.md' } };
  const ctx = {
    app: { vault: { getFileByPath: () => null, getResourcePath: () => '' }, metadataCache: { getFirstLinkpathDest: () => null } },
    data: { workouts, exercises: [ex] },
    state: { params: { exercise: 'Back Squat' } },
    nav() {}, backTo: f => f, back() {}, openFile() {}, view: null,
  };
  const root = global.document.createElement('div');
  detail.render(ctx, root);
  const tiles = [];
  const walk = n => { for (const c of n.children || []) { if (c.nodeType !== 1) continue; if (String(c.className).split(/\s+/).includes('gv-tile')) tiles.push(c.textContent); else walk(c); } };
  walk(root);
  return tiles;
}

/* Run every case and report them all by name, so a failing run prints each
   wrong value rather than stopping at the first. */
const failures = [];
function check(name, fn) {
  try { fn(); } catch (e) { failures.push(`  FAIL  ${name}\n        ${String(e.message).split('\n').join('\n        ')}`); }
}

/* ---------- 2. the page: the figure that reaches the screen ---------- */

check('page: 140 kg x 1 and 60 kg x 20 shows est. 1RM 144.7 kg, not 233.3', () => {
  const orm = pageTiles(HEAVY_AND_LIGHT).find(t => /est\. 1RM/.test(t));
  assert.ok(orm, 'the exercise page must show an est. 1RM tile for a weighted exercise');
  assert.strictEqual(orm, '144.7 kgest. 1RM',
    `page printed "${orm}" — the best weight and the best reps came from different sets`);
});

check('page: one logged set shows that set\'s own estimate', () => {
  const tiles = pageTiles([session('2026-09-01', [row('Back Squat', 5, 100)])]);
  assert.ok(tiles.includes('116.7 kgest. 1RM'), `got ${JSON.stringify(tiles)}`);
});

check('page: weight on one row and reps on another, never together, shows no 1RM', () => {
  const tiles = pageTiles([
    session('2026-09-01', [row('Back Squat', '', 100)]),
    session('2026-09-03', [row('Back Squat', 12, '')]),
  ]);
  assert.ok(!tiles.some(t => /est\. 1RM/.test(t)),
    `a 1RM was shown without any single set holding both figures: ${JSON.stringify(tiles)}`);
  assert.ok(tiles.some(t => /last done/.test(t)), 'with no 1RM the tile falls back to "last done"');
});

check('page: a run (unit km) still shows no 1RM and no best-weight tiles', () => {
  const tiles = pageTiles(HEAVY_AND_LIGHT, { unit: 'km', type: 'cardio' });
  assert.ok(!tiles.some(t => /est\. 1RM/.test(t)), `a run page must not print a 1RM: ${JSON.stringify(tiles)}`);
  assert.ok(tiles.some(t => /longest run/.test(t)), 'run page keeps its own tiles');
});

/* ---------- 1. the rule: stats.best1RM ---------- */

check('stats.best1RM is exported', () => {
  assert.strictEqual(typeof stats.best1RM, 'function', 'stats.best1RM must exist and be exported');
});

check('best1RM: max over each set\'s own weight and reps (140x1 vs 60x20)', () => {
  assert.strictEqual(stats.best1RM(HEAVY_AND_LIGHT, 'Back Squat'), 144.7);
});

check('best1RM: equals the best per-set epley1RM, whichever session holds it', () => {
  const ws = [
    session('2026-09-01', [row('Row', 10, 50), row('Row', 8, 60)]),
    session('2026-09-08', [row('Row', 3, 70), row('Row', 15, 30)]),
  ];
  const expect = Math.max(...ws.flatMap(s => s.rows).map(r => stats.epley1RM(+r.weight_kg, +r.reps)));
  assert.strictEqual(stats.best1RM(ws, 'Row'), expect);
  /* Sanity: the winner is one real set (70 x 3), and it is NOT the cross-set
     blend of best weight (70) with best reps (15) that the old page printed. */
  assert.strictEqual(expect, stats.epley1RM(70, 3), `the best set here is 70 x 3, got ${expect}`);
  assert.notStrictEqual(stats.best1RM(ws, 'Row'), stats.epley1RM(70, 15), 'must not equal the cross-set blend');
});

check('best1RM: a single set is that set\'s own Epley figure', () => {
  assert.strictEqual(stats.best1RM([session('2026-09-01', [row('Bench Press', 5, 100)])], 'Bench Press'), 116.7);
});

check('best1RM: matches the name the way every other best does (case, spaces)', () => {
  const ws = [session('2026-09-01', [row('  back SQUAT ', 5, 100), row('Front Squat', 1, 400)])];
  assert.strictEqual(stats.best1RM(ws, 'Back Squat'), 116.7, 'must neither miss a case variant nor borrow another exercise\'s rows');
});

check('best1RM: no weight anywhere -> null (not 0)', () => {
  const ws = [session('2026-09-01', [row('Pull-ups', 12, ''), row('Pull-ups', 8, '')])];
  assert.strictEqual(stats.best1RM(ws, 'Pull-ups'), null);
});

check('best1RM: weight without reps -> null', () => {
  assert.strictEqual(stats.best1RM([session('2026-09-01', [row('Carry', '', 40)])], 'Carry'), null);
});

check('best1RM: zero and negative figures are not a set', () => {
  const ws = [session('2026-09-01', [row('Squat', 0, 100), row('Squat', 5, 0), row('Squat', -3, 100), row('Squat', 5, -20)])];
  assert.strictEqual(stats.best1RM(ws, 'Squat'), null);
});

check('best1RM: never logged -> null', () => {
  assert.strictEqual(stats.best1RM(HEAVY_AND_LIGHT, 'Never Done'), null);
  assert.strictEqual(stats.best1RM([], 'Back Squat'), null);
});

check('best1RM: a workout with no rows is skipped, not a crash', () => {
  assert.strictEqual(stats.best1RM([{ fm: { date: '2026-09-01' } }, ...HEAVY_AND_LIGHT], 'Back Squat'), 144.7);
});

if (failures.length) {
  console.error(`exercise-1rm-same-set: ${failures.length} case(s) failed\n${failures.join('\n')}`);
  process.exit(1);
}
console.log('exercise-1rm-same-set OK (est. 1RM is the best single set\'s own Epley figure, on the page and in stats.best1RM)');
