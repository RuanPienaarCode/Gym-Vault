'use strict';
/* Progress and personal-best figures for the Today, live-set, completion and
   Records screens. Pure derivations: no DOM is built here, no vault is read.

   ONE RULE PER NUMBER. This codebase's recurring bug is two figures derived by
   different rules, so nothing in this file computes a best, a record, a streak
   or a week count of its own:

     a best         records.previousBest   (-> stats.exerciseBests)
     "is it a PB"   records.isRecord
     which kinds    records.claimableKinds
     sessions/week  stats.sessionsInWeek
     the streak     stats.weekStreak       (computed by the caller)

   What IS new here is arithmetic on those figures (a gap, a percentage, a
   target one step above a best) and the choice of which figure to put in front
   of the user. */

const records = require('./records');
const { num, sameName, sessionsInWeek } = require('./stats');
const { weekdayKey, addDays, startOfWeek } = require('./dates');
const { isRestDay, targetIsDuration, targetWeight } = require('./plan-parse');
const { WEEKDAY_LABELS } = require('./constants');
const { fmtSeconds } = require('./dom');

const round1 = x => Math.round(x * 10) / 10;

/* ---------- which record a set can claim ---------- */

/* THE kind a guided set can claim a record in. Moved here from page-session so
   Today can ask the same question about a plan line that the session asks
   about the entry built from it. A run has no record concept (v1); a duration
   claims seconds; a weighted entry claims weight; everything else reps. */
function classifyKind(entry) {
  if (entry.distance) return null;
  if (entry.duration) return 'seconds';
  if (entry.weighted) return 'weight';
  return 'reps';
}

/* The shape page-log.makeEntry gives a plan line, restricted to the three
   flags classifyKind reads. It exists so Today can predict the kind a session
   will claim WITHOUT building a draft; tests/progress-parity.test.cjs builds
   real drafts through page-log and fails if this ever disagrees with makeEntry.

   `exercise` is the library note ({name, fm}) or null for a plan line with no
   note behind it. */
function entryShape(exercise, target) {
  const unit = exercise && exercise.fm ? exercise.fm.unit : null;
  const t = target || '';
  const distance = unit === 'km';
  const duration = !distance && (unit === 'seconds' || targetIsDuration(t));
  const weighted = unit === 'kg' || targetWeight(t) !== null;
  return { distance, duration, weighted };
}

/* The best a kind has ever reached, or null when there is nothing to beat. The
   claimableKinds gate lives HERE, at the seam both Today and the live screen
   read through, so neither can promise a record the Records page would refuse
   to show (a REP exercise's circuit clock is not a hold). A best of 0 is "no
   target": there is nothing to chase and a percentage of it divides by zero. */
function claimableBest(workouts, exercise, name, kind) {
  if (!kind) return null;
  if (!records.claimableKinds(exercise).includes(kind)) return null;
  const best = records.previousBest(workouts, name, kind);
  return best !== null && best !== undefined && best > 0 ? best : null;
}

/* ---------- the live "beat your best" target ---------- */

/* The best a LIVE screen may show a target against, or null for none.

   `observed` is the list of kinds that screen actually watches the user
   produce (page-session's OBSERVED_REPS / OBSERVED_SECONDS) - the same trust
   rule applyCompletion applies, so a target is only ever shown for a figure the
   screen would also be willing to celebrate. A weighted entry claims WEIGHT,
   which the tap counter never observes, so it gets no target; a timed interval
   observes nothing. `workouts` must be the pre-session snapshot
   (sess.workoutsAtStart), for the same reason previousBest's callers pass it. */
function liveBest(workouts, exercise, entry, observed) {
  const kind = classifyKind(entry);
  if (!kind || (observed || []).indexOf(kind) === -1) return null;
  return claimableBest(workouts, exercise, entry.exercise, kind);
}

/* Where `current` stands against `best`.

   toGo is the distance to the first figure that WOULD be a record: records.
   isRecord is strictly greater, so matching the best is one short, not done
   (12 on a best of 12 is "1 to go", and a best of 12.5 needs 13). `beaten` is
   isRecord itself, never a second comparison. pct is capped at 100 - the bar
   must not overflow its track when the count runs past the best. */
function pbTarget(best, current) {
  const b = num(best);
  if (b === null || b <= 0) return null;
  const c = Math.max(0, num(current) === null ? 0 : num(current));
  const beaten = records.isRecord(b, c);
  return {
    best: b,
    current: c,
    beaten,
    over: beaten ? round1(c - b) : 0,
    toGo: beaten ? 0 : Math.floor(b) + 1 - c,
    pct: Math.min(100, Math.round((c / b) * 100)),
  };
}

/* ---------- the completion screen's margin ---------- */

/* How far a new best moved: {abs, pct}. null when there is no old figure (a
   first-ever best has nothing to be measured against - callers omit the
   struck-through old value and the % chip rather than print 0) or when nothing
   improved. An old best of 0 keeps its absolute gain but has no percentage. */
function pbDelta(oldBest, newBest) {
  const o = num(oldBest), n = num(newBest);
  if (o === null || n === null || n <= o) return null;
  const abs = round1(n - o);
  return { abs, pct: o > 0 ? round1(((n - o) / o) * 100) : null };
}

/* "+2 reps" / "+2.5 kg" / "+5s". Rounded to one decimal by pbDelta: a 2.5 kg
   jump is real, 2.4999999999 is a float artefact. */
function marginText(kind, abs) {
  if (kind === 'reps') return `+${abs} rep${abs === 1 ? '' : 's'}`;
  if (kind === 'weight') return `+${abs} kg`;
  if (kind === 'seconds') return `+${fmtSeconds(abs)}`;
  return '';
}

function pctText(pct) { return `+${pct}%`; }

/* ---------- Today: PB in reach ---------- */

/* How far above the best the nudge asks for. Reps and seconds move in the
   steps the live screen counts in (one rep; five seconds is a hold worth
   naming - one second is noise); weight moves by the smallest plate that
   exists, 2.5 kg. */
const REACH_STEP = { reps: 1, seconds: 5, weight: 2.5 };

/* THE ONE EXERCISE TODAY NUDGES. Walk today's plan day in order and take the
   first item whose session kind (classifyKind of the entry the session will
   build from it) has a prior best in a kind its exercise may claim. The kind
   is the SESSION's, not a preference order: a weighted lift's record is its
   weight, which is what a session would celebrate, so a bench press is never
   offered a reps best the session would not count. Target = best + REACH_STEP
   of that kind. `index` is the item's position, so the caller marks that ROW
   (a plan may list one exercise twice). null when nothing on the day has a
   figure to chase. */
function pbInReach(items, workouts, exercises) {
  const list = items || [];
  for (let index = 0; index < list.length; index++) {
    const it = list[index];
    const exercise = (exercises || []).find(e => sameName(e.name, it.exercise)) || null;
    const kind = classifyKind(entryShape(exercise, it.target));
    const best = claimableBest(workouts, exercise, it.exercise, kind);
    if (best === null) continue;
    return { index, exercise: it.exercise, kind, best, target: round1(best + REACH_STEP[kind]) };
  }
  return null;
}

function figureText(kind, v) {
  if (kind === 'seconds') return fmtSeconds(v);
  if (kind === 'weight') return `${v} kg`;
  return String(v);
}

function reachText(r) {
  return `PB in reach · best ${figureText(r.kind, r.best)}, hit ${figureText(r.kind, r.target)}`;
}

/* ---------- Today: this week ---------- */

/* The seven days of the week containing `today`, each with the plan day
   scheduled on it (rest days and empty days: null). ONE rule for the week
   strip and for the week's target: the strip used to compute this inline, and
   a target derived by a second copy of it is exactly how "4 planned dots, a
   target of 3" would happen. */
function weekPlan(daysOn, today, weekStart) {
  const start = startOfWeek(today, weekStart);
  const out = [];
  for (let i = 0; i < 7; i++) {
    const iso = addDays(start, i);
    const wk = weekdayKey(iso);
    const scheduled = ((daysOn(wk) || [])[0] || {}).day || null;
    out.push({ iso, wk, planDay: scheduled && !isRestDay(scheduled) ? scheduled : null });
  }
  return out;
}

/* This week against its target, or null when the week has no target (a
   rest-only week with no goal: there is nothing to be "on track" for).

   Target: the user's own workouts-per-week goal when they set one (the first
   such goal with a positive target), otherwise the number of non-rest days the
   plan schedules this week. done: stats.sessionsInWeek - sessions, not days,
   the same count the tile beside it and the goal itself use. */
function weekProgress({ workouts, goals, daysOn, today, weekStart }) {
  let target = 0, source = 'plan';
  for (const g of goals || []) {
    const fm = (g && g.fm) || {};
    const t = Math.round(num(fm.target) || 0);
    if (fm.metric === 'workouts-per-week' && t > 0) { target = t; source = 'goal'; break; }
  }
  if (!target) target = weekPlan(daysOn, today, weekStart).filter(d => d.planDay).length;
  if (!target) return null;
  const done = sessionsInWeek(workouts, today, weekStart);
  return {
    done,
    target,
    source,
    pct: Math.min(100, Math.round((done / target) * 100)),
    toGo: Math.max(0, target - done),
    met: done >= target,
  };
}

/* The streak nag. weekStreak survives on ONE session in a week, so the only
   state in which the streak is genuinely at risk is: it is alive (streak > 0)
   and this week has nothing logged yet - it breaks if that is still true when
   the week ends. Being under the week's TARGET is not a risk to the streak (the
   ring's "to go" covers that), and saying "don't break it" there would claim a
   danger the code does not honour.

   Returns {streak, by}: the streak that would be lost and the last day of the
   week it can still be saved on. `streak` is stats.weekStreak, passed in so the
   flame and this read ONE number. A week with no target at all (rest-only,
   wp === null) is a week the plan asks nothing of, so no nag. */
function streakRisk(streak, wp, today, weekStart) {
  if (!(streak > 0) || !wp || wp.done !== 0) return null;
  const lastDay = weekdayKey(addDays(startOfWeek(today, weekStart), 6));
  return { streak, by: WEEKDAY_LABELS[lastDay] };
}

function streakRiskText(r) {
  return `Don't break it · 1 session by ${r.by} keeps your ${r.streak}-week streak`;
}

module.exports = {
  classifyKind, entryShape, claimableBest, liveBest, pbTarget, pbDelta, marginText, pctText,
  pbInReach, reachText, figureText, weekPlan, weekProgress, streakRisk, streakRiskText, REACH_STEP,
};
