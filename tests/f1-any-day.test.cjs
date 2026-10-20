'use strict';
/* C-01: an `(any)` plan day is counted ONCE per week.

   controller.resolveDaysOn hands the wildcard day to every weekday the plan
   leaves empty, so the quest and the week ring each saw the SAME day object up
   to seven times: "Do 119 sets this week" on a plan whose one session is 17
   sets, and a week target of 7 sessions. Both now read ONE rule,
   rewards.weekSchedule, which counts a wildcard day once.

   Real parse + real resolveDaysOn, the same chain Today uses. */
const assert = require('node:assert');
const { loadSrc, makeRunner } = require('./gym-fake-vault');
const R = loadSrc('rewards.js');
const P = loadSrc('progress.js');
const { resolveDaysOn } = loadSrc('controller.js');
const { parsePlanBody } = loadSrc('plan-parse.js');
const F = require('./rewards-fixtures');

const { check, run } = makeRunner();
const TODAY = '2026-10-21'; // a Wednesday; Mon-start week 19-25 Oct
const plan = (body, fm) => ({ name: 'P', fm: fm || {}, model: parsePlanBody(body) });
const quest = (p, parallel) => R.questFor({ daysOn: wk => resolveDaysOn(wk, p, parallel || [], []), exercises: F.EXERCISES, workouts: [], today: TODAY, weekStart: 'mon' });
const ring = (p, parallel, weekStart) => P.weekProgress({ workouts: [], goals: [], daysOn: wk => resolveDaysOn(wk, p, parallel || [], []), today: TODAY, weekStart: weekStart || 'mon' });

check('C01a an all-(any) plan: the quest asks for ONE session, not one per free weekday', () => {
  const p = plan('## Full body (any)\n\n- Push-ups | 3 x 10\n- Squat | 3 x 10\n');
  const q = quest(p);
  assert.strictEqual(q.target, 60, `quest target ${q.target}: one day of the plan is 3x10 + 3x10 = 60 reps (a title of "${q.title}")`);
});

check('C01b an all-(any) plan: the week ring targets ONE session', () => {
  const p = plan('## Full body (any)\n\n- Push-ups | 3 x 10\n');
  assert.strictEqual(ring(p).target, 1, 'the week target must not be 7');
});

check('C01c a mixed plan (Mon + Thu named, one any day): the any day once -> 3 sessions, 75 reps', () => {
  const p = plan('## Upper (mon)\n\n- Push-ups | 3 x 10\n\n## Lower (thu)\n\n- Squat | 3 x 10\n\n## Extra (any)\n\n- Pull-ups | 3 x 5\n');
  assert.strictEqual(quest(p).target, 30 + 30 + 15);
  assert.strictEqual(ring(p).target, 3);
});

check('C01d a normal plan (every weekday its own heading) is unchanged: quest and target sum every day', () => {
  const p = plan('## A (mon)\n\n- Push-ups | 3 x 10\n\n## B (wed)\n\n- Squat | 4 x 5\n\n## C (fri)\n\n- Push-ups | 2 x 12\n');
  assert.strictEqual(quest(p).target, 30 + 20 + 24);
  assert.strictEqual(ring(p).target, 3);
  assert.strictEqual(ring(p, [], 'sun').target, 3, 'a Sunday week start schedules the same three days');
});

check('C01e the strip still shows the any day on every free weekday (it can be trained any day)', () => {
  const p = plan('## Full body (any)\n\n- Push-ups | 3 x 10\n');
  const wp = P.weekPlan(wk => resolveDaysOn(wk, p, [], []), TODAY, 'mon');
  assert.strictEqual(wp.filter(d => d.planDay).length, 7);
});

check('C01f quest and ring read ONE rule: both come from rewards.weekSchedule', () => {
  assert.strictEqual(typeof R.weekSchedule, 'function');
});

run('f1-any-day');
