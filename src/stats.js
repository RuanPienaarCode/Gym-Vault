'use strict';
/* Derived figures. Pure — no DOM, no obsidian import.

   Budget-plugin lesson, carried over on purpose: "two figures derived by
   different rules" is the recurring bug shape. Every number the UI shows —
   streaks, weekly counts, bests, goal progress — is computed HERE and only
   here, so the dashboard and the goals page can never disagree. */

const { startOfWeek, addDays, todayISO } = require('./dates');

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/* ---- session-level --------------------------------------------------- */

/* Unique workout dates, ascending. Sessions carry their date in frontmatter;
   rows without one are ignored rather than guessed. */
function workoutDates(workouts) {
  const set = new Set();
  for (const w of workouts) if (w.fm && w.fm.date) set.add(w.fm.date);
  return [...set].sort();
}

function countInWeek(dates, refIso, weekStart) {
  const start = startOfWeek(refIso, weekStart);
  const end = addDays(start, 7);
  return dates.filter(d => d >= start && d < end).length;
}

/* Consecutive weeks with at least one session, counting back from the
   current week. The current week counts when it has a session; an empty
   current week doesn't break the streak (the week isn't over yet) — the
   count then starts from last week. */
function weekStreak(dates, weekStart, today) {
  const ref = today || todayISO();
  let start = startOfWeek(ref, weekStart);
  let streak = 0;
  const inWeek = s => dates.some(d => d >= s && d < addDays(s, 7));
  if (inWeek(start)) streak++;
  start = addDays(start, -7);
  while (inWeek(start)) { streak++; start = addDays(start, -7); }
  return streak;
}

/* ---- exercise-level bests -------------------------------------------- */

const sameName = (a, b) => (a || '').trim().toLowerCase() === (b || '').trim().toLowerCase();

/* Scan every logged set of `exercise` for maxima. Returns nulls when the
   exercise was never logged — "no data" and "zero" must stay distinct. */
function exerciseBests(workouts, exercise) {
  let reps = null, weight = null, seconds = null, lastDate = null;
  for (const w of workouts) {
    for (const r of w.rows || []) {
      if (!sameName(r.exercise, exercise)) continue;
      const rp = num(r.reps), wt = num(r.weight_kg), sc = num(r.seconds);
      if (rp !== null && (reps === null || rp > reps)) reps = rp;
      if (wt !== null && (weight === null || wt > weight)) weight = wt;
      if (sc !== null && (seconds === null || sc > seconds)) seconds = sc;
      if (w.fm && w.fm.date && (!lastDate || w.fm.date > lastDate)) lastDate = w.fm.date;
    }
  }
  return { reps, weight, seconds, lastDate };
}

/* Estimated one-rep max (Epley). Only meaningful for weighted reps. */
function epley1RM(weight, reps) {
  if (!weight || !reps) return null;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

function sessionVolume(rows) {
  let v = 0;
  for (const r of rows || []) {
    const rp = num(r.reps), wt = num(r.weight_kg);
    if (rp !== null && wt !== null) v += rp * wt;
  }
  return Math.round(v);
}

function sessionSets(rows) { return (rows || []).length; }

/* ---- goals ----------------------------------------------------------- */

/* The single source for "where is this goal now". `ctx` carries everything
   any metric could need so callers can't feed two goals different data. */
function goalCurrent(goal, ctx) {
  const fm = goal.fm || {};
  switch (fm.metric) {
    case 'exercise-reps':     return exerciseBests(ctx.workouts, fm.exercise).reps;
    case 'exercise-duration': return exerciseBests(ctx.workouts, fm.exercise).seconds;
    case 'exercise-weight':   return exerciseBests(ctx.workouts, fm.exercise).weight;
    case 'body-weight': {
      const rows = (ctx.body || []).filter(r => num(r.weight_kg) !== null);
      return rows.length ? num(rows[rows.length - 1].weight_kg) : null;
    }
    case 'workouts-per-week':
      return countInWeek(workoutDates(ctx.workouts), ctx.today || todayISO(), ctx.weekStart);
    default: return null;
  }
}

/* 0..1 progress. Uses start_value as the baseline when present (so a cut
   from 90kg toward 80kg shows honest movement); without one, an increase
   goal measures from zero and a decrease goal can only be done-or-not. */
function goalProgress(goal, current) {
  const fm = goal.fm || {};
  const target = num(fm.target);
  if (target === null || current === null) return null;
  const start = num(fm.start_value);
  const decrease = fm.direction === 'decrease';
  if (decrease) {
    if (start === null || start <= target) return current <= target ? 1 : 0;
    return clamp01((start - current) / (start - target));
  }
  const base = start !== null && start < target ? start : 0;
  return clamp01((current - base) / (target - base));
}

const clamp01 = x => Math.max(0, Math.min(1, x));

/* ---- body log -------------------------------------------------------- */

/* [{date, value}] ascending, for the weight sparkline. */
function weightSeries(bodyRows) {
  return (bodyRows || [])
    .map(r => ({ date: r.date, value: num(r.weight_kg) }))
    .filter(p => p.date && p.value !== null)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

function bmi(weightKg, heightCm) {
  const w = num(weightKg), h = num(heightCm);
  if (!w || !h) return null;
  return Math.round((w / ((h / 100) ** 2)) * 10) / 10;
}

module.exports = {
  num, workoutDates, countInWeek, weekStreak, exerciseBests, epley1RM,
  sessionVolume, sessionSets, goalCurrent, goalProgress, weightSeries, bmi,
};
