'use strict';
/* W4-1 (usability fix wave 2, 20 Oct 2026): THE PLAN PICKER LOOKS LIKE THE APP.

   PlanPickerModal marked its modalEl `.gv-modal` only. Every --gv-* token lives on `.gv-app`, and
   Obsidian appends a modal to <body>, outside the view, so inside the picker every token was
   undefined: `.gv-card` painted no surface, no border, no skin slab, and the rows rendered as bare
   text (audit 20 Oct 2026, Medium). The rep counter, media viewer and photo capture solve the same
   thing by wearing `.gv-app` + the skin + the accent on the modalEl; the picker now does too, with
   the classes copied from the live view root (one source: the picker is only ever opened from it),
   and the app root's flex column is switched off for it (`.gv-app.gv-modal`).

   The tokens for the OTHER dialogs (form / confirm / end-session, which stay plain Obsidian
   dialogs) come from the one shared token block, not from a copy on the error line.

   Drives the real modals.js over a fake DOM, then reads the cascade for the classes it actually
   put on the modalEl. */
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { mkNode, stub } = require('./f3-stub.js');
const cx = require('./css-cascade.js');
const { skinClasses, SKINS } = require('../src/constants');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};

/* A Modal with the parts modals.js touches. */
stub.Modal = class {
  constructor(app) {
    this.app = app;
    const n = tag => { const x = mkNode(tag); x.addClass = c => x.classList.add(c); return x; };
    this.modalEl = n('div'); this.contentEl = n('div'); this.titleEl = n('div'); this.titleEl.setText = t => { this.titleEl._text = t; };
    this.modalEl.className = 'modal';
  }
  open() { this.onOpen(); }
  close() {}
};
const { PlanPickerModal } = require('../src/modals');

/* The live view root the picker is opened from. */
const withRoot = (classes, fn) => {
  const root = mkNode('div'); root.className = 'view-content gv-app ' + classes.join(' ');
  const prev = global.document.querySelector;
  global.document.querySelector = sel => (/gv-app/.test(sel) ? root : null);
  try { return fn(); } finally { global.document.querySelector = prev; }
};
const plan = { name: 'Plan A', fm: {}, model: { days: [{ weekday: 'mon', items: [1] }, { weekday: 'wed', items: [1] }] } };
const openPicker = classes => withRoot(classes, () => {
  const m = new PlanPickerModal({}, { plans: [plan], extras: [], currentName: 'Plan A', onPick() {} });
  m.open();
  return m;
});

const rules = cx.load();
for (const skin of SKINS.map(s => s[0])) {
  for (const theme of ['light', 'dark']) {
    check(`${skin}/${theme}: the picker's rows resolve the app's tokens, surface and ink`, () => {
      const rootClasses = skinClasses(skin).concat(['gv-accent-lime']);
      const m = openPicker(rootClasses);
      const modalSpec = 'div.' + String(m.modalEl.className).split(/\s+/).filter(Boolean).join('.');
      const chain = cx.chainOf(['body.theme-' + theme, modalSpec, 'div.modal-content', 'div.gv-card.gv-optrow', 'div.gv-optrow-desc']);
      assert.ok(cx.computed(chain.slice(0, 2), '--gv-surface', rules),
        `--gv-surface is undefined on ${modalSpec}: the picker's .gv-card rows have no surface (bare text)`);
      assert.ok(cx.computed(chain.slice(0, 2), '--gv-ink', rules), `--gv-ink undefined on ${modalSpec}`);
      const t = cx.textColor(chain, rules);
      assert.ok(cx.ratio(t.fg, t.bg) >= 4.5, `row description ${cx.hex(t.fg)} on ${cx.hex(t.bg)} = ${cx.ratio(t.fg, t.bg).toFixed(2)}:1`);
      const card = cx.chainOf(chain.slice(0, 4));
      assert.ok(cx.declarationsFor(card, ['border', 'border-color', '--gv-slab'], rules).length,
        `${modalSpec} .gv-card has no border/slab rule reaching it: the row has no edge`);
    });
  }
}

check('the picker wears the live root\'s skin and accent (one source), not a hard-coded one', () => {
  const m = openPicker(['gv-skin-floor', 'gv-accent-punch']);
  const cls = String(m.modalEl.className).split(/\s+/);
  for (const c of ['gv-app', 'gv-modal', 'gv-skin-floor', 'gv-accent-punch']) assert.ok(cls.includes(c), `modalEl lacks ${c}: ${m.modalEl.className}`);
  assert.ok(!cls.includes('gv-skin-apex'), 'a hard-coded skin leaked in');
});

check('the app root\'s flex column is not imposed on the stock dialog', () => {
  const m = openPicker(skinClasses('apex').concat(['gv-accent-lime']));
  const spec = 'div.' + String(m.modalEl.className).split(/\s+/).filter(Boolean).join('.');
  const chain = cx.chainOf(['body.theme-light', spec]);
  for (const prop of ['display', 'height', 'overflow']) {
    const v = cx.computed(chain, prop, rules);
    assert.ok(!v || (prop === 'display' ? v.value === 'block' : prop === 'height' ? v.value === 'auto' : v.value === 'visible'),
      `${prop}: ${v && v.value} reaches the modal from ${v && v.rule.selector}`);
  }
});

check('the form modals\' error line takes its --gv-danger from the shared token block, not a copy', () => {
  const copies = rules.filter(r => /gv-modal-err/.test(r.selector) && r.decls.some(d => d.prop === '--gv-danger'));
  assert.deepStrictEqual(copies.map(r => r.selector), [], 'a second --gv-danger copy still sits on the error line');
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('w4-modal-picker OK');
