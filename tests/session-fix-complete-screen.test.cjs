'use strict';
/* THE COMPLETION SCREEN HAD NO WAY OUT, AND LIED ABOUT HOW LONG IT TOOK
   (0.11.2 journey audit, findings #4 and #7).

   #4 — renderComplete rendered no top bar and no X. If every set was
   skipped, "Finish & save" hit page-log's own zero-rows guard and merely
   noticed, leaving the user stuck under a heading that still said "Session
   done" with no way off the screen except that one dead button.

   #7 — the tile floored elapsed minutes at 0 (`Math.max(0, ...)`) while
   page-log.finishSession's own duration_min floors at 1 — so a session
   under a minute showed "0 min" on the screen it was reading and then saved
   a note that said 1.

   Both are driven directly through renderComplete(ctx, root, draft, sess),
   which needs no flow/position machinery — only draft.entries, draft.startedAt
   and sess's tallies. */
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

/* page-log.js is stubbed out entirely for this file: renderComplete's own
   button must decide whether to CALL finishSession at all, and that
   decision is exactly what's under test — a real finishSession would try to
   write a vault file. */
const finishCalls = [];
const pageLogStub = {
  buildRows: () => [],
  finishSession: (ctx, draft) => { finishCalls.push(draft); },
};

const origLoad = Module._load;
Module._load = (req, ...rest) => {
  if (req === 'obsidian') return stub;
  if (req === './motion-source') return motionStub;
  if (req === './page-log') return pageLogStub;
  return origLoad(req, ...rest);
};

/* A minimal but REAL tree — children actually collected, classes actually
   tracked and toggled, click handlers actually stored — so the assertions
   below are about what render put on screen, not about a no-op stand-in. */
const mkNode = (tag) => {
  const handlers = {};
  const node = {
    tagName: tag, nodeType: 1, className: '', children: [],
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add(...c) { node.className = (node.className + ' ' + c.join(' ')).trim(); },
      remove(...c) { for (const x of c) node.className = node.className.split(' ').filter(v => v !== x).join(' '); },
      toggle() {}, contains: c => node.className.split(' ').includes(c),
    },
    attrs: {},
    setAttribute(k, v) { node.attrs[k] = v; },
    addEventListener(type, fn) { (handlers[type] = handlers[type] || []).push(fn); },
    click() { for (const fn of (handlers.click || [])) fn(); },
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

const { renderComplete } = require(path.join(SRC, 'page-session'));
Module._load = origLoad;

/* ---------- helpers to read the tree renderComplete actually built ------- */
function collectByClass(node, cls, out = []) {
  if (!node || !node.children) return out;
  for (const kid of node.children) {
    if (kid && typeof kid.className === 'string' && kid.className.split(' ').includes(cls)) out.push(kid);
    collectByClass(kid, cls, out);
  }
  return out;
}
function textOf(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.text;
  return (node.children || []).map(textOf).join('');
}
function findButtons(node, out = []) {
  if (!node) return out;
  if (node.tagName === 'button') out.push(node);
  for (const kid of node.children || []) findButtons(kid, out);
  return out;
}

const newCtx = () => ({
  view: null, settings: {}, data: { goals: [] }, state: {}, app: {},
  nav: () => {},
});
const newSess = () => ({ records: [], goalCount: 0, muted: true, completionCelebrated: false, confettiStop: null });

/* ---------- 1. zero saveable rows: Discard, not a dead Finish & save ----- */
{
  finishCalls.length = 0;
  const ctx = newCtx();
  const draft = { startedAt: Date.now() - 5000, entries: [{ sets: [{ done: false, touched: false, reps: '' }] }] };
  const root = mkNode('div');
  renderComplete(ctx, root, draft, newSess());

  const buttons = findButtons(root);
  const labels = buttons.map(textOf);
  assert.ok(!labels.includes('Finish & save'),
    'with nothing saveable, "Finish & save" is a dead button — it must not be offered');
  assert.ok(labels.includes('Discard'), 'and Discard must be offered in its place');

  const discardBtn = buttons.find(b => textOf(b) === 'Discard');
  discardBtn.click();
  assert.strictEqual(finishCalls.length, 0, 'Discard must never call finishSession');
  assert.strictEqual(ctx.state.logDraft, null, 'Discard must actually clear the draft');
}

/* ---------- 2. a real exit: an X exists even when there IS work to save -- */
{
  const ctx = newCtx();
  const draft = { startedAt: Date.now() - 5000, entries: [{ sets: [{ done: true, touched: true, reps: '10' }] }] };
  const root = mkNode('div');
  renderComplete(ctx, root, draft, newSess());

  const buttons = findButtons(root);
  const labels = buttons.map(textOf);
  assert.ok(labels.includes('Finish & save'), 'with real work done, the primary action must still be Finish & save');

  const exitBtn = buttons.find(b => b.attrs['aria-label'] === 'End session');
  assert.ok(exitBtn, 'the completion screen must offer a real exit (the same End session control every other phase has) — ' +
    'it used to render no top bar and no X at all');
}

/* ---------- 3. the primary button DOES call finishSession when there is
   something to save ---------- */
{
  finishCalls.length = 0;
  const ctx = newCtx();
  const draft = { startedAt: Date.now() - 5000, entries: [{ sets: [{ done: true, touched: true, reps: '10' }] }] };
  const root = mkNode('div');
  renderComplete(ctx, root, draft, newSess());
  const finishBtn = findButtons(root).find(b => textOf(b) === 'Finish & save');
  finishBtn.click();
  assert.strictEqual(finishCalls.length, 1, 'Finish & save must still bank the session when there is something to bank');
}

/* ---------- 4. #7: the elapsed tile floors at 1, same as the note it saves */
{
  const ctx = newCtx();
  /* Under a minute — the exact case that used to read "0 min". */
  const draft = { startedAt: Date.now() - 2000, entries: [] };
  const root = mkNode('div');
  renderComplete(ctx, root, draft, newSess());
  const tileBig = collectByClass(root, 'gv-tile-big').map(textOf);
  assert.ok(tileBig.includes('1 min'),
    'a session under a minute must show 1 min on screen, matching page-log.finishSession\'s own Math.max(1, ...) — ' +
    'the screen and the note it is about to save must not disagree on how long it took');
  assert.ok(!tileBig.includes('0 min'), 'and must never show 0 min — page-log never saves duration_min: 0');
}

console.log('completion screen OK (Discard replaces a dead Finish & save, a real exit exists, and the elapsed tile agrees with the saved note)');
