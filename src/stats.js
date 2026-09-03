'use strict';
/* Derived figures. Pure — no DOM, no obsidian import.

   Budget-plugin lesson, carried over on purpose: "two figures derived by
   different rules" is the recurring bug shape. Every number the UI shows —
   streaks, weekly counts, bests, goal progress — is computed HERE and only
   here, so the dashboard and the goals page can never disagree. */

const { startOfWeek, addDays, todayISO, fromISO, toISO, daysBetween } = require('./dates');

const num = v => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

/* ---- session-level --------------------------------------------------- */

/* Unique workout dates, ascending, normalized to plain YYYY-MM-DD — a
   hand-edited `date: 2026-08-26T09:00` must count the same everywhere
   (equality checks AND range compares), not split between them. Sessions
   without a parseable date are ignored rather than guessed. */
/* THE one rule for "the date of this workout": canonical YYYY-MM-DD, or
   null when it cannot be parsed. Every consumer — the dashboard, the history
   page, the export's range filter — must route through this. The export used
   to do its own `.slice(0, 10)` instead, so the same three files counted as
   one session on the dashboard and three in the export, and its `d >= from`
   range compare was a lexical test on unnormalised strings. */
function workoutDate(w) {
  const d = w && w.fm && w.fm.date ? fromISO(w.fm.date) : null;
  return d ? toISO(d) : null;
}

function workoutDates(workouts) {
  const set = new Set();
  for (const w of workouts) {
    const d = workoutDate(w);
    if (d) set.add(d);
  }
  return [...set].sort();
}


/* The one rule for "does this logged set count": ticked done, OR the USER
   edited it and it holds a figure. `touched` (set by the log page's input
   listeners) is what separates a typed value from a plan-target prefill —
   without it, tapping Finish on an untouched session would log every
   exercise as performed exactly to target. Used by BOTH the live tally and
   finishSession — two copies of this rule is how they drift apart. */
function setCounts(set) {
  const hasFigure = !!(String(set.reps ?? '').trim() ||
    String(set.weight_kg ?? '').trim() ||
    String(set.seconds ?? '').trim() ||
    String(set.distance_km ?? '').trim() ||
    String(set.minutes ?? '').trim());
  return !!(set.done || (set.touched && hasFigure));
}

/* HOW MANY SESSIONS — the one rule, for every surface that prints the word.

   Three screens counted three different things and all three said
   "sessions": Today counted UNIQUE DATES, History counted dated FILES, and
   Export counted files. Log a lift and then a run on the same day — which
   this app treats as first-class, "Log another session" is a button — and
   Today said 1 while History listed 2.

   A session is a logged workout note. Two on one day are two. An undated
   note is still one — it is a session someone recorded and History already
   shows it on screen; leaving it out of the count made the number disagree
   with the cards underneath it. Undated notes stay out of the STREAK and the
   heatmap, which genuinely need a date, and workoutDates() still answers
   that separate question. */
function sessionCount(workouts) {
  return (workouts || []).length;
}

/* The same rule, inside one week. Undated notes belong to no week, so they
   are absent here — the week tile is a dated question. */
function sessionsInWeek(workouts, refIso, weekStart) {
  const start = startOfWeek(refIso, weekStart);
  const end = addDays(start, 7);
  return (workouts || []).filter(w => {
    const d = workoutDate(w);
    return d && d >= start && d < end;
  }).length;
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
  let reps = null, weight = null, seconds = null, distance = null, lastDate = null;
  let totalDistance = 0;
  for (const w of workouts) {
    for (const r of w.rows || []) {
      if (!sameName(r.exercise, exercise)) continue;
      const rp = num(r.reps), wt = num(r.weight_kg), sc = num(r.seconds), di = num(r.distance_km);
      if (rp !== null && (reps === null || rp > reps)) reps = rp;
      if (wt !== null && (weight === null || wt > weight)) weight = wt;
      if (sc !== null && (seconds === null || sc > seconds)) seconds = sc;
      if (di !== null && (distance === null || di > distance)) distance = di;
      if (di !== null) totalDistance += di;
      if (w.fm && w.fm.date && (!lastDate || w.fm.date > lastDate)) lastDate = w.fm.date;
    }
  }
  /* totalDistance stays 0-vs-null honest: null distance means never run. */
  return { reps, weight, seconds, distance, totalDistance: Math.round(totalDistance * 10) / 10, lastDate };
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

/* Total km logged inside the week containing refIso. Sums EVERY distance
   row, whatever the exercise — a week's running volume is a week's running
   volume. */
function distanceInWeek(workouts, refIso, weekStart) {
  const start = startOfWeek(refIso || todayISO(), weekStart);
  const end = addDays(start, 7);
  let km = 0;
  for (const w of workouts) {
    const d = w.fm && w.fm.date ? fromISO(w.fm.date) : null;
    if (!d) continue;
    const iso = toISO(d);
    if (iso < start || iso >= end) continue;
    for (const r of w.rows || []) { const di = num(r.distance_km); if (di !== null) km += di; }
  }
  return Math.round(km * 10) / 10;
}

/* Which week of a training ladder `today` falls in: 1-based, null before the
   start date, clamped to the last rung once the plan is finished. */
function ladderWeek(startDate, today, weeks) {
  const start = fromISO(startDate), now = fromISO(today || todayISO());
  if (!start || !now || !weeks) return null;
  /* Whole days must come from ONE rule. Raw millisecond arithmetic on
     local-midnight Dates loses an hour across a spring-forward DST
     transition, and Math.floor turns that into a missing day — so on exactly
     the day the ladder should step up a rung it still showed the old one.
     dates.daysBetween already rounds correctly; use it. */
  const days = daysBetween(startDate, today || todayISO());
  if (days == null || days < 0) return null;
  return Math.min(weeks, Math.floor(days / 7) + 1);
}

/* ---- goals ----------------------------------------------------------- */

/* The single source for "where is this goal now". `ctx` carries everything
   any metric could need so callers can't feed two goals different data. */
function goalCurrent(goal, ctx) {
  const fm = goal.fm || {};
  switch (fm.metric) {
    case 'exercise-reps':     return exerciseBests(ctx.workouts, fm.exercise).reps;
    case 'exercise-duration': return exerciseBests(ctx.workouts, fm.exercise).seconds;
    case 'exercise-weight':   return exerciseBests(ctx.workouts, fm.exercise).weight;
    case 'exercise-distance': return exerciseBests(ctx.workouts, fm.exercise).distance;
    case 'body-weight': {
      const rows = (ctx.body || []).filter(r => num(r.weight_kg) !== null);
      return rows.length ? num(rows[rows.length - 1].weight_kg) : null;
    }
    case 'workouts-per-week':
      /* Sessions, not training days — the same rule the tile beside it uses.
         A goal of "4 a week" met by two doubles and no third day was
         reported as 2 while History listed 4. */
      return sessionsInWeek(ctx.workouts, ctx.today || todayISO(), ctx.weekStart);
    default: return null;
  }
}

/* Why is this goal showing nothing?

   "No data yet" and "this goal points at an exercise that doesn't exist"
   produced the identical empty card, and the goals page rendered "log a
   workout to start tracking" for both — blaming the user for a typo. A
   hand-written `exercise: pull ups` against a file named `Pull-ups.md` never
   matched and never said so. Returns a reason to show, or null when the goal
   is genuinely just waiting for data. `ctx.exerciseNames` is optional: without
   it the name check is skipped rather than guessed at. */
function goalIssue(goal, ctx) {
  const fm = (goal && goal.fm) || {};
  if (!fm.metric) return 'this goal has no metric set';
  if (/^exercise-/.test(fm.metric)) {
    if (!fm.exercise) return 'this goal has no exercise set';
    const names = (ctx && ctx.exerciseNames) || null;
    if (names && !names.some(n => sameName(n, fm.exercise))) return `no exercise named "${fm.exercise}"`;
  }
  return null;
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
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function bmi(weightKg, heightCm) {
  const w = num(weightKg), h = num(heightCm);
  if (!w || !h) return null;
  return Math.round((w / ((h / 100) ** 2)) * 10) / 10;
}

module.exports = {
  num, workoutDates, workoutDate, sameName, countInWeek, sessionCount, sessionsInWeek, weekStreak, exerciseBests, epley1RM,
  sessionVolume, sessionSets, setCounts, distanceInWeek, ladderWeek,
  goalCurrent, goalIssue, goalProgress, weightSeries, bmi,
};
