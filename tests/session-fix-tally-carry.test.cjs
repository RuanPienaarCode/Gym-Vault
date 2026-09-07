'use strict';
/* "REVIEW IN LOG" THEN "GUIDED" MUST NOT LOSE THE RECORDS/GOALS SUMMARY
   (0.11.2 journey audit, finding L9).

   THE BUG THIS REPRODUCES. Leaving the session page for ANY reason ran
   page-session.js's pageCleanup, which unconditionally nulled
   ctx.state.session — records and goalCount included. controller.js's
   ctx.enterGuided() also (deliberately) nulls ctx.state.session to force a
   fresh flow.initialPosition() on the way back in, honouring anything
   ticked on the log overview meanwhile. But between those two nullings, a
   record broken before the detour was gone: the completion screen at the
   end of the session reads sess.records/goalCount, and re-entering guided
   mode built both back up from nothing.

   THE FIX: pageCleanup now stashes the outgoing tally on
   ctx.state.sessionCarry, tied to the draft it was earned against; the
   next fresh session built for that SAME draft picks it back up. A
   genuinely new draft (a fresh Start after Finish or Discard, both of
   which null ctx.state.logDraft before they navigate away) must not
   inherit it.

   This drives the real render() twice — same pattern as
   session-fix-motion-teardown.test.cjs — with the real pageCleanup
   function invoked in between, exactly as ctx.nav would call it. */
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

const newCtx = () => ({
  data: { exercises: [{ name: 'Push-ups', fm: {} }], workouts: [], goals: [] },
  state: {},
  settings: {},
  view: null,
  nav: () => {},
  notice: () => {},
  rerender: () => {},
  setPageInterval: () => {},
  io: {},
});

/* ---------- 1. THE ROUND TRIP: same draft, tally must survive ---------- */
{
  const ctx = newCtx();
  startDraft(ctx, { name: 'Test' }, { items: [{ exercise: 'Push-ups', target: '10', sets: 2 }] });
  const draft = ctx.state.logDraft;

  pageSession.render(ctx, mkNode());
  assert.ok(ctx.state.session, 'first render must build a fresh session');

  /* A record broken and a goal met, before the detour. */
  ctx.state.session.records.push({ key: 'Push-ups/reps', exercise: 'Push-ups', kind: 'reps', val: '21', prev: '14' });
  ctx.state.session.goalCount = 1;

  /* "Review in log": ctx.nav('log') would call this exact function. */
  assert.strictEqual(typeof ctx.state.pageCleanup, 'function', 'render must register pageCleanup');
  ctx.state.pageCleanup();
  assert.strictEqual(ctx.state.session, null, 'leaving the page must still clear the live session object');

  /* controller.js's ctx.enterGuided(): forces a fresh position, same draft. */
  ctx.state.session = null;

  pageSession.render(ctx, mkNode());
  assert.ok(ctx.state.session, 'second render must build a fresh session for the same draft');
  assert.strictEqual(ctx.state.session.records.length, 1,
    'the record broken before the detour must still be on the completion screen — this is the exact regression reported');
  assert.strictEqual(ctx.state.session.records[0].val, '21');
  assert.strictEqual(ctx.state.session.goalCount, 1, 'the goal tally must survive the round trip too');
}

/* ---------- 2. A GENUINELY NEW DRAFT MUST NOT INHERIT THE OLD TALLY ---- */
{
  const ctx = newCtx();
  startDraft(ctx, { name: 'Old' }, { items: [{ exercise: 'Push-ups', target: '10', sets: 2 }] });
  pageSession.render(ctx, mkNode());
  ctx.state.session.records.push({ key: 'Push-ups/reps', exercise: 'Push-ups', kind: 'reps', val: '21', prev: '14' });
  ctx.state.session.goalCount = 3;

  /* Finish/Discard both null logDraft BEFORE navigating away — reproduced
     here directly, then the same pageCleanup that a real nav would run. */
  ctx.state.logDraft = null;
  ctx.state.pageCleanup();

  /* A brand new session, on a brand new draft object. */
  startDraft(ctx, { name: 'New' }, { items: [{ exercise: 'Push-ups', target: '10', sets: 2 }] });
  ctx.state.session = null;
  pageSession.render(ctx, mkNode());

  assert.strictEqual(ctx.state.session.records.length, 0,
    'a genuinely new draft must start with an empty tally, not inherit the old session\'s');
  assert.strictEqual(ctx.state.session.goalCount, 0);
}

console.log('session tally-carry OK (a broken record survives "Review in log" then Guided; a fresh draft never inherits an old tally)');
