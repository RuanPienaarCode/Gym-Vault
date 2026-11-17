'use strict';
const { accentFor } = require('./constants');
/* Opening a weekly challenge and saving what it counted. The rules live in
   challenge.js and the screen in challenge-modal.js; this is the seam to the
   vault, kept out of both so neither needs the app context.

   A finished run is saved as a workout note (one row per unbroken set) marked
   `kind: challenge`, so History, Records, the Goals card and next week's target
   all read it through the same rows as everything else - but it is NOT a session
   (stats.isChallengeRun, decision D1): no session count, week ring, workouts-per-
   week goal, session medal, weekly quest or +100 "Session finished" XP. It does
   earn the per-set XP and the PB bonus, and it keeps the week streak alive. */

const ch = require('./challenge');
const records = require('./records');
const { ChallengeModal } = require('./challenge-modal');
const rewardsFlow = require('./rewards-flow');
const { FormModal } = require('./modals');
const { todayISO } = require('./dates');

function statusFor(ctx, goal) {
  return ch.challengeStatus(goal, (ctx.data && ctx.data.workouts) || [], { weekStart: ctx.settings.weekStart, today: todayISO() });
}

/* The day name on the saved note: "50 Push-ups challenge", unless the goal
   is already called a challenge. */
function challengeDay(name) {
  const n = String(name || '').trim() || 'Weekly';
  return /challenge/i.test(n) ? n : `${n} challenge`;
}

function openChallenge(ctx, goal) {
  new ChallengeModal(ctx.app, {
    title: goal.name,
    exercise: goal.fm.exercise,
    status: statusFor(ctx, goal),
    shape: ch.parseShape(goal.fm.split),
    restSeconds: ch.restSeconds(goal.fm),
    skin: ctx.settings.skin,
    accent: accentFor(ctx.settings),
    settings: ctx.settings,
    onSave: (sets, mode, startedAt) => saveRun(ctx, goal, sets, mode, startedAt),
  }).open();
}

/* The record this go set, if it set one, in the shape awardsForSession reads
   (sess.records: {key, exercise, kind, val, prev}), or none.

   A challenge count is observed tap by tap (or by the hold's own clock), so its
   best is as trustworthy a record as a guided set's. The figure to beat is the
   previous ALL-TIME best of this exercise and kind (records.previousBest, the one
   rule the guided counter and the Records page use) - not the challenge's own
   best since it started, which is a different, smaller question. `before` is the
   history as it stood BEFORE this go was saved, so the go cannot beat itself.
   The kind comes from the goal's metric, and an exercise that cannot claim it
   (records.claimableKinds) claims nothing, exactly as everywhere else. */
function recordFor(ctx, goal, sets, before) {
  const exercise = goal.fm.exercise;
  const kind = ch.kindOf(goal) === 'seconds' ? 'seconds' : 'reps';
  const lib = ((ctx.data && ctx.data.exercises) || []).find(e => e.name && String(e.name).trim().toLowerCase() === String(exercise).trim().toLowerCase());
  if (lib && !records.claimableKinds(lib).includes(kind)) return [];
  const val = ch.bestSet(sets);
  const prev = records.previousBest(before, exercise, kind);
  if (!records.isRecord(prev, val)) return [];
  return [{ key: `${exercise}/${kind}`, exercise, kind, val, prev }];
}

/* Resolves true once the note exists, false if nothing was written. */
async function saveRun(ctx, goal, sets, mode, startedAt) {
  const rows = ch.challengeRows(goal.fm.exercise, sets, mode, ch.kindOf(goal));
  if (!rows.length) return false;
  const date = todayISO();
  const duration_min = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  /* The history BEFORE the save: the save (or the reload it triggers) can put
     this go into ctx.data.workouts, and a go does not beat its own figure. */
  const before = ((ctx.data && ctx.data.workouts) || []).slice();
  let path;
  try {
    path = await ctx.io.saveWorkout({ date, plan: '', day: challengeDay(goal.name), duration_min, rows, kind: 'challenge' });
  } catch (e) {
    ctx.notice(`could not save the challenge (${e.message || e})`);
    return false;
  }
  /* Per-set XP and the PB bonus, but not the +100 for a session (the draft says
     `kind: challenge`) - and not while a guided session is open:
     rewards-flow reads THAT session's records, and they would be paid against
     this note and again when the session finishes. */
  let award = null;
  if (!(ctx.state && ctx.state.session)) {
    const draft = { date, startedAt, kind: 'challenge', records: recordFor(ctx, goal, sets, before) };
    award = await rewardsFlow.awardWithin(ctx, draft, rows, path, rewardsFlow.flow.AWARD_WAIT_MS);
  }
  ctx.notice(award && award.xp ? `Challenge logged. +${award.xp} XP` : 'Challenge logged.');
  ctx.reload();
  return true;
}

/* The quick way in: pick a popular exercise, say how far you want to go,
   and the goal note is written with the challenge switched on. The full goal
   form (Edit) still holds every other field. */
function openNewChallenge(ctx) {
  /* Popular bodyweight moves first, then every other bodyweight rep or hold
     exercise — a loaded lift is not a max-reps challenge. */
  const all = ch.challengeChoices(ctx.data.exercises);
  if (!all.length) { ctx.notice('add an exercise first — a challenge needs something to count.'); return; }
  const byName = new Map(all.map(p => [p.name, p]));
  new FormModal(ctx.app, {
    title: 'New weekly challenge',
    fields: [
      { key: 'exercise', label: 'Exercise', kind: 'dropdown', options: all.map(p => [p.name, p.kind === 'seconds' ? `${p.name} (hold)` : p.name]), value: all[0].name },
      { key: 'target', label: 'Goal', kind: 'number', value: '', desc: 'Where you want to end up: reps in one unbroken set, or seconds in one hold (marked "hold"). Week one is a test, so start anywhere.' },
    ],
    submitLabel: 'Start challenge',
    validate: v => {
      const t = parseFloat(v.target);
      /* The goal is saved rounded (below), so what must clear zero is the
         ROUNDED figure: 0.4 is above zero but would make "0 Push-ups challenge". */
      return Number.isFinite(t) && Math.round(t) >= 1 ? null : 'Set a goal of at least 1.';
    },
    onSubmit: async v => {
      const p = byName.get(v.exercise) || all[0];
      const target = Math.round(parseFloat(v.target));
      const name = ch.challengeName(p.name, target, p.kind);
      const fm = { metric: p.metric, exercise: p.name, target, direction: 'increase', challenge: 'weekly', started: todayISO() };
      const created = await ctx.io.createGoal({ name, fm, note: 'Beat your best every week until you reach the goal.' });
      if (!created) { ctx.notice('a challenge with that name already exists.'); return; }
      ctx.reload();
      /* The button says "Start challenge", so it starts it: straight into
         the test week rather than back to a list. */
      openChallenge(ctx, { name, fm });
    },
  }).open();
}

module.exports = { openChallenge, openNewChallenge, saveRun, challengeDay, statusFor };
