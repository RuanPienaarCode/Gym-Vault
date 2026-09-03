'use strict';
/* ONE WORD, ONE RULE (issue #20).

   THE BUG THIS REPRODUCES. Three surfaces printed the word "sessions" and
   counted three different things:

     Today    workoutDates().length   UNIQUE DATES
     History  dated files             files, but the LIST showed undated ones too
     Export   pickWorkouts().length   files

   Two sessions on one day are first-class here — "Log another session" is a
   button on the dashboard — so logging a lift and then a run showed 1 on
   Today and 2 in History, with nothing to say which was wrong. And History's
   own number disagreed with the cards printed underneath it, because the
   count skipped undated notes the list still rendered.

   Settled: A SESSION IS A LOGGED WORKOUT NOTE. Two on one day are two. An
   undated note is one — someone recorded it and History already shows it.

   The streak and the heatmap keep counting unique DAYS, because a streak is
   genuinely a run of days; workoutDates() still answers that separate
   question, and this file pins the boundary between the two so they cannot
   be confused again. */
const assert = require('node:assert');
const Module = require('node:module');

const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
};
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));
const stats = require('../src/stats');
Module._load = origLoad;

const { sessionCount, sessionsInWeek, workoutDates, weekStreak, goalCurrent } = stats;

/* A week with a double day: Tuesday carries a lift AND a run, plus one
   undated note someone wrote without a date in the frontmatter. */
const w = (date, name) => ({ name: name || date, fm: { date }, rows: [{ exercise: 'X', set: 1, reps: '5' }] });
const WORKOUTS = [
  w('2026-09-01', 'mon lift'),
  w('2026-09-02', 'tue lift'),
  w('2026-09-02', 'tue run'),
  w('2026-09-04', 'fri lift'),
  w('', 'undated'),
];

/* ---------- 1. a session is a note; two on one day are two ---------- */
{
  assert.strictEqual(sessionCount(WORKOUTS), 5,
    'five notes are five sessions — the undated one included, because History already shows it');
  assert.strictEqual(sessionsInWeek(WORKOUTS, '2026-09-02', 'mon'), 4,
    'four dated notes fall in that week, and the double day counts twice');

  /* The old rule, kept here so the fixture is proven to exercise the bug. */
  const dates = workoutDates(WORKOUTS);
  assert.strictEqual(dates.length, 3, 'three distinct training days');
  assert.notStrictEqual(dates.length, sessionCount(WORKOUTS),
    'the fixture must actually disagree under the old rule, or this test proves nothing');
}

/* ---------- 2. THE THREE SURFACES ACTUALLY CALL IT ---------- */

/* Asserting sessionCount(X) === sessionCount(X) would prove nothing. What
   has to be true is that each of the three screens ROUTES THROUGH the helper
   instead of keeping the local count it had. Two of the three cannot be
   required in node (page-dashboard and page-history pull the page graph and
   the obsidian host), so the call sites are pinned in source — the
   page-headings.test.cjs precedent — and the old expressions are named so
   they cannot quietly return. */
{
  const fs = require('node:fs');
  const path = require('node:path');
  const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  const dash = read('page-dashboard.js');
  assert.match(dash, /sessionCount\(data\.workouts\)/,
    'Today\'s "sessions all time" tile must count sessions, not distinct dates');
  assert.match(dash, /sessionsInWeek\(data\.workouts, today, settings\.weekStart\)/,
    'and "sessions this week" with it');
  assert.ok(!/fmt\(dates\.length\)/.test(dash),
    'dates.length is the TRAINING-DAY count — it must not be printed under the word sessions again');

  const hist = read('page-history.js');
  assert.match(hist, /const counted = sessionCount\(data\.workouts\)/,
    'History\'s toolbar must use the same rule');
  assert.ok(!/data\.workouts\.filter\(w => workoutDate\(w\)\)\.length/.test(hist),
    'counting only DATED files is what made the toolbar disagree with the cards below it');

  const exp = read('export.js');
  assert.match(exp, /const sessions = sessionCount\(workouts\)/,
    'the export summary must route through the helper, so a change to the rule reaches all three');

  /* History's number must equal the number of CARDS it renders, and the list
     walks data.workouts unfiltered — which is exactly why undated notes had
     to join the count rather than leave the list. */
  assert.match(hist, /const sessions = \[\.\.\.data\.workouts\]\.reverse\(\)/,
    'the list renders every note, so the count above it must too');
  assert.strictEqual(sessionCount(WORKOUTS), WORKOUTS.length,
    'the toolbar count must equal the number of cards below it');
}

/* ---------- 2b. and the streak keeps its own, different rule ---------- */
{
  const fs = require('node:fs');
  const path = require('node:path');
  const dash = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-dashboard.js'), 'utf8');
  assert.match(dash, /weekStreak\(dates/,
    'the streak must still be built from workoutDates — two notes on one Tuesday are not two days');
}

/* ---------- 3. the streak still counts DAYS, and must ---------- */
{
  /* Two sessions on Tuesday are not two days of training. Nothing about
     this fix may inflate a streak. */
  const dates = workoutDates(WORKOUTS);
  assert.deepStrictEqual(dates, ['2026-09-01', '2026-09-02', '2026-09-04'],
    'the double day collapses to one date, and the undated note has none');
  assert.strictEqual(weekStreak(dates, 'mon', '2026-09-04'), 1,
    'the streak is weeks of training days and is unaffected by how many notes each day holds');
}

/* ---------- 4. the "workouts per week" goal uses the same word ---------- */
{
  /* A goal of four a week met by two doubles and no third day used to report
     2 — the tile beside it and the History list both said 4. */
  const goal = { fm: { metric: 'workouts-per-week', target: 4 } };
  const current = goalCurrent(goal, { workouts: WORKOUTS, today: '2026-09-02', weekStart: 'mon' });
  assert.strictEqual(current, 4,
    'a goal that says "sessions" must count what every other surface calls a session');

  /* Undated notes belong to no week, so they cannot inflate a weekly goal. */
  const onlyUndated = goalCurrent(goal, { workouts: [w('', 'undated')], today: '2026-09-02', weekStart: 'mon' });
  assert.strictEqual(onlyUndated, 0,
    'a note with no date is in no week — countable all-time, never this week');
}

/* ---------- 5. edges ---------- */
{
  assert.strictEqual(sessionCount([]), 0);
  assert.strictEqual(sessionCount(null), 0, 'a page rendering before data lands must not throw');
  assert.strictEqual(sessionsInWeek(null, '2026-09-02', 'mon'), 0);

  /* A timestamped date is the same day as a bare one — workoutDate's rule,
     which sessionsInWeek routes through rather than comparing raw strings. */
  const stamped = [{ name: 'a', fm: { date: '2026-09-02T09:00' }, rows: [] }];
  assert.strictEqual(sessionsInWeek(stamped, '2026-09-02', 'mon'), 1,
    'a timestamped note is in the week its day falls in');
}

console.log('session count OK (a session is a note; Today, History, Export and the goal all say the same number)');
