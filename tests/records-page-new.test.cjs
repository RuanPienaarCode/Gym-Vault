'use strict';
/* THE RECORDS PAGE MARKS THE NEWEST RECORD (Apex skin).

   The most recently BEATEN best gets .gv-rec-new on its row, a struck-through
   <s class="gv-rec-prev"> of what it beat, and a .gv-rec-delta. Everything
   comes from records.latestRecord (itself built on allRecords/recordHistory),
   so the row that is marked carries the same value and date the page prints
   beside it. A best set once and never beaten is a baseline and is never "new";
   a row hidden by the search or muscle filter is simply not drawn. */
const assert = require('node:assert');
const Module = require('node:module');

const mkNode = tag => ({
  nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, parent: null, value: '',
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
  removeChild(k) { this.children = this.children.filter(c => c !== k); },
  get firstChild() { return this.children[0] || null; },
  get textContent() { return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join(''); },
  querySelector() { return null; },
});
global.document = {
  createElement(tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createElementNS(_ns, tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createTextNode(t) { return { nodeType: 3, tag: '#text', text: String(t) }; },
};
global.window = global.window || {};
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {}, ItemView: class {},
  Plugin: class {}, PluginSettingTab: class {}, TFile: class {}, normalizePath: p => p,
} : origLoad(req, ...rest));
const page = require('../src/page-records');
Module._load = origLoad;

const all = (n, cls, out = []) => {
  for (const k of n.children || []) {
    if (k.nodeType !== 1) continue;
    if (String(k.className).split(/\s+/).includes(cls)) out.push(k);
    all(k, cls, out);
  }
  return out;
};
const w = (date, rows) => ({ name: date, fm: { date }, rows });
const row = (exercise, o) => Object.assign({ exercise, set: 1, reps: '', weight_kg: '', seconds: '', distance_km: '' }, o);
const ex = (name, unit, muscles) => ({ name, fm: { unit, muscles }, file: null });

const HIST = [
  w('2026-01-01', [row('Push-ups', { reps: '12' }), row('Bench', { weight_kg: '60' })]),
  w('2026-02-01', [row('Push-ups', { reps: '14' })]),
  w('2026-03-01', [row('Bench', { weight_kg: '65' }), row('Plank', { seconds: '100' })]),
];
const EXS = [ex('Push-ups', 'reps', ['chest']), ex('Bench', 'kg', ['chest']), ex('Plank', 'seconds', ['core'])];

function render(workouts, exercises, ui) {
  const ctx = { data: { workouts, exercises }, state: { recordsUi: ui || { q: '', muscle: '' } }, nav() {}, rerender() {}, backTo: f => f };
  const root = mkNode('div'); root.classList.owner = root;
  page.render(ctx, root);
  return root;
}
const nameOf = r => all(r, 'gv-recrow-name')[0].textContent;

/* ---------- 1. the newest beaten record, and only it ---------- */
{
  const root = render(HIST, EXS);
  const marked = all(root, 'gv-rec-new');
  assert.strictEqual(marked.length, 1, 'exactly one row is marked new');
  assert.strictEqual(nameOf(marked[0]), 'Bench', 'the most recently beaten best (65 kg on 2026-03-01), not Plank\'s newer-or-equal baseline');
  assert.ok(String(marked[0].className).split(/\s+/).includes('gv-recrow'), 'it is the record row itself');
  const prev = all(marked[0], 'gv-rec-prev');
  assert.strictEqual(prev.length, 1);
  assert.strictEqual(prev[0].tag, 's', 'what it beat is a struck-through <s>');
  assert.strictEqual(prev[0].textContent, '60 kg');
  assert.strictEqual(all(marked[0], 'gv-rec-delta')[0].textContent, '+5 kg');
  /* the figure on the row is the record itself */
  assert.strictEqual(all(marked[0], 'gv-recrow-margin')[0].textContent, '65 kg');
  assert.strictEqual(all(root, 'gv-rec-prev').length, 1, 'and no other row carries one');
  /* The "Latest" badge is CSS content, and this row's aria-label REPLACES its
     text for assistive tech - so the words have to be in the label itself. */
  assert.strictEqual(marked[0].attrs['aria-label'], 'Open Bench, latest record', 'the badge is said in the row\'s aria-label');
  const others = all(root, 'gv-recrow').filter(r => r !== marked[0]);
  assert.ok(others.length >= 2, 'fixture: other rows exist');
  for (const r of others) assert.strictEqual(r.attrs['aria-label'], `Open ${nameOf(r)}`, 'only the newest record says "latest record"');
}

/* ---------- 2. a rep record reads in its own unit ---------- */
{
  const root = render([HIST[0], HIST[1]], EXS);
  const m = all(root, 'gv-rec-new')[0];
  assert.strictEqual(nameOf(m), 'Push-ups');
  assert.strictEqual(all(m, 'gv-rec-prev')[0].textContent, '12');
  assert.strictEqual(all(m, 'gv-rec-delta')[0].textContent, '+2 reps');
}

/* ---------- 3. nothing beaten -> nothing new (a baseline is not a record) ---------- */
{
  assert.strictEqual(all(render([HIST[0]], EXS), 'gv-rec-new').length, 0);
  assert.strictEqual(all(render([HIST[0]], EXS), 'gv-recrow').length, 2, 'the rows themselves still render');
}

/* ---------- 4. a filtered-out newest record is not drawn, and nothing else is promoted ---------- */
{
  const root = render(HIST, EXS, { q: 'push', muscle: '' });
  assert.strictEqual(all(root, 'gv-recrow').length, 1);
  assert.strictEqual(all(root, 'gv-rec-new').length, 0, 'Push-ups is a record too, but not THE newest - it must not inherit the mark');
}

/* ---------- 5. the circuit-clock gate carries through ---------- */
{
  const hist = [
    w('2026-01-01', [row('Push-ups', { reps: '10', seconds: '30' })]),
    w('2026-04-01', [row('Push-ups', { reps: '10', seconds: '45' })]),
  ];
  assert.strictEqual(all(render(hist, [ex('Push-ups', 'reps', [])]), 'gv-rec-new').length, 0,
    'a rep exercise\'s circuit clock is not a hold, so it is not a new record');
}

console.log('records page new OK (newest beaten record marked with what it beat; baselines, filtered rows and circuit clocks are not)');
