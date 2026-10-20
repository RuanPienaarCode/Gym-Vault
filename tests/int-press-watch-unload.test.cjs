'use strict';
/* The plan editor's press watcher (the swallowed-Done fix) listens on the whole
   DOCUMENT for pointerdown/up/cancel. Added with a bare addEventListener they
   outlive the plugin: disabling Gym Vault left three capture listeners on the
   document holding the old module's closures. They go through the plugin's
   registerDomEvent, which Obsidian removes on unload; the bare form is only the
   fallback when no plugin is reachable (the headless tests). */
const assert = require('node:assert');
const { makeDocument, fire, byTag, hasClass } = require('./plans-dom-stub');
const { loadSrc, makeVault, makePlugin, makeRunner, notices } = require('./gym-fake-vault');

const doc = makeDocument();
const raw = [];
doc.addEventListener = ev => { raw.push(ev); };
global.document = doc;
const { makeIo } = loadSrc('data.js');
const pagePlans = loadSrc('page-plans.js');

const PLAN = 'Gym/Plans/Test Plan.md';
const { check, run } = makeRunner();

check('the press watcher registers through the plugin, so unload removes it', async () => {
  const v = makeVault([
    ['Gym/Profile.md', '---\nname: T\n---\n'],
    ['Gym/Exercises/Push-ups.md', '---\nunit: reps\n---\n'],
    [PLAN, '---\nactive: true\n---\n## Push (mon)\n\n- Push-ups | 3 x 10\n'],
  ]);
  const io = makeIo(makePlugin(v));
  const registered = [];
  const ctx = {
    app: {}, io, data: await io.loadAll(),
    plugin: { registerDomEvent: (el, ev, fn, opts) => registered.push({ el, ev, opts }) },
    state: { params: { plan: 'Test Plan' }, plansUi: { plan: 'Test Plan', editing: true } },
    nav() {}, openFile() {}, startGuided() {}, backTo: f => f, back() {}, reload() {},
    notice: m => notices.push(m),
    mainPlans: () => ctx.data.plans,
  };
  const root = document.createElement('div');
  pagePlans.render(ctx, root);
  assert.ok(byTag(root, 'div').some(d => hasClass(d, 'gv-edititem')), 'fixture: the plan is in edit mode');
  const evs = registered.filter(r => r.el === doc).map(r => r.ev).sort();
  assert.deepStrictEqual(evs, ['pointercancel', 'pointerdown', 'pointerup'],
    `pointer listeners on the document must go through plugin.registerDomEvent; registered: ${JSON.stringify(evs)}, bare: ${JSON.stringify(raw)}`);
  assert.ok(registered.every(r => r.opts === true || (r.opts && r.opts.capture)), 'still capture-phase');
  assert.deepStrictEqual(raw.filter(e => /^pointer/.test(e)), [], 'and none were added with a bare addEventListener');
});

run('press watcher unload');
