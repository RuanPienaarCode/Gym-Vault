'use strict';
/* Shared fake DOM + Today ctx for the tests/audit-1125-today-*.test.cjs guards.
   Not a test itself (no .test.cjs suffix). The ctx is built from the REAL plan
   rules (plan-parse.mainPlansOf / activePlanOf, controller.resolveDaysOn) so a
   guard drives the shipping scheduling, not a copy of it. */
const Module = require('node:module');

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
  removeChild(k) { this.children = this.children.filter(c => c !== k); },
  get firstChild() { return this.children[0] || null; },
  get textContent() { return this.children.map(c => (typeof c === 'string' ? c : c.nodeType === 3 ? c.text : c.textContent || '')).join(''); },
  querySelector() { return null; },
});
const own = n => { n.classList.owner = n; return n; };
global.document = {
  querySelector() { return null; },
  createElement(tag) { return own(mkNode(tag)); },
  createElementNS(_ns, tag) { return own(mkNode(tag)); },
  createTextNode(t) { return { nodeType: 3, tag: '#text', text: String(t) }; },
};
global.window = global.window || {};

const opened = [];
const origLoad = Module._load;
class FakeModal {
  constructor(app) { this.app = app; opened.push(this); const mk = () => { const n = own(mkNode('div')); n.addClass = c => n.classList.add(c); n.createDiv = () => own(mkNode('div')); n.empty = () => { n.children = []; }; return n; }; this.modalEl = mk(); this.contentEl = mk(); this.titleEl = mk(); this.titleEl.setText = t => { this.titleEl.text = t; }; }
  open() { this.opened = true; if (this.onOpen) this.onOpen(); }
  close() { this.closed = true; }
}
Module._load = (req, ...rest) => (req === 'obsidian' ? {
  setIcon: () => {}, Notice: class {}, Modal: FakeModal, Setting: class {}, ItemView: class {}, Plugin: class {},
  PluginSettingTab: class {}, TFile: class {}, TFolder: class {}, normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
} : origLoad(req, ...rest));
const dashboard = require(process.env.GV_DASHBOARD_JS || '../src/page-dashboard');
const controller = require('../src/controller');
const picker = require('../src/workout-picker');
const planParse = require('../src/plan-parse');
const dates = require('../src/dates');
Module._load = origLoad;

const clsOf = n => `${n.className} ${n.attrs.class || ''}`.split(/\s+/).filter(Boolean);
const findAll = (node, cls, out) => {
  out = out || [];
  for (const c of node.children || []) { if (c.nodeType !== 1) continue; if (clsOf(c).includes(cls)) out.push(c); findAll(c, cls, out); }
  return out;
};
const first = (node, cls) => findAll(node, cls)[0] || null;
const byTag = (node, tag, out) => { out = out || []; for (const c of node.children || []) { if (c.nodeType !== 1) continue; if (c.tag === tag) out.push(c); byTag(c, tag, out); } return out; };
const txt = n => (n.children || []).map(c => (typeof c === 'string' ? c : c.nodeType === 3 ? c.text : txt(c))).join('');
const buttons = root => byTag(root, 'button');
const buttonText = b => txt(b).trim();
const hasButton = (root, re) => buttons(root).some(b => re.test(buttonText(b)));
const findButton = (root, re) => buttons(root).find(b => re.test(buttonText(b))) || null;
const click = async b => { for (const fn of b.listeners.click || []) await fn({ stopPropagation() {} }); };

const mkDay = (weekday, name, items) => ({ weekday, name, items: items || [{ exercise: 'Push-ups', sets: 3, target: '10' }], notes: [] });
const mkPlan = (name, days, fm) => ({ name, file: { path: `Gym/Plans/${name}.md` }, fm: Object.assign({}, fm || {}), model: { days, intro: [] } });

/* o: plans, workouts, goals, settings, state, today(unused: real clock), overrides (ctx fields) */
function renderToday(o) {
  o = o || {};
  const plans = o.plans || [];
  const calls = { nav: [], start: [], startAlt: [], guided: [], startLog: [], notice: [], reload: 0 };
  const ctx = {
    app: {}, data: { plans, workouts: o.workouts || [], exercises: [], goals: o.goals || [], body: [] },
    settings: Object.assign({ weekStart: 'mon', skin: 'floor' }, o.settings || {}), state: Object.assign({ logDraft: null }, o.state || {}),
    io: o.io || { setActivePlan: async () => {} },
    nav: (...a) => calls.nav.push(a), notice: m => calls.notice.push(m), reload: () => { calls.reload++; },
    start: (p, d) => calls.start.push([p, d]), startAlt: (p, d) => calls.startAlt.push([p, d]),
    startGuided: (p, d) => calls.guided.push([p, d]), startLog: (p, d) => calls.startLog.push([p, d]),
    activePlan: () => planParse.activePlanOf(plans), activePlanIsImplicit: () => controller.isImplicitActive(planParse.mainPlansOf(plans)),
    mainPlans: () => planParse.mainPlansOf(plans), parallelPlans: () => controller.parallelPlansOf(plans), fallbackPlans: () => controller.fallbackPlansOf(plans),
  };
  ctx.daysOn = wk => controller.resolveDaysOn(wk, ctx.activePlan(), ctx.parallelPlans(), ctx.fallbackPlans());
  Object.assign(ctx, o.overrides || {});
  const root = own(mkNode('div'));
  dashboard.render(ctx, root);
  return { root, ctx, calls };
}

module.exports = { picker, dashboard, dates, planParse, controller, mkNode, own, opened, clsOf, findAll, first, byTag, txt, buttons, buttonText, hasButton, findButton, click, mkDay, mkPlan, renderToday };
