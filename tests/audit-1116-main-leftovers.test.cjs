'use strict';
/* Audit 16 Nov 2026, integration — the seams between the fix lanes.

   Each lane fixed a rule inside its own files and reported the callers it
   could not reach. These are those callers, each one a second copy of a rule
   that had just been made single:

   - stats.weightSeries sorted by raw text while data.compareBodyRows sorted by
     the parsed day, so the Profile tile and the weight trend disagreed.
   - stats.setCounts counted a lone `.` as a figure (a set of "." reps).
   - data.findMissingExercises compared the plan line's name, not the file name
     the note is saved under ("90/90 Hip Switch" lives in "90-90 Hip Switch").
   - export.js passed no body log to goalProgress (0% where Goals showed 43%),
     and let a `|` in a Body Log note add a column to the summary table.
   - page-dashboard.js printed "5 × " for a line with a count and no target,
     where Plans and the export print "5 sets" (plan-parse.rxLabel).
   - page-history.js printed a session count that no longer includes
     weekly-challenge goes, above a list that does. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const T = require('./f3-stub');
const { loadSrc, makeRunner } = require('./gym-fake-vault');
const stats = require('../src/stats');
const { buildSummary, buildJson } = require('../src/export');
const { BODY_COLUMNS } = require('../src/constants');

void T;
const { findMissingExercises } = loadSrc('data.js');
const { check, run } = makeRunner();
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

check('weightSeries: the trend ends on the latest DAY, not the last string', () => {
  const s = stats.weightSeries([
    { date: '2026-09-15', weight_kg: '84' },
    { date: '2026-8-6', weight_kg: '99' },
    { date: '2026-11-01', weight_kg: '81' },
  ]);
  assert.strictEqual(s[s.length - 1].value, 81, `trend ends on ${JSON.stringify(s[s.length - 1])}`);
  assert.ok(s.every(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date)), `an unreadable date is in the trend: ${JSON.stringify(s)}`);
});

check('setCounts: a lone decimal point is not a figure', () => {
  assert.strictEqual(stats.setCounts({ touched: true, reps: '.' }), false, 'a set of "." reps counted');
  assert.strictEqual(stats.setCounts({ touched: true, reps: ' ', weight_kg: '.' }), false);
});

check('setCounts: real figures and ticked sets still count (control)', () => {
  assert.strictEqual(stats.setCounts({ touched: true, reps: '8' }), true);
  assert.strictEqual(stats.setCounts({ touched: true, weight_kg: '62,5' }), true);
  assert.strictEqual(stats.setCounts({ touched: true, distance_km: '.5' }), true);
  assert.strictEqual(stats.setCounts({ done: true, reps: '' }), true);
  assert.strictEqual(stats.setCounts({ touched: false, reps: '8' }), false);
});

check('findMissingExercises: a note saved under its folded file name is not missing', () => {
  const data = {
    exercises: [{ name: '90-90 Hip Switch' }],
    plans: [{ name: 'Mobility', model: { days: [{ items: [{ exercise: '90/90 Hip Switch' }] }] } }],
    goals: [],
  };
  assert.deepStrictEqual(findMissingExercises(data).map(m => m.name), []);
});

check('findMissingExercises: a genuinely missing exercise is still reported (control)', () => {
  const data = {
    exercises: [{ name: 'Push-ups' }],
    plans: [{ name: 'P', model: { days: [{ items: [{ exercise: 'Push-ups' }, { exercise: 'Nordic Curl' }] }] } }],
    goals: [],
  };
  assert.deepStrictEqual(findMissingExercises(data).map(m => m.name), ['Nordic Curl']);
});

const goalData = () => ({
  profile: { fm: {}, body: '' },
  workouts: [], exercises: [], plans: [],
  /* No start_value: the baseline has to come from the body log. */
  goals: [{ name: 'Cut', fm: { metric: 'body-weight', target: '78', direction: 'decrease' }, file: { stat: { ctime: Date.parse('2026-10-01T08:00:00') } } }],
  body: [{ date: '2026-10-01', weight_kg: '82.4' }, { date: '2026-11-10', weight_kg: '80.5' }],
});

check('export: a decrease goal reads its baseline from the body log, as Goals does', () => {
  const data = goalData();
  const sctx = { workouts: [], body: data.body, weekStart: 'mon', today: '2026-11-16', exercises: [] };
  const cur = stats.goalCurrent(data.goals[0], sctx);
  const onGoals = stats.goalProgress(data.goals[0], cur, sctx);
  assert.ok(onGoals > 0, `fixture: Goals itself shows ${onGoals}`);
  const j = JSON.parse(buildJson(data, { today: '2026-11-16', days: 0, weekStart: 'mon' }));
  assert.strictEqual(j.goals[0].progress, onGoals, `export ${j.goals[0].progress} vs Goals ${onGoals}`);
  const pct = `${Math.round(onGoals * 100)}%`;
  const row = buildSummary(data, { today: '2026-11-16', days: 0, weekStart: 'mon' }).split('\n').find(l => /^\| Cut \|/.test(l));
  assert.ok(row && row.includes(pct), `summary row "${row}" should say ${pct}`);
});

check('export: a | in a Body Log note does not add a column to the summary table', () => {
  const data = goalData();
  data.goals = [];
  data.body = [{ date: '2026-11-10', weight_kg: '80.5', note: 'am | fasted' }];
  const out = buildSummary(data, { today: '2026-11-16', days: 0, includeBody: true, includeHealth: true });
  const lines = out.split('\n');
  const head = lines.findIndex(l => l.includes(BODY_COLUMNS[0].label) && l.trim().startsWith('|') && /weight/i.test(l));
  assert.ok(head >= 0, 'fixture: the body table is in the summary');
  const cells = l => l.replace(/\\\|/g, '').split('|').length;
  assert.strictEqual(cells(lines[head + 2]), cells(lines[head]), `row has a different column count: ${lines[head + 2]}`);
  assert.ok(lines[head + 2].includes('am \\| fasted'), `the note should be escaped: ${lines[head + 2]}`);
});

check('Today prints a prescription through plan-parse.rxLabel, like Plans and the export', () => {
  const s = src('page-dashboard.js');
  assert.ok(!/\$\{it\.sets\} × \$\{it\.target\}/.test(s), 'page-dashboard.js still builds "N × target" by hand');
  assert.ok(/rxLabel\(it\)/.test(s), 'page-dashboard.js should call rxLabel(it)');
});

check('History names challenge goes apart from the session count', () => {
  const s = src('page-history.js');
  assert.ok(/data\.workouts\.filter\(isChallengeRun\)/.test(s), 'History should count challenge goes with stats.isChallengeRun');
  assert.ok(/challenge \$\{goes === 1 \? 'go' : 'goes'\}/.test(s), 'History should say how many challenge goes are listed');
});

check('a restored draft still knows which figures were typed (so a kill cannot re-arm a prefill record)', () => {
  const ds = require('../src/draft-store');
  const flow = require('../src/session-flow');
  const now = Date.parse('2026-11-16T10:00:00');
  const draft = {
    date: '2026-11-16', plan: 'P', day: 'A', startedAt: now - 600000,
    entries: [{ exercise: 'Bench Press', target: '8 @ 60kg', weighted: true, sets: [
      { reps: '6', weight_kg: '60', done: true, touched: true, typed: { reps: true } },
      { reps: '8', weight_kg: '60', done: true, touched: true, typed: {} },
      { reps: '8', weight_kg: '62.5', done: true, touched: true },
    ] }],
  };
  const back = ds.restoreDraft(JSON.parse(JSON.stringify(ds.snapshotDraft(draft, now))), now + 1000);
  assert.ok(back, 'fixture: the draft restores');
  const [a, b, c] = back.entries[0].sets;
  assert.deepStrictEqual(flow.typedKinds(a), ['reps'], `typed reps only, restored as ${JSON.stringify(flow.typedKinds(a))}`);
  assert.deepStrictEqual(flow.typedKinds(b), [], 'an empty record means nothing typed, and stays that way');
  assert.deepStrictEqual(flow.typedKinds(c), ['reps', 'weight', 'seconds'], 'a set with no record (an older draft) keeps the old answer');
});

run("audit-1116-main-leftovers");
