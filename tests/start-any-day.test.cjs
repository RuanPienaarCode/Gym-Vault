'use strict';
/* START ANY DAY, ANY DAY (24 Nov 2026, Ruan: "I want to do my lunch time plan
   in the week"). A Friday-only plan had no Start on a Tuesday: Today said
   "Rest day" with only a freestyle log, and every Start on the plan page was
   ghost. plan-parse.startDayFor picks the day a plan's Start opens:
     S1 today's own day when the plan has one
     S2 else its `any` day (counts as today)
     S3 else the NEXT day it trains, wrapping round the week (not today)
     S4 rest days are never picked; a plan with nothing to train gives null
     S5 Today's rest hero carries a real Start for the next planned day, and
        the Plans list leads with an "In use" strip of start cards */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startDayFor } = require('../src/plan-parse');

const day = (weekday, name, items = [{ exercise: 'Push-ups' }]) => ({ weekday, name, items, notes: [] });
const plan = (...days) => ({ model: { days } });

const lunch = plan(day('fri', 'Lunch Circuit'));
let r = startDayFor(lunch, 'tue');
assert.strictEqual(r.day.name, 'Lunch Circuit', 'S3 a Friday plan starts its Friday day on a Tuesday');
assert.strictEqual(r.today, false); assert.strictEqual(r.weekday, 'fri');
r = startDayFor(lunch, 'fri');
assert.ok(r.today && r.day.name === 'Lunch Circuit', 'S1 on Friday it is today');

const split = plan(day('mon', 'Upper'), day('wed', 'Lower'), day('fri', 'Circuit'));
assert.strictEqual(startDayFor(split, 'thu').day.name, 'Circuit', 'S3 next day forward');
assert.strictEqual(startDayFor(split, 'sat').day.name, 'Upper', 'S3 wraps round the week');

assert.ok(startDayFor(plan(day('any', 'Anytime')), 'tue').today, 'S2 an any day is today');
assert.strictEqual(startDayFor(plan(day('mon', 'Rest', [])), 'mon'), null, 'S4 rest only gives null');
assert.strictEqual(startDayFor(plan(day('tue', 'Rest', []), day('thu', 'Legs')), 'tue').day.name, 'Legs', 'S4 skips a rest day');
assert.strictEqual(startDayFor(plan(), 'tue'), null);

const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
assert.match(src('page-dashboard.js'), /onclick: \(\) => ctx\.start\(next\.plan, next\.day\)/, 'S5 Today starts the next planned day');
assert.match(src('page-plans.js'), /const inUse = inUseStrip\(/, 'S5 Plans leads with the In use strip');
console.log('start any day OK');
