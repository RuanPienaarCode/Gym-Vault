'use strict';
/* LAST TIME AND YOUR BESTS, PER EXERCISE (issue #28) — what a lifter wants to
   see sitting down at a machine: the sets they did last time, their heaviest
   set and their most reps. Pure: no DOM, no obsidian import of its own (the
   one seconds formatter lives in dom.js). The log card and the guided live set
   both print recapLines, so the two screens cannot disagree.

   Every row comes through stats.forEachExerciseRow and every figure through
   stats.num, the same selection and parsing exerciseBests uses — so the
   heaviest set's weight IS exerciseBests' weight and the most reps IS its reps
   (tests/recap.test.cjs pins both). What this adds is the OTHER half of each
   set: exerciseBests keeps two maxima that usually come from different sets,
   and "160 kg" glued to "14 reps" would be a lift nobody did (best1RM's rule). */

const { forEachExerciseRow, num, workoutDate, sameName } = require('./stats');
const { fmtShort } = require('./dates');
const { fmtSeconds, el } = require('./dom');

/* Sets shown on the Last line before "+n": a card must not grow a paragraph. */
const LAST_MAX = 6;

/* A row with any figure in it (a blank row is not something you did). */
const hasFigure = r => ['reps', 'weight_kg', 'seconds', 'distance_km'].some(k => num(r[k]) !== null);

/* → null when never logged, else { last, best, mostReps, longest }. */
function exerciseRecap(workouts, exercise) {
  let best = null, mostReps = null, longest = null, any = false;
  /* The latest DAY wins; on the same day the later note (loadAll keeps file
     order for equal days). A note whose date cannot be read is never "last"
     — it cannot be placed — but its sets still count for the bests. */
  let lastKey = null, lastWorkout = null;
  forEachExerciseRow(workouts || [], exercise, (r, w) => {
    if (!hasFigure(r)) return;
    any = true;
    const rp = num(r.reps), wt = num(r.weight_kg), sc = num(r.seconds);
    if (wt !== null && wt > 0 && (best === null || wt > best.weight || (wt === best.weight && (rp || 0) > (best.reps || 0)))) best = { weight: wt, reps: rp };
    if (rp !== null && (mostReps === null || rp > mostReps.reps || (rp === mostReps.reps && (wt || 0) > (mostReps.weight || 0)))) mostReps = { reps: rp, weight: wt };
    if (sc !== null && (longest === null || sc > longest)) longest = sc;
    const d = workoutDate(w);
    if (d && (lastKey === null || d >= lastKey)) { lastKey = d; lastWorkout = w; }
  });
  if (!any) return null;
  const sets = lastWorkout ? (lastWorkout.rows || []).filter(r => sameName(r.exercise, exercise) && hasFigure(r)) : [];
  return { last: lastWorkout ? { date: lastKey, sets } : null, best, mostReps, longest };
}

/* One set as the log writes it: reps × weight kg, bare reps, or a time. */
function setText(reps, weight, seconds) {
  if (reps !== null && reps !== undefined) return weight ? `${reps} × ${weight} kg` : String(reps);
  if (seconds !== null && seconds !== undefined) return fmtSeconds(seconds);
  return weight ? `${weight} kg` : '';
}

const rowText = r => setText(num(r.reps), num(r.weight_kg), num(r.reps) === null ? num(r.seconds) : null);

/* → [{ label, text }]: Last, then Best and Most reps (or Longest for a timed
   exercise). A run gets none — the Running pages own distance. */
function recapLines(recap) {
  if (!recap) return [];
  const lines = [];
  const sets = recap.last ? recap.last.sets.filter(r => num(r.distance_km) === null) : [];
  if (recap.last && !sets.length && recap.last.sets.length) return []; // a run
  if (sets.length) {
    const shown = sets.slice(0, LAST_MAX).map(rowText).filter(Boolean);
    const more = sets.length > LAST_MAX ? [`+${sets.length - LAST_MAX}`] : [];
    lines.push({ label: `Last · ${fmtShort(recap.last.date)}`, text: [...shown, ...more].join(' · ') });
  }
  if (recap.best) lines.push({ label: 'Best', text: setText(recap.best.reps, recap.best.weight, null) });
  if (recap.mostReps) lines.push({ label: 'Most reps', text: setText(recap.mostReps.reps, recap.mostReps.weight, null) });
  if (!recap.best && !recap.mostReps && recap.longest !== null) lines.push({ label: 'Longest', text: fmtSeconds(recap.longest) });
  return lines;
}

/* The lines as one small block, or '' when there is nothing to say (never
   logged): the log card and the guided live set both draw this, so the two
   screens cannot drift. `workouts` is saved history only — the session being
   logged is not saved until Finish, so it can never be its own "last time". */
function recapEl(workouts, exercise, cls) {
  const lines = recapLines(exerciseRecap(workouts, exercise));
  if (!lines.length) return '';
  return el('dl', { class: `gv-recap${cls ? ` ${cls}` : ''}` },
    ...lines.map(l => el('div', { class: 'gv-recap-line' }, el('dt', {}, l.label), el('dd', {}, l.text))));
}

module.exports = { exerciseRecap, recapLines, recapEl, LAST_MAX };
