'use strict';
/* THE TODAY SCREEN ACTUALLY DRAWS THE WAY BACK INTO AN OPEN SESSION.

   THE BUG THIS REPRODUCES (0.11.2 journey audit). Leaving a session by the
   nav bar — one tap, and the nav bar is visible during rest and on the
   completion screen — kept the draft alive on ctx.state.logDraft but offered
   it back nowhere. controller.js's nav handler has carried the comment
   "Leaving mid-log keeps the draft: coming back to Today offers the log page
   again" since 0.5; nothing ever read the draft back, and the next Start
   simply overwrote it. Every completed set, gone, silently.

   today-resolution.test.cjs pins the RULES and the wiring in source. This
   file renders the real page-dashboard.render() against a DOM stub, because
   "the slab is in the source" and "the slab reaches the screen" are two
   different claims and only the second one is the fix. */
const assert = require('node:assert');
const Module = require('node:module');

/* ---------- DOM stub (house pattern, see session-sets-ui.test.cjs) ---------- */

const mkNode = tag => ({
  /* nodeType 1 is load-bearing: el() checks `kid.nodeType` to tell an element
     from a string, so a stub without it stringifies its children. */
  nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, parent: null,
  hidden: false, disabled: false, value: '',
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
  get textContent() {
    if (this._text !== undefined) return this._text;
    return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join('');
  },
  set textContent(v) { this._text = v; this.children = []; },
  /* ico() probes for an already-drawn <svg> before falling back, so a stub
     without querySelector throws inside every icon on the page. */
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
  /* The streak flame draws real SVG. It is not what this file is about, but
     the whole page renders in one pass, so it has to survive. */
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
const { describeDraft, isImplicitActive } = require('../src/controller');

/* ---------- a vault just big enough to render Today ---------- */

const plan = (name, days, fm) => ({
  name,
  fm: fm || {},
  model: {
    days: days.map(d => ({ name: d.name, weekday: d.weekday, items: d.items || [], notes: [] })),
    intro: [],
  },
});

const thePlan = plan('Get Over The Bar', [
  { name: 'A · Pull Priority', weekday: 'mon', items: [{ exercise: 'Pull-ups', sets: 3, target: '8' }] },
], { active: 'true' });

function makeCtx(over) {
  const ctx = {
    app: {},
    data: { workouts: [], exercises: [{ name: 'Pull-ups', fm: { unit: 'reps' } }], goals: [], body: [] },
    settings: { weekStart: 'mon' },
    state: { logDraft: null },
    io: { setActivePlan: async () => {} },
    nav: () => {}, notice: () => {}, reload: () => {},
    startGuided: () => {}, startLog: () => {},
    activePlan: () => thePlan,
    activePlanIsImplicit: () => false,
    mainPlans: () => [thePlan],
    parallelPlans: () => [],
    fallbackPlans: () => [],
    /* Every weekday resolves to the one day, so the hero always has a
       session and the draft slab is never the only thing on screen — the
       point is that it appears ALONGSIDE today's plan, not instead of it. */
    daysOn: () => [{ plan: thePlan, day: thePlan.model.days[0] }],
    resumeDraft() { this._resumed = true; },
  };
  ctx.describeDraft = () => describeDraft(ctx.state.logDraft);
  Object.assign(ctx, over || {});
  return ctx;
}

const renderTo = ctx => { const root = mkNode('div'); root.classList.owner = root; dashboard.render(ctx, root); return root; };

const findAll = (node, cls, out) => {
  out = out || [];
  for (const c of node.children || []) {
    if (c.nodeType !== 1) continue;
    if (String(c.className).split(/\s+/).includes(cls)) out.push(c);
    findAll(c, cls, out);
  }
  return out;
};
const findButton = (node, label) =>
  findAll(node, 'gv-btn').concat(findAll(node, 'gv-btn-small'))
    .find(b => b.textContent.indexOf(label) !== -1) || null;

/* ---- PROMISE 1: no draft, no slab ---- */

const clean = renderTo(makeCtx());
assert.strictEqual(
  findButton(clean, 'Resume'), null,
  'with no session in progress the Today screen must NOT offer a Resume — a slab that is always there ' +
  'says nothing, and the user would learn to ignore the one time it matters.',
);

/* ---- PROMISE 2: a live draft is announced, named, and resumable ---- */

const withDraft = makeCtx();
withDraft.state.logDraft = {
  plan: 'Get Over The Bar', day: 'A · Pull Priority', date: '2026-09-06', startedAt: Date.now(), entries: [],
};
const drafted = renderTo(withDraft);

const resume = findButton(drafted, 'Resume');
assert.ok(
  resume,
  'a session left mid-flight must be offered back on Today. The draft survives on ctx.state.logDraft, but ' +
  'until this slab existed nothing read it and the next Start overwrote it — every completed set lost, ' +
  'with no warning and nothing to undo it.',
);

const text = drafted.textContent;
assert.ok(
  text.indexOf('Session in progress') !== -1,
  `the slab must SAY a session is open, not just offer a button — the user has usually forgotten. Got: ${text.slice(0, 200)}`,
);
assert.ok(
  text.indexOf('A · Pull Priority') !== -1 && text.indexOf('Get Over The Bar') !== -1,
  `the slab names the day and the plan, so the user knows what they are going back into. Got: ${text.slice(0, 200)}`,
);
/* Since 0.12.1 the draft survives a kill (kept device-local, draft-store.js),
   so "nothing is saved" would now be false — but it is still NOT in the vault
   until Finish, and that is the fact that makes resuming matter. */
assert.ok(
  text.indexOf('Kept on this device') !== -1 && text.indexOf('saved to your vault when you finish') !== -1,
  'the slab must say where the work is: kept on this device, and not in the vault until Finish. Got: ' + text.slice(0, 200),
);

(resume.listeners.click || []).forEach(fn => fn({}));
assert.strictEqual(
  withDraft._resumed, true,
  'the Resume button must actually call ctx.resumeDraft() — a slab that announces an open session and ' +
  'then does nothing is a worse dead end than saying nothing at all.',
);

/* Today's own session still renders beside it: the draft is additional
   information, not a takeover of the screen. */
assert.ok(
  drafted.textContent.indexOf('Get after it') !== -1 || findAll(drafted, 'gv-btn-go').length > 0,
  'the hero must still render its own start action with a draft open — the slab sits alongside Today, ' +
  'it does not replace it.',
);

/* ---- PROMISE 3: an unflagged active plan says so, and can be claimed ---- */

const implicit = makeCtx({ activePlanIsImplicit: () => true });
let claimed = null;
implicit.io = { setActivePlan: async (plans, p) => { claimed = p.name; } };
const nagged = renderTo(implicit);

assert.ok(
  nagged.textContent.indexOf('No active plan') !== -1
  && nagged.textContent.indexOf('Today is using Get Over The Bar') !== -1,
  `when nothing carries the active flag, Today must admit which plan it picked for the user. Every ` +
  `downloaded plan arrives active: false, so this is the state a user lands in by deleting the seeded ` +
  `plan. Got: ${nagged.textContent.slice(0, 200)}`,
);

const claim = findButton(nagged, 'Make it active');
assert.ok(claim, 'saying "no plan is active" without offering to fix it just moves the dead end one step along.');
(claim.listeners.click || []).forEach(fn => fn({}));
assert.strictEqual(
  claimed, 'Get Over The Bar',
  'Make it active must flag the plan Today is already driving, so the badge and the behaviour agree.',
);

/* And it stays quiet when the choice was explicit — isImplicitActive is the
   one rule behind both this notice and the guard in today-resolution. */
assert.strictEqual(isImplicitActive([thePlan]), false, 'a flagged plan is an explicit choice; Today must not nag.');
const quiet = renderTo(makeCtx());
assert.strictEqual(
  quiet.textContent.indexOf('No active plan'), -1,
  'a plan flagged active must produce no notice at all.',
);

console.log('today draft render OK (an open session is announced, named and resumable; an unflagged ' +
  'active plan says so and can be claimed; neither appears when it should not)');
