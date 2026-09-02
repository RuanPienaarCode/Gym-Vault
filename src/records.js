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

const { exerciseBests, sameName, num } = require('./stats');

/* The three dimensions a record can exist in, in the order they are shown.
   Distance is deliberately absent: a run's record is its own thing and
   exerciseBests tracks it, but nothing here claims one (see the header). */
const KINDS = ['reps', 'weight', 'seconds'];

/* Which row column each kind reads. One table, so recordHistory and
   allRecords cannot come to disagree about what "weight" means. `distance`
   is here for recordHistory's benefit (the Running records page can walk
   it) without being in KINDS — the strength Records page still does not
   claim a distance record. */
const COLUMN = { reps: 'reps', weight: 'weight_kg', seconds: 'seconds', distance: 'distance_km' };

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

/* Workouts in date order, oldest first. loadAll already sorts, but "already
   sorted" is an assumption and a record history built on a wrong order is
   silently wrong rather than obviously broken — it would report a best being
   beaten by a figure that came earlier. Cheap to be sure.

   A workout with no date sorts last: it cannot be placed in the story, and
   putting it at the end means it can only ever ADD a record, never
   retroactively invalidate one. */
function inDateOrder(workouts) {
  return (workouts || []).slice().sort((a, b) => {
    const ad = (a.fm && a.fm.date) || '9999-99-99';
    const bd = (b.fm && b.fm.date) || '9999-99-99';
    return ad < bd ? -1 : ad > bd ? 1 : 0;
  });
}

/* Every time this exercise's best in `kind` was BEATEN, oldest first:
   [{value, prev, date}]. The first entry has prev === null — the first time
   you ever did something is not a record broken, it is the baseline, and
   isRecord() says the same thing.

   The last entry's value is, by construction, exerciseBests(...)[kind]. The
   guard suite asserts exactly that: this walks the rows to find WHEN the
   best moved, and if it ever disagreed with the number the exercise page
   shows, the two would be a "same figure, two rules" pair — the shape this
   codebase keeps having to dig out. */
function recordHistory(workouts, exercise, kind) {
  const column = COLUMN[kind];
  if (!column) return [];
  const out = [];
  let best = null;
  for (const w of inDateOrder(workouts)) {
    const date = (w.fm && w.fm.date) || '';
    for (const r of w.rows || []) {
      if (!sameName(r.exercise, exercise)) continue;
      const v = num(r[column]);
      if (v === null) continue;
      /* Strictly greater, same as isRecord: a tie beats nothing. */
      if (best === null || v > best) {
        out.push({ value: v, prev: best, date });
        best = v;
      }
    }
  }
  return out;
}

/* Current best per exercise per kind, with the date it was set —
   [{exercise, kind, value, date}], for the Records page.

   Values come from exerciseBests, NOT from a faster single pass of its own.
   A bespoke scan here would be a second implementation of "what is the
   best", and the first time the two disagreed the Records page and the
   exercise page would each be confidently showing a different number.
   recordHistory supplies only the DATE, which exerciseBests does not track
   per kind. */
function allRecords(workouts, exercises) {
  const out = [];
  for (const ex of exercises || []) {
    const bests = exerciseBests(workouts, ex.name);
    for (const kind of KINDS) {
      const value = bests[kind === 'weight' ? 'weight' : kind];
      if (value === null || value === undefined) continue;
      const history = recordHistory(workouts, ex.name, kind);
      const last = history[history.length - 1];
      out.push({
        exercise: ex.name,
        kind,
        value,
        date: last ? last.date : '',
        /* How many times it has moved. One means it has never been beaten —
           that is a baseline, not a record, and the page says so. */
        times: history.length,
      });
    }
  }
  return out;
}

module.exports = { previousBest, isRecord, recordHistory, allRecords, inDateOrder, KINDS, COLUMN };
