'use strict';
/* THE PERSONAL-BEST MOMENT ON THE COMPLETION SCREEN (Apex skin).

   Rendered through the real renderComplete. What must hold:

     - exactly one .gv-pb-moment per entry in sess.records - the records
       applyCompletion already detected. The moment builds no detection of its
       own, so it can only ever celebrate what the existing rules counted;
     - the figures are the record's own (prev, val), the chips are
       progress.pbDelta's (+2 reps, +16.7%), the unit follows the kind;
     - a first-ever best (no old value) omits the struck-through old figure,
       the arrow and BOTH chips - it never prints a 0;
     - the existing record rows and the "N records broken" line are untouched. */
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
};
const motionStub = { motionAvailable: () => false, startMotionCounter: async () => () => {} };
const pageLogStub = { buildRows: () => [], finishSession: () => {}, keepDraft: () => {} };
const origLoad = Module._load;
Module._load = (req, ...rest) => {
  if (req === 'obsidian') return stub;
  if (req === './motion-source') return motionStub;
  if (req === './page-log') return pageLogStub;
  return origLoad(req, ...rest);
};

const mkNode = tag => {
  const node = {
    tagName: tag, nodeType: 1, className: '', children: [], attrs: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add(...c) { node.className = (node.className + ' ' + c.join(' ')).trim(); },
      remove() {}, toggle() {}, contains: c => node.className.split(' ').includes(c),
    },
    setAttribute(k, v) { node.attrs[k] = v; },
    addEventListener() {}, click() {},
    append(...kids) { node.children.push(...kids.flat().filter(Boolean)); },
    querySelector: () => null, insertBefore() {}, remove() {}, removeChild() {},
  };
  return node;
};
global.document = {
  createElement: mkNode, createTextNode: t => ({ nodeType: 3, text: String(t) }),
  addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
};
global.window = global.window || { setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout };

const { renderComplete, applyCompletion } = require(path.join(SRC, 'page-session'));
Module._load = origLoad;

const textOf = n => (!n ? '' : n.nodeType === 3 ? n.text : (n.children || []).map(textOf).join(''));
const all = (n, cls, out = []) => {
  for (const k of n.children || []) {
    if (k && typeof k.className === 'string' && k.className.split(' ').includes(cls)) out.push(k);
    all(k, cls, out);
  }
  return out;
};
const one = (n, cls) => { const h = all(n, cls); assert.ok(h.length <= 1, `one .${cls}, got ${h.length}`); return h[0] || null; };

const ctx = { view: null, settings: {}, data: { goals: [] }, state: {}, app: {}, nav() {} };
const draft = { startedAt: Date.now() - 600000, entries: [{ sets: [{ done: true, touched: true, reps: '14' }] }] };
const sessWith = records => ({ records, goalCount: 0, muted: true, completionCelebrated: true, confettiStop: null });
const renderWith = records => { const root = mkNode('div'); renderComplete(ctx, root, draft, sessWith(records)); return root; };

/* ---------- 1. the reported shape: Dips 12 -> 14 reps ---------- */
{
  const root = renderWith([{ key: 'Dips/reps', exercise: 'Dips', kind: 'reps', val: '14', prev: 12 }]);
  const m = one(root, 'gv-pb-moment');
  assert.ok(m, 'a record produces a .gv-pb-moment');
  assert.strictEqual(textOf(one(m, 'gv-pb-moment-kicker')), 'Personal best');
  assert.strictEqual(textOf(one(m, 'gv-pb-moment-name')), 'Dips');
  const old = one(m, 'gv-pb-old');
  assert.strictEqual(old.tagName, 's', 'the old figure is a struck-through <s>');
  assert.strictEqual(textOf(old), '12');
  assert.ok(one(m, 'gv-pb-arrow'), 'with an arrow between');
  assert.strictEqual(textOf(one(m, 'gv-pb-new')), '14');
  assert.strictEqual(textOf(one(m, 'gv-pb-unit')), 'reps');
  assert.deepStrictEqual(all(m, 'gv-pb-delta').map(textOf), ['+2 reps', '+16.7%']);
}

/* ---------- 2. units and chips follow the kind ---------- */
{
  const w = one(renderWith([{ key: 'k', exercise: 'Bench', kind: 'weight', val: '82.5', prev: 80 }]), 'gv-pb-moment');
  assert.strictEqual(textOf(one(w, 'gv-pb-unit')), 'kg');
  assert.deepStrictEqual(all(w, 'gv-pb-delta').map(textOf), ['+2.5 kg', '+3.1%']);
  const s = one(renderWith([{ key: 'k', exercise: 'Plank', kind: 'seconds', val: '50', prev: 40 }]), 'gv-pb-moment');
  assert.strictEqual(textOf(one(s, 'gv-pb-unit')), 's');
  assert.strictEqual(textOf(one(s, 'gv-pb-new')), '50');
  assert.deepStrictEqual(all(s, 'gv-pb-delta').map(textOf), ['+10s', '+25%']);
}

/* ---------- 3. first-ever best: no old value, no arrow, no chips, no 0 ---------- */
{
  const m = one(renderWith([{ key: 'k', exercise: 'Dips', kind: 'reps', val: '14', prev: null }]), 'gv-pb-moment');
  assert.ok(m);
  assert.strictEqual(one(m, 'gv-pb-old'), null, 'no struck-through old value');
  assert.strictEqual(one(m, 'gv-pb-arrow'), null, 'and no arrow to nothing');
  assert.strictEqual(all(m, 'gv-pb-delta').length, 0, 'and neither chip');
  assert.strictEqual(textOf(one(m, 'gv-pb-new')), '14');
  assert.ok(!/\b0\b/.test(textOf(m)), `no 0 anywhere: ${textOf(m)}`);
}

/* ---------- 4. one per record; none without records ---------- */
{
  const root = renderWith([
    { key: 'a', exercise: 'Dips', kind: 'reps', val: '14', prev: 12 },
    { key: 'b', exercise: 'Plank', kind: 'seconds', val: '50', prev: 40 },
  ]);
  assert.strictEqual(all(root, 'gv-pb-moment').length, 2, 'one moment per record');
  assert.ok(textOf(root).indexOf('2 records broken') !== -1, 'the existing tally is untouched');
  assert.strictEqual(all(root, 'gv-recrow').length, 2, 'and so are the existing record rows');
  assert.strictEqual(all(renderWith([]), 'gv-pb-moment').length, 0, 'no records, no moment');
}

/* ---------- 5. the moment can only show what applyCompletion detected ---------- */
{
  const workoutsAtStart = [{ fm: { date: '2026-01-01' }, rows: [{ exercise: 'Dips', reps: '12' }] }];
  const mk = reps => {
    const sess = { workoutsAtStart, records: [], goalCount: 0, muted: true, metGoals: new Set() };
    const set = { reps: '', weight_kg: '', seconds: '', done: false, touched: false };
    applyCompletion({ view: null, settings: {}, data: { goals: [] } }, { entries: [] }, sess, set,
      { exercise: 'Dips', duration: false, weighted: false, distance: false }, { reps }, { observed: ['reps'] });
    return sess;
  };
  const beaten = mk('14');
  const root = mkNode('div'); renderComplete(ctx, root, draft, beaten);
  const m = one(root, 'gv-pb-moment');
  assert.ok(m, 'a real detected record is celebrated');
  assert.strictEqual(textOf(one(m, 'gv-pb-old')), '12', 'with the best it actually beat');
  assert.strictEqual(textOf(one(m, 'gv-pb-new')), '14');

  const tie = mk('12');
  const root2 = mkNode('div'); renderComplete(ctx, root2, draft, tie);
  assert.strictEqual(all(root2, 'gv-pb-moment').length, 0, 'a tie is not a record, so it is not a moment');
}

console.log('session pb moment OK (one per detected record, real figures, first-ever best prints no old value)');
