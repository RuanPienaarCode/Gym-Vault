'use strict';
/* L4-12: the counter-settings and explainer sheets had no Escape-to-close and
   did not hand focus back to the control that opened them, so a keyboard user
   was dropped at the top of the page. Escape now closes either sheet (and does
   not reach the tap zone underneath), and focus returns to the opener - unless
   the control just used already moved focus somewhere else (Type focuses the
   count), which must not be stolen back. */
const assert = require('node:assert');
const T = require('./f3-stub');

/* The shared stub has no remove/focus/contains; add them the way a browser does. */
const baseCreate = global.document.createElement;
const baseNS = global.document.createElementNS;
const decorate = n => {
  n.remove = () => { if (n.parent) { n.parent.children = n.parent.children.filter(c => c !== n); n.parent = null; } };
  n.focus = () => { global.document.activeElement = n; };
  n.contains = o => { for (let x = o; x; x = x.parent) if (x === n) return true; return false; };
  Object.defineProperty(n, 'isConnected', { get: () => { let x = n; while (x.parent) x = x.parent; return x === global.document.body; } });
  return n;
};
global.document.createElement = tag => decorate(baseCreate(tag));
global.document.createElementNS = (ns, tag) => decorate(baseNS(ns, tag));
global.document.body = T.mkNode('body');
decorate(global.document.body);
global.document.activeElement = global.document.body;

const { openCounterSettings, counterSettingsButton } = require('../src/counter-settings');
const { openExplainer, helpButton } = require('../src/explainer');

const fire = (node, ev, e) => (node.listeners[ev] || []).forEach(fn => fn(e));
const mkHost = () => { const h = decorate(T.mkNode('div')); global.document.body.append(h); return h; };
const keyEv = key => { const e = { key, stopped: false, prevented: false, stopPropagation() { e.stopped = true; }, preventDefault() { e.prevented = true; } }; return e; };

const failures = [];
const test = (name, fn) => { try { fn(); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };

for (const [label, cls, mount] of [
  ['counter settings', 'gv-cs', (h, opener) => openCounterSettings(h, [{ label: 'x', node: decorate(T.mkNode('button')) }], { opener })],
  ['explainer', 'gv-xp', (h, opener) => openExplainer(h, { opener })],
]) {
  test(`L4-12 ${label}: Escape closes the sheet and does not reach the tap zone`, () => {
    const h = mkHost();
    mount(h);
    const sheet = h.querySelector('.' + cls);
    assert.ok(sheet, 'mounted');
    const other = keyEv('a'); fire(sheet, 'keydown', other);
    assert.ok(h.querySelector('.' + cls), 'a non-Escape key leaves it open');
    const esc = keyEv('Escape'); fire(sheet, 'keydown', esc);
    assert.ok(h.querySelector('.' + cls) === null, 'Escape must close the sheet');
    assert.ok(esc.stopped, 'Escape must still not propagate to the zone underneath');
  });
  test(`L4-12 ${label}: focus returns to the opener on close`, () => {
    const h = mkHost();
    const opener = decorate(T.mkNode('button')); h.append(opener);
    global.document.activeElement = global.document.body;
    const dismiss = mount(h, opener);
    assert.ok(global.document.activeElement !== opener, 'focus moved into the sheet while open');
    dismiss();
    assert.ok(global.document.activeElement === opener, 'focus must go back to the control that opened the sheet');
  });
  test(`L4-12 ${label}: control: focus the user moved elsewhere is not stolen`, () => {
    const h = mkHost();
    const opener = decorate(T.mkNode('button')); h.append(opener);
    const field = decorate(T.mkNode('input')); h.append(field);
    const dismiss = mount(h, opener);
    field.focus();
    dismiss();
    assert.ok(global.document.activeElement === field, 'closing must not pull focus off a field the user is in');
  });
}
test('L4-12 the buttons pass themselves as the opener', () => {
  for (const [btn, host] of [
    (() => { const h = mkHost(); return [counterSettingsButton(() => h, () => [{ label: 'x', node: decorate(T.mkNode('button')) }]), h]; })(),
    (() => { const h = mkHost(); return [helpButton(() => h), h]; })(),
  ]) {
    h_open(btn, host);
  }
  function h_open(btn, host) {
    host.append(btn); /* the real button sits in the page */
    global.document.activeElement = global.document.body;
    fire(btn, 'click', {});
    const sheet = host.children.find(c => /(^|\s)gv-(cs|xp)(\s|$)/.test(c.className));
    assert.ok(sheet, 'opened');
    fire(sheet, 'keydown', keyEv('Escape'));
    assert.ok(global.document.activeElement === btn, 'Escape from the sheet lands back on the gear / ? that opened it');
  }
});
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('w3 sheet keyboard OK');
