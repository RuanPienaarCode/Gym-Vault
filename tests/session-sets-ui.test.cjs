'use strict';
/* Today's sets field, pinned AT THE CALL SITES (issue #6).

   tests/session-sets.test.cjs proves the helpers — setsPerEntryFor,
   uniformSets, levelSets, nextSetsValue. It never calls setsBlock and never
   fires a button, so the product failure this codebase actually names is
   unguarded: THE FIELD CLAIMING A NUMBER A MIXED PLAN DOES NOT HAVE, while
   the preview total underneath it disagrees.

   A draw() that showed the first exercise's count, or a previewText doing
   `count * mostCommon`, would ship a lying number on a mixed day and the
   helper suite would still be green. Same for the buttons: "floor at 1" and
   "one press moves all" are proven of levelSets(), not of a plus click.

   So this file fires the real controls (the 0.10.1 counter-settings.test.cjs
   pattern) and holds the one seam that cannot be fired from node — that
   previewText and beginSession quote the SAME array — in source.

   This must stay green through the gv-setsrow -> dial rewrite (#9). The
   dial is a new face on this exact contract, not a new contract. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

/* ---------- DOM stub (house pattern, see prose.test.cjs) ---------- */

const mkNode = tag => ({
  /* nodeType 1 is load-bearing: el() checks `kid.nodeType` to tell an
     element from a string, so a stub without it stringifies its children. */
  nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, parent: null,
  hidden: false, disabled: false,
  classList: {
    add(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.add(c); this.owner.className = [...s].join(' '); },
    remove(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.delete(c); this.owner.className = [...s].join(' '); },
    contains(c) { return String(this.owner.className).split(/\s+/).includes(c); },
    /* draw() drives BOTH of the field's faces through toggle — the `.word`
       class on the figure and `.changed` on the row — so a no-op toggle
       stub would hide exactly the bug this file exists for. */
    toggle(c, on) { const want = on === undefined ? !this.contains(c) : !!on; return want ? this.add(c) : this.remove(c); },
  },
  setAttribute(k, v) { this.attrs[k] = String(v); },
  getAttribute(k) { return this.attrs[k]; },
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
  append(...kids) { for (const k of kids) { if (k && k.nodeType === 1) k.parent = this; this.children.push(k); } },
  get textContent() {
    if (this._text !== undefined) return this._text;
    return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join('');
  },
  set textContent(v) { this._text = v; this.children = []; },
  querySelector(sel) {
    const want = sel.replace(/^\./, '');
    const walk = n => {
      for (const c of n.children) {
        if (c.nodeType !== 1) continue;
        if (String(c.className).split(/\s+/).includes(want)) return c;
        const hit = walk(c);
        if (hit) return hit;
      }
      return null;
    };
    return walk(this);
  },
});

global.document = {
  createElement(tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createTextNode(t) { return { nodeType: 3, tag: '#text', text: String(t) }; },
};
global.window = global.window || {};

const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
};
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));
const { setsBlock, setsPerEntryFor, SETS_MIN, SETS_MAX } = require('../src/page-session-setup');
Module._load = origLoad;

/* ---------- harness ---------- */

const day = (...counts) => ({ items: counts.map((n, i) => ({ exercise: `Move ${i + 1}`, sets: n, target: '10' })) });

const byAria = (root, label) => {
  const walk = n => {
    for (const c of n.children) {
      if (c.nodeType !== 1) continue;
      if (c.attrs['aria-label'] === label) return c;
      const hit = walk(c);
      if (hit) return hit;
    }
    return null;
  };
  return walk(root);
};
const click = node => (node.listeners.click || []).forEach(fn => fn());

/* Mount the real block and hand back the real controls, so every assertion
   below goes through the same nodes a thumb would. */
function mount(d) {
  const ui = { sets: {} };
  let previews = 0;
  const node = setsBlock({}, d, ui, () => { previews++; });
  return {
    ui,
    plus: byAria(node, 'One more set of every exercise'),
    minus: byAria(node, 'One fewer set of every exercise'),
    field: node.querySelector('gv-setsrow-n'),
    note: node.querySelector('gv-setsrow-target'),
    reset: node.querySelector('gv-setsall-reset'),
    row: node.querySelector('gv-setsrow'),
    perEntry: () => setsPerEntryFor(d, ui),
    previews: () => previews,
  };
}

/* THE assertion this whole file exists for: the face and the figures cannot
   disagree. A field reading "4" while the session builds [3,1,3] is the
   product failure; "Mixed" is the only honest face for a plan that varies. */
const agrees = (m, where) => {
  const per = m.perEntry();
  const uniform = per.every(v => v === per[0]);
  assert.strictEqual(
    m.field.textContent, uniform ? String(per[0]) : 'Mixed',
    `${where}: the field says "${m.field.textContent}" while the session would build [${per}]`,
  );
  assert.strictEqual(m.field.classList.contains('word'), !uniform,
    `${where}: the word face and the number face must follow the figures`);
};

/* ---------- 1. an untouched mixed plan reads Mixed, not the first count --- */
{
  const m = mount(day(3, 1, 3));
  assert.strictEqual(m.field.textContent, 'Mixed',
    'a mixed plan has no single number — showing the first item\'s 3 is the lie this pins');
  assert.ok(m.field.classList.contains('word'),
    '"Mixed" is a word, not a figure, and must not render in the display face');
  agrees(m, 'untouched mixed');
  assert.match(m.note.textContent, /levels all 3/, 'the note must say what stepping would do');
  assert.strictEqual(m.reset.hidden, true, 'nothing is overridden yet, so there is nothing to reset to');
  assert.strictEqual(m.minus.disabled, false, 'a mixed plan has no floor to be at — minus stays live');
}

/* ---------- 2. a uniform plan reads its number ---------- */
{
  const m = mount(day(3, 3, 3));
  assert.strictEqual(m.field.textContent, '3', 'a plan that agrees may show what it agrees on');
  assert.strictEqual(m.field.classList.contains('word'), false, 'a figure renders as a figure');
  agrees(m, 'untouched uniform');
  assert.match(m.note.textContent, /3 exercises, 3 each/);
}

/* ---------- 3. ONE PRESS MOVES ALL — through the button ---------- */
{
  const m = mount(day(3, 1, 3));
  click(m.plus);
  assert.deepStrictEqual(m.perEntry(), [4, 4, 4],
    'a plus click must write EVERY index — writing ui.sets[0] alone is the bug');
  agrees(m, 'after one plus on a mixed plan');
  assert.strictEqual(m.field.textContent, '4');
  assert.strictEqual(m.previews(), 1, 'the preview total must be told, or the line under the button contradicts it');
  assert.strictEqual(m.reset.hidden, false, 'once levelled there must be a way back to the plan');
  assert.ok(m.row.classList.contains('changed'), 'the row must show it is no longer the plan\'s own counts');
}

/* ---------- 4. the floor holds at the button, not just in levelSets ------- */
{
  const m = mount(day(1, 1));
  assert.strictEqual(m.field.textContent, '1');
  assert.strictEqual(m.minus.disabled, true, 'at the floor the control must be dead, not merely ineffective');
  assert.strictEqual(m.plus.disabled, false, 'the floor says nothing about the ceiling');
  click(m.minus);
  assert.deepStrictEqual(m.perEntry(), [SETS_MIN, SETS_MIN], 'stepping down at the floor changes nothing');
  agrees(m, 'at the floor');
}

/* ---------- 4b. AND THE CEILING (#7) — plus dies at SETS_MAX ------------- */

/* The clamp in nextSetsValue always held, so this was never a wrong number.
   It was a dead control that looked live: at 10 the plus still rendered
   enabled and a thumb kept pressing it. Both ends, or neither. */
{
  const m = mount(day(9, 9));
  assert.strictEqual(m.plus.disabled, false, 'below the ceiling plus must be live');
  click(m.plus);
  assert.strictEqual(m.field.textContent, String(SETS_MAX));
  assert.strictEqual(m.plus.disabled, true,
    'at the ceiling the control must be dead, not merely ineffective — minus disables at the floor, plus must match');
  click(m.plus);
  assert.deepStrictEqual(m.perEntry(), [SETS_MAX, SETS_MAX], 'stepping up at the ceiling changes nothing');
  agrees(m, 'at the ceiling');

  /* Coming back down re-arms it, or the field is stuck at 10 forever. */
  click(m.minus);
  assert.strictEqual(m.plus.disabled, false, 'stepping away from the ceiling must re-arm plus');
}

/* A mixed plan has neither bound yet — it has no single number to be at one
   — so neither control may be dead. */
{
  const m = mount(day(10, 1));
  assert.strictEqual(m.field.textContent, 'Mixed');
  assert.strictEqual(m.plus.disabled, false, 'a mixed plan is not at the ceiling, whatever its highest item says');
  assert.strictEqual(m.minus.disabled, false, 'nor at the floor, whatever its lowest says');
}

/* ---------- 5. reset returns the plan's own counts ---------- */
{
  const m = mount(day(3, 1, 3));
  click(m.plus);
  assert.deepStrictEqual(m.perEntry(), [4, 4, 4]);
  click(m.reset);
  assert.deepStrictEqual(m.perEntry(), [3, 1, 3],
    'reset must hand the plan back its own counts, not a levelled copy of them');
  agrees(m, 'after reset');
  assert.strictEqual(m.reset.hidden, true, 'nothing is overridden again');
  assert.strictEqual(m.previews(), 2, 'reset moves the total too');
}

/* ---------- 5b. UNDO IS NOT A FLAG (#8) — a no-op round trip clears it --- */

/* +1 then -1 lands back on the plan's own counts, so there is nothing left
   to undo. The reset used to ask whether anything had been WRITTEN to
   ui.sets, which stays true forever once you touch the control — the row
   kept its `.changed` mark and offered "Back to the plan" while already
   being the plan. Start built the right draft throughout; only the chrome
   lied. */
{
  const m = mount(day(3, 3, 3));
  assert.strictEqual(m.reset.hidden, true, 'untouched: nothing to undo');

  click(m.plus);
  assert.deepStrictEqual(m.perEntry(), [4, 4, 4]);
  assert.strictEqual(m.reset.hidden, false, 'now there is something to undo');
  assert.ok(m.row.classList.contains('changed'));

  click(m.minus);
  assert.deepStrictEqual(m.perEntry(), [3, 3, 3], 'back on the plan\'s own counts');
  assert.strictEqual(m.reset.hidden, true,
    'undo must only be offered when there is something to undo — a no-op round trip leaves nothing');
  assert.ok(!m.row.classList.contains('changed'),
    'the row must not stay marked as changed once it matches the plan again');
}

/* Levelling a MIXED plan to a value one of its items already had still
   differs from the plan — the others moved. The test is the whole array,
   never one index. */
{
  const m = mount(day(3, 1, 3));
  click(m.plus);           // -> 4,4,4
  click(m.minus);          // -> 3,3,3 : matches item 0 and 2, NOT item 1
  assert.deepStrictEqual(m.perEntry(), [3, 3, 3]);
  assert.strictEqual(m.reset.hidden, false,
    'the middle exercise moved from 1 to 3 — there is very much something to undo');
  click(m.reset);
  assert.deepStrictEqual(m.perEntry(), [3, 1, 3]);
  assert.strictEqual(m.reset.hidden, true);
}

/* ---------- 6. every step keeps the face and the figures together -------- */
{
  const m = mount(day(2, 5, 2));
  agrees(m, 'start');
  for (const n of [1, 2, 3, 4, 5, 6]) {
    click(n % 2 ? m.plus : m.minus);
    agrees(m, `after ${n} presses`);
  }
}

/* ---------- 7. THE SEAM: the preview and the session quote one array ----- */

/* previewText and beginSession are module-private, and beginSession cannot
   run in node (it unlocks audio and enters a route). The contract between
   them is still the one that decides whether the line under the button is
   true, so it is checked where it is written. */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-session-setup.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const body = name => {
    const i = src.indexOf(`function ${name}(`);
    assert.ok(i >= 0, `${name} has been renamed — this seam check must be renamed with it`);
    /* To the next top-level `function ` declaration, which is where every
       function in this file ends. */
    const j = src.indexOf('\nfunction ', i + 1);
    return src.slice(i, j === -1 ? src.length : j);
  };

  const preview = body('previewText');
  const begin = body('beginSession');

  assert.match(preview, /setsPerEntryFor\(/,
    'previewText must quote setsPerEntryFor — a total computed any other way can disagree with what Start builds');
  assert.match(begin, /setsPerEntryFor\(/,
    'beginSession must build from setsPerEntryFor — the preview promised that array');
  assert.ok(!/mostCommonSets\s*\(/.test(preview),
    'a preview total derived from the most common count is the lying number on a mixed day');
  assert.ok(!/uniformSets\s*\(/.test(preview),
    'uniformSets is the FIELD\'s question (one number or the word) — a total must not be derived from it');
}

console.log('session sets UI OK (the field never claims a number the session would not build; buttons fired, not simulated)');
