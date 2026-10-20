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

   THE LAST GOOD LEDGER SURVIVES A RELOAD. Every vault change replaces ctx.data and
   so retires the cache above, which used to mean every reload drew the level row
   empty and popped it in again. ctx.state outlives a reload, so each good read is
   also kept on ctx.state.rewardsLast, and a new cache entry carries it as `stale`:
   the screens paint it AT ONCE (the summary and quest are computed from it against
   the CURRENT ctx.data, so a new workout is not lost) and replace what they drew
   only if the fresh read says something different. A failed or unreadable read
   never touches rewardsLast, and a screen that has something drawn keeps it.

   THE WRITE (awardFinished) happens where the workout is saved: page-log's
   finishSession, after io.saveWorkout resolved with the note's path. Both exits
   (Finish & save on the complete screen, Bank it on the log, "Finish session" on a
   rest, the end-session sheet) funnel there, so a session abandoned without saving
   earns nothing, and the draft.finishing guard plus draft.rewardsAwarded plus the
   ledger's own key-idempotence mean a double tap earns once. It NEVER throws and is
   raced against a short timeout by the caller: a failed or slow award cannot fail
   or hold up a finished session.

   A FAILED AWARD IS NOT FORGOTTEN. draft.rewardsAwarded is set before the write (it
   is what makes a double tap pay once) and the draft is gone as soon as the session
   is saved, so a write that failed - the vault threw, or the ledger would not read
   yet (an undownloaded iCloud file: io.appendRewards refuses to write over it) - has
   nowhere to be retried from. It goes on ctx.state.rewardsRetry as a snapshot of
   what is needed to work the awards out again (workout path, date, rows, records)
   and is tried ONCE on the next Today render and ONCE MORE at the next session start
   (page-log.startDraft), each against a FRESH read of the ledger, so a key that has
   meanwhile landed is never paid twice (the engine skips present keys and the ledger
   is idempotent by key too). In memory only: no setting, no repair of old sessions.
   A session that was never saved queues nothing, and rewards off queues and retries
   nothing. While a finish waits more than flow.FEEDBACK_MS for its award, a small
   "Saving rewards..." notice says so (and goes when the wait ends). */

const R = require('./rewards');
const { todayISO } = require('./dates');
const stats = require('./stats');

const enabled = ctx => R.rewardsEnabled(ctx && ctx.settings);

/* How long a finished session waits for its awards before moving on, and how long a wait
   goes unremarked before a notice says what it is waiting for (a test lowers both). */
const flow = { AWARD_WAIT_MS: 1500, FEEDBACK_MS: 400 };

/* ---- the ledger, cached per ctx.data ---- */

/* The user's week start, tolerant of a context with no settings object (the engine has its own default). */
const weekStartOf = ctx => (ctx && ctx.settings && ctx.settings.weekStart) || undefined;

function readLedger(ctx) {
  if (!enabled(ctx)) return null;
  const st = ctx.state || (ctx.state = {});
  const c = st.rewardsCache;
  if (c && c.data === ctx.data) return c;
  const entry = { data: ctx.data, value: null, failed: false, done: false, promise: null, stale: st.rewardsLast || null };
  entry.promise = (async () => {
    try {
      if (!ctx.io || typeof ctx.io.readRewards !== 'function') throw new Error('no ledger reader');
      const v = await ctx.io.readRewards();
      if (!v || v.unreadable || v.disabled) entry.failed = true; else {
        entry.value = v;
        /* Only a read that is still the current one is the "last good": an append that landed
           meanwhile retired this entry and has already put a newer ledger there. */
        if (st.rewardsCache === entry) st.rewardsLast = v;
      }
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
   stands in for "before". A draft that came back after the app was closed carries
   its records on `draft.live` (draft-store), and resuming it from Today's card goes
   straight to the log page with no session or carry, so that copy is the last
   source. */
function sessionInputs(ctx, draft) {
  const sess = ctx.state && ctx.state.session;
  const carry = ctx.state && ctx.state.sessionCarry;
  if (sess) return { records: sess.records || [], workouts: sess.workoutsAtStart || ctx.data.workouts };
  if (carry && carry.draft === draft) return { records: carry.records || [], workouts: ctx.data.workouts };
  const kept = draft && draft.live && Array.isArray(draft.live.records) ? draft.live.records : [];
  return { records: kept, workouts: ctx.data.workouts };
}

function awardsFor(ctx, draft, rows, workoutKey, ledgerState, inputs, keySuffix) {
  const inp = inputs || sessionInputs(ctx, draft);
  return R.awardsForSession({
    workoutKey, keySuffix, date: draft.date, sets: rows, records: inp.records, workouts: inp.workouts,
    daysOn: ctx.daysOn, exercises: ctx.data.exercises, weekStart: weekStartOf(ctx),
    settings: ctx.settings, ledgerState,
  });
}

/* ---- Session complete's preview ----
   The complete screen is shown BEFORE the save, so the card is a preview: the awards
   this session WOULD earn, computed with a provisional key (the real key is the saved
   note's path, which does not exist yet). The amounts do not depend on the key. It is
   cached on the session object so a re-render of the screen does not recompute it.
   The provisional key is unique to this draft, so the preview always prices a full
   session; awardFinished pays that same full amount even when the saved path was paid
   before (R.sessionKeySuffix), so the card's promise and the ledger agree. */
function preview(ctx, draft, sess, rows) {
  if (!enabled(ctx)) return null;
  if (sess.rewardsPreview) return sess.rewardsPreview;
  const c = readLedger(ctx);
  /* What finishing would earn against ONE ledger state. */
  const compute = ledger => {
    const inputs = { records: sess.records || [], workouts: sess.workoutsAtStart || ctx.data.workouts };
    const awards = awardsFor(ctx, draft, rows, `pending:${draft.startedAt || 0}`, ledger, inputs);
    const totalBefore = summaryFor(ctx, ledger).totalXp;
    let medalsBefore = null, medalsAfter = null;
    if (awards.length) {
      const mine = { name: 'pending', fm: { date: draft.date }, rows, file: { path: 'pending' } };
      medalsBefore = medalsFor(ctx, inputs.workouts);
      medalsAfter = medalsFor(ctx, inputs.workouts.concat([mine]));
    }
    return { awards, totalBefore, medalsBefore, medalsAfter };
  };
  /* `early` is the preview against the LAST GOOD ledger, available at once, so the card is
     on the screen when "Finish & save" is (it used to arrive a beat later and push the
     button down). `value` is the fresh read's preview; the screen swaps early for it only
     if they differ. A failed fresh read leaves early standing. */
  const p = { done: false, failed: false, value: null, early: null, promise: null };
  if (c.stale) {
    try { p.early = compute(c.stale); } catch (e) { console.error('gym-vault rewards preview', e); }
  }
  p.promise = c.promise.then(() => {
    try {
      if (c.failed) { p.failed = true; return p; }
      p.value = compute(c.value);
    } catch (e) { console.error('gym-vault rewards preview', e); p.failed = true; }
    p.done = true;
    return p;
  });
  sess.rewardsPreview = p;
  return p;
}

/* ---- the write ---- */

/* ---- failed awards, kept for a retry ---- */

const retryList = ctx => (ctx && ctx.state && ctx.state.rewardsRetry) || [];

function queueRetry(ctx, job) {
  const st = ctx.state || (ctx.state = {});
  st.rewardsRetry = retryList(ctx).filter(j => j.path !== job.path || j.sessionId !== job.sessionId).concat([Object.assign({ tried: { today: false, start: false }, busy: false }, job)]);
}

/* A write that did not happen: the vault threw, or the ledger is there but would not
   give itself up (io.appendRewards says so with unreadable / unavailable). */
const notWritten = res => !res || res.unreadable === true || res.unavailable === true;

/* The ledger as we now know it after appending `appended` to `before`, so Today can paint
   the new total the moment it renders instead of the old one and then the new one. */
function withAppended(before, appended) {
  if (!before || !appended || !appended.length) return before || null;
  const entries = (before.entries || []).concat(appended);
  const keys = new Set(before.keys || []);
  for (const a of appended) keys.add(a.key);
  return Object.assign({}, before, { entries, keys });
}

async function awardFinished(ctx, draft, rows, path) {
  if (!enabled(ctx)) return null;
  if (!ctx.io || typeof ctx.io.readRewards !== 'function' || typeof ctx.io.appendRewards !== 'function') return null;
  if (!draft || draft.rewardsAwarded) return null;
  draft.rewardsAwarded = true;
  /* The session's own id (the key suffix, should its path already be paid), fixed here so a retry is the same session. */
  const job = { path, date: draft.date, rows, records: [], sessionId: draft.startedAt || Date.now() };
  try {
    const inputs = sessionInputs(ctx, draft);
    job.records = (inputs.records || []).slice();
    /* A fresh read, never the screen's cache: the file may have moved since Today drew. */
    const ledgerState = await ctx.io.readRewards();
    /* Never work awards out against a ledger that would not read: it says nothing about what is paid. */
    if (!ledgerState || ledgerState.unreadable) { queueRetry(ctx, job); invalidate(ctx); return null; }
    job.keySuffix = R.sessionKeySuffix(ledgerState, path, job.sessionId);
    const awards = awardsFor(ctx, draft, rows, path, ledgerState, inputs, job.keySuffix);
    if (awards.length) {
      const res = await ctx.io.appendRewards(awards);
      if (notWritten(res)) { queueRetry(ctx, job); invalidate(ctx); return null; }
      if (ctx.state) ctx.state.rewardsLast = withAppended(ledgerState, res.appended);
    }
    invalidate(ctx);
    return { awards, xp: awards.reduce((n, a) => n + a.xp, 0) };
  } catch (e) {
    console.error('gym-vault rewards', e);
    queueRetry(ctx, job);
    invalidate(ctx);
    return null;
  }
}

/* One more try at a queued award. `when` is 'today' (the next Today render) or 'start' (the
   next session start): each job is tried at most once in each, never twice at once. Every
   try works the awards out AGAIN against a fresh read, so nothing already paid is paid
   again, and a ledger that still will not read leaves the job where it is. Never rejects. */
async function retryOne(ctx, job, when) {
  if (job.busy || job.tried[when]) return;
  job.tried[when] = true;
  job.busy = true;
  try {
    const ledgerState = await ctx.io.readRewards();
    if (!ledgerState || ledgerState.unreadable) return;
    /* The suffix the first try chose stands; a job that never got that far decides now (nothing of it can be in the ledger). */
    if (job.keySuffix == null) job.keySuffix = R.sessionKeySuffix(ledgerState, job.path, job.sessionId);
    const awards = awardsFor(ctx, { date: job.date }, job.rows, job.path, ledgerState, { records: job.records, workouts: ctx.data.workouts }, job.keySuffix);
    let appended = [];
    if (awards.length) {
      const res = await ctx.io.appendRewards(awards);
      if (notWritten(res)) return;
      appended = res.appended || [];
      if (ctx.state) ctx.state.rewardsLast = withAppended(ledgerState, appended);
    }
    ctx.state.rewardsRetry = retryList(ctx).filter(j => j !== job);
    invalidate(ctx);
    const xp = appended.reduce((n, a) => n + a.xp, 0);
    if (xp && typeof ctx.notice === 'function') ctx.notice(`Rewards saved for your last session. +${xp} XP`);
    if (ctx.state.page === 'dashboard' && typeof ctx.rerender === 'function') ctx.rerender();
  } catch (e) {
    console.error('gym-vault rewards retry', e);
  } finally {
    job.busy = false;
    /* Both tries spent: let it go rather than hold the rows for the rest of the session. */
    if (job.tried.today && job.tried.start) ctx.state.rewardsRetry = retryList(ctx).filter(j => j !== job);
  }
}

function retryPending(ctx, when) {
  if (!enabled(ctx) || !retryList(ctx).length) return Promise.resolve();
  if (!ctx.io || typeof ctx.io.readRewards !== 'function' || typeof ctx.io.appendRewards !== 'function') return Promise.resolve();
  return Promise.all(retryList(ctx).slice().map(j => retryOne(ctx, j, when))).then(() => undefined);
}

/* Await awardFinished for at most `ms`; a late finish still retires the cache and
   redraws Today if it is the screen being looked at. Never rejects. If the wait runs
   past flow.FEEDBACK_MS a notice says what the pause is, and it goes when the wait does. */
async function awardWithin(ctx, draft, rows, path, ms) {
  const work = awardFinished(ctx, draft, rows, path).catch(() => null);
  const setT = (typeof window !== 'undefined' && window.setTimeout) || setTimeout;
  const clearT = (typeof window !== 'undefined' && window.clearTimeout) || clearTimeout;
  let timer = null, feedbackTimer = null, late = false, shown = null;
  const clock = new Promise(resolve => { timer = setT(() => { late = true; resolve(null); }, ms); });
  if (ms > flow.FEEDBACK_MS) {
    feedbackTimer = setT(() => {
      try { shown = typeof ctx.notice === 'function' ? ctx.notice('Saving rewards…') : null; } catch (e) { shown = null; }
    }, flow.FEEDBACK_MS);
  }
  const got = await Promise.race([work, clock]);
  if (timer !== null) clearT(timer);
  if (feedbackTimer !== null) clearT(feedbackTimer);
  if (shown && typeof shown.hide === 'function') { try { shown.hide(); } catch (e) { /* already gone */ } }
  if (late) {
    work.then(() => { invalidate(ctx); if (ctx.state && ctx.state.page === 'dashboard' && typeof ctx.rerender === 'function') ctx.rerender(); });
  }
  return got;
}

module.exports = {
  flow, enabled, readLedger, invalidate, summaryFor, questFor, medalsFor, sessionInputs, awardsFor, preview, awardFinished, awardWithin, retryPending,
  sessionCount: w => stats.sessionCount(w),
};
