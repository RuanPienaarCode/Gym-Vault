'use strict';
/* Derived figures. Pure — no DOM, no obsidian import.

   Budget-plugin lesson, carried over on purpose: "two figures derived by
   different rules" is the recurring bug shape. Every number the UI shows —
   streaks, weekly counts, bests, goal progress — is computed HERE and only
   here, so the dashboard and the goals page can never disagree. */

const { startOfWeek, addDays, todayISO, fromISO, toISO, daysBetween } = require('./dates');

/* A hand-typed decimal COMMA ("7,5", "62,25") is read as a decimal point, but
   only for digits, a comma and one or two digits. Three digits after the comma
   ("1,000") is a thousands separator or a typo, never 1.0, so it is left to
   parseFloat exactly as before. */
const COMMA_DECIMAL = /^\d+,\d{1,2}$/;
const num = v => {
  const s = typeof v === 'string' ? v.trim() : v;
  const n = parseFloat(typeof s === 'string' && COMMA_DECIMAL.test(s) ? s.replace(',', '.') : s);
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

/* The time of day a workout note says it was done, as zero-padded "HH:MM", or
   '' when it says none. Read from a `time:` / `started:` key, else from the
   time part of `date:` ("2026-08-26T09:30"). The app writes none of these
   itself, so this only orders sessions a person (or another tool) dated. */
function workoutTime(w) {
  const fm = (w && w.fm) || {};
  for (const raw of [fm.time, fm.started, fm.date]) {
    const m = String(raw === null || raw === undefined ? '' : raw).match(/(?:^|[T\s])(\d{1,2}):(\d{2})/);
    if (m && +m[1] < 24 && +m[2] < 60) return (m[1].length < 2 ? '0' : '') + m[1] + ':' + m[2];
  }
  return '';
}

/* THE order of workout notes, oldest first: by day (workoutDate; an unreadable
   date sorts first, so it never displaces a real "last session"), then by the
   time of day when the notes give one, then by file name read numerically
   ("Push 2" before "Push 10"), then by path. Total and independent of the
   order the files were listed in, so two sessions on one day always come out
   the same way round. */
function compareWorkouts(a, b) {
  const x = workoutDate(a) || '', y = workoutDate(b) || '';
  if (x !== y) return x < y ? -1 : 1;
  const tx = workoutTime(a), ty = workoutTime(b);
  if (tx !== ty) return tx < ty ? -1 : 1;
  const na = String((a && a.name) || ''), nb = String((b && b.name) || '');
  const byName = na.localeCompare(nb, undefined, { numeric: true });
  if (byName) return byName;
  const pa = String((a && a.file && a.file.path) || ''), pb = String((b && b.file && b.file.path) || '');
  return pa < pb ? -1 : pa > pb ? 1 : 0;
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
  /* A figure has a digit in it. A lone `.` (a decimal point typed and left)
     used to count, and was saved as a set of "." reps. */
  const fig = v => /\d/.test(String(v ?? ''));
  const hasFigure = fig(set.reps) || fig(set.weight_kg) || fig(set.seconds) || fig(set.distance_km) || fig(set.minutes);
  return !!(set.done || (set.touched && hasFigure));
}

/* THE ONE RULE FOR "THIS NOTE WAS A WEEKLY-CHALLENGE GO, NOT A SESSION".

   challenge-flow saves a go as an ordinary workout note (one row per unbroken
   set) so Records, the goal's best and History read it with every other note.
   That also made every "how many sessions" figure count it: four one-rep goes
   read "4 of 4 done - Week done", completed a "4 Workouts a Week" goal and paid
   +100 XP each. Decision D1: a go is not a session. It still feeds Records, the
   exercise bests, the goal's own best, the week streak, per-set XP and the PB
   bonus - everything that reads the ROWS or the DAY - and counts toward nothing
   that asks "how many sessions".

   New notes carry `kind: challenge` (data.saveWorkout writes it from the
   session). A note saved before that carries no kind, but it has no plan and its
   day is the goal's name ("50 Push-ups challenge" - challenge-flow.challengeDay),
   so an empty plan with "challenge" in the day name is read the same way. A real
   session always names its plan day, so this cannot catch one. */
function isChallengeRun(w) {
  const fm = (w && w.fm) || {};
  if (fm.kind === 'challenge') return true;
  return !String(fm.plan == null ? '' : fm.plan).trim() && /challenge/i.test(String(fm.day == null ? '' : fm.day));
}

/* The workouts that are SESSIONS: every list a session figure is derived from
   starts here (sessionCount, sessionsInWeek, sessionDates, the rewards medals and
   the weekly quest), so no caller has its own idea of what to leave out. */
const sessionsOf = workouts => (workouts || []).filter(w => !isChallengeRun(w));

/* HOW MANY SESSIONS — the one rule, for every surface that prints the word.

   Three screens counted three different things and all three said
   "sessions": Today counted UNIQUE DATES, History counted dated FILES, and
   Export counted files. Log a lift and then a run on the same day — which
   this app treats as first-class, "Log another session" is a button — and
   Today said 1 while History listed 2.

   A session is a logged workout note that is not a weekly-challenge go
   (isChallengeRun). Two on one day are two. An undated
   note is still one — it is a session someone recorded and History already
   shows it on screen; leaving it out of the count made the number disagree
   with the cards underneath it. Undated notes stay out of the STREAK and the
   heatmap, which genuinely need a date, and workoutDates() still answers
   that separate question. History still LISTS a challenge go (it is a note
   with rows), so its count is the one place a go is on the screen and not in
   the number. */
function sessionCount(workouts) {
  return sessionsOf(workouts).length;
}

/* Unique session days, ascending: workoutDates over the sessions only. The day
   strip's "done" marks and "Logged for today" read this; the week STREAK and
   the heat grid read workoutDates, because a week with only a challenge go is
   still a week you trained. */
function sessionDates(workouts) {
  return workoutDates(sessionsOf(workouts));
}

/* The same rule, inside one week. Undated notes belong to no week, so they
   are absent here — the week tile is a dated question. */
function sessionsInWeek(workouts, refIso, weekStart) {
  const start = startOfWeek(refIso, weekStart);
  const end = addDays(start, 7);
  return sessionsOf(workouts).filter(w => {
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

/* THE one rule for "which logged rows belong to this exercise": every row of
   every workout whose name matches (case/space-folded), undated workouts
   included. exerciseBests and best1RM both walk rows through this, so the
   tiles on one page can never be built from different row sets. */
function forEachExerciseRow(workouts, exercise, fn) {
  for (const w of workouts) {
    for (const r of w.rows || []) {
      if (sameName(r.exercise, exercise)) fn(r, w);
    }
  }
}

/* Scan every logged set of `exercise` for maxima. Returns nulls when the
   exercise was never logged — "no data" and "zero" must stay distinct. */
function exerciseBests(workouts, exercise) {
  let reps = null, weight = null, seconds = null, distance = null, lastDate = null;
  let totalDistance = 0;
  forEachExerciseRow(workouts, exercise, (r, w) => {
    const rp = num(r.reps), wt = num(r.weight_kg), sc = num(r.seconds), di = num(r.distance_km);
    if (rp !== null && (reps === null || rp > reps)) reps = rp;
    if (wt !== null && (weight === null || wt > weight)) weight = wt;
    if (sc !== null && (seconds === null || sc > seconds)) seconds = sc;
    if (di !== null && (distance === null || di > distance)) distance = di;
    if (di !== null) totalDistance += di;
    const wd = workoutDate(w);
    if (wd && (!lastDate || wd > lastDate)) lastDate = wd;
  });
  /* totalDistance stays 0-vs-null honest: null distance means never run. */
  return { reps, weight, seconds, distance, totalDistance: Math.round(totalDistance * 10) / 10, lastDate };
}

/* Estimated one-rep max (Epley). Only meaningful for weighted reps. */
function epley1RM(weight, reps) {
  if (!weight || !reps) return null;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

/* The exercise's best estimated 1RM: the highest Epley figure of any ONE set,
   weight and reps taken from the same row. Never epley1RM(best weight, best
   reps) off exerciseBests — those two maxima usually come from different sets
   (a heavy single and a light 20-rep back-off made 140 kg x 1 + 60 kg x 20
   read as 233.3 kg, a lift nobody did). A row without a positive weight AND a
   positive rep count is not a set an estimate can be drawn from. Null when no
   row qualifies — "no data" stays distinct from zero. Rows come through
   forEachExerciseRow, the same selection exerciseBests uses. */
function best1RM(workouts, exercise) {
  let best = null;
  forEachExerciseRow(workouts, exercise, r => {
    const rp = num(r.reps), wt = num(r.weight_kg);
    if (rp === null || wt === null || rp <= 0 || wt <= 0) return;
    const est = epley1RM(wt, rp);
    if (est !== null && (best === null || est > best)) best = est;
  });
  return best;
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

/* A count and its noun, said once and said right: "1 set", "0 sets", "13 sets". Exactly one is singular; zero and
   everything else is plural. `many` is for a noun that does not just take an s. The call sites used to write
   the count and the plural word by hand, which is how "LAST . 1 SETS" reached the Today tile. Pure: a test pins it. */
function countLabel(n, one, many) {
  return `${n} ${countNoun(n, one, many)}`;
}

/* Just the noun, for a tile that prints its figure separately ("1" over "session this week"). The same
   rule as countLabel: one is singular, everything else plural. */
function countNoun(n, one, many) {
  return Number(n) === 1 ? one : (many || `${one}s`);
}

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

/* THE ONE RULE FOR "A RUN HAPPENED ON THIS DAY". A saved session that day
   holds a row with a distance, OR a row of a km exercise (`exercises` are the
   library's notes): a timed circuit saves a run as minutes with no km, and
   Today ("Logged for today") and the Running page's week list must not read
   the same saved session two ways. This answers "did it happen" only - the
   distance figures (week/last-week km, longest run, pace, records) still need
   a distance, so a km-less row adds no kilometres. */
function ranOn(workouts, iso, exercises) {
  const runNames = (exercises || []).filter(e => e.fm && e.fm.unit === 'km').map(e => e.name);
  return (workouts || []).some(w => workoutDate(w) === iso && (w.rows || []).some(r =>
    num(r.distance_km) !== null || runNames.some(n => sameName(n, r.exercise))));
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

/* Which record kinds an exercise can legitimately claim, decided by its OWN
   unit rather than by which columns happen to be filled. page-log.buildRows
   deliberately writes `seconds` for a REP entry too, on purpose - a timed
   circuit measures real time on a push-up interval, and throwing that
   figure away would be worse than keeping it. But that means a filled
   `seconds` column is not, by itself, evidence of a hold: without this gate
   the Records page walked every kind for every exercise and invented a
   "hold" best for Push-ups out of a circuit's clock reading, and an
   exercise-duration goal pointed at Push-ups read the same 45 as progress
   toward a hold nobody ever attempted.

   `km` claims nothing here - a run's record is its own thing (see the Running
   records page) and the strength Records page still does not claim one.
   `seconds` claims only `seconds` - a held plank's reps/weight columns are
   never filled, so there's nothing else to claim. `kg`, `reps`, and no unit
   at all claim `reps` and `weight`: a weighted exercise can set a rep best
   or a weight best, and an unspecified one is treated the same as reps.

   Lives HERE (records.js re-exports it) so goalCurrent can apply the same
   gate without a stats <-> records require cycle. */
function claimableKinds(exercise) {
  const unit = exercise && exercise.fm ? exercise.fm.unit : null;
  if (unit === 'km') return [];
  if (unit === 'seconds') return ['seconds'];
  return ['reps', 'weight'];
}

/* The record kind a goal metric reads, for the claimableKinds gate.
   exercise-distance is deliberately ABSENT: claimableKinds([km]) is [] because
   a distance is not a strength-record kind, so gating it would blank every
   run goal. */
const GOAL_KIND = { 'exercise-reps': 'reps', 'exercise-duration': 'seconds', 'exercise-weight': 'weight' };

/* exerciseBests with the kinds the exercise cannot claim set to null - THE
   one reading of "this exercise's best" for a surface that prints a hold, a
   rep best or a weight best (the exercise page's tiles, the export). Takes the
   exercise OBJECT, which the name-only exerciseBests cannot. A run (unit km)
   is not gated: its distance is not a record kind and its `seconds` is the
   run's own time, which the run pages print. */
function claimedBests(workouts, exercise) {
  const b = exerciseBests(workouts, exercise.name);
  if (exercise.fm && exercise.fm.unit === 'km') return b;
  const claim = claimableKinds(exercise);
  return { ...b, reps: claim.includes('reps') ? b.reps : null, weight: claim.includes('weight') ? b.weight : null, seconds: claim.includes('seconds') ? b.seconds : null };
}

/* The single source for "where is this goal now". `ctx` carries everything
   any metric could need so callers can't feed two goals different data.

   When `ctx.exercises` is given, an exercise goal is gated by the exercise's
   claimableKinds: a known exercise that cannot claim the metric's kind reads
   null, exactly as the Records page refuses to show it. (A timed circuit
   leaves its clock in `seconds` for a REP exercise; without the gate that
   read as progress toward a hold nobody attempted.) An exercise name that
   resolves to nothing is goalIssue's problem, not this gate's. Without
   `ctx.exercises` nothing is gated. */
function goalCurrent(goal, ctx) {
  const fm = goal.fm || {};
  const kind = GOAL_KIND[fm.metric];
  if (kind && ctx.exercises) {
    const ex = ctx.exercises.find(e => sameName(e.name, fm.exercise));
    if (ex && !claimableKinds(ex).includes(kind)) return null;
  }
  /* A WEEKLY CHALLENGE reads its OWN best: the biggest unbroken set (or hold)
     logged on or after `started`, which is the figure its challenge line, the
     pop-up's "Best" and next week's target are built from
     (challenge.challengeStatus). The all-time exerciseBests below counts sets
     from before the challenge began and undated notes, so with 52 push-ups on
     1 Oct and a "50 Push-ups" challenge started on 13 Nov the card showed a
     trophy and "52 of 50" beside a line that said "baseline 20". Required here
     rather than at the top because challenge.js requires this file. */
  const challenge = require('./challenge');
  if (challenge.isChallenge(goal)) {
    return challenge.challengeStatus(goal, ctx.workouts, { weekStart: ctx.weekStart, today: ctx.today || todayISO() }).best;
  }
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
  /* Last, so the metric and the exercise are named first: a goal with no
     target has nothing to measure against, and "log a workout to start
     tracking" would send the user to fix the wrong thing. */
  if (num(fm.target) === null) return 'this goal has no target set';
  return null;
}

/* When was this goal note created, as YYYY-MM-DD, or null when the file does not
   say (a goal built in memory, a sync that dropped the stat). */
function goalCreatedISO(goal) {
  const t = goal && goal.file && goal.file.stat ? goal.file.stat.ctime : null;
  return typeof t === 'number' && Number.isFinite(t) ? toISO(new Date(t)) : null;
}

/* The baseline a body-weight goal with no `start_value` measures from: the
   earliest weight logged on or after the day the goal was created. A decrease
   goal with no baseline can only be done-or-not, so 82.4 kg -> 80.5 kg toward
   78 read 0% until it was met. Null when the data offers none (no creation
   date, no weight logged since), which leaves the old behaviour untouched. */
function bodyBaseline(goal, body) {
  const created = goalCreatedISO(goal);
  if (!created) return null;
  let first = null;
  for (const r of body || []) {
    const d = r && r.date ? fromISO(r.date) : null, w = r ? num(r.weight_kg) : null;
    if (!d || w === null) continue;
    const iso = toISO(d);
    if (iso >= created && (!first || iso < first.iso)) first = { iso, w };
  }
  return first ? first.w : null;
}

/* The two things a NEW goal is given when the user did not choose them
   (page-goals calls this when a goal is created):

   direction - "auto" (the form's default) or nothing means: a body-weight goal
   whose target is below the current weight is a Decrease, anything else an
   Increase. Defaulting every goal to Increase made a cut from 90 kg to 80 kg
   "done", with a trophy, the moment it was saved. An explicit "increase" or
   "decrease" is never touched.

   start_value - a body-weight goal left blank starts from the current body-log
   weight, so a decrease has a baseline from day one. Only body-weight, only when
   blank and only when a weight is logged; every other goal keeps what it typed. */
function newGoalDefaults(v, body) {
  const metric = v && v.metric;
  const typed = v && v.direction;
  let direction = typed === 'increase' || typed === 'decrease' ? typed : 'increase';
  let start = v && v.start_value !== undefined && v.start_value !== null ? v.start_value : '';
  if (metric === 'body-weight') {
    const current = goalCurrent({ fm: { metric } }, { body });
    const target = num(v.target);
    if (typed !== 'increase' && typed !== 'decrease' && current !== null && target !== null && target < current) direction = 'decrease';
    if (String(start).trim() === '' && current !== null) start = current;
  }
  return { direction, start_value: start };
}

/* 0..1 progress. Uses start_value as the baseline when present (so a cut
   from 90kg toward 80kg shows honest movement); without one, an increase
   goal measures from zero and a decrease goal can only be done-or-not.
   `ctx.body` (the body log) is optional: a body-weight goal with no start_value
   then falls back to bodyBaseline. Callers that pass it agree with each other;
   a caller that does not gets the old figure. */
function goalProgress(goal, current, ctx) {
  const fm = goal.fm || {};
  const target = num(fm.target);
  if (target === null || current === null) return null;
  let start = num(fm.start_value);
  if (start === null && fm.metric === 'body-weight' && ctx && ctx.body) start = bodyBaseline(goal, ctx.body);
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
    /* workoutDate, not the raw text: as strings a hand-typed `2026-8-6` sorts
       after `2026-11-01`, and the trend ended on an old weight while the tile
       (data.compareBodyRows, the same rule) showed the right one. A row whose
       date cannot be read is left out of the trend. */
    .map(r => ({ date: workoutDate({ fm: { date: r && r.date } }) || '', value: num(r && r.weight_kg) }))
    .filter(p => p.date && p.value !== null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

function bmi(weightKg, heightCm) {
  const w = num(weightKg), h = num(heightCm);
  if (!w || !h) return null;
  return Math.round((w / ((h / 100) ** 2)) * 10) / 10;
}

module.exports = {
  num, workoutDates, workoutDate, workoutTime, compareWorkouts, sameName, countInWeek, sessionCount, sessionsInWeek, sessionsOf, sessionDates, isChallengeRun, weekStreak, exerciseBests, epley1RM, best1RM,
  sessionVolume, sessionSets, countLabel, countNoun, setCounts, distanceInWeek, ladderWeek, ranOn,
  goalCurrent, goalIssue, goalProgress, newGoalDefaults, weightSeries, bmi, claimableKinds, claimedBests,
};
