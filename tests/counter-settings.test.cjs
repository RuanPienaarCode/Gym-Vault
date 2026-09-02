'use strict';
/* The counter's settings sheet, and the focus-mode seam.

   WHAT THIS IS GUARDING. The counting screen carries two invariants that
   were written down in comments and proven by nothing:

   1. A PRESS INSIDE THE SHEET MUST NOT COUNT A REP. The sheet is an overlay
      sitting on top of the tap zone, and the tap zone counts anything that
      reaches it. counter-settings.js stops propagation for exactly that
      reason — lose that and every tap on a setting silently adds a rep to
      the user's set, which is both wrong and invisible until they look at
      the number.

   2. FOCUS MODE MUST NOT LEAK. `gv-focus` hides the head and the nav. The
      counting screens add it; ctx.rerender clears it. If the clear is ever
      moved, reordered after the page render, or dropped, the user lands on
      a page with no navigation and no way out of it — recoverable only by
      reopening the view.

   The sheet half is behavioural, against the same hand-built DOM stub
   prose.test.cjs uses. The focus-mode half is a STATIC seam check, in the
   spirit of module-exports.test.cjs: page-session.js cannot be required in
   node (it pulls half the plugin and the obsidian host with it), and
   focusMode is module-private, so the three halves of the contract are
   checked where they are written instead. Cheap, and total. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

/* ---------- DOM stub (house pattern, see prose.test.cjs) ---------- */

const mkNode = tag => ({
  /* nodeType 1 is load-bearing: el() checks `kid.nodeType` to tell an
     element from a string, so a stub without it stringifies its children. */
  nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, parent: null,
  classList: {
    add(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.add(c); this.owner.className = [...s].join(' '); },
    remove(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.delete(c); this.owner.className = [...s].join(' '); },
    contains(c) { return String(this.owner.className).split(/\s+/).includes(c); },
  },
  setAttribute(k, v) { this.attrs[k] = String(v); },
  getAttribute(k) { return this.attrs[k]; },
  addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
  append(...kids) { for (const k of kids) { if (k && k.nodeType === 1) k.parent = this; this.children.push(k); } },
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } },
  focus() { this.focused = true; },
  /* Only the '.class' form is needed — it is the only selector this module
     uses (the do-not-stack-sheets guard). */
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
  get textContent() {
    if (this._text !== undefined) return this._text;
    return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join('');
  },
  set textContent(v) { this._text = v; this.children = []; },
});

global.document = {
  createElement(tag) { const n = mkNode(tag); n.classList.owner = n; return n; },
  createTextNode(t) { return { nodeType: 3, tag: '#text', text: String(t) }; },
};

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? { setIcon: () => {} } : origLoad(req, ...rest));
const { counterSettingsButton, openCounterSettings } = require('../src/counter-settings');
Module._load = origLoad;

const host = () => { const h = mkNode('div'); h.classList.owner = h; return h; };
const ctrl = () => { const n = mkNode('button'); n.classList.owner = n; return n; };
const fire = (node, ev, e) => (node.listeners[ev] || []).forEach(fn => fn(e));

/* ---------- the sheet renders what it is given ---------- */
{
  const h = host();
  const motion = ctrl();
  openCounterSettings(h, [
    { label: 'Motion counting', hint: 'Let the phone count the movement itself', node: motion },
    { label: 'Type the count', hint: 'For the reps the taps and the sensor both missed', node: ctrl(), closeOnUse: true },
  ]);

  const sheet = h.querySelector('.gv-cs');
  assert.ok(sheet, 'the sheet must mount on the host it was handed');
  assert.strictEqual(sheet.getAttribute('role'), 'dialog', 'it is a dialog and must say so');
  assert.match(sheet.textContent, /Motion counting/);
  assert.match(sheet.textContent, /Let the phone count the movement itself/, 'the hint is the whole point of the row');

  /* The LIVE control is moved in, not rebuilt — a rebuilt motion button
     would lose the running sensor's state and its listeners. */
  const found = h.querySelector('.gv-cs-control');
  assert.ok(found.children.includes(motion), 'the row must host the very node it was given, not a copy');
}

/* ---------- THE GUARD: a press inside the sheet must not reach the zone --- */
{
  const h = host();
  openCounterSettings(h, [{ label: 'Motion counting', node: ctrl() }]);
  const sheet = h.querySelector('.gv-cs');

  for (const ev of ['touchstart', 'mousedown', 'click', 'keydown']) {
    let stopped = false;
    assert.ok((sheet.listeners[ev] || []).length > 0, `${ev} must be intercepted — it is one of the ways a tap reaches the zone`);
    fire(sheet, ev, { stopPropagation() { stopped = true; } });
    assert.ok(stopped, `${ev} inside the sheet must be stopped, or it falls through and counts a rep`);
  }
}

/* ---------- dismiss removes it, and is safe twice ---------- */
{
  const h = host();
  let closed = 0;
  const dismiss = openCounterSettings(h, [{ label: 'x', node: ctrl() }], { onClose: () => { closed++; } });
  assert.ok(h.querySelector('.gv-cs'), 'mounted');
  dismiss();
  assert.strictEqual(h.querySelector('.gv-cs'), null, 'dismiss must take the sheet off the host');
  dismiss();
  assert.strictEqual(closed, 1, 'onClose fires exactly once however many times dismiss is called');
}

/* ---------- the gear: opens once, never stacks ---------- */
{
  const h = host();
  const btn = counterSettingsButton(() => h, () => [{ label: 'Motion counting', node: ctrl() }]);
  assert.strictEqual(btn.getAttribute('aria-label'), 'Counter settings');

  fire(btn, 'click', {});
  const first = h.querySelector('.gv-cs');
  assert.ok(first, 'the gear opens the sheet');

  fire(btn, 'click', {});
  const sheets = h.children.filter(c => String(c.className).includes('gv-cs'));
  assert.strictEqual(sheets.length, 1, 'a second press must NOT stack a second sheet over the first');
  assert.strictEqual(h.querySelector('.gv-cs'), first, 'and the one on screen is still the original');
}

/* ---------- closeOnUse: only the controls that open their own surface ----- */
{
  const h = host();
  const motion = ctrl(), type = ctrl();
  const btn = counterSettingsButton(() => h, () => [
    { label: 'Motion counting', node: motion },
    { label: 'Type the count', node: type, closeOnUse: true },
  ]);
  fire(btn, 'click', {});
  assert.ok(h.querySelector('.gv-cs'), 'open');

  /* Motion stays: you flip it and read the sensitivity line it reveals. */
  fire(motion, 'click', {});
  assert.ok(h.querySelector('.gv-cs'), 'the motion toggle must NOT close the sheet');

  /* Type edits the count element UNDERNEATH this sheet — leaving it open
     would put the number box somewhere nobody can see. */
  fire(type, 'click', {});
  assert.strictEqual(h.querySelector('.gv-cs'), null, 'a closeOnUse control must take the sheet down with it');
}

/* ---------- FOCUS MODE: the three halves of the contract must agree ------- */
{
  const css = read('styles.css');
  const controller = read('controller.js');
  const session = read('page-session.js');

  /* (a) the rule exists and hides BOTH pieces of chrome */
  assert.match(css, /\.gv-app\.gv-focus[^{]*\.gv-head/, 'gv-focus must hide the head');
  assert.match(css, /\.gv-app\.gv-focus[^{]*\.gv-nav/, 'gv-focus must hide the nav');
  assert.match(css, /\.gv-app\.gv-focus[\s\S]{0,120}display:\s*none/,
    'display:none, not a collapsed height — a zero-height flex child still takes tab focus');

  /* (b) the clear happens in rerender, and BEFORE the page is rendered.
     After it, a counting screen's own add would be wiped and focus mode
     would never appear; without it, the class outlives the counter. */
  const rerender = controller.slice(controller.indexOf('ctx.rerender = () =>'));
  const clearAt = rerender.indexOf("classList.remove('gv-focus')");
  const renderAt = rerender.indexOf('page.render(ctx, pageEl)');
  assert.ok(clearAt > -1, 'ctx.rerender must clear gv-focus — it is the only thing stopping a leak');
  assert.ok(renderAt > -1, 'sanity: the page render call moved, this guard needs rewiring');
  assert.ok(clearAt < renderAt, 'the clear must come BEFORE the page renders, or it erases the screen\'s own add');

  /* (c) exactly one module grants it, through one named function. */
  const granters = [];
  for (const f of fs.readdirSync(SRC).filter(n => n.endsWith('.js'))) {
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    if (code.includes("classList.add('gv-focus')")) granters.push(f);
  }
  assert.deepStrictEqual(granters, ['page-session.js'],
    'only the counting screens may grant focus mode — anything else can hide the nav on a page with no way out');

  const body = session.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(body, /function focusMode\(ctx\)\s*\{[\s\S]{0,160}classList\.add\('gv-focus'\)/,
    'the grant must stay inside focusMode() — one place to reason about');
  assert.ok((body.match(/\bfocusMode\(ctx\)/g) || []).length >= 4,
    'every counting screen must call focusMode: reps, duration, timed — plus the definition');
}

console.log('counter settings OK (a press in the sheet cannot count a rep; focus mode is granted in one place and cleared before every render)');
