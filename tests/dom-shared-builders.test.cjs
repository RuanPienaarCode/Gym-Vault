'use strict';
/* SHARED MARKUP BUILDERS (src/dom.js statTile, emptyLine).

   Six pages each wrote the same stat-tile function and sixteen call sites wrote
   the same one-line empty state inline. They now share one builder each. That is
   only a refactor if the DOM is BYTE-IDENTICAL, so this builds each tile and
   empty line twice - once the way every page used to write it (the literal
   markup, below) and once through the helper - and compares the serialised trees:
   tag, class, attributes, text, order.

   It also pins that no page defines its own `tile` again and no page writes the
   empty-line markup inline, so the duplication cannot quietly grow back. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const stub = require('./plans-dom-stub.js');

global.document = stub.makeDocument();
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'obsidian' ? stub.obsidianStub : origLoad.call(this, request, ...rest); };
const { el, statTile, emptyLine } = require('../src/dom');

const ser = n => (n.nodeType === 3 ? JSON.stringify(n.text)
  : `<${n.tag} class=${JSON.stringify(n.className)} attrs=${JSON.stringify(n.attrs)}>${n.children.map(ser).join('')}</${n.tag}>`);
let n = 0;
const same = (a, b, msg) => { assert.strictEqual(ser(a), ser(b), msg); n++; };

/* the markup each page used to write inline, verbatim */
const oldTile = (icon, big, label) => el('div', { class: 'gv-tile' },
  el('div', { class: 'gv-tile-ico' }, icon),
  el('div', { class: 'gv-tile-big' }, big),
  el('div', { class: 'gv-tile-label' }, label));
const oldTileExtra = (icon, big, label, extraClass) => el('div', { class: `gv-tile${extraClass ? ` ${extraClass}` : ''}` },
  el('div', { class: 'gv-tile-ico' }, icon),
  el('div', { class: 'gv-tile-big' }, big),
  el('div', { class: 'gv-tile-label' }, label));
const oldEmpty = (...kids) => el('div', { class: 'gv-empty-line' }, ...kids);

for (const [big, label] of [['12', 'sessions'], ['—', 'last run'], ['3.5 km', 'this week'], ['', '']]) {
  const icon = el('span', { class: 'gv-ico' });
  same(statTile(icon, big, label), oldTile(icon, big, label), `statTile(${big}, ${label}) matches the inline tile`);
  same(statTile(icon, big, label, 'gv-tile-x'), oldTileExtra(icon, big, label, 'gv-tile-x'), 'extra class variant matches');
  same(statTile(icon, big, label, undefined), oldTileExtra(icon, big, label), 'no extra class matches');
}
same(emptyLine('No matches.'), oldEmpty('No matches.'), 'one text child');
same(emptyLine('a', el('b', {}, 'b')), oldEmpty('a', el('b', {}, 'b')), 'mixed children keep their order');
same(emptyLine(), oldEmpty(), 'no children');

/* the duplicates stay gone */
const src = path.join(__dirname, '..', 'src');
for (const f of fs.readdirSync(src).filter(f => f.endsWith('.js') && f !== 'dom.js')) {
  const code = fs.readFileSync(path.join(src, f), 'utf8');
  assert.ok(!/^function tile\(/m.test(code), `src/${f} defines its own tile(); use dom.statTile`); n++;
  assert.ok(!/class: 'gv-empty-line'/.test(code), `src/${f} writes the empty-line markup inline; use dom.emptyLine`); n++;
}
console.log(`dom shared builders OK (${n} checks: statTile and emptyLine produce byte-identical DOM to the inline markup they replaced; no page defines its own again)`);
