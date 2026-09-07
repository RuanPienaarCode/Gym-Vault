'use strict';
/* Three findings from the 0.11.2 journey audit of the guided-setup screen,
   pinned so a reasonable-looking refactor cannot quietly reopen any of
   them. Each was reproduced by driving the real app, not guessed from
   reading the source.

   1. Back was hardcoded to Today (page-session-setup.js:228-229 as of
      8469070) — the exact defect #22 fixed for plan detail in 0.11.1,
      reopened on this screen. Plans -> a plan -> Start -> Back, and
      Running -> Start -> Back, both dropped the user on Today instead of
      wherever they actually came from. back-stack.test.cjs's source pin
      covers the shared-button wiring; this file covers the OTHER half —
      that ctx.state.setup is still cleared on every way off the screen,
      not just a click on the button that used to clear it inline.

   2. Start was never disabled, so an empty day built a zero-entry session
      that dead-ended at "Finish & save" with no way out but Discard.

   3. Two days sharing a name resolved to the FIRST one however you tapped
      the second — controller.js keeps dayIndex for exactly this case, but
      resolveSetup preferred the name lookup unconditionally. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const srcPath = path.join(SRC, 'page-session-setup.js');
const readSrc = () => fs.readFileSync(srcPath, 'utf8');

/* ---------- 1. setup is reset on every exit, via pageCleanup ---------- */
{
  const src = readSrc();
  const m = src.match(/ctx\.state\.pageCleanup = \(\) => \{([^}]*)\};/);
  assert.ok(m, 'render() must register ctx.state.pageCleanup');
  assert.match(m[1], /ctx\.state\.setupUi = null/,
    'pageCleanup must still clear setupUi — that half of the invariant already existed');
  assert.match(m[1], /ctx\.state\.setup = null/,
    'pageCleanup must ALSO clear ctx.state.setup, so it happens on every way off the screen '
    + '(Back, a primary-tab tap, a vault edit that bounces resolveSetup to the dashboard) — '
    + 'not only on a click on a button that used to clear it inline');

  /* And the back button itself must be the shared helper, not a hand-built
     button with its own nav — back-stack.test.cjs already pins the source
     text of that; this just confirms the click handler was not left behind
     duplicating the reset pageCleanup now owns. */
  assert.ok(!/back\.addEventListener\('click', \(\) => \{ ctx\.state\.setup = null/.test(src),
    'the old inline click handler must be gone, not merely unreachable dead code beside the new one');
}

/* ---------- 2. Start is disabled when the resolved day has no items ---------- */
{
  /* render() needs a live page graph (setIcon, Menu…), so mount it for real
     against a minimal DOM stub — the session-sets-ui.test.cjs pattern —
     rather than trust a source-pin for behaviour a thumb actually meets. */
  const mkNode = tag => ({
    nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, parent: null,
    hidden: false, disabled: false, value: '',
    classList: {
      add(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.add(c); this.owner.className = [...s].join(' '); },
      remove(c) { const s = new Set(String(this.owner.className).split(/\s+/).filter(Boolean)); s.delete(c); this.owner.className = [...s].join(' '); },
      contains(c) { return String(this.owner.className).split(/\s+/).includes(c); },
      toggle(c, on) { const want = on === undefined ? !this.contains(c) : !!on; return want ? this.add(c) : this.remove(c); },
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(ev, fn) { (this.listeners[ev] ||= []).push(fn); },
    append(...kids) { for (const k of kids) { if (k && k.nodeType === 1) k.parent = this; this.children.push(k); } },
    removeChild(k) { this.children = this.children.filter(c => c !== k); },
    get firstChild() { return this.children[0] || null; },
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
    setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {}, Menu: class {},
    ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {}, TFolder: class {},
    normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
    MarkdownRenderer: class {},
  };
  const origLoad = Module._load;
  Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));
  delete require.cache[srcPath];
  const { render } = require('../src/page-session-setup');
  Module._load = origLoad;

  const makeCtx = items => {
    const plan = { name: 'Push Day', model: { days: [{ name: 'Push', items }] } };
    const state = { setup: { plan: 'Push Day', day: 'Push', dayIndex: 0 }, setupUi: null, pageCleanup: null };
    return {
      data: { plans: [plan], exercises: [] },
      state,
      settings: {},
      plugin: { settings: {}, saveSettings: async () => {} },
      rerender: () => {},
      nav: () => {},
      notice: () => {},
      enterGuided: () => {},
      backTo: fallback => fallback,
      back: () => {},
    };
  };

  const mount = items => {
    const ctx = makeCtx(items);
    const root = document.createElement('div');
    render(ctx, root);
    return root.querySelector('.gv-btn-go');
  };

  const emptyStart = mount([]);
  assert.ok(emptyStart, 'the Start button must still render on an empty day, disabled rather than absent');
  assert.strictEqual(emptyStart.disabled, true,
    'an empty day must not be startable — startDraft would build zero entries and the session '
    + 'would dead-end at "Finish & save" with no way out but Discard');
  assert.match(emptyStart.textContent, /nothing/i,
    'the button must say why in the house voice, not silently sit inert');

  const fullStart = mount([{ exercise: 'Push-ups', target: '10', sets: 3 }]);
  assert.strictEqual(fullStart.disabled, false, 'a day with exercises must stay startable');
  assert.match(fullStart.textContent, /start session/i);
}

/* ---------- 3. index+name match wins over the name lookup ---------- */
{
  /* resolveSetup is module-private and reads ctx.data/ctx.state directly, so
     it is extracted and driven with real inputs — the Function constructor
     runs it in its own scope, unaffected by the file's own strict mode, so
     the body can be lifted verbatim without an interpreter. */
  const src = readSrc();
  const start = src.indexOf('function resolveSetup(ctx) {');
  assert.ok(start >= 0, 'resolveSetup must exist — this guard must be renamed with it');
  const end = src.indexOf('\nfunction render(ctx, root)');
  const fnText = src.slice(start, end);
  const braceStart = fnText.indexOf('{');
  const braceEnd = fnText.lastIndexOf('}');
  const resolveSetup = new Function('ctx', fnText.slice(braceStart + 1, braceEnd));

  /* Two days sharing a name — the pathological case controller.js's comment
     names dayIndex for. Tapping the SECOND Thursday must build the SECOND
     Thursday's session. */
  const thu1 = { name: 'Thursday', items: [{ exercise: 'Squats' }] };
  const thu2 = { name: 'Thursday', items: [{ exercise: 'Deadlifts' }] };
  const plan = { name: 'Plan', model: { days: [thu1, thu2] } };
  const ctxFor = dayIndex => ({
    data: { plans: [plan] },
    state: { setup: { plan: 'Plan', day: 'Thursday', dayIndex } },
  });

  const first = resolveSetup(ctxFor(0));
  assert.strictEqual(first.day, thu1, 'index 0 + matching name must resolve to the FIRST Thursday');

  const second = resolveSetup(ctxFor(1));
  assert.strictEqual(second.day, thu2,
    'index 1 + matching name must resolve to the SECOND Thursday — this is the bug: the name '
    + 'lookup alone always returns the first match, whichever Thursday was actually tapped');

  /* A day renamed or reordered since setup was opened invalidates the index
     (the name at that position no longer matches), and the name lookup is
     still the right way to follow the edit — re-resolving from ctx.data on
     every render is the whole point of this function (see its own comment). */
  const renamed = { name: 'Plan', model: { days: [{ name: 'Monday', items: [{ exercise: 'Rows' }] }, thu2] } };
  const staleCtx = { data: { plans: [renamed] }, state: { setup: { plan: 'Plan', day: 'Thursday', dayIndex: 0 } } };
  const followed = resolveSetup(staleCtx);
  assert.strictEqual(followed.day, thu2,
    'when the stored index no longer names the stored day, the name lookup must still find it');

  /* No index at all (a first visit with no plan resolved) still falls back
     to the name lookup, as before. */
  const noIndex = resolveSetup({ data: { plans: [plan] }, state: { setup: { plan: 'Plan', day: 'Thursday', dayIndex: -1 } } });
  assert.strictEqual(noIndex.day, thu1, 'with no usable index, the name lookup picks the first match, as it always has');
}

console.log('setup journey audit OK (Back returns to the caller, an empty day cannot be started, '
  + 'and index+name beats a same-name collision)');
