'use strict';
/* C-11: Rewards.md lines the ledger could not read are said out loud.

   rewards-ledger.parseLedger keeps unreadable table rows out of the XP sum and lists them
   in `bad`, but nothing showed them - a hand-edit that broke a row quietly lowered the
   total. The Profile card now says "N lines in Rewards.md could not be read" beside the
   total, and only when N > 0. */
const assert = require('node:assert');
const { loadSrc, makeRunner } = require('./gym-fake-vault');

const mkNode = tag => {
  const n = {
    nodeType: 1, tag, className: '', children: [], attrs: {}, parent: null, _connected: true,
    classList: { add() {}, remove() {}, contains: () => false },
    style: {},
    setAttribute(k, v) { n.attrs[k] = String(v); if (k === 'class') n.className = String(v); },
    getAttribute: k => (k in n.attrs ? n.attrs[k] : null),
    addEventListener() {},
    append(...kids) { for (const k of kids.flat()) { if (k == null) continue; if (k.nodeType === 1) k.parent = n; n.children.push(k); } },
    appendChild(k) { n.append(k); return k; },
    get firstChild() { return n.children[0] || null; },
    removeChild(k) { const i = n.children.indexOf(k); if (i >= 0) n.children.splice(i, 1); return k; },
    get isConnected() { return n._connected; },
    get textContent() { return n.children.map(c => (c.nodeType === 3 ? c.text : c.textContent)).join(''); },
    set textContent(t) { n.children = [{ nodeType: 3, text: String(t), parent: n }]; },
    querySelector() { return null; },
  };
  return n;
};
global.document = { createElement: mkNode, createElementNS: mkNode, createTextNode: t => ({ nodeType: 3, text: String(t) }), addEventListener() {}, removeEventListener() {} };
global.window = global.window || { setTimeout, clearTimeout };

const ui = loadSrc('rewards-ui.js');
const L = require('../src/rewards-ledger');
const V = require('../src/rewards-view');
const R = require('../src/rewards');
const F = require('./rewards-fixtures');

const { check, run } = makeRunner();
const realErr = console.error; console.error = () => {};
const flush = () => new Promise(r => setImmediate(r));
const text = n => n.textContent;
const findText = (n, re, out = []) => { for (const c of n.children || []) { if (c.nodeType === 1) { if (re.test(text(c)) && !(c.children || []).some(k => k.nodeType === 1 && re.test(text(k)))) out.push(c); findText(c, re, out); } } return out; };

const HEAD = ['| Date | Kind | Key | XP | Note |', '| --- | --- | --- | --- | --- |'];
const GOOD = '| 2026-10-12 | session | session:a | 100 | ok |';
const mkCtx = lines => ({
  settings: { weekStart: 'mon' }, state: {}, daysOn: () => [],
  data: { workouts: [], exercises: F.EXERCISES },
  io: { readRewards: async () => Object.assign(L.parseLedger([...HEAD, ...lines].join('\n')), { exists: true, disabled: false, unreadable: false }) },
});
const profileText = async lines => {
  const root = mkNode('div');
  ui.mountProfile(mkCtx(lines), root);
  await flush();
  return text(root);
};

check('B1 the model words the count: singular, plural, and nothing at zero', () => {
  const m = n => V.profileModel({ summary: R.summarise(null, null, {}), medals: [], sessionCount: 0, badLines: n });
  assert.strictEqual(m(0).badText, '');
  assert.strictEqual(m(undefined).badText, '');
  assert.strictEqual(m(1).badText, '1 line in Rewards.md could not be read');
  assert.strictEqual(m(3).badText, '3 lines in Rewards.md could not be read');
});

check('B2 Profile shows the warning when Rewards.md has unreadable rows', async () => {
  const t = await profileText([GOOD, '| 2026-13-45 | session | session:b | 100 | broken date |', '| not | enough |']);
  assert.ok(/2 lines in Rewards\.md could not be read/.test(t), t);
});

check('B3 a clean ledger shows no warning', async () => {
  const t = await profileText([GOOD]);
  assert.ok(/100 XP in total/.test(t), t);
  assert.ok(!/could not be read/.test(t), t);
});

run('f1-ledger-bad-lines').then(() => { console.error = realErr; });
