'use strict';
/* Opening a weekly challenge and saving what it counted. The rules live in
   challenge.js and the screen in challenge-modal.js; this is the seam to the
   vault, kept out of both so neither needs the app context.

   A finished run is saved as an ordinary workout note (one row per unbroken
   set), so History, Records, the Goals card and next week's target all read
   it through the same rows as everything else. */

const ch = require('./challenge');
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
    accent: ctx.settings.accent,
    settings: ctx.settings,
    onSave: (sets, mode, startedAt) => saveRun(ctx, goal, sets, mode, startedAt),
  }).open();
}

/* Resolves true once the note exists, false if nothing was written. */
async function saveRun(ctx, goal, sets, mode, startedAt) {
  const rows = ch.challengeRows(goal.fm.exercise, sets, mode, ch.kindOf(goal));
  if (!rows.length) return false;
  const date = todayISO();
  const duration_min = Math.max(1, Math.round((Date.now() - startedAt) / 60000));
  let path;
  try {
    path = await ctx.io.saveWorkout({ date, plan: '', day: challengeDay(goal.name), duration_min, rows });
  } catch (e) {
    ctx.notice(`could not save the challenge (${e.message || e})`);
    return false;
  }
  /* XP the same way a logged session earns it — but not while a guided
     session is open: rewards-flow reads THAT session's records, and they
     would be paid against this note and again when the session finishes. */
  let award = null;
  if (!(ctx.state && ctx.state.session)) {
    award = await rewardsFlow.awardWithin(ctx, { date, startedAt }, rows, path, rewardsFlow.flow.AWARD_WAIT_MS);
  }
  ctx.notice(award && award.xp ? `Challenge logged. +${award.xp} XP` : 'Challenge logged.');
  ctx.reload();
  return true;
}

/* The quick way in: pick a popular exercise, say how far you want to go,
   and the goal note is written with the challenge switched on. The full goal
   form (Edit) still holds every other field. */
function openNewChallenge(ctx) {
  const picks = ch.popularChallenges(ctx.data.exercises);
  /* Every other rep or hold exercise, after the popular ones. */
  const rest = ctx.data.exercises
    .filter(e => ch.metricFor(e) && !picks.some(p => p.name === e.name))
    .map(e => ({ name: e.name, metric: ch.metricFor(e), kind: ch.metricFor(e) === 'exercise-duration' ? 'seconds' : 'reps' }));
  const all = [...picks, ...rest];
  if (!all.length) { ctx.notice('add an exercise first — a challenge needs something to count.'); return; }
  const byName = new Map(all.map(p => [p.name, p]));
  new FormModal(ctx.app, {
    title: 'New weekly challenge',
    fields: [
      { key: 'exercise', label: 'Exercise', kind: 'dropdown', options: all.map(p => [p.name, p.kind === 'seconds' ? `${p.name} (hold)` : p.name]), value: all[0].name },
      { key: 'target', label: 'Goal', kind: 'number', value: '', desc: 'Reps in one unbroken set — or seconds in one hold for a plank or wall sit.' },
    ],
    submitLabel: 'Start challenge',
    validate: v => {
      const t = parseFloat(v.target);
      return Number.isFinite(t) && t > 0 ? null : 'Set a goal above zero.';
    },
    onSubmit: async v => {
      const p = byName.get(v.exercise) || all[0];
      const target = Math.round(parseFloat(v.target));
      const name = ch.challengeName(p.name, target, p.kind);
      const fm = { metric: p.metric, exercise: p.name, target, direction: 'increase', challenge: 'weekly', started: todayISO() };
      const created = await ctx.io.createGoal({ name, fm, note: 'Beat your best every week until you reach the goal.' });
      if (!created) ctx.notice('a challenge with that name already exists.');
      ctx.reload();
    },
  }).open();
}

module.exports = { openChallenge, openNewChallenge, saveRun, challengeDay, statusFor };
