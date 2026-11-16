'use strict';
/* CALM'S HOME IS THE SHORT ONE (16 Nov 2026, "home is too busy, too much text").

   On the Calm style, Today shows the day's name, ONE summary line and the
   Start button. The warm-up prose, the exercise list and the Bring chips fold
   into a closed "See the workout" disclosure under the buttons; the stat
   tiles, the streak nag, the "No zero days." line, the sets/last-session line
   and the level row's second line are not drawn. Every other style is
   untouched.
     S1  simpleToday: Calm only
     S2  todaySummary: "5 exercises · about 25 min", singular when one
     S3  Calm markup: summary line, closed <details> AFTER the Start slab,
         holding the prose, the list (PB-in-reach row intact) and the kit
     S4  the other styles keep the list in the hero and the prose as the sub
     S5  done today still says so; a rest day's list folds away too
     S6  the disclosure remembers being opened across re-renders
     S7  CSS: Calm hides the five extras on Today, and only Calm does
   GV_DASHBOARD_JS / GV_STYLES_CSS point at broken copies (mutation testing). */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

const mkNode = tag => ({
  nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, parent: null,
  classList: {
    add(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.add(c); this.owner.className = [...s].join(' '); },
    remove(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.delete(c); this.owner.className = [...s].join(' '); },
    contains(c) { return String(this.owner.className).split(/\s+/).includes(c); },
  },
  setAttribute(k, v) { this.attrs[k] = String(v); },
  getAttribute(k) { return this.attrs[k]; },
  addEventListener(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); },
  append(...kids) { for (const k of kids) { if (k && k.nodeType === 1) k.parent = this; this.children.push(k); } },
  appendChild(k) { this.append(k); return k; },
  get textContent() { return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join(''); },
  querySelector() { return null; },
});
const clsOf = n => `${n.className} ${n.attrs.class || ''}`.split(/\s+/).filter(Boolean);
global.document = {
  createElement(tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createElementNS(_ns, tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createTextNode(t) { return { nodeType: 3, tag: '#text', text: String(t) }; },
};
global.window = global.window || {};
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {}, ItemView: class {}, Plugin: class {},
  PluginSettingTab: class {}, TFile: class {}, normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
} : origLoad(req, ...rest));
const SRC = process.env.GV_DASHBOARD_JS || '../src/page-dashboard';
const dashboard = require(SRC);
const { todayISO, startOfWeek, addDays } = require('../src/dates');
Module._load = origLoad;
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const findAll = (node, cls, out) => {
  out = out || [];
  for (const c of node.children || []) { if (c.nodeType !== 1) continue; if (clsOf(c).includes(cls)) out.push(c); findAll(c, cls, out); }
  return out;
};
const first = (node, cls) => findAll(node, cls)[0] || null;


const check = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); } };
let failed = 0;
const TODAY = todayISO();
const PROSE = 'Warm-up: 3 minutes easy on the rower. Then three sets of each.';
const ITEMS = [{ exercise: 'Incline Press', sets: 3, target: '6-8' }, { exercise: 'Pull-ups', sets: 3, target: '3-5' }, { exercise: 'Row', sets: 3, target: '8-10' }, { exercise: 'Lateral Raise', sets: 3, target: '12-15' }, { exercise: 'Face Pull', sets: 3, target: '15' }];
const mkDay = o => Object.assign({ name: 'Upper · Push & Pull', weekday: 'mon', items: ITEMS, notes: [PROSE] }, o || {});
function render(o) {
  o = o || {};
  const d = o.day || mkDay();
  const pl = { name: 'P', fm: { active: 'true' }, model: { days: [d], intro: [] } };
  const ctx = {
    app: {}, data: { workouts: o.workouts || [], exercises: [{ name: 'Pull-ups', fm: { unit: 'reps' } }], goals: [], body: [] },
    settings: Object.assign({ weekStart: 'mon' }, o.settings || {}), state: Object.assign({ logDraft: null }, o.state || {}),
    io: {}, nav() {}, notice() {}, reload() {}, startGuided() {}, startLog() {},
    activePlan: () => pl, activePlanIsImplicit: () => false, mainPlans: () => [pl],
    parallelPlans: () => [], fallbackPlans: () => [], daysOn: () => [{ plan: pl, day: d }],
  };
  const root = mkNode('div'); root.classList.owner = root;
  dashboard.render(ctx, root);
  return { root, ctx };
}
const byTag = (node, tag, out) => { out = out || []; for (const c of node.children || []) { if (c.nodeType !== 1) continue; if (c.tag === tag) out.push(c); byTag(c, tag, out); } return out; };
/* the fake DOM keeps a raw string child as a string (append('text')), which its own textContent skips */
const txt = n => (n.children || []).map(c => (typeof c === 'string' ? c : c.nodeType === 3 ? c.text : txt(c))).join('');
const calm = { skin: 'calm' };

check('S1 simpleToday is Calm only', () => {
  assert.strictEqual(dashboard.simpleToday({ skin: 'calm' }), true);
  for (const skin of ['apex', 'lockin', 'floor', 'editorial', undefined, '']) assert.strictEqual(dashboard.simpleToday({ skin }), false, String(skin));
  assert.strictEqual(dashboard.simpleToday(null), false);
});

check('S2 todaySummary is one short line', () => {
  assert.strictEqual(dashboard.todaySummary(5, 25), '5 exercises · about 25 min');
  assert.strictEqual(dashboard.todaySummary(1, 15), '1 exercise · about 15 min');
});

check('S3 Calm: summary line, then Start, then a closed disclosure holding the detail', () => {
  const { root } = render({ settings: calm });
  const hero = first(root, 'gv-hero');
  assert.strictEqual(txt(first(hero, 'gv-hero-sub')), '5 exercises · about 25 min');
  const more = byTag(hero, 'details');
  assert.strictEqual(more.length, 1, 'one disclosure');
  const d = more[0];
  assert.ok(clsOf(d).includes('gv-today-more') && d.parent === hero, 'details.gv-today-more is the hero\'s own child');
  assert.ok(!('open' in d.attrs), 'closed by default');
  const sum = byTag(d, 'summary')[0];
  assert.ok(sum && /See the workout/.test(txt(sum)), 'its label says what it opens');
  assert.strictEqual(txt(first(d, 'gv-today-notes')), PROSE, 'the prose moved inside');
  const rx = first(d, 'gv-rx');
  assert.ok(rx && rx.children.length === 5, 'the list moved inside, whole');
  assert.ok(!hero.children.some(c => clsOf(c).includes('gv-rx')), 'the list is no longer loose in the hero');
  const kids = hero.children;
  const iSlab = kids.findIndex(c => clsOf(c).includes('gv-hero-action')), iMore = kids.indexOf(d);
  assert.ok(iSlab > 0 && iMore > iSlab, 'Start comes before the disclosure, so opening it never moves the button');
  assert.ok(first(hero, 'gv-btn-go') && first(hero, 'gv-hero-manual'), 'both ways to start are still there');
  const bare = render({ settings: calm, day: mkDay({ notes: [] }) });
  assert.ok(!first(bare.root, 'gv-today-notes'), 'no prose, no empty paragraph');
});

check('S3 the PB-in-reach row survives inside the disclosure', () => {
  const w = (date, reps) => ({ name: date, fm: { date }, rows: [{ exercise: 'Pull-ups', reps: String(reps) }] });
  const { root } = render({ settings: calm, workouts: [w(addDays(TODAY, -7), 6)] });
  assert.ok(first(first(root, 'gv-today-more'), 'gv-rx-reach'), 'the reach row is in the folded list');
});

check('S4 every other style keeps the full hero', () => {
  for (const skin of ['apex', 'lockin', 'floor', 'editorial', undefined]) {
    const { root } = render({ settings: { skin } });
    const hero = first(root, 'gv-hero');
    assert.strictEqual(byTag(hero, 'details').length, 0, `${skin}: no disclosure`);
    assert.ok(hero.children.some(c => clsOf(c).includes('gv-rx')), `${skin}: the list is in the hero`);
    assert.strictEqual(txt(first(hero, 'gv-hero-sub')), PROSE, `${skin}: the sub is the prose`);
  }
});

check('S5 done today still says so; a rest day folds its list too', () => {
  const done = render({ settings: calm, workouts: [{ name: TODAY, fm: { date: TODAY }, rows: [{ exercise: 'Row', reps: '8' }] }] });
  assert.strictEqual(txt(first(done.root, 'gv-hero-sub')), 'Logged for today — nice work.');
  const rest = render({ settings: calm, day: { name: 'Rest & recovery', weekday: 'mon', notes: [], items: [{ exercise: 'Walk', sets: null, target: '20 min' }] } });
  const d = byTag(first(rest.root, 'gv-hero'), 'details')[0];
  assert.ok(d && first(d, 'gv-rx-rest'), 'the rest list is inside the disclosure');
  assert.ok(first(rest.root, 'gv-btn-hero-ghost'), 'Log recovery is still there');
});

check('S6 the disclosure remembers being opened', () => {
  const a = render({ settings: calm });
  const d = byTag(a.root, 'details')[0];
  assert.ok(d.listeners.toggle && d.listeners.toggle.length === 1, 'listens for toggle');
  d.open = true; d.listeners.toggle[0]();
  assert.strictEqual(a.ctx.state.todayMoreOpen, true);
  d.open = false; d.listeners.toggle[0]();
  assert.strictEqual(a.ctx.state.todayMoreOpen, false);
  const b = render({ settings: calm, state: { todayMoreOpen: true } });
  assert.ok('open' in byTag(b.root, 'details')[0].attrs, 'a re-render keeps it open');
});

check('S7 Calm hides the extras on Today, and only Calm does', () => {
  const rules = cx.load();
  const SPOTS = {
    'stat tiles': ['div.gv-today', 'div.gv-tiles'],
    'streak nag': ['div.gv-today', 'p.gv-streak-risk'],
    '"No zero days."': ['div.gv-today', 'p.gv-microcopy'],
    'sets / last line': ['div.gv-today', 'div.gv-hero.gv-hero-today', 'div.gv-hero-action', 'div.gv-hero-action-line'],
    'level second line': ['div.gv-today', 'div.gv-slot-level', 'div.gv-rw-level', 'div.gv-rw-level-mid', 'div.gv-rw-level-foot'],
  };
  const shown = (skin, chain) => { const d = cx.computed(cx.appChain({ theme: 'light', skin, accent: 'olive' }, ...chain), 'display', rules); return !d || d.value !== 'none'; };
  for (const [name, chain] of Object.entries(SPOTS)) {
    assert.ok(!shown('calm', chain), `Calm must not draw the ${name}`);
    assert.ok(shown('floor', chain), `Floor must still draw the ${name}`);
  }
  /* tiles and microcopy elsewhere (Records, Profile) are untouched */
  assert.ok(shown('calm', ['div.gv-tiles']), 'tiles off Today stay');
  assert.ok(shown('calm', ['p.gv-microcopy']), 'microcopy off Today stays');
});

if (failed) { console.error(`simple-today: ${failed} failed`); process.exit(1); }
