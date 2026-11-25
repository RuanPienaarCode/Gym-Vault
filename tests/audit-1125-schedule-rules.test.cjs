'use strict';
/* AUDIT 25 NOV 2026, LANE L3: THE SCHEDULING RULES EVERY PAGE READS.

   36  A Backup plan shows on any day with NO TRAINING SESSION from the main plan
       or the add-ons. A written rest day (plan-parse.isRestDay) is not a training
       session, so it no longer blocks the backup: the backup's day comes AFTER
       it. An add-on's training day still blocks the backup.
   37  When two add-ons train on one weekday, a starred plan comes first; with no
       star the order stays as loaded (by name). The main plan's day stays first.
   35  The Running page's plan: the active MAIN plan when it has a run in it, else
       an add-on (paused ones included) with a run in it, else null. Never a plan
       with no run in it.
   46  withRole(fm, role, { on }): a boolean `on` overrides the derived on/off of
       an alongside result. Without it nothing changes.
   24  resumeTarget(draft, mark): where "Resume" goes - the guided screen when the
       draft was last open there, the log otherwise or when nothing is known.

   Every case drives the real exported function. Synthetic plans only. */
const assert = require('node:assert');
const Module = require('node:module');

const origLoad = Module._load;
const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Plugin: class {}, ItemView: class {},
  PluginSettingTab: class {}, Setting: class {}, TFile: class {}, TFolder: class {},
  normalizePath: p => p, requestUrl: () => {},
};
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));
const controller = require('../src/controller');
const P = require('../src/plan-parse');
Module._load = origLoad;

const { resolveDaysOn, runPlanOf, parallelPlansOf, fallbackPlansOf } = controller;

const results = [];
const check = (name, fn) => { try { fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };

const plan = (name, fm, days) => ({
  name, fm: { ...fm }, file: { path: `Gym/Plans/${name}.md` },
  model: { intro: [], days: days.map(d => ({ name: d.name, weekday: d.weekday, notes: [], items: d.items || [], parts: [] })) },
});
const names = got => got.map(x => `${x.plan.name}/${x.day.name}`);
const run = ex => [{ exercise: ex, sets: 1, target: '5 km' }];
const isRun = n => /run/i.test(n || '');

/* ---- 36: Backup vs a rest day / an add-on training day ------------------- */
const MAIN = plan('Lunch Plan', { active: true }, [
  { name: 'Upper', weekday: 'mon' }, { name: 'Rest', weekday: 'tue' }, { name: 'Lower', weekday: 'wed' },
]);
const BACKUP = plan('Rest & Recovery', { fallback: true }, [{ name: 'Mobility', weekday: 'any' }]);
const ADDON = plan('Trail Base', { parallel: true }, [{ name: 'Easy Run', weekday: 'tue', items: run('Trail Run') }]);
const ADDON_REST = plan('Swim Base', { parallel: true }, [{ name: 'Recovery', weekday: 'thu' }]);

check('36: a main-plan rest day does not block the Backup; the Backup comes AFTER it', () => {
  const got = resolveDaysOn('tue', MAIN, [], [BACKUP]);
  assert.deepStrictEqual(names(got), ['Lunch Plan/Rest', 'Rest & Recovery/Mobility']);
});
check('36: an add-on TRAINING day still blocks the Backup', () => {
  const got = resolveDaysOn('tue', MAIN, [ADDON], [BACKUP]);
  assert.deepStrictEqual(names(got), ['Lunch Plan/Rest', 'Trail Base/Easy Run']);
});
check('36: an add-on REST day is not a workout either, so the Backup shows after it', () => {
  const got = resolveDaysOn('thu', MAIN, [ADDON_REST], [BACKUP]);
  assert.deepStrictEqual(names(got), ['Swim Base/Recovery', 'Rest & Recovery/Mobility']);
});
check('36: a main-plan training day blocks the Backup (unchanged)', () => {
  assert.deepStrictEqual(names(resolveDaysOn('mon', MAIN, [], [BACKUP])), ['Lunch Plan/Upper']);
});
check('36: nothing scheduled at all -> the Backup alone (unchanged)', () => {
  assert.deepStrictEqual(names(resolveDaysOn('fri', MAIN, [], [BACKUP])), ['Rest & Recovery/Mobility']);
});
check('36: still only ONE Backup plan fills the day', () => {
  const second = plan('Stretch', { fallback: true }, [{ name: 'Stretch', weekday: 'any' }]);
  assert.deepStrictEqual(names(resolveDaysOn('tue', MAIN, [], [BACKUP, second])), ['Lunch Plan/Rest', 'Rest & Recovery/Mobility']);
});

/* ---- 37: two add-ons on one weekday --------------------------------------- */
const GTG = plan('Grease the Groove', { parallel: true }, [{ name: 'Grease', weekday: 'sat' }]);
const TRAIL = plan('Trail Base', { parallel: true }, [{ name: 'Long Trail Run', weekday: 'sat', items: run('Trail Run') }]);
const starred = p => plan(p.name, { ...p.fm, favourite: true }, p.model.days);

check('37: no star -> the loaded order (by name) stays', () => {
  assert.deepStrictEqual(names(resolveDaysOn('sat', MAIN, [GTG, TRAIL], [])), ['Grease the Groove/Grease', 'Trail Base/Long Trail Run']);
});
check('37: a starred add-on leads the day', () => {
  assert.deepStrictEqual(names(resolveDaysOn('sat', MAIN, [GTG, starred(TRAIL)], [])), ['Trail Base/Long Trail Run', 'Grease the Groove/Grease']);
});
check('37: both starred -> the loaded order again', () => {
  assert.deepStrictEqual(names(resolveDaysOn('sat', MAIN, [starred(GTG), starred(TRAIL)], [])), ['Grease the Groove/Grease', 'Trail Base/Long Trail Run']);
});
check("37: the main plan's day stays first, even before a starred add-on", () => {
  const main = plan('Main', { active: true }, [{ name: 'Strength', weekday: 'sat' }]);
  assert.deepStrictEqual(names(resolveDaysOn('sat', main, [GTG, starred(TRAIL)], [])), ['Main/Strength', 'Trail Base/Long Trail Run', 'Grease the Groove/Grease']);
});
check('37: the list passed in is not reordered in place', () => {
  const list = [GTG, starred(TRAIL)];
  resolveDaysOn('sat', MAIN, list, []);
  assert.deepStrictEqual(list.map(p => p.name), ['Grease the Groove', 'Trail Base']);
});

/* ---- 34 (check only): an add-on's `(any)` day stays off Today ------------- */
check("34: an add-on's (any) day is still not placed on Today", () => {
  const mob = plan('Mobility', { parallel: true }, [{ name: 'Mobility', weekday: 'any' }]);
  assert.deepStrictEqual(names(resolveDaysOn('thu', MAIN, [mob], [])), []);
});

/* ---- 35: runPlanOf -------------------------------------------------------- */
const RUN_MAIN = plan('5 km Plan', { active: true }, [{ name: 'Easy', weekday: 'tue', items: run('Easy Run') }]);
const LIFT_ADDON = plan('Arms', { parallel: true }, [{ name: 'Curls', weekday: 'mon', items: [{ exercise: 'Curl', sets: 3, target: '10' }] }]);
const RUN_ADDON = plan('Trail Base', { parallel: true }, [{ name: 'Long Run', weekday: 'sat', items: run('Trail Run') }]);

check('35: an active MAIN plan with a run in it is the running plan, before any add-on', () => {
  assert.strictEqual(runPlanOf([RUN_MAIN, LIFT_ADDON, RUN_ADDON], isRun), RUN_MAIN);
});
check('35: only non-run add-ons (and a main with no run) -> null, never a plan with no run', () => {
  assert.strictEqual(runPlanOf([MAIN, LIFT_ADDON], isRun), null);
});
check('35: a PAUSED run add-on is still found when the main plan has no run', () => {
  const paused = plan('Trail Base', { parallel: true, paused: true }, RUN_ADDON.model.days);
  assert.strictEqual(runPlanOf([MAIN, LIFT_ADDON, paused], isRun), paused);
});
check('35: an inactive main run plan is not picked over the active one', () => {
  const off = plan('15 km Plan', { active: false }, RUN_MAIN.model.days);
  assert.strictEqual(runPlanOf([MAIN, off, LIFT_ADDON], isRun), null);
});

/* ---- 46: withRole { on } -------------------------------------------------- */
check('46: a main plan Today follows implicitly (no active key) made an Add-on with { on: true } arrives ON', () => {
  assert.deepStrictEqual(P.withRole({ x: 1 }, 'parallel', { on: true }), { x: 1, parallel: true });
});
check('46: { on: false } makes an active main plan arrive paused', () => {
  assert.deepStrictEqual(P.withRole({ active: true }, 'fallback', { on: false }), { fallback: true, paused: true });
});
check('46: { on: true } turns a paused add-on moved to Backup on', () => {
  assert.deepStrictEqual(P.withRole({ parallel: true, paused: true }, 'fallback', { on: true }), { fallback: true });
});
check('46: no third argument -> unchanged (no active key still arrives paused)', () => {
  assert.deepStrictEqual(P.withRole({}, 'parallel'), { parallel: true, paused: true });
  assert.deepStrictEqual(P.withRole({ active: true }, 'parallel'), { parallel: true });
});
check('46: a non-boolean on is ignored', () => {
  assert.deepStrictEqual(P.withRole({}, 'parallel', { on: 'true' }), { parallel: true, paused: true });
  assert.deepStrictEqual(P.withRole({}, 'parallel', {}), { parallel: true, paused: true });
});
check('46: becoming MAIN still never takes Today over, whatever on says', () => {
  assert.deepStrictEqual(P.withRole({ parallel: true }, 'main', { on: true }), { active: false });
});

/* ---- 24: resumeTarget / liveViewOf --------------------------------------- */
check('24: resumeTarget and liveViewOf are exported', () => {
  assert.strictEqual(typeof controller.resumeTarget, 'function');
  assert.strictEqual(typeof controller.liveViewOf, 'function');
});
check('24: a draft last open on the set-by-set screen goes back there', () => {
  const d = { entries: [] };
  const mark = { draft: d, view: controller.liveViewOf('session', d) };
  assert.strictEqual(mark.view, 'guided');
  assert.strictEqual(controller.resumeTarget(d, mark), 'session');
});
check('24: a timed draft goes back to the timed screen while its schedule is held', () => {
  const d = { entries: [], timed: { intervals: [] } };
  const mark = { draft: d, view: controller.liveViewOf('session', d) };
  assert.strictEqual(mark.view, 'timed');
  assert.strictEqual(controller.resumeTarget(d, mark), 'session');
  delete d.timed; // a relaunch drops the schedule (draft-store.js)
  assert.strictEqual(controller.resumeTarget(d, mark), 'log');
});
check('24: a log-only draft, an unknown mark, and a mark for another draft all go to the log', () => {
  const d = { entries: [] };
  assert.strictEqual(controller.resumeTarget(d, { draft: d, view: controller.liveViewOf('log', d) }), 'log');
  assert.strictEqual(controller.resumeTarget(d, null), 'log');
  assert.strictEqual(controller.resumeTarget(d, { draft: { entries: [] }, view: 'guided' }), 'log');
  assert.strictEqual(controller.resumeTarget(null, { draft: d, view: 'guided' }), null);
  assert.strictEqual(controller.liveViewOf('plans', d), null);
  assert.strictEqual(controller.liveViewOf('session', null), null);
});

/* The real wrappers, so the closure in mountApp is the rule above. */
check('wiring: Today still reads resolveDaysOn over the filtered lists', () => {
  const plans = [MAIN, GTG, starred(TRAIL), BACKUP];
  const got = resolveDaysOn('sat', P.activePlanOf(plans), parallelPlansOf(plans), fallbackPlansOf(plans));
  assert.deepStrictEqual(names(got), ['Trail Base/Long Trail Run', 'Grease the Groove/Grease']);
});

const failed = results.filter(([, e]) => e);
for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${String(e.message).split('\n')[0]}` : ''}`);
if (failed.length) { console.error(`${failed.length} of ${results.length} schedule-rule checks failed`); process.exit(1); }
console.log(`audit-1125 schedule rules OK (${results.length} checks)`);
