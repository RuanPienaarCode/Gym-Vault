'use strict';
/* THE TODAY HERO SAYS WHEN IT IS A REST HERO (0.13.1).

   Lock In paints the hero as a full accent flood. On a rest day that is the
   loudest thing on the screen, the opposite of what the day is for, and CSS
   cannot tell the two apart without a hook. So the hero carries `gv-hero-rest`
   on BOTH kinds of rest day — a rest day written into the plan, and a day with
   nothing scheduled at all — and never on a training day. */
const assert = require('node:assert');
const Module = require('node:module');

const mkNode = tag => ({
  nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {},
  classList: {
    add(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.add(c); this.owner.className = [...s].join(' '); },
    contains(c) { return String(this.owner.className).split(/\s+/).includes(c); },
  },
  setAttribute(k, v) { this.attrs[k] = String(v); },
  getAttribute(k) { return this.attrs[k]; },
  addEventListener() {},
  querySelector() { return null; },
  append(...kids) { for (const k of kids) this.children.push(k); },
  appendChild(k) { this.append(k); return k; },
  get textContent() { return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join(''); },
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
const dashboard = require('../src/page-dashboard');
Module._load = origLoad;

const findAll = (node, cls, out = []) => {
  for (const c of node.children || []) { if (c.nodeType !== 1) continue; if (clsOf(c).includes(cls)) out.push(c); findAll(c, cls, out); }
  return out;
};
const lift = { name: 'Push', weekday: 'mon', items: [{ exercise: 'Dips', sets: 3, target: '8' }], notes: [] };
const rest = { name: 'Rest & recovery', weekday: 'mon', items: [], notes: [] };
const plan = { name: 'P', fm: { active: 'true' }, model: { days: [lift, rest], intro: [] } };

function hero(daysOn) {
  const ctx = {
    app: {}, data: { workouts: [], exercises: [{ name: 'Dips', fm: { unit: 'reps' } }], goals: [], body: [] },
    settings: { weekStart: 'mon' }, state: { logDraft: null },
    io: {}, nav() {}, notice() {}, reload() {}, startGuided() {}, startLog() {},
    activePlan: () => plan, activePlanIsImplicit: () => false, mainPlans: () => [plan],
    parallelPlans: () => [], fallbackPlans: () => [], daysOn,
  };
  const root = mkNode('div'); root.classList.owner = root;
  dashboard.render(ctx, root);
  const heroes = findAll(root, 'gv-hero');
  assert.strictEqual(heroes.length, 1, 'exactly one hero');
  return clsOf(heroes[0]);
}

let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const training = () => [{ plan, day: lift }];
const plannedRest = () => [{ plan, day: rest }];
const nothing = () => [];

ok(!hero(training).includes('gv-hero-rest'), 'a training day is not a rest hero');
ok(hero(plannedRest).includes('gv-hero-rest'), 'a rest day written into the plan is a rest hero');
ok(hero(nothing).includes('gv-hero-rest'), 'a day with nothing scheduled is a rest hero');
ok(hero(training).includes('gv-hero'), 'the hero keeps its base class');
console.log(`hero rest class OK (${n} checks)`);
