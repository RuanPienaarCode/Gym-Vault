'use strict';
/* Weekly set challenge — "beat your best unbroken set every week until you
   hit the goal". Pure: no DOM, no obsidian import, so every rule below is
   unit-tested (tests/challenge.test.cjs).

   A challenge is NOT a new kind of note. It is a goal measured by "best reps
   in a set" with `challenge: weekly` in its frontmatter, so the Goals page,
   Records and History all keep reading the same rows, and the challenge's
   all-time best can never disagree with the goal card beside it (both go
   through stats.exerciseBests' row walk and stats.sameName).

   THE SCORE IS THE BEST UNBROKEN SET. Never a session total: a Sets day of
   30/20/20/10/10/10 is good training and scores 30. Totals are kept for the
   summary only.

   Holds work the same way: a "best hold" goal (a plank, a wall sit) with
   `challenge: weekly` scores the longest unbroken hold in seconds.

   Frontmatter it reads (all optional except the goal's own fields):
     challenge: weekly          — what makes a goal a challenge
     started: YYYY-MM-DD        — sets before this do not count
     split: 30,20,20,10,10,10   — the Sets-mode shape, as parts of the target
     rest_limit_s: 5            — a pause longer than this ends the set */

const { startOfWeek, daysBetween } = require('./dates');
const { num, sameName, workoutDate } = require('./stats');

const DEFAULT_SHAPE = Object.freeze([30, 20, 20, 10, 10, 10]);
const DEFAULT_REST_S = 5;

/* The two scores a challenge can keep: reps in one unbroken set, or seconds
   in one unbroken hold (a plank, a wall sit). The goal's metric decides. */
const KIND_OF_METRIC = { 'exercise-reps': 'reps', 'exercise-duration': 'seconds' };

function kindOf(goal) {
  const fm = (goal && goal.fm) || {};
  return KIND_OF_METRIC[fm.metric] || null;
}

function isChallenge(goal) {
  const fm = goal && goal.fm;
  if (!fm || fm.challenge !== 'weekly') return false;
  return !!kindOf(goal) && !!String(fm.exercise || '').trim();
}

/* The goal metric an exercise's challenge is measured by — its own unit
   decides, the same unit stats.claimableKinds reads. A run has none. */
function metricFor(exercise) {
  const unit = exercise && exercise.fm ? exercise.fm.unit : null;
  if (unit === 'km') return null;
  return unit === 'seconds' ? 'exercise-duration' : 'exercise-reps';
}

/* The quick picker's list: popular bodyweight challenges, in this order,
   offered only when the vault actually has the exercise (matched by the
   same name rule as everything else). */
const POPULAR = [
  'Push-ups', 'Sit-Up', 'Sit-ups', 'Bodyweight Squat', 'Squats', 'Jump Squat', 'Burpees',
  'Pull-ups', 'Tricep Dips', 'Forward Lunges', 'Mountain Climbers', 'Jumping Jacks',
  'Plank', 'Side Plank', 'Wall Sit', 'Dead Hang',
];

function popularChallenges(exercises) {
  const out = [];
  for (const want of POPULAR) {
    const ex = (exercises || []).find(e => sameName(e.name, want));
    const metric = ex && metricFor(ex);
    if (!metric || out.some(o => sameName(o.name, ex.name))) continue;
    out.push({ name: ex.name, metric, kind: KIND_OF_METRIC[metric] });
  }
  return out;
}

/* The new-challenge picker's whole list: the popular ones first, then every
   other rep or hold exercise A to Z — but only bodyweight ones. A loaded
   lift is not a max-reps challenge (the count depends on the weight). An
   exercise whose `equipment` names bodyweight (alone or beside a mat), says
   none, or says nothing counts as bodyweight. */
function isBodyweight(exercise) {
  const eq = exercise && exercise.fm ? exercise.fm.equipment : null;
  const parts = (Array.isArray(eq) ? eq : String(eq == null ? '' : eq).split(','))
    .map(x => String(x == null ? '' : x).trim().toLowerCase()).filter(Boolean);
  return !parts.length || parts.includes('bodyweight') || parts.includes('none');
}

function challengeChoices(exercises) {
  const usable = (exercises || []).filter(e => isBodyweight(e) && metricFor(e));
  const picks = popularChallenges(usable);
  const rest = usable
    .filter(e => !picks.some(p => sameName(p.name, e.name)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(e => ({ name: e.name, metric: metricFor(e), kind: KIND_OF_METRIC[metricFor(e)] }));
  return [...picks, ...rest];
}

/* A hold has no reps to punch: the timer lands a beat every ten seconds and
   a bigger one on each whole minute — the cadence a rep count gets from
   every fifth rep (rep-counter-shared.punch). */
function holdBeat(secs) {
  if (!(secs > 0) || secs % 10 !== 0) return null;
  return secs % 60 === 0 ? 'big' : 'beat';
}

/* Score formatting for both kinds: "18" reps, "45s" or "3:00" held. */
function fmtScore(n, kind) {
  if (kind !== 'seconds') return String(n);
  const s = Math.round(n);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* The goal's name, which is also its file name — so no "3:00": a colon is
   not allowed in a file name on every platform. */
function challengeName(exercise, target, kind) {
  const n = Math.round(target);
  const score = kind !== 'seconds' ? String(n) : n >= 60 && n % 60 === 0 ? `${n / 60}-minute` : `${n}s`;
  return `${score} ${exercise} challenge`;
}

/* "30,20,20,10,10,10" or [30, 20, ...]. Junk parts are dropped rather than
   read as zero; nothing usable at all falls back to the default. */
function parseShape(value) {
  const parts = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const shape = parts.map(num).filter(n => n !== null && n > 0);
  return shape.length ? shape : DEFAULT_SHAPE.slice();
}

function restSeconds(fm) {
  const n = num(fm && fm.rest_limit_s);
  return n !== null && n > 0 ? n : DEFAULT_REST_S;
}

/* Split a rep target into whole sets in the shape's proportions, adding to
   exactly the target. Largest remainder decides who gets the leftover reps;
   a tie goes to the earlier (normally bigger) set. Sets that would be empty
   are dropped — a target of 3 is three sets of one, not 1,1,1,0,0,0. */
function splitSets(target, shape) {
  const n = Math.round(num(target) ?? 0);
  if (!(n >= 1)) return [];
  const parts = parseShape(shape);
  const sum = parts.reduce((a, b) => a + b, 0);
  const exact = parts.map(p => (n * p) / sum);
  const sets = exact.map(Math.floor);
  /* Rounded so float dust (0.30000000000000004 vs 0.3) cannot break a tie. */
  const rem = exact.map((x, i) => ({ i, r: Math.round((x - sets[i]) * 1e9) }));
  rem.sort((a, b) => b.r - a.r || a.i - b.i);
  let left = n - sets.reduce((a, b) => a + b, 0);
  for (let k = 0; left > 0; k = (k + 1) % rem.length, left--) sets[rem[k].i]++;
  return sets.filter(s => s > 0);
}

/* Last attempted week's best + 10% (rounded up, at least one more), never
   above the goal. null before there is anything to beat: week one is a test.
   Integer maths — 20 * 1.1 is 22.000000000000004, which would ceil to 23. */
function nextTarget(lastBest, goal) {
  if (lastBest === null || lastBest === undefined) return null;
  const g = num(goal);
  const grown = Math.max(lastBest + 1, Math.ceil((lastBest * 11) / 10));
  return g !== null ? Math.min(g, grown) : grown;
}

/* One entry per week that has at least one logged set of `exercise`, oldest
   first: { week (its first day), best (biggest single set), total, sets }.
   Undated workouts have no week and are skipped; with `since`, so is
   anything before it. */
function weeklyBests(workouts, exercise, opts) {
  const { weekStart, since } = opts || {};
  /* Reps OR seconds, never either: a timed circuit leaves its clock in
     `seconds` on a rep exercise, and that is not a hold. */
  const field = opts && opts.kind === 'seconds' ? 'seconds' : 'reps';
  const byWeek = new Map();
  for (const w of workouts || []) {
    const date = workoutDate(w);
    if (!date || (since && date < since)) continue;
    for (const r of w.rows || []) {
      if (!sameName(r.exercise, exercise)) continue;
      const reps = num(r[field]);
      if (reps === null || reps <= 0) continue;
      const week = startOfWeek(date, weekStart);
      const e = byWeek.get(week) || { week, best: 0, total: 0, sets: 0 };
      e.best = Math.max(e.best, reps);
      e.total += reps;
      e.sets++;
      byWeek.set(week, e);
    }
  }
  return [...byWeek.values()].sort((a, b) => (a.week < b.week ? -1 : 1));
}

/* Where the challenge stands today. */
function challengeStatus(goal, workouts, opts) {
  const fm = (goal && goal.fm) || {};
  const { weekStart, today } = opts || {};
  const kind = kindOf(goal) || 'reps';
  const weeks = weeklyBests(workouts, fm.exercise, { weekStart, since: fm.started || null, kind });
  const current = startOfWeek(today, weekStart);
  const thisWeek = weeks.find(x => x.week === current) || null;
  const before = weeks.filter(x => x.week < current);
  const lastWeek = before.length ? before[before.length - 1] : null;
  const goalN = num(fm.target);
  const target = nextTarget(lastWeek ? lastWeek.best : null, goalN);
  const best = weeks.reduce((m, x) => Math.max(m, x.best), 0) || null;
  const weekBest = thisWeek ? thisWeek.best : 0;
  const started = fm.started ? startOfWeek(fm.started, weekStart) : null;
  return {
    weekNo: started ? Math.floor(daysBetween(started, current) / 7) + 1 : null,
    exercise: fm.exercise,
    kind,
    goal: goalN,
    weeks,
    thisWeek,
    lastWeek,
    target,
    testWeek: target === null,
    beaten: target !== null && weekBest >= target,
    toGo: target === null ? null : Math.max(0, target - weekBest),
    best,
    done: best !== null && goalN !== null && best >= goalN,
  };
}

/* ---- the live run ----------------------------------------------------
   A count where a rest longer than restMs ends the set. Both screens use it:
   in Max mode it turns one long effort into honest unbroken sets; in Sets
   mode it is what moves you from one set to the next. Every function returns
   a NEW run and never mutates its input. */

function createRun(restMs) {
  return { sets: [], current: 0, lastRepAt: null, restMs };
}

function addRep(run, now) {
  const rested = run.lastRepAt !== null && now - run.lastRepAt > run.restMs;
  if (run.current > 0 && rested) {
    return { run: { ...run, sets: [...run.sets, run.current], current: 1, lastRepAt: now }, split: true };
  }
  /* current 0 with sets behind it: closeIfRested already ended the last set,
     so this rep opens the next one. */
  const split = run.current === 0 && run.sets.length > 0;
  return { run: { ...run, current: run.current + 1, lastRepAt: now }, split };
}

/* Close the open set the moment the rest runs out, so the screen can say
   "set over" without waiting for the next rep. */
function closeIfRested(run, now) {
  if (run.current === 0 || run.lastRepAt === null || now - run.lastRepAt <= run.restMs) return { run, closed: null };
  return { run: { ...run, sets: [...run.sets, run.current], current: 0 }, closed: run.current };
}

/* Takes back the last rep. lastRepAt is left alone: an undo is not a rep and
   must not restart the rest clock. */
function undoRep(run) {
  if (run.current > 0) return { ...run, current: run.current - 1 };
  if (!run.sets.length) return run;
  const sets = run.sets.slice(0, -1);
  return { ...run, sets, current: run.sets[run.sets.length - 1] - 1 };
}

function runSets(run) {
  return run.current > 0 ? [...run.sets, run.current] : run.sets.slice();
}

function restingFor(run, now) {
  return run.lastRepAt === null ? null : now - run.lastRepAt;
}

function bestSet(sets) {
  return (sets || []).reduce((m, s) => Math.max(m, s), 0);
}

/* The workout rows a finished run saves: one row per unbroken set, so the
   Goals card, Records and the next week's target all read the best set back
   as the best set. Unused columns stay empty, never 0. The mode is noted on
   the first row so History shows how the day was done. */
function challengeRows(exercise, sets, mode, kind) {
  const held = kind === 'seconds';
  return (sets || []).filter(n => n > 0).map((n, i) => ({
    exercise,
    set: String(i + 1),
    reps: held ? '' : String(n),
    weight_kg: '',
    seconds: held ? String(n) : '',
    note: i === 0 ? `Challenge · ${mode}` : '',
    distance_km: '',
  }));
}

module.exports = {
  DEFAULT_SHAPE, DEFAULT_REST_S,
  isChallenge, kindOf, metricFor, popularChallenges, challengeChoices, holdBeat, fmtScore, challengeName, parseShape, restSeconds, splitSets, nextTarget, weeklyBests, challengeStatus,
  createRun, addRep, closeIfRested, undoRep, runSets, restingFor, bestSet, challengeRows,
};
