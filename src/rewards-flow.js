'use strict';
/* REWARDS FLOW - the glue between the pages and the engine: where the ledger is
   read for a screen, what Session complete previews, and the ONE place awards are
   written. No DOM here (src/rewards-ui.js draws), no obsidian import.

   REWARDS OFF is checked first in every entry point: nothing is read, nothing is
   computed, nothing is written (the io layer refuses too, but the page code never
   gets as far as asking).

   THE LEDGER IS READ ONCE PER RENDER CYCLE. readLedger() caches the read on
   ctx.state.rewardsCache, keyed by the ctx.data object it was read under: a reload
   (any vault change) replaces ctx.data and so retires the cache, and an append
   retires it explicitly. Today's render is synchronous, so a screen asks for the
   cache entry, draws its slots empty and fills them when the entry resolves; a
   second render in the same cycle finds the entry already resolved and fills at
   once, which is what keeps the level row from flickering. A read that fails or
   comes back unreadable is `failed`: the slots stay empty, nothing is thrown.

   THE WRITE (awardFinished) happens where the workout is saved: page-log's
   finishSession, after io.saveWorkout resolved with the note's path. Both exits
   (Finish & save on the complete screen, Bank it on the log, "Finish session" on a
   rest, the end-session sheet) funnel there, so a session abandoned without saving
   earns nothing, and the draft.finishing guard plus draft.rewardsAwarded plus the
   ledger's own key-idempotence mean a double tap earns once. It NEVER throws and is
   raced against a short timeout by the caller: a failed or slow award cannot fail
   or hold up a finished session. */

const R = require('./rewards');
const { todayISO } = require('./dates');
const stats = require('./stats');

const enabled = ctx => R.rewardsEnabled(ctx && ctx.settings);

/* How long a finished session waits for its awards before moving on (a test lowers it). */
const flow = { AWARD_WAIT_MS: 1500 };

/* ---- the ledger, cached per ctx.data ---- */

/* The user's week start, tolerant of a context with no settings object (the engine has its own default). */
const weekStartOf = ctx => (ctx && ctx.settings && ctx.settings.weekStart) || undefined;

function readLedger(ctx) {
  if (!enabled(ctx)) return null;
  const st = ctx.state || (ctx.state = {});
  const c = st.rewardsCache;
  if (c && c.data === ctx.data) return c;
  const entry = { data: ctx.data, value: null, failed: false, done: false, promise: null };
  entry.promise = (async () => {
    try {
      if (!ctx.io || typeof ctx.io.readRewards !== 'function') throw new Error('no ledger reader');
      const v = await ctx.io.readRewards();
      if (!v || v.unreadable || v.disabled) entry.failed = true; else entry.value = v;
    } catch (e) { entry.failed = true; }
    entry.done = true;
    return entry;
  })();
  st.rewardsCache = entry;
  return entry;
}

const invalidate = ctx => { if (ctx && ctx.state) ctx.state.rewardsCache = null; };

/* ---- what Today and Profile show ---- */

function summaryFor(ctx, ledger) {
  return R.summarise(ledger, todayISO(), { weekStart: weekStartOf(ctx) });
}
function questFor(ctx, ledger) {
  return R.questFor({
    daysOn: ctx.daysOn, exercises: ctx.data.exercises, workouts: ctx.data.workouts,
    today: todayISO(), weekStart: weekStartOf(ctx), ledger,
  });
}
function medalsFor(ctx, workouts) {
  return R.medals({ workouts: workouts || ctx.data.workouts, exercises: ctx.data.exercises, weekStart: weekStartOf(ctx) });
}

/* ---- the inputs a finished session was earned from ---- */

/* The records broken and the history before this session. A live guided session
   holds both; a session finished from the log page after leaving the guided one
   finds them in the carry the guided page stashed for THIS draft; a manual session
   has no records (the guided counter is what detects them) and the loaded history
   stands in for "before". */
function sessionInputs(ctx, draft) {
  const sess = ctx.state && ctx.state.session;
  const carry = ctx.state && ctx.state.sessionCarry;
  if (sess) return { records: sess.records || [], workouts: sess.workoutsAtStart || ctx.data.workouts };
  if (carry && carry.draft === draft) return { records: carry.records || [], workouts: ctx.data.workouts };
  return { records: [], workouts: ctx.data.workouts };
}

function awardsFor(ctx, draft, rows, workoutKey, ledgerState, inputs) {
  const inp = inputs || sessionInputs(ctx, draft);
  return R.awardsForSession({
    workoutKey, date: draft.date, sets: rows, records: inp.records, workouts: inp.workouts,
    daysOn: ctx.daysOn, exercises: ctx.data.exercises, weekStart: weekStartOf(ctx),
    settings: ctx.settings, ledgerState,
  });
}

/* ---- Session complete's preview ----
   The complete screen is shown BEFORE the save, so the card is a preview: the awards
   this session WOULD earn, computed with a provisional key (the real key is the saved
   note's path, which does not exist yet). The amounts do not depend on the key. It is
   cached on the session object so a re-render of the screen does not recompute it. */
function preview(ctx, draft, sess, rows) {
  if (!enabled(ctx)) return null;
  if (sess.rewardsPreview) return sess.rewardsPreview;
  const c = readLedger(ctx);
  const p = { done: false, failed: false, value: null, promise: null };
  p.promise = c.promise.then(() => {
    try {
      if (c.failed) { p.failed = true; return p; }
      const inputs = { records: sess.records || [], workouts: sess.workoutsAtStart || ctx.data.workouts };
      const awards = awardsFor(ctx, draft, rows, `pending:${draft.startedAt || 0}`, c.value, inputs);
      const totalBefore = summaryFor(ctx, c.value).totalXp;
      let medalsBefore = null, medalsAfter = null;
      if (awards.length) {
        const mine = { name: 'pending', fm: { date: draft.date }, rows, file: { path: 'pending' } };
        medalsBefore = medalsFor(ctx, inputs.workouts);
        medalsAfter = medalsFor(ctx, inputs.workouts.concat([mine]));
      }
      p.value = { awards, totalBefore, medalsBefore, medalsAfter };
    } catch (e) { console.error('gym-vault rewards preview', e); p.failed = true; }
    p.done = true;
    return p;
  });
  sess.rewardsPreview = p;
  return p;
}

/* ---- the write ---- */

async function awardFinished(ctx, draft, rows, path) {
  if (!enabled(ctx)) return null;
  if (!ctx.io || typeof ctx.io.readRewards !== 'function' || typeof ctx.io.appendRewards !== 'function') return null;
  if (!draft || draft.rewardsAwarded) return null;
  draft.rewardsAwarded = true;
  try {
    const inputs = sessionInputs(ctx, draft);
    /* A fresh read, never the screen's cache: the file may have moved since Today drew. */
    const ledgerState = await ctx.io.readRewards();
    const awards = awardsFor(ctx, draft, rows, path, ledgerState, inputs);
    if (awards.length) await ctx.io.appendRewards(awards);
    invalidate(ctx);
    return { awards, xp: awards.reduce((n, a) => n + a.xp, 0) };
  } catch (e) {
    console.error('gym-vault rewards', e);
    invalidate(ctx);
    return null;
  }
}

/* Await awardFinished for at most `ms`; a late finish still retires the cache and
   redraws Today if it is the screen being looked at. Never rejects. */
async function awardWithin(ctx, draft, rows, path, ms) {
  const work = awardFinished(ctx, draft, rows, path).catch(() => null);
  const setT = (typeof window !== 'undefined' && window.setTimeout) || setTimeout;
  const clearT = (typeof window !== 'undefined' && window.clearTimeout) || clearTimeout;
  let timer = null, late = false;
  const clock = new Promise(resolve => { timer = setT(() => { late = true; resolve(null); }, ms); });
  const got = await Promise.race([work, clock]);
  if (timer !== null) clearT(timer);
  if (late) {
    work.then(() => { invalidate(ctx); if (ctx.state && ctx.state.page === 'dashboard' && typeof ctx.rerender === 'function') ctx.rerender(); });
  }
  return got;
}

module.exports = {
  flow, enabled, readLedger, invalidate, summaryFor, questFor, medalsFor, sessionInputs, awardsFor, preview, awardFinished, awardWithin,
  sessionCount: w => stats.sessionCount(w),
};
