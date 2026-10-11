'use strict';
/* Shared synthetic fixtures for the rewards tests. Not a test itself (no
   .test.cjs suffix, so scripts/run-tests.mjs skips it). Everything here is
   generic: no real names, paths or figures. */

const ex = (name, unit) => ({ name, fm: unit ? { unit } : {} });

const EXERCISES = [
  ex('Pull-ups', 'reps'), ex('Push-ups', 'reps'), ex('Bench Press', 'kg'), ex('Squat', 'kg'),
  ex('Plank', 'seconds'), ex('Easy Run', 'km'),
];

/* A saved row, exactly the shape tableToObjects gives: every figure a string. */
const row = (exercise, o = {}) => ({
  exercise, set: String(o.set || 1),
  reps: o.reps == null ? '' : String(o.reps),
  weight_kg: o.kg == null ? '' : String(o.kg),
  seconds: o.sec == null ? '' : String(o.sec),
  note: '',
  distance_km: o.km == null ? '' : String(o.km),
});

const wk = (date, rows, name) => ({
  name: name || date, fm: { date }, rows: rows || [],
  file: { path: `Gym/Workouts/${name || date}.md` },
});

/* n identical rows. */
const sets = (exercise, n, o) => Array.from({ length: n }, (_, i) => row(exercise, { ...o, set: i + 1 }));

/* A plan day as plan-parse builds it: items [exercise, sets, target]. */
const day = (name, items) => ({
  name, weekday: 'mon', notes: [], parts: [],
  items: items.map(([exercise, n, target]) => ({ exercise, sets: n, target })),
});

/* ctx.daysOn: weekday key -> [{plan, day}]. */
const daysOnFrom = (schedule, planFm) => weekday =>
  (schedule[weekday] || []).map(d => ({ plan: { name: 'Plan', fm: planFm || {} }, day: d }));

module.exports = { ex, EXERCISES, row, wk, sets, day, daysOnFrom };
