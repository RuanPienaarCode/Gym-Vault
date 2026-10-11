'use strict';
/* TODAY'S PROGRESS ELEMENTS REACH THE SCREEN WITH REAL NUMBERS (Apex skin).

   progress.test.cjs pins the arithmetic. This file renders the real
   page-dashboard.render() against a DOM stub, because "the function is right"
   and "the number is on the screen" are two claims: the ticker, the PB-in-reach
   line, the weekly ring and the streak nag are each wired in the render and
   each has a condition under which it must NOT appear. Class names are the
   contract Lane A styles from, so they are asserted verbatim. */
const assert = require('node:assert');
const Module = require('node:module');

const mkNode = tag => ({
  nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, parent: null,
  classList: {
    add(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.add(c); this.owner.className = [...s].join(' '); },
    remove(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.delete(c); this.owner.className = [...s].join(' '); },
    contains(c) { return String(this.owner.className).split(/\s+/).includes(c); },
    toggle(c, on) { const want = on === undefined ? !this.contains(c) : !!on; return want ? this.add(c) : this.remove(c); },
  },
  setAttribute(k, v) { this.attrs[k] = String(v); },
  getAttribute(k) { return this.attrs[k]; },
  addEventListener(ev, fn) { (this.listeners[ev] || (this.listeners[ev] = [])).push(fn); },
  append(...kids) { for (const k of kids) { if (k && k.nodeType === 1) k.parent = this; this.children.push(k); } },
  appendChild(k) { this.append(k); return k; },
  get textContent() { return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join(''); },
  querySelector(sel) {
    const want = sel.replace(/^\./, '');
    const walk = n => { for (const c of n.children || []) { if (c.nodeType !== 1) continue; if (c.tag === want || clsOf(c).includes(want)) return c; const h = walk(c); if (h) return h; } return null; };
    return walk(this);
  },
});
/* The ring sets its class with setAttribute('class', ...) - which the real DOM
   maps onto className and this stub does not - so read both. */
const clsOf = n => `${n.className} ${n.attrs.class || ''}`.split(/\s+/).filter(Boolean);
global.document = {
  createElement(tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createElementNS(_ns, tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createTextNode(t) { return { nodeType: 3, tag: '#text', text: String(t) }; },
};
global.window = global.window || {};

const origLoad = Module._load;
const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
};
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));
const dashboard = require('../src/page-dashboard');
const { todayISO, startOfWeek, addDays, weekdayKey } = require('../src/dates');
const { WEEKDAYS } = require('../src/constants');
Module._load = origLoad;

const findAll = (node, cls, out) => {
  out = out || [];
  for (const c of node.children || []) {
    if (c.nodeType !== 1) continue;
    if (clsOf(c).includes(cls)) out.push(c);
    findAll(c, cls, out);
  }
  return out;
};
const one = (root, cls) => {
  const hits = findAll(root, cls);
  assert.ok(hits.length <= 1, `expected at most one .${cls}, got ${hits.length}`);
  return hits[0] || null;
};

/* ---------- a week whose schedule is known whatever day the suite runs ---------- */

const TODAY = todayISO();
const WK = startOfWeek(TODAY, 'mon');
const todayKey = weekdayKey(TODAY);
/* Four training weekdays, today's among them, the rest left empty. */
const trainKeys = new Set([todayKey]);
for (const k of WEEKDAYS) if (trainKeys.size < 4) trainKeys.add(k);
const lift = { name: 'A · Pull Priority', weekday: 'mon', items: [{ exercise: 'Dips', sets: 3, target: 'AMRAP' }, { exercise: 'Pull-ups', sets: 3, target: '8' }], notes: [] };
const restDay = { name: 'Rest & recovery', weekday: 'mon', items: [], notes: [] };
const plan = { name: 'P', fm: { active: 'true' }, model: { days: [lift], intro: [] } };
const scheduleFor = wk => (trainKeys.has(wk) ? [{ plan, day: lift }] : []);

const w = (date, rows) => ({ name: date, fm: { date }, rows: rows || [{ exercise: 'Pull-ups', reps: '9' }] });

function render(over) {
  const ctx = Object.assign({
    app: {},
    data: { workouts: [], exercises: [{ name: 'Pull-ups', fm: { unit: 'reps' } }, { name: 'Dips', fm: { unit: 'reps' } }], goals: [], body: [] },
    settings: { weekStart: 'mon' },
    state: { logDraft: null },
    io: {}, nav() {}, notice() {}, reload() {}, startGuided() {}, startLog() {},
    activePlan: () => plan, activePlanIsImplicit: () => false, mainPlans: () => [plan],
    parallelPlans: () => [], fallbackPlans: () => [],
    daysOn: scheduleFor,
  }, over || {});
  const root = mkNode('div'); root.classList.owner = root;
  dashboard.render(ctx, root);
  return root;
}
/* this week's session dates, always inside the week whatever day it is */
const inWeek = n => Array.from({ length: n }, (_, i) => addDays(WK, i));
const lastWeek = () => addDays(WK, -3);

/* ---------- 1. the ticker ---------- */
{
  const root = render();
  const t = one(root, 'gv-ticker');
  assert.ok(t, 'a training day renders the .gv-ticker strip');
  assert.strictEqual(t.attrs['aria-hidden'], 'true', 'it is decoration: hidden from assistive tech');
  const spans = [];
  (function walk(n) { for (const c of n.children || []) { if (c.nodeType !== 1) continue; if (c.tag === 'span') spans.push(c); walk(c); } })(t);
  assert.ok(spans.length >= 3, 'a strip of spans');
  assert.ok(spans.some(s => s.textContent === 'Lock in') && spans.some(s => s.textContent === 'No days off') && spans.some(s => s.textContent === 'Earn it'));
  /* between the hero's head (kicker, title, chips, sub) and the Rx list. The
     head is one wrapper so Lock In can flood it alone; the title lives in it. */
  const hero = one(root, 'gv-hero');
  const order = hero.children.map(c => clsOf(c).find(x => /^gv-(hero-head|ticker|rx)$/.test(x)) || '');
  const iHead = order.indexOf('gv-hero-head'), iTick = order.indexOf('gv-ticker'), iRx = order.indexOf('gv-rx');
  assert.ok(iHead === 0 && iTick > iHead && iRx > iTick, `ticker sits between the head block and the Rx list (order: ${order.join(', ')})`);
  assert.ok(one(hero.children[iHead], 'gv-hero-title'), 'the title is inside the head');
}
/* a rest day has no "No days off" banner over it */
{
  const root = render({ daysOn: () => [{ plan, day: restDay }] });
  assert.strictEqual(one(root, 'gv-ticker'), null, 'a rest day carries no ticker');
}

/* ---------- 1b. a long day name steps the hero title down (Apex) ----------
   The CSS (.is-long / .is-xlong) is pinned in apex-review-notes.test.cjs; this pins
   the classes page-dashboard puts on the title, by length. Up to 44 characters is
   an ordinary day name and stays at the mockup size. */
{
  const titleClassFor = len => {
    const name = 'x'.repeat(len);
    const day = { name, weekday: 'mon', items: [{ exercise: 'Dips', sets: 3, target: 'AMRAP' }], notes: [] };
    const root = render({ daysOn: () => [{ plan, day }], activePlan: () => ({ name: 'P', fm: { active: 'true' }, model: { days: [day], intro: [] } }) });
    const h = findAll(root, 'gv-hero-title')[0];
    assert.ok(h, `the hero renders a title for a ${len}-character day name`);
    return clsOf(h).filter(c => c !== 'gv-display' && c !== 'gv-hero-title').join(' ');
  };
  for (const len of [8, 19, 30, 40, 44]) assert.strictEqual(titleClassFor(len), '', `${len} characters: the normal size`);
  for (const len of [45, 60, 70]) assert.strictEqual(titleClassFor(len), 'is-long', `${len} characters steps down once`);
  for (const len of [71, 95, 140]) assert.strictEqual(titleClassFor(len), 'is-xlong', `${len} characters steps down twice`);
}

/* ---------- 2. PB in reach ---------- */
{
  const root = render({ data: { workouts: [w(lastWeek(), [{ exercise: 'Pull-ups', reps: '12' }])], exercises: [{ name: 'Pull-ups', fm: { unit: 'reps' } }, { name: 'Dips', fm: { unit: 'reps' } }], goals: [], body: [] } });
  const reach = one(root, 'gv-pb-reach');
  assert.ok(reach, 'an exercise with a prior best gets the nudge');
  assert.strictEqual(reach.textContent, 'PB in reach · best 12, hit 13');
  const lis = findAll(root, 'gv-rx').flatMap(rx => rx.children);
  const host = lis.filter(li => findAll(li, 'gv-pb-reach').length);
  assert.strictEqual(host.length, 1, 'on exactly ONE .gv-rx li');
  assert.ok(host[0].textContent.indexOf('Pull-ups') !== -1, 'and it is the Pull-ups row (Dips has no history to chase)');
  assert.ok(host[0].textContent.indexOf('Dips') === -1);
}
{
  const root = render();
  assert.strictEqual(one(root, 'gv-pb-reach'), null, 'no history, no nudge - never an invented target');
}

/* ---------- 3. this week ---------- */
const ringParts = wp => {
  const ring = findAll(wp, 'gv-week-progress-ring')[0];
  const circles = [];
  (function walk(n) { for (const c of n.children || []) { if (c.nodeType !== 1) continue; if (c.tag === 'circle') circles.push(c); walk(c); } })(ring);
  return { ring, track: circles.find(c => clsOf(c).includes('gv-ring-track')), fill: circles.find(c => clsOf(c).includes('gv-ring-fill')) };
};
/* circumference from the circle's OWN r attribute, and the dasharray it carries,
   as numbers: the test restates the maths (2*pi*r * pct/100) rather than a string. */
const circ = c => 2 * Math.PI * Number(c.attrs.r);
const dashOf = (c, pct) => {
  const [dash, gap] = c.attrs['stroke-dasharray'].split(/\s+/).map(Number);
  assert.ok(Number.isFinite(dash) && Number.isFinite(gap), `dasharray is two numbers, got "${c.attrs['stroke-dasharray']}"`);
  const want = circ(c) * pct / 100;
  assert.ok(Math.abs(dash - want) < 1e-6, `${pct}%: dash ${dash} != ${want} (2*pi*r*pct/100)`);
  assert.ok(Math.abs(gap - circ(c)) < 1e-6, `gap ${gap} != circumference ${circ(c)}`);
};
{
  const root = render({ data: { workouts: inWeek(2).map(d => w(d)), exercises: [], goals: [], body: [] } });
  const wp = one(root, 'gv-week-progress');
  assert.ok(wp, 'a week with a target renders .gv-week-progress');
  assert.strictEqual(one(wp, 'gv-week-progress-num').textContent, '2/4');
  assert.strictEqual(one(wp, 'gv-week-progress-togo').textContent, '2 to go');
  assert.strictEqual(one(wp, 'gv-week-progress-label').textContent, 'This week');
  const { ring, track, fill } = ringParts(wp);
  assert.ok(ring && ring.tag === 'svg', 'the ring is an inline SVG');
  assert.ok(track && fill, 'with circle.gv-ring-track and circle.gv-ring-fill');
  /* The dash is measured against the REAL circumference. `pathLength` on a
     <circle> is unconfirmed on iOS 15 WebKit, so it must not be what the ring
     depends on - and must not be there at all (a half-honoured attribute is the
     worst case: dasharray "50 100" read as pixels is a 50px arc). */
  assert.ok(!('pathLength' in track.attrs) && !('pathLength' in fill.attrs), 'no pathLength: the ring does not lean on it');
  dashOf(fill, 50); /* 2 of 4 is half of 2*pi*r, on a gap of one full circumference */
  assert.strictEqual(track.attrs['stroke-dasharray'], undefined, 'the track is the whole circle, undashed');
  assert.ok(/2 of 4/.test(ring.attrs['aria-label'] || ''), `the ring is labelled: ${ring.attrs['aria-label']}`);
  assert.strictEqual(ring.attrs.role, 'img');
}
{
  const root = render({ data: { workouts: inWeek(4).map(d => w(d)), exercises: [], goals: [], body: [] } });
  const wp = one(root, 'gv-week-progress');
  assert.strictEqual(one(wp, 'gv-week-progress-togo').textContent, 'Week done');
  assert.strictEqual(one(wp, 'gv-week-progress-num').textContent, '4/4');
  dashOf(ringParts(wp).fill, 100); /* a met week closes the ring: dash == the circumference */
}
{
  const goals = [{ name: 'Three a week', fm: { metric: 'workouts-per-week', target: 3 } }];
  const root = render({ data: { workouts: [w(inWeek(1)[0])], exercises: [], goals, body: [] } });
  assert.strictEqual(one(one(root, 'gv-week-progress'), 'gv-week-progress-num').textContent, '1/3', 'the user\'s own goal sets the target');
}
{
  const root = render({ daysOn: () => [{ plan, day: restDay }] });
  assert.strictEqual(one(root, 'gv-week-progress'), null, 'a rest-only week has no target, so no ring');
  assert.strictEqual(one(root, 'gv-streak-risk'), null);
}

/* ---------- 4. the streak nag: only when the streak breaks unless something is logged ---------- */
{
  /* alive via last week, nothing yet this week */
  const root = render({ data: { workouts: [w(lastWeek())], exercises: [], goals: [], body: [] } });
  const risk = one(root, 'gv-streak-risk');
  assert.ok(risk, 'streak alive and nothing logged this week -> shown');
  assert.strictEqual(risk.textContent, "Don't break it · 1 session by Sunday keeps your 1-week streak");
}
{
  /* one this week of four: the streak is already safe, so no nag (the ring says "3 to go") */
  const root = render({ data: { workouts: [w(lastWeek()), w(inWeek(1)[0])], exercises: [], goals: [], body: [] } });
  assert.strictEqual(one(root, 'gv-streak-risk'), null, 'one session logged: the streak survives, so claiming a risk would be false');
  assert.strictEqual(one(one(root, 'gv-week-progress'), 'gv-week-progress-togo').textContent, '3 to go', 'the under-target case is the ring\'s job');
}
{
  const root = render({ data: { workouts: [], exercises: [], goals: [], body: [] } });
  assert.strictEqual(one(root, 'gv-streak-risk'), null, 'no streak, nothing to lose, no nag');
  assert.ok(one(root, 'gv-week-progress'), 'but the ring still shows');
  const fill = ringParts(one(root, 'gv-week-progress')).fill;
  dashOf(fill, 0); /* nothing done: an empty ring, not a missing one */
}
{
  /* a fraction that is not 50/100: 1 of 3 = 33%, so the maths cannot pass by
     accident on a half. */
  const goals = [{ name: 'Three a week', fm: { metric: 'workouts-per-week', target: 3 } }];
  const root = render({ data: { workouts: [w(inWeek(1)[0])], exercises: [], goals, body: [] } });
  const fill = ringParts(one(root, 'gv-week-progress')).fill;
  dashOf(fill, 33);
}
{
  const root = render({ data: { workouts: inWeek(4).map(d => w(d)), exercises: [], goals: [], body: [] } });
  assert.strictEqual(one(root, 'gv-streak-risk'), null, 'target met, no nag');
}

console.log('today apex progress OK (ticker, PB in reach, weekly ring and streak nag render real numbers, and stay away when they should)');
