'use strict';
/* THE MOTION SUBSCRIPTION USED TO OUTLIVE ITS OWN RENDER (0.11.2 journey
   audit, finding #1).

   THE BUG THIS REPRODUCES. The listener startMotionCounter attaches lives on
   `window`, not the DOM — so nothing about a render producing a fresh set of
   nodes tears it down for free, the way a detached tap zone would. render()
   already tore down the media-cycle timer on every call for exactly this
   reason (see its own comment), but never did the same for sess.stopMotion.
   motionButton's own re-subscribe branch (`if (sess.motionOn &&
   !sess.stopMotion) begin()`) only fires when stopMotion is null — so with
   the old code, a render landing with motion already on and a STALE
   subscription still sitting in sess.stopMotion never re-subscribed at all:
   the old closure kept running (counting into whatever the next set turns
   out to be, or throwing on a null sess.counter during rest), and the new
   render's tap zone got nothing.

   This drives page-session.js's real render() twice, with a fake "leftover
   subscription from the previous render" already sitting on sess.stopMotion,
   and proves render() itself tears it down and lets a fresh one attach —
   not merely that the source contains the right-looking line. */
const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
};

/* A fake motion source: startMotionCounter resolves to a stop function
   carrying its own id, so "which subscription is live" is checkable by
   identity rather than by guessing at timing. */
let nextId = 0;
const startCalls = [];
const motionStub = {
  motionAvailable: () => true,
  startMotionCounter: (opts) => {
    const id = ++nextId;
    startCalls.push(id);
    const stopFn = () => stopFn.calls.push(id);
    stopFn.calls = [];
    stopFn.id = id;
    return Promise.resolve(stopFn);
  },
};

const origLoad = Module._load;
Module._load = (req, ...rest) => {
  if (req === 'obsidian') return stub;
  if (req === './motion-source') return motionStub;
  return origLoad(req, ...rest);
};

const mkNode = () => ({
  nodeType: 1, className: '', style: { setProperty() {}, removeProperty() {} }, children: [], attrs: {},
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, addEventListener() {}, append() {}, querySelector: () => null,
  insertBefore() {}, remove() {}, removeChild() {},
});
global.document = {
  createElement: mkNode, createTextNode: t => ({ nodeType: 3, text: String(t) }),
  addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
};
global.window = global.window || { setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout };

const { startDraft } = require(path.join(SRC, 'page-log'));
const pageSession = require(path.join(SRC, 'page-session'));
Module._load = origLoad;

const ctx = {
  data: { exercises: [{ name: 'Push-ups', fm: {} }], workouts: [] },
  state: {},
  settings: {},
  view: null,
  nav: () => {},
  notice: () => {},
  rerender: () => {},
  setPageInterval: () => {},
  io: {},
};
startDraft(ctx, { name: 'Test' }, { items: [{ exercise: 'Push-ups', target: '10', sets: 2 }] });

/* First render builds sess fresh (motion off — nothing to tear down yet). */
pageSession.render(ctx, mkNode());
assert.ok(ctx.state.session, 'render must build sess.session on first entry');

/* Simulate motion having been switched on during that first render, leaving
   a subscription that a SECOND render (the one every completed set causes)
   lands against. This is exactly the shape a real toggle would leave behind
   — the test does not need to drive the motion button itself to prove the
   render-time teardown. */
const staleStop = () => staleStop.calls.push('stale');
staleStop.calls = [];
ctx.state.session.motionOn = true;
ctx.state.session.stopMotion = staleStop;

pageSession.render(ctx, mkNode());

/* motionButton's begin() call is async (startMotionCounter returns a
   Promise), so give it a turn of the microtask queue before asserting. */
setTimeout(() => {
  assert.deepStrictEqual(staleStop.calls, ['stale'],
    'the previous render\'s subscription must be torn down by render() itself — ' +
    'the listener is on window, not the DOM, so nothing else will ever call it');
  assert.strictEqual(typeof ctx.state.session.stopMotion, 'function',
    'motion is still on, so a fresh subscription must have been picked back up');
  assert.notStrictEqual(ctx.state.session.stopMotion, staleStop,
    'the live subscription must be a NEW one, not the stale closure left over from the last render');
  assert.strictEqual(startCalls.length, 1,
    'startMotionCounter must have been called for the second render — with the old code stopMotion still ' +
    'looked non-null (the stale one), so motionButton\'s re-subscribe branch never ran at all');

  console.log('motion teardown OK (render() kills the previous subscription itself, so the re-subscribe branch actually runs)');
}, 10);
