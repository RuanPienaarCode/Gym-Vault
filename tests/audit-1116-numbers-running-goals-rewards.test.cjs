'use strict';
/* AUDIT 16 NOV 2026, lane NUMBERS: #21, #29, #30, #31.

   #21  Running's headline long run came from stats.ladderWeek(today) on a Monday
        cycle and ignored "Week starts on", while the "This week" list below it
        followed the setting. Seed ladder, start Mon 2 Nov, week starts Saturday,
        Mon 16 Nov: headline "6 km - Week 3 of 12", list long run Sat 14 Nov 5 km.
        Now the list and the headline call ONE function. "Recent runs" printed the
        raw fm.date instead of stats.workoutDate.
   #29  "1 PBs to go" / "1 weeks to go".
   #31  A body-weight goal's Direction defaulted to Increase, so a cut from 90 to
        80 kg was "done" the moment it was saved.
   #30  "Starting from" was empty, so a decrease goal read 0% until it was met. */
const assert = require('node:assert');
const T = require('./f3-stub');
const running = require('../src/page-running');
const goalsPage = require('../src/page-goals');
const stats = require('../src/stats');
const rewards = require('../src/rewards');
const view = require('../src/rewards-view');
const { SEED_RUN_PLAN } = require('../src/seed');
const { parsePlanBody } = require('../src/plan-parse');
const { addDays, weekdayKey } = require('../src/dates');

const failures = [];
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${String(e && e.message).split('\n')[0]}`); }
};

/* ---------------------------------------------------------------- #21 */

const RealDate = Date;
function at(iso, fn) {
  const [y, m, d] = iso.split('-').map(Number);
  const fixed = new RealDate(y, m - 1, d, 12, 0, 0).getTime();
  global.Date = class extends RealDate { constructor(...a) { if (a.length === 0) super(fixed); else super(...a); } static now() { return fixed; } };
  try { return fn(); } finally { global.Date = RealDate; }
}
const LADDER = SEED_RUN_PLAN.fm.ladder;
const START = '2026-11-02';                                   // a Monday
const plan = { name: SEED_RUN_PLAN.name, fm: { parallel: 'true', ladder: LADDER, start_date: START }, model: parsePlanBody(SEED_RUN_PLAN.body) };
const exercises = [{ name: 'Long Trail Run', fm: { unit: 'km' } }, { name: 'Easy Run', fm: { unit: 'km' } }];
const mkCtx = (weekStart, workouts) => ({
  app: {}, data: { workouts: workouts || [], exercises }, settings: { weekStart }, state: {}, nav() {}, startLog() {}, runPlan: () => plan,
});
const norm = s => s.replace(/\s+/g, ' ').trim();

test('control: the seed plan parses to a Saturday long run named "Long Trail Run"', () => {
  assert.ok(plan.model.days.some(d => d.weekday === 'sat' && /long/i.test(d.name)), JSON.stringify(plan.model.days.map(d => [d.name, d.weekday])));
});
test('#21 headline long run == the long run in the "This week" list, every weekday x every week start', () => {
  let checked = 0;
  for (const weekStart of ['mon', 'sat', 'sun']) {
    for (let i = 0; i < 28; i++) {
      const today = addDays('2026-11-09', i);                  // four weeks, all 7 weekdays four times
      const root = at(today, () => T.render(running, mkCtx(weekStart)));
      const mark = T.findAll(root, 'gv-mark')[0];
      const sub = T.findAll(root, 'gv-hero-sub')[0];
      const rows = T.findAll(root, 'gv-runday').filter(n => /Long Trail Run/.test(n.textContent));
      const why = `today ${today} (${weekdayKey(today)}), week starts ${weekStart}`;
      assert.strictEqual(rows.length, 1, `one long run in the list, ${why}`);
      const listKm = norm(T.findAll(rows[0], 'gv-runday-rx')[0].textContent);
      const m = norm(sub.textContent).match(/^Week (\d+) of 12/);
      assert.ok(m, `no "Week N of 12" in the headline, ${why}: ${norm(sub.textContent)}`);
      assert.strictEqual(norm(mark.textContent), listKm, `headline ${norm(mark.textContent)} vs list ${listKm}, ${why}`);
      assert.strictEqual(`${LADDER[+m[1] - 1]} km`, listKm, `"Week ${m[1]}" is not the list's rung, ${why}`);
      checked++;
    }
  }
  assert.strictEqual(checked, 84);
});
test('#21 the issue\'s example: seed ladder, start Mon 2 Nov, week starts Saturday, Mon 16 Nov -> headline 5 km, Week 2', () => {
  const root = at('2026-11-16', () => T.render(running, mkCtx('sat')));
  assert.strictEqual(norm(T.findAll(root, 'gv-mark')[0].textContent), '5 km');
  assert.ok(/^Week 2 of 12/.test(norm(T.findAll(root, 'gv-hero-sub')[0].textContent)));
});
test('#21 a Monday week start is unchanged: Mon 16 Nov is week 3, 6 km, both places', () => {
  const root = at('2026-11-16', () => T.render(running, mkCtx('mon')));
  assert.strictEqual(norm(T.findAll(root, 'gv-mark')[0].textContent), '6 km');
});
test('#21 the ladder strip marks the same rung the headline names', () => {
  for (const weekStart of ['mon', 'sat', 'sun']) {
    const root = at('2026-11-16', () => T.render(running, mkCtx(weekStart)));
    const now = T.findAll(root, 'gv-rung').filter(n => /\bnow\b/.test(n.className));
    const m = norm(T.findAll(root, 'gv-hero-sub')[0].textContent).match(/^Week (\d+)/);
    assert.strictEqual(now.length, 1, weekStart);
    assert.ok(new RegExp(`w${m[1]}$`).test(norm(now[0].textContent)), `${weekStart}: strip says ${norm(now[0].textContent)}, headline week ${m[1]}`);
  }
});
test('#21 a week with no long-run day still gets the old headline (today\'s rung)', () => {
  const noLong = { ...plan, model: { ...plan.model, days: plan.model.days.filter(d => !/long/i.test(d.name)) } };
  const ctx = { ...mkCtx('mon'), runPlan: () => noLong };
  const root = at('2026-11-16', () => T.render(running, ctx));
  assert.strictEqual(norm(T.findAll(root, 'gv-mark')[0].textContent), '6 km');
});
test('#21 "Recent runs" prints stats.workoutDate, never the raw fm.date text', () => {
  const w = { name: 'r', file: { path: 'r.md' }, fm: { date: 'next Tuesday' }, rows: [{ exercise: 'Easy Run', distance_km: '5', seconds: '1800' }] };
  const root = at('2026-11-16', () => T.render(running, mkCtx('mon', [w])));
  assert.ok(!/next Tuesday/.test(root.textContent), 'the raw date string was printed');
  const ok = { ...w, fm: { date: '2026-11-14T08:30' } };
  const root2 = at('2026-11-16', () => T.render(running, mkCtx('mon', [ok])));
  assert.ok(/14 Nov/.test(root2.textContent), 'control: a date-time still prints as its day');
});

/* ---------------------------------------------------------------- #29 */

test('#29 every medal unit takes its singular at exactly 1 to go, and stays plural at 0 and 2', () => {
  const medals = rewards.medals({ workouts: [], exercises: [], weekStart: 'mon' });
  const units = [...new Set(medals.map(m => m.unit))];
  assert.ok(units.length >= 5, units.join());
  const detail = (unit, left) => view.medalsSection([{ key: 'x', name: 'X', unit, tierIndex: -1, tier: 'locked', progress: { value: 10, next: 10 + left, pct: 10 }, earned: {}, tiers: [] }]).tiles[0].detail;
  assert.strictEqual(detail('PBs', 1), '1 PB to go');
  assert.strictEqual(detail('weeks', 1), '1 week to go');
  assert.strictEqual(detail('sessions', 1), '1 session to go');
  assert.strictEqual(detail('reps', 1), '1 rep to go');
  assert.strictEqual(detail('km', 1), '1 km to go');
  assert.strictEqual(detail('kg', 1), '1 kg to go');
  assert.strictEqual(detail('PBs', 2), '2 PBs to go');
  assert.strictEqual(detail('weeks', 0), '0 weeks to go');
  assert.strictEqual(detail('reps', 1000), '1,000 reps to go');
});

/* ------------------------------------------------------------ #30 / #31 */

const body = [{ date: '2026-10-05', weight_kg: '95' }, { date: '2026-10-22', weight_kg: '82.4' }, { date: '2026-11-10', weight_kg: '80.5' }];
const ctxFor = rows => ({ app: {}, data: { exercises: [], goals: [], body: rows }, settings: {}, state: {} });
const defaultOf = key => goalsPage.goalFields(ctxFor(body), null).find(f => f.key === key).value;

test('#31 a NEW goal\'s Direction is not pre-chosen (auto), an edited goal shows its own', () => {
  assert.strictEqual(defaultOf('direction'), 'auto');
  const edit = goalsPage.goalFields(ctxFor(body), { fm: { metric: 'body-weight', direction: 'decrease' } }).find(f => f.key === 'direction');
  assert.strictEqual(edit.value, 'decrease');
  assert.ok(!edit.options.some(o => o[0] === 'auto'), 'an existing goal has an explicit direction; no Auto');
});
const form = o => Object.assign({ metric: 'body-weight', exercise: '', target: '78', start_value: '', direction: defaultOf('direction'), deadline: '', challenge: false }, o);
test('#31 a cut entered without touching Direction is a decrease, and is not "done" when saved', () => {
  const fm = goalsPage.goalFm(form({ target: '80' }), {}, [{ date: '2026-11-10', weight_kg: '90' }]);
  assert.strictEqual(fm.direction, 'decrease');
  const g = { fm };
  assert.strictEqual(stats.goalProgress(g, 90), 0, 'a cut from 90 to 80 read as done');
});
test('#31 a target above the current weight is an increase; no weight logged is an increase', () => {
  assert.strictEqual(goalsPage.goalFm(form({ target: '95' }), {}, body).direction, 'increase');
  assert.strictEqual(goalsPage.goalFm(form({ target: '70' }), {}, []).direction, 'increase');
});
test('#31 an explicit choice is never overridden', () => {
  assert.strictEqual(goalsPage.goalFm(form({ target: '70', direction: 'increase' }), {}, body).direction, 'increase');
  assert.strictEqual(goalsPage.goalFm(form({ target: '95', direction: 'decrease' }), {}, body).direction, 'decrease');
});
test('#31 other metrics: "auto" is simply increase, as before', () => {
  assert.strictEqual(goalsPage.goalFm(form({ metric: 'exercise-reps', exercise: 'Push-ups', target: '10' }), {}, body).direction, 'increase');
});
test('#30 "Starting from" defaults to the current body-log weight at creation', () => {
  const fm = goalsPage.goalFm(form({ target: '78' }), {}, body);
  assert.strictEqual(fm.start_value, 80.5);
  assert.strictEqual(goalsPage.goalFm(form({ target: '78', start_value: '84' }), {}, body).start_value, 84, 'a typed start is kept');
  assert.strictEqual(goalsPage.goalFm(form({ target: '78' }), {}, []).start_value, '', 'nothing logged: nothing to default to');
  assert.strictEqual(goalsPage.goalFm(form({ metric: 'exercise-reps', exercise: 'Push-ups', target: '10' }), {}, body).start_value, '', 'only a body-weight goal');
});
test('#30 editing an existing goal never fills a blank start in behind the user', () => {
  const fm = goalsPage.goalFm(form({ target: '78', direction: 'decrease' }), { metric: 'body-weight', direction: 'decrease' });
  assert.strictEqual(fm.start_value, '');
  assert.strictEqual(fm.direction, 'decrease');
});

const stat = iso => ({ ctime: new RealDate(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), 12).getTime() });
const old = (fm, created) => ({ name: 'Cut', file: { path: 'Gym/Goals/Cut.md', stat: created ? stat(created) : undefined }, fm: Object.assign({ metric: 'body-weight', target: 78, direction: 'decrease' }, fm) });
test('#30 an existing decrease goal with no start falls back to the earliest weight on or after its creation (82.4 -> 80.5 toward 78 is 43%, not 0%)', () => {
  const g = old({}, '2026-10-20');
  const cur = stats.goalCurrent(g, { workouts: [], body });
  assert.strictEqual(cur, 80.5);
  const p = stats.goalProgress(g, cur, { body });
  assert.ok(Math.abs(p - (82.4 - 80.5) / (82.4 - 78)) < 1e-9, `progress ${p}`);
});
test('#30 the fallback only fills a gap: no creation date, no log, or an explicit start behave as today', () => {
  assert.strictEqual(stats.goalProgress(old({}, null), 80.5, { body }), 0, 'no creation date');
  assert.strictEqual(stats.goalProgress(old({}, '2026-10-20'), 80.5, { body: [] }), 0, 'no body log');
  assert.strictEqual(stats.goalProgress(old({}, '2026-10-20'), 80.5), 0, 'no ctx at all');
  const explicit = old({ start_value: 90 }, '2026-10-20');
  assert.ok(Math.abs(stats.goalProgress(explicit, 80.5, { body }) - (90 - 80.5) / (90 - 78)) < 1e-9, 'an explicit start_value is untouched');
  assert.strictEqual(stats.goalProgress(old({}, '2026-10-20'), 77, { body }), 1, 'met is still met');
});
test('#30 the Goals card uses it (43%)', () => {
  const g = old({}, '2026-10-20');
  const ctx = { app: {}, data: { goals: [g], workouts: [], body, exercises: [] }, settings: { weekStart: 'mon' }, state: {}, nav() {}, notice() {}, reload() {}, openFile() {}, io: {} };
  const text = norm(T.render(goalsPage, ctx).textContent);
  assert.ok(/43%/.test(text), text);
});

if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('audit-1116 numbers running, goals, rewards OK');
