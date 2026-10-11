'use strict';
/* REWARDS ENGINE - XP, levels, a weekly quest and medals. Pure: no DOM, no
   obsidian import, no vault. The UI phase calls these; src/rewards-ledger.js
   owns the storage format and src/data.js (io.readRewards / io.appendRewards)
   the file IO.

   ONE RULE PER NUMBER, as everywhere in this repo. Nothing here re-spells a
   figure the app already derives; it composes the seams:
     which day a session is on      stats.workoutDate         (undated -> null, never guessed)
     sessions / unique days / week  stats.sessionCount, workoutDates, sessionsInWeek
     the week streak                stats.weekStreak
     sets in a session              stats.sessionSets          (and stats.setCounts, upstream, in page-log.buildRows)
     volume                         stats.sessionVolume        (what History prints as "kg volume")
     a personal best                records.recordHistory + records.claimableKinds (allRecords' own inputs)
     which workout comes first      records.inDateOrder
     what a plan asks for           plan-parse itemSets / targetFirstNumber / targetIsDuration / isRestDay
   and the week boundary is dates.startOfWeek with the user's weekStart.

   XP IS COUNTED FORWARD FROM INSTALL. Past workouts earn nothing: the first
   award is the first session finished after this ships, and nothing here
   walks history to pay XP. Medals are the opposite on purpose - they are
   derived figures over the FULL history, like a personal best.

   ---------------------------------------------------------------------
   CONTRACT
   ---------------------------------------------------------------------
   XP = {session:100, set:5, pb:50, streak:20, quest:120}      the ONLY place the amounts live
   LEVEL = {base:150, step:50}   XP to go from level n to n+1 = base + step*n   (L1->L2 200, L10->L11 650)
   RANKS = [{name, from}]        Rookie 1, Contender 5, Challenger 10, Elite 20, Apex 30   (from = first level)

   rewardsEnabled(settings) -> bool
       ON unless settings.rewards is false (or the string 'false'). Absent settings / absent key -> ON.
       When it is OFF awardsForSession returns [] and io.readRewards/appendRewards touch nothing.

   xpToReach(level) -> int     cumulative XP at which `level` starts: (level-1)*(150+25*level). level<=1 -> 0.
   levelFor(xp) -> {xp, level, xpInto, xpForNext, toNext, pct, rank, rankIndex}
       Level 1 at 0 XP. xp is floored, and negative / NaN / non-number -> 0. xpInto is XP past this
       level's start, xpForNext the width of this level, toNext = xpForNext - xpInto, pct = 0..99
       (floor, never 100: reaching 100% IS the next level). rank is the RANKS name, rankIndex 0..4.
       No level cap; exact thresholds belong to the new level (xp 200 -> level 2, xpInto 0).
   rankFor(level) -> {name, index}

   weekKey(date, weekStart) -> 'YYYY-MM-DD'    the first day of the week containing `date` (the key for week-scoped awards)

   questFor({daysOn, exercises, workouts, today, weekStart, ledger}) -> null | quest
       THE ONE QUEST RULE. Each calendar week (weekStart 'mon'|'sun') derives ONE quest from what the plans
       schedule that week. daysOn is ctx.daysOn: weekday key -> [{plan, day}] (active plan + parallel plans
       merged, as Today builds it). Days named rest/recovery (plan-parse.isRestDay) and entries from a
       fallback plan (fm.fallback) are not "planned work". Items are the day's `- exercise | N x target` lines.
         no planned items at all (empty plan, rest-only week)       -> null (no quest, no XP)
         EVERY item is rep-countable                                 -> {kind:'reps'}: target = sum over items of
             itemSets(item) * targetFirstNumber(item.target). "Rep-countable" = the exercise's unit is not 'km'
             or 'seconds', the target is not a duration (targetIsDuration), and it names a number > 0
             ("8-12" -> 8, "5 @ 60kg" -> 5; "submax" / "AMRAP" name none).
         anything else (time-based, km, mixed, a rep line with no number) -> {kind:'sets'}: target = sum of itemSets(item)
       Progress counts what was REALLY logged in the calendar week containing `today`: kind 'reps' = sum of the
       reps column over every row; kind 'sets' = stats.sessionSets over every row. Workouts whose date cannot be
       read belong to no week. weekStart changes which Sunday-or-Monday a week begins on, and so which sets count.
       Returns {key:'quest:<weekKey>', kind, target, done, toGo, pct (0..100), complete, xp:120,
                title, subject, weekStart, weekEnd, paid}
         title   'Do 100 reps of Push Day' / 'Do 100 reps this week' / 'Do 12 sets this week'
         subject the one exercise name, else the one day name when only one training day is planned, else null
         paid    true when `ledger` (parseLedger result or entries) already holds the key

   medals({workouts, exercises, weekStart}) -> [medal x 9], in this order:
       first-pb, iron-week, week-streak, 10k-club, century, rep-machine, distance-club, consistency, pb-hunter
     medal = {key, name, desc, unit, tier: 'locked'|'bronze'|'silver'|'gold', tierIndex: -1..2,
              progress: {value, next, pct}, earned: {bronze, silver, gold}, earnedOn, complete, tiers: [{tier, at}]}
       value   the all-time figure (the best week / longest run for the "best ever" medals)
       next    the threshold of the next tier, null once the top tier is reached
       pct     value/next as a whole percent, floor, 0..99 while locked, 100 when complete
       earned  date (YYYY-MM-DD) each tier was FIRST reached, found by walking the history in date order;
               null when not reached or when the reaching workout has no readable date
       earnedOn  the date of the current (highest) tier
   newMedals(before, after) -> [{key, name, tier, from}]    tiers gained between two medals() results ("medal unlocked" on Session complete)

   awardsForSession({workoutKey, date, sets, records, workouts, daysOn, exercises, weekStart, settings, ledgerState})
       -> [{date, key, kind, xp, note}]
       Called ONCE when a session finishes. Pure; leaves out any key already in the ledger.
         workoutKey  the saved workout's vault path (io.saveWorkout's return value): stable and unique per session
         date        the session's YYYY-MM-DD
         sets        the rows that were saved (page-log.buildRows); sessionSets(sets) is the set count
         records     sess.records ([{key, exercise, kind, val, prev}]) - never a second detection path
         workouts    history WITHOUT this session (sess.workoutsAtStart); a workout whose file.path equals workoutKey is ignored
         ledgerState parseLedger() result (or entries)
       No saved rows -> []. Components, in this order, each its own ledger line:
         session:<workoutKey>                 +100  'Session finished'
         sets:<workoutKey>                    +5 x sessionSets(sets)
         pb:<workoutKey>#<record.key>         +50 each record in `records`
         week-streak:<weekKey>                +20  once a week, when stats.weekStreak (counting this session) >= 2
         quest:<weekKey>                      +120 when THIS session takes the week's quest from incomplete to complete
       Idempotent by key: awarding twice, or from two devices, can never pay twice.

   summarise(ledgerState, now, {weekStart}) -> {totalXp, level (levelFor), sessions, pbs, started,
        thisWeek: {start, end, xp, sessions, streakKept, questPaid, awards}, lastAwards: null | {date, xp, items}}
       now is a YYYY-MM-DD string. Totals are the sum of the (deduped) ledger lines, floored at 0.
       lastAwards = the lines from the most recent `session` line to the end of the ledger (the last session's breakdown). */

const { startOfWeek, addDays, fromISO, toISO, weekdayKey, todayISO } = require('./dates');
const stats = require('./stats');
const records = require('./records');
const { itemSets, targetFirstNumber, targetIsDuration, isRestDay } = require('./plan-parse');
const ledger = require('./rewards-ledger');

const XP = { session: 100, set: 5, pb: 50, streak: 20, quest: 120 };
const LEVEL = { base: 150, step: 50 };
const RANKS = [
  { name: 'Rookie', from: 1 },
  { name: 'Contender', from: 5 },
  { name: 'Challenger', from: 10 },
  { name: 'Elite', from: 20 },
  { name: 'Apex', from: 30 },
];

function notImplemented() { throw new Error('rewards: not implemented'); }

const num = stats.num;

/* ---- settings ---- */

function rewardsEnabled(settings) {
  const v = settings ? settings.rewards : undefined;
  return !(v === false || String(v) === 'false');
}

/* ---- levels ---- */

/* Cumulative XP at which `level` starts. Level n costs base + step*n to leave, so
   the sum for levels 1..L-1 is (L-1)*(base + step*L/2) - with the shipped numbers
   (L-1)*(150+25*L). Written from LEVEL so the curve really is in one place. */
function xpToReach(level) {
  const L = Math.floor(Number(level));
  if (!(L > 1)) return 0;
  return (L - 1) * (LEVEL.base + (LEVEL.step * L) / 2);
}

const toXp = v => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' ? parseFloat(v) : NaN);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), Number.MAX_SAFE_INTEGER) : 0;
};

function rankFor(level) {
  let idx = 0;
  for (let i = 0; i < RANKS.length; i++) if (level >= RANKS[i].from) idx = i;
  return { name: RANKS[idx].name, index: idx };
}

function levelFor(xpRaw) {
  const xp = toXp(xpRaw);
  /* Solve (L-1)*(base + step*L/2) <= xp for L, then settle the float drift by
     walking to the exact bracket. */
  const a = LEVEL.step / 2, b = LEVEL.base - a;       // a*L^2 + b*L - (base... see xpToReach
  let L = Math.floor((-b + Math.sqrt(b * b + 4 * a * (xp + LEVEL.base))) / (2 * a));
  if (!(L >= 1)) L = 1;
  while (L > 1 && xpToReach(L) > xp) L--;
  while (xpToReach(L + 1) <= xp) L++;
  const start = xpToReach(L);
  const xpForNext = LEVEL.base + LEVEL.step * L;
  const xpInto = xp - start;
  const rank = rankFor(L);
  return {
    xp, level: L, xpInto, xpForNext, toNext: xpForNext - xpInto,
    pct: Math.min(99, Math.floor((xpInto / xpForNext) * 100)),
    rank: rank.name, rankIndex: rank.index,
  };
}

/* ---- weeks ---- */

const weekKey = (date, weekStart) => (fromISO(date) ? startOfWeek(date, weekStart) : null);

/* ---- the weekly quest ---- */

const isFallbackPlan = plan => !!plan && !!plan.fm && String(plan.fm.fallback) === 'true';
const findExercise = (exercises, name) => (exercises || []).find(e => stats.sameName(e.name, name)) || null;

/* Reps a plan line asks for per set, or null when it is not a rep prescription:
   a km or timed exercise, a duration target, a percentage ("65% max") or a
   target that names no number ("submax", "AMRAP"). */
function repsPerSet(item, exercise) {
  const unit = exercise && exercise.fm ? exercise.fm.unit : '';
  if (unit === 'km' || unit === 'seconds') return null;
  const target = item.target || '';
  if (targetIsDuration(target) || target.indexOf('%') >= 0) return null;
  const n = targetFirstNumber(target);
  return n !== null && n > 0 ? n : null;
}

function questFor(o) {
  const today = o.today || todayISO();
  if (!fromISO(today)) return null;
  const start = startOfWeek(today, o.weekStart);
  const end = addDays(start, 6);
  const items = [];
  const dayNames = new Map();
  const exNames = new Map();
  for (let i = 0; i < 7; i++) {
    for (const entry of (typeof o.daysOn === 'function' ? o.daysOn(weekdayKey(addDays(start, i))) : []) || []) {
      if (!entry || !entry.day || isFallbackPlan(entry.plan) || isRestDay(entry.day)) continue;
      for (const it of entry.day.items || []) {
        items.push(it);
        const nk = String(entry.day.name || '').trim().toLowerCase();
        if (nk && !dayNames.has(nk)) dayNames.set(nk, entry.day.name.trim());
        const ek = String(it.exercise || '').trim().toLowerCase();
        if (ek && !exNames.has(ek)) exNames.set(ek, String(it.exercise).trim());
      }
    }
  }
  if (!items.length) return null;

  let setsTarget = 0, repsTarget = 0, allReps = true;
  for (const it of items) {
    const n = itemSets(it);
    setsTarget += n;
    const per = repsPerSet(it, findExercise(o.exercises, it.exercise));
    if (per === null) allReps = false; else repsTarget += n * per;
  }
  const kind = allReps ? 'reps' : 'sets';
  const target = allReps ? repsTarget : setsTarget;

  let done = 0;
  for (const w of o.workouts || []) {
    const d = stats.workoutDate(w);
    if (!d || d < start || d > end) continue;
    if (kind === 'sets') done += stats.sessionSets(w.rows);
    else for (const r of w.rows || []) { const n = num(r.reps); if (n !== null) done += n; }
  }

  const subject = exNames.size === 1 ? [...exNames.values()][0] : (dayNames.size === 1 ? [...dayNames.values()][0] : null);
  const key = `quest:${start}`;
  const title = kind === 'reps'
    ? (subject ? `Do ${target} reps of ${subject}` : `Do ${target} reps this week`)
    : `Do ${target} sets this week`;
  return {
    key, kind, target, done,
    toGo: Math.max(0, target - done),
    pct: Math.min(100, Math.floor((done / target) * 100)),
    complete: done >= target,
    xp: XP.quest, title, subject, weekStart: start, weekEnd: end,
    paid: o.ledger ? ledger.hasKey(o.ledger, key) : false,
  };
}

/* ---- awards ---- */

const KIND_UNIT = { reps: ' reps', weight: ' kg', seconds: 's' };

function awardsForSession(o) {
  if (!rewardsEnabled(o.settings)) return [];
  const wkey = String(o.workoutKey == null ? '' : o.workoutKey).trim();
  const date = stats.workoutDate({ fm: { date: o.date } });
  const n = stats.sessionSets(o.sets);
  if (!wkey || !date || !n) return [];

  const state = o.ledgerState || ledger.parseLedger('');
  const out = [];
  const add = (key, kind, xp, note) => {
    if (ledger.hasKey(state, key) || out.some(a => a.key === key)) return;
    out.push({ date, key, kind, xp, note });
  };

  add(`session:${wkey}`, 'session', XP.session, 'Session finished');
  add(`sets:${wkey}`, 'sets', XP.set * n, `${n} set${n === 1 ? '' : 's'} logged`);
  for (const rec of o.records || []) {
    if (!rec) continue;
    const id = rec.key || `${rec.exercise}/${rec.kind}`;
    add(`pb:${wkey}#${id}`, 'pb', XP.pb, `New best: ${rec.exercise} ${rec.val}${KIND_UNIT[rec.kind] || ''}`);
  }

  /* THIS session as a workout, so every derived figure below counts it. The
     caller's history excludes it; if it was already saved and reloaded, drop it
     by path rather than count it twice. */
  const history = (o.workouts || []).filter(w => !(w && w.file && w.file.path === wkey));
  const mine = { name: wkey, fm: { date }, rows: o.sets, file: { path: wkey } };
  const wk = weekKey(date, o.weekStart);

  const streak = stats.weekStreak(stats.workoutDates(history.concat([mine])), o.weekStart, date);
  if (streak >= 2) add(`week-streak:${wk}`, 'streak', XP.streak, `${streak}-week streak kept`);

  const common = { daysOn: o.daysOn, exercises: o.exercises, today: date, weekStart: o.weekStart };
  const after = questFor({ ...common, workouts: history.concat([mine]) });
  if (after && after.complete) {
    const before = questFor({ ...common, workouts: history });
    if (before && !before.complete) add(after.key, 'quest', XP.quest, `Weekly quest done: ${after.title}`);
  }
  return out;
}

/* ---- summary ---- */

function summarise(state, now, opts) {
  const entries = ledger.entriesOf(state);
  const weekStart = (opts && opts.weekStart) || 'mon';
  const today = now instanceof Date ? toISO(now) : (typeof now === 'string' && fromISO(now) ? toISO(fromISO(now)) : todayISO());
  const start = startOfWeek(today, weekStart);
  const end = addDays(start, 6);
  const sum = list => list.reduce((t, e) => t + e.xp, 0);

  const totalXp = Math.max(0, sum(entries));
  const week = entries.filter(e => e.date >= start && e.date <= end);
  let last = -1;
  for (let i = 0; i < entries.length; i++) if (entries[i].kind === 'session') last = i;
  const items = last >= 0 ? entries.slice(last) : [];
  const dates = entries.map(e => e.date).sort();
  return {
    totalXp,
    level: levelFor(totalXp),
    sessions: entries.filter(e => e.kind === 'session').length,
    pbs: entries.filter(e => e.kind === 'pb').length,
    started: (state && !Array.isArray(state) && state.started) || dates[0] || null,
    thisWeek: {
      start, end, xp: sum(week),
      sessions: week.filter(e => e.kind === 'session').length,
      streakKept: week.some(e => e.kind === 'streak'),
      questPaid: week.some(e => e.kind === 'quest'),
      awards: week,
    },
    lastAwards: items.length ? { date: items[0].date, xp: sum(items), items } : null,
  };
}

/* ---- medals ---- */

/* Each medal is a named figure with up to three thresholds and a SERIES: the
   history walked in date order, one {date, value} per step, `value` never
   falling (a best-ever figure is carried as a running maximum). The final value
   is the medal's figure; the first step at or past a threshold is the date that
   tier was earned. `date` is null for a workout whose day cannot be read - it
   sorts last (records.inDateOrder) and earns no date. */

const TIER_NAMES = ['bronze', 'silver', 'gold'];
const round1 = x => Math.round(x * 10) / 10;

/* The workouts in the one date order the records use, each with its day. */
function walkOrder(workouts) {
  return records.inDateOrder((workouts || []).filter(Boolean)).map(w => ({ w, date: stats.workoutDate(w) }));
}

/* A figure that grows by `step(w)` each workout. */
const runningTotal = (step, round) => steps => {
  let total = 0;
  return steps.map(({ w, date }) => { total += step(w); return { date, value: round ? round(total) : total }; });
};

/* Per-week session counts as the walk reaches each week - the same rule as
   stats.sessionsInWeek (a dated session in the week; undated notes in none),
   bucketed so a long history is one pass. */
function weekCounts() {
  const counts = new Map();
  return {
    add(date, weekStart) { const s = startOfWeek(date, weekStart); counts.set(s, (counts.get(s) || 0) + 1); return s; },
    get: s => counts.get(s) || 0,
  };
}

function seriesBestWeek(steps, ctx) {
  const wc = weekCounts();
  let best = 0;
  const out = [];
  for (const { date } of steps) {
    if (!date) continue;
    best = Math.max(best, wc.get(wc.add(date, ctx.weekStart)));
    out.push({ date, value: best });
  }
  return out;
}

/* The longest streak the history ever reached, asked of stats.weekStreak as the
   walk enters each new week. One date per week is enough input for it (it only
   asks "is there a session in this week"), which keeps a long streak cheap. */
function seriesBestStreak(steps, ctx) {
  const weekFirst = [];
  let lastWeek = null, best = 0;
  const out = [];
  for (const { date } of steps) {
    if (!date) continue;
    const s = startOfWeek(date, ctx.weekStart);
    if (s === lastWeek) continue;
    lastWeek = s;
    weekFirst.push(date);
    best = Math.max(best, stats.weekStreak(weekFirst, ctx.weekStart, date));
    out.push({ date, value: best });
  }
  return out;
}

/* Consecutive weeks of at least STEADY_SESSIONS sessions each. */
const STEADY_SESSIONS = 3;
function seriesSteadyWeeks(steps, ctx) {
  const wc = weekCounts();
  let best = 0;
  const out = [];
  for (const { date } of steps) {
    if (!date) continue;
    const s = wc.add(date, ctx.weekStart);
    if (wc.get(s) < STEADY_SESSIONS) continue;
    let run = 1;
    for (let p = addDays(s, -7); wc.get(p) >= STEADY_SESSIONS; p = addDays(p, -7)) run++;
    if (run > best) { best = run; out.push({ date, value: best }); }
  }
  return out;
}

/* Every time a best was BEATEN, across every exercise and every kind the
   exercise may claim - allRecords' own inputs, so the count is its times-1 summed.
   The baseline (prev === null) is the first time you did something, not a record. */
function seriesPersonalBests(steps, ctx) {
  const seen = [];
  const events = [];
  for (const ex of ctx.exercises || []) {
    if (!ex || !ex.name || seen.some(n => stats.sameName(n, ex.name))) continue;
    seen.push(ex.name);
    for (const kind of records.claimableKinds(ex)) {
      for (const h of records.recordHistory(ctx.workouts, ex.name, kind)) {
        if (h.prev !== null) events.push({ date: h.date || null, at: events.length });
      }
    }
  }
  events.sort((a, b) => {
    const x = a.date || '9999-99-99', y = b.date || '9999-99-99';
    return x < y ? -1 : x > y ? 1 : a.at - b.at;
  });
  return events.map((e, i) => ({ date: e.date, value: i + 1 }));
}

const MEDALS = [
  { key: 'first-pb', name: 'First PB', unit: 'PBs', at: [1], desc: 'Beat a personal best for the first time.', series: seriesPersonalBests },
  { key: 'iron-week', name: 'Iron Week', unit: 'sessions', at: [3, 4, 5], desc: 'Sessions logged in a single week.', series: seriesBestWeek },
  { key: 'week-streak', name: 'Week Streak', unit: 'weeks', at: [3, 5, 10], desc: 'Weeks in a row with a session.', series: seriesBestStreak },
  { key: '10k-club', name: '10K Club', unit: 'kg', at: [10000, 50000, 100000], desc: 'Total weight lifted, reps x kg.',
    series: runningTotal(w => stats.sessionVolume(w.rows)) },
  { key: 'century', name: 'Century', unit: 'sessions', at: [25, 100, 250], desc: 'Sessions logged.',
    series: steps => steps.map(({ date }, i) => ({ date, value: i + 1 })) },
  { key: 'rep-machine', name: 'Rep Machine', unit: 'reps', at: [1000, 5000, 10000], desc: 'Total reps logged.',
    series: runningTotal(w => (w.rows || []).reduce((n, r) => n + (stats.num(r.reps) || 0), 0)) },
  { key: 'distance-club', name: 'Distance Club', unit: 'km', at: [50, 250, 1000], desc: 'Total distance logged.',
    series: runningTotal(w => (w.rows || []).reduce((n, r) => n + (stats.num(r.distance_km) || 0), 0), round1) },
  { key: 'consistency', name: 'Consistency', unit: 'weeks', at: [4, 8, 12], desc: 'Weeks in a row with 3 or more sessions.', series: seriesSteadyWeeks },
  { key: 'pb-hunter', name: 'Personal Best Hunter', unit: 'PBs', at: [5, 25, 100], desc: 'Personal bests broken.', series: seriesPersonalBests },
];

function medals(o) {
  const ctx = { workouts: (o.workouts || []).filter(Boolean), exercises: o.exercises || [], weekStart: o.weekStart };
  const steps = walkOrder(ctx.workouts);
  return MEDALS.map(def => {
    const events = def.series(steps, ctx);
    const value = events.length ? events[events.length - 1].value : 0;
    const tiers = def.at.map((at, i) => ({ tier: TIER_NAMES[i], at }));
    const earned = { bronze: null, silver: null, gold: null };
    let tierIndex = -1;
    tiers.forEach((t, i) => {
      if (value < t.at) return;
      tierIndex = i;
      const hit = events.find(e => e.value >= t.at);
      earned[t.tier] = hit ? hit.date : null;
    });
    const next = tierIndex + 1 < tiers.length ? tiers[tierIndex + 1].at : null;
    const tier = tierIndex >= 0 ? tiers[tierIndex].tier : 'locked';
    return {
      key: def.key, name: def.name, desc: def.desc, unit: def.unit, tier, tierIndex,
      progress: { value, next, pct: next === null ? 100 : Math.min(99, Math.floor((value / next) * 100)) },
      earned, earnedOn: tierIndex >= 0 ? earned[tier] : null,
      complete: next === null && tierIndex >= 0, tiers,
    };
  });
}

function newMedals(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return [];
  const out = [];
  for (const m of after) {
    const b = before.find(x => x.key === m.key);
    const was = b ? b.tierIndex : -1;
    if (m.tierIndex > was) out.push({ key: m.key, name: m.name, tier: m.tier, from: b ? b.tier : 'locked' });
  }
  return out;
}

module.exports = {
  XP, LEVEL, RANKS,
  rewardsEnabled, xpToReach, levelFor, rankFor, weekKey, questFor, medals, newMedals, awardsForSession, summarise,
};
