'use strict';
/* REMOVING AN EXERCISE MID-TIMED-SESSION MIS-ATTRIBUTES EVERY LATER INTERVAL
   (journey audit finding 3).

   THE BUG THIS REPRODUCES. A timed schedule's intervals hold a POSITIONAL
   `entryIndex` into draft.entries (see timed-plan.js), not a reference to
   the entry itself. removeBtn spliced draft.entries regardless, so
   removing entry 0 left an interval still named "Push-ups" writing its
   reps into whatever slid into that slot (Squats), while the interval that
   used to be last indexed past the end of the array and was silently
   dropped.

   THE FIX, from this side only (re-keying the schedule belongs to the lane
   that owns timed-plan.js): refuse the removal outright while
   `draft.timed` holds a live schedule, and disable the control so it reads
   as refused rather than broken. */
const assert = require('node:assert');
const Module = require('node:module');

const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
};
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));

/* A minimal DOM stub that actually tracks the attributes/listeners removeBtn
   sets, so the test can assert on them rather than just on whether the
   entries array changed. */
function mkNode() {
  const node = {
    nodeType: 1, className: '', style: {}, children: [], attrs: {}, disabled: false,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { node.attrs[k] = v; },
    addEventListener(type, fn) { (node._listeners = node._listeners || {})[type] = fn; },
    append(...kids) { node.children.push(...kids); },
    querySelector: () => null, querySelectorAll: () => [],
    click() { if (node._listeners && node._listeners.click) node._listeners.click(); },
  };
  return node;
}
global.document = { createElement: mkNode, createTextNode: t => ({ nodeType: 3, text: String(t) }) };
global.window = global.window || {};
const { startDraft } = require('../src/page-log');
Module._load = origLoad;

/* removeBtn is not exported (it is an internal DOM-builder), so the guard
   goes through the same public seam a real click does: build the draft,
   call the module's removeBtn via entryCard is not exported either — so we
   reconstruct the same decision entryCard's removeBtn makes, directly
   against the exported draft shape, which is the part of the contract this
   finding is actually about: draft.entries must not shrink while
   draft.timed is live. */
const notices = [];
const ctx = {
  data: { exercises: [] }, state: {},
  notice: msg => notices.push(msg),
  rerender: () => {},
};
startDraft(ctx, { name: 'Circuit' }, {
  name: 'Day', items: [
    { exercise: 'Push-ups', target: '10', sets: 3 },
    { exercise: 'Squats', target: '10', sets: 3 },
  ],
});
const draft = ctx.state.logDraft;

/* Simulate a live timed session the same way page-session.js sets one up:
   draft.timed holds the schedule. */
draft.timed = { intervals: [{ kind: 'work', exercise: 'Push-ups', entryIndex: 0, setIndex: 0 }] };

/* Re-require the module fresh isn't necessary — page-log doesn't export
   removeBtn, so this guard exercises the module's OWN entryCard path via
   its side effects: build a card for entry 0 and click its remove button. */
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));
const pageLog = require('../src/page-log');
Module._load = origLoad;

/* entryCard is internal too. The public surface this finding actually
   promises is behavioural: draft.entries must be untouched by a remove
   click while draft.timed is set. render() builds every entryCard as a
   side effect of rendering the page, so drive it through render() and pull
   the remove button back out via the mock DOM tree it appended. */
const root = mkNode();
ctx.setPageInterval = () => {};
ctx.enterGuided = () => {};
pageLog.render(ctx, root);

/* Walk the fake tree for every node carrying an aria-label of "Remove
   exercise…" and click it — mkNode is a flat stub with no real tree
   traversal, so collect recursively through attrs. */
function findRemoveButtons(node, out) {
  if (!node || typeof node !== 'object') return out;
  if (node.attrs && typeof node.attrs['aria-label'] === 'string' && node.attrs['aria-label'].startsWith('Remove exercise')) out.push(node);
  for (const c of node.children || []) findRemoveButtons(c, out);
  return out;
}
const removeButtons = findRemoveButtons(root, []);
assert.strictEqual(removeButtons.length, 2, 'one remove button per logged entry');

const before = draft.entries.length;
removeButtons[0].click();
assert.strictEqual(draft.entries.length, before,
  'removing an exercise mid-timed-session must be refused — entries must not shrink');
assert.strictEqual(draft.entries[0].exercise, 'Push-ups', 'the entry must stay exactly where the schedule expects it');
assert.ok(removeButtons[0].disabled, 'the control itself must read as disabled, not merely a silent no-op');
assert.match(removeButtons[0].attrs['aria-label'], /finish or discard the timed session first/i,
  'the reason must be explained, in the house voice, not just refused silently');
assert.ok(notices.length >= 1, 'clicking the disabled control must still explain itself via ctx.notice');

/* Once the timed session ends, removal must work again. */
draft.timed = null;
const root2 = mkNode();
pageLog.render(ctx, root2);
const removeButtons2 = findRemoveButtons(root2, []);
const beforeCount = draft.entries.length;
removeButtons2[0].click();
assert.strictEqual(draft.entries.length, beforeCount - 1, 'once the timed session ends, removal must work as before');

console.log('log remove-timed-lock OK (removing an exercise mid-clock is refused, not silently mis-attributed)');
