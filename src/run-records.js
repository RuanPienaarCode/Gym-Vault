'use strict';
/* Running records — every figure the Running records page shows.

   Pure: no DOM, no obsidian import, no timers.

   WHY RUNS GET THEIR OWN MODULE AND PAGE. records.js is built around a
   single number that goes UP — more reps, more kilos, a longer hold — and
   the Records page reads exactly that. A run is not one number. The same
   run is "8 km", "51 minutes" and "6:22 a kilometre", and the interesting
   record is often the pace, which is a number that goes DOWN, derived from
   two figures that must come from the SAME row. Folding that into the
   strength page would either flatten a run to its distance (and lose the
   pace) or teach the strength page about a second kind of record. Both were
   worse than a page of its own.

   THE ONE-RULE DISCIPLINE, carried over from stats.js: the longest run per
   exercise is stats.exerciseBests(...).distance, the week total is
   stats.distanceInWeek, the date of a workout is stats.workoutDate. Nothing
   here re-derives a figure another module already owns; the guard suite
   asserts the overall longest equals the max of those per-exercise bests.
   A pace is ALWAYS one run's own seconds over its own kilometres — never a
   best time over a best distance, which can be two different runs. */

const { exerciseBests, workoutDate, distanceInWeek, num, sameName } = require('./stats');
const { startOfWeek } = require('./dates');

/* A pace needs a real distance under it. A 300 m stride at 3:00/km is a
   true figure and a meaningless record; one kilometre is where "how fast
   do I run" starts to mean something. */
const MIN_PACE_KM = 1;

/* The distances a pace is worth tracking at. "Best pace over any run of at
   least 5 km" is honest in a way "your fastest 5 km" from a 7 km run is not:
   nobody timed a 5 km split, so nothing here claims one. */
const PACE_BANDS = [5, 10, 15, 21.1];

const isRunExercise = ex => !!ex && !!ex.fm && (ex.fm.unit || '') === 'km';

/* Every logged run, one per row with a distance, in date order (undated
   rows last — same rule as records.inDateOrder: a run that cannot be placed
   in the story can only ADD a record, never retroactively invalidate one). */
function runRows(workouts) {
  const out = [];
  for (const w of workouts || []) {
    const date = workoutDate(w);
    for (const r of w.rows || []) {
      const km = num(r.distance_km);
      if (km === null || km <= 0) continue;
      const seconds = num(r.seconds);
      out.push({
        date,
        exercise: String(r.exercise || '').trim(),
        km,
        seconds: seconds !== null && seconds > 0 ? seconds : null,
        workout: w.name || '',
      });
    }
  }
  return out.sort((a, b) => {
    const ad = a.date || '9999-99-99', bd = b.date || '9999-99-99';
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });
}

/* Seconds per kilometre for ONE run, or null when either figure is missing. */
function paceOf(run) {
  if (!run || !run.seconds || !run.km) return null;
  return run.seconds / run.km;
}

/* "5:12 /km". Rounded to the second, which is as fine as a hand-typed
   minutes box can honestly support. */
function fmtPace(secPerKm) {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '—';
  const s = Math.round(secPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} /km`;
}

/* The run with the best (lowest) pace among runs of at least `minKm` that
   carry a time. Strictly better wins, so on a tie the EARLIER run keeps the
   record — matching records.isRecord, where a tie beats nothing. */
function fastestPace(runs, minKm) {
  const floor = minKm == null ? MIN_PACE_KM : minKm;
  let best = null;
  for (const r of runs || []) {
    if (r.km < floor) continue;
    const p = paceOf(r);
    if (p === null) continue;
    if (best === null || p < paceOf(best)) best = r;
  }
  return best;
}

/* The longest run. Strictly greater, earliest keeps — same tie rule. */
function longestRun(runs) {
  let best = null;
  for (const r of runs || []) if (best === null || r.km > best.km) best = r;
  return best;
}

/* The most time on feet in one run. */
function longestTime(runs) {
  let best = null;
  for (const r of runs || []) {
    if (r.seconds === null) continue;
    if (best === null || r.seconds > best.seconds) best = r;
  }
  return best;
}

/* The biggest week, measured by stats.distanceInWeek — the same figure the
   Running page's "this week" tile shows, so the record can never be a
   number that tile could not have displayed. Undated runs belong to no
   week and are skipped here. */
function biggestWeek(workouts, weekStart) {
  const seen = new Set();
  let best = null;
  for (const r of runRows(workouts)) {
    if (!r.date) continue;
    const start = startOfWeek(r.date, weekStart);
    if (seen.has(start)) continue;
    seen.add(start);
    const km = distanceInWeek(workouts, r.date, weekStart);
    if (best === null || km > best.km) best = { weekStart: start, km };
  }
  return best;
}

/* Every time the longest run moved, oldest first: [{km, prev, date,
   exercise}]. The first entry is the baseline (prev null), not a record.
   The last entry's km is, by construction, longestRun(runs).km — the guard
   suite asserts it, because a walk and a max that disagree is exactly the
   two-rules failure this codebase keeps digging out. */
function longestTimeline(runs) {
  const out = [];
  let best = null;
  for (const r of runs || []) {
    if (best === null || r.km > best) {
      out.push({ km: r.km, prev: best, date: r.date, exercise: r.exercise, seconds: r.seconds });
      best = r.km;
    }
  }
  return out;
}

/* Per-exercise figures. `longest` and `totalKm` come from exerciseBests —
   the number the exercise detail page shows — and the pace records are
   derived here from that exercise's own rows. Includes every km-unit
   exercise in the library (so an exercise never run still shows, honestly
   empty) plus any exercise name that appears in a run row but has no note. */
function byExercise(workouts, exercises) {
  const runs = runRows(workouts);
  const names = [];
  for (const ex of exercises || []) if (isRunExercise(ex)) names.push(ex.name);
  for (const r of runs) if (r.exercise && !names.some(n => sameName(n, r.exercise))) names.push(r.exercise);
  return names.map(name => {
    const mine = runs.filter(r => sameName(r.exercise, name));
    const bests = exerciseBests(workouts, name);
    return {
      exercise: name,
      runs: mine.length,
      totalKm: bests.totalDistance,
      longest: bests.distance === null ? null : longestRun(mine),
      fastest: fastestPace(mine, MIN_PACE_KM),
      longestTime: longestTime(mine),
      lastDate: mine.length ? mine[mine.length - 1].date : null,
    };
  }).sort((a, b) => b.totalKm - a.totalKm || a.exercise.localeCompare(b.exercise));
}

/* Everything the page needs, in one call. */
function runRecords(workouts, exercises, weekStart) {
  const runs = runRows(workouts);
  const totalKm = Math.round(runs.reduce((n, r) => n + r.km, 0) * 10) / 10;
  return {
    runs: runs.length,
    totalKm,
    longest: longestRun(runs),
    fastest: fastestPace(runs, MIN_PACE_KM),
    longestTime: longestTime(runs),
    bands: PACE_BANDS.map(km => ({ km, best: fastestPace(runs, km) })),
    biggestWeek: biggestWeek(workouts, weekStart),
    timeline: longestTimeline(runs),
    exercises: byExercise(workouts, exercises),
    firstDate: runs.length ? runs[0].date : null,
  };
}

module.exports = {
  MIN_PACE_KM, PACE_BANDS, isRunExercise,
  runRows, paceOf, fmtPace, fastestPace, longestRun, longestTime, biggestWeek, longestTimeline, byExercise, runRecords,
};
