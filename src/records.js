'use strict';
/* Pure "did this set break a personal record" logic — no DOM, no obsidian
   import. Reuses stats.exerciseBests for the actual maxima rather than
   recomputing a shadow one here: two figures derived by different rules is
   this codebase's recurring bug shape (see stats.js's own header comment),
   and a guided-mode record that disagreed with the exercise-detail page's
   "best" would be exactly that.

   `kind` is one of the three dimensions exerciseBests tracks: 'reps',
   'weight', 'seconds'. Distance (runs) has no record concept here in v1 —
   callers simply don't call this for a distance entry. */

const { exerciseBests } = require('./stats');

/* The best-so-far for `kind`, computed from `workouts`. Callers MUST pass a
   snapshot taken before the guided session started (or otherwise excluding
   the in-progress draft's own rows) — comparing against live history means
   two record-breaking sets logged in one sitting each beat the REAL past,
   not each other. */
function previousBest(workouts, exercise, kind) {
  const bests = exerciseBests(workouts, exercise);
  if (kind === 'reps') return bests.reps;
  if (kind === 'weight') return bests.weight;
  if (kind === 'seconds') return bests.seconds;
  return null;
}

/* Does `value` beat `prev`? A null/undefined prev (the exercise has never
   been logged) is NOT a record — there's nothing to beat, so the first-ever
   logged set of an exercise never celebrates. A TIE is not a record either —
   nothing was actually beaten. */
function isRecord(prev, value) {
  if (prev === null || prev === undefined) return false;
  const v = parseFloat(value);
  if (!Number.isFinite(v)) return false;
  return v > prev;
}

module.exports = { previousBest, isRecord };
