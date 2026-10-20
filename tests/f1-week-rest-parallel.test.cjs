'use strict';
/* C-03: a parallel plan's day on a weekday the MAIN plan calls "Rest" is still planned work.

   progress.weekPlan took the first entry daysOn gave for the weekday and dropped
   it if it was a rest day, so the parallel plan's day behind it vanished from the
   week strip and the ring target while the quest still counted it. It now takes the
   first NON-rest entry (one rule, rewards.weekSchedule, shared with the quest). */
const assert = require('node:assert');
const { loadSrc, makeRunner } = require('./gym-fake-vault');
const R = loadSrc('rewards.js');
const P = loadSrc('progress.js');
const { resolveDaysOn } = loadSrc('controller.js');
const { parsePlanBody } = loadSrc('plan-parse.js');
const F = require('./rewards-fixtures');

const { check, run } = makeRunner();
const TODAY = '2026-10-21';
const main = { name: 'Main', fm: { active: 'true' }, model: parsePlanBody('## Upper (mon)\n\n- Push-ups | 3 x 10\n\n## Lower (wed)\n\n- Squat | 3 x 10\n\n## Rest (sat)\n\n- Walk | 1 x 20 min\n') };
const runPlan = { name: 'Run', fm: { parallel: 'true' }, model: parsePlanBody('## Long run (sat)\n\n- Easy Run | 1 x 8 km\n\n## Easy (thu)\n\n- Easy Run | 1 x 4 km\n') };
const daysOn = wk => resolveDaysOn(wk, main, [runPlan], []);

check('C03a the strip shows the parallel day on the weekday the main plan rests', () => {
  const strip = P.weekPlan(daysOn, TODAY, 'mon').map(d => `${d.wk}:${d.planDay ? d.planDay.name : '-'}`).join(' ');
  assert.strictEqual(strip, 'mon:Upper tue:- wed:Lower thu:Easy fri:- sat:Long run sun:-');
});

check('C03b the ring target is the days the strip shows (4), the same four days the quest counts', () => {
  const wp = P.weekProgress({ workouts: [], goals: [], daysOn, today: TODAY, weekStart: 'mon' });
  assert.strictEqual(wp.target, 4);
  const q = R.questFor({ daysOn, exercises: F.EXERCISES, workouts: [], today: TODAY, weekStart: 'mon' });
  assert.strictEqual(q.kind, 'sets');
  assert.strictEqual(q.target, 3 + 3 + 1 + 1, 'quest counts Upper, Lower, Easy and Long run');
});

check('C03c a rest-only main day with nothing behind it is still no planned day', () => {
  const only = { name: 'M', fm: {}, model: parsePlanBody('## Rest (sat)\n\n- Walk | 1 x 20 min\n') };
  const sat = P.weekPlan(wk => resolveDaysOn(wk, only, [], []), TODAY, 'mon').find(d => d.wk === 'sat');
  assert.strictEqual(sat.planDay, null);
});

run('f1-week-rest-parallel');
