'use strict';
/* R2-08 / L2-08: the "Log today's workout" command looked the day up with
   plan.model.days.find(d => d.weekday === wk) - ignoring `(any)` days, parallel
   and fallback plans - so on a run or rest day it opened an EMPTY freestyle log
   under the strength plan's name. It now asks the rule Today uses (ctx.daysOn,
   a wrapper over controller.resolveDaysOn) and takes the same first entry. */
const assert = require('node:assert');
require('./f3-stub');
const GymPlugin = require('../src/main');
const { resolveDaysOn } = require('../src/controller');
const { weekdayKey } = require('../src/dates');

assert.strictEqual(typeof GymPlugin.logTargetFor, 'function', 'main.js exposes GymPlugin.logTargetFor');
const day = (name, weekday) => ({ name, weekday, items: [{ exercise: 'X', sets: 3, target: '5' }], notes: [] });
const plan = (name, days) => ({ name, fm: {}, model: { days, intro: [] } });
const mk = (active, parallel, fallback) => ({
  daysOn: wk => resolveDaysOn(wk, active, parallel, fallback),
});
const ISO = '2026-10-21'; // a Wednesday
const wk = weekdayKey(ISO);
const other = wk === 'mon' ? 'tue' : 'mon';

const strength = plan('Strength', [day('Push', wk === 'mon' ? 'tue' : 'mon')]);
const run = plan('Trail', [day('Easy Run', wk)]);
const rest = plan('Rest', [day('Recovery', 'any')]);
const anyPlan = plan('Anywhere', [day('Whenever', 'any')]);

let t = GymPlugin.logTargetFor(mk(strength, [run], []), ISO);
assert.deepStrictEqual([t.plan, t.day.name], [run, 'Easy Run'], 'a run day opens the RUN plan\'s day, not an empty log under the strength plan');
t = GymPlugin.logTargetFor(mk(strength, [], [rest]), ISO);
assert.deepStrictEqual([t.plan, t.day.name], [rest, 'Recovery'], 'a rest day resolves through the fallback plan');
t = GymPlugin.logTargetFor(mk(anyPlan, [], []), ISO);
assert.strictEqual(t.day.name, 'Whenever', 'an (any) day is honoured');
t = GymPlugin.logTargetFor(mk(plan('Own', [day('Mid', wk)]), [run], []), ISO);
assert.strictEqual(t.day.name, 'Mid', 'the active plan\'s own day still comes first (same order as Today)');
t = GymPlugin.logTargetFor(mk(strength, [], []), ISO);
assert.deepStrictEqual([t.plan, t.day], [null, null], 'nothing scheduled: a plain freestyle log, not one mislabelled with the strength plan');
console.log('f3 log command OK');
