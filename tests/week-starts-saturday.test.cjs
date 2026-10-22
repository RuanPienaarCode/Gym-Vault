'use strict';
/* THE WEEK CAN START ON SATURDAY.

   CONTRACT (written before the code):
     constants.WEEK_STARTS                 -> [[key, label]...], the options Settings offers
                                              ('mon' Monday, 'sat' Saturday, 'sun' Sunday)
     dates.startOfWeek(iso, weekStart)     -> the most recent `weekStart` day on or before iso;
                                              an unknown / missing value still means Monday
   Every consumer (weekSchedule, sessionsInWeek, distanceInWeek, weekStreak,
   streakRisk, the History grid) reaches the week through startOfWeek, so the
   tests below pin the rule once and then check the consumers read it. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {}, ItemView: class {},
  Plugin: class {}, PluginSettingTab: class {}, TFile: class {}, normalizePath: p => p,
} : origLoad(req, ...rest));
const { startOfWeek, addDays, weekdayKey } = require('../src/dates');
const { WEEK_STARTS, DEFAULT_SETTINGS } = require('../src/constants');
const { weekSchedule } = require('../src/rewards');
const { sessionsInWeek, weekStreak, distanceInWeek } = require('../src/stats');
const { streakRisk } = require('../src/progress');
Module._load = origLoad;

let n = 0;
const check = (name, fn) => { fn(); n++; console.log(`  ok   ${name}`); };

/* 2026-10-22 is a Thursday. Fri 23 Oct, Sat 24 Oct, Sun 25 Oct, Mon 26 Oct. */
check('Saturday start: Thursday belongs to the week that began the previous Saturday', () => {
  assert.strictEqual(startOfWeek('2026-10-22', 'sat'), '2026-10-17');
});
check('Saturday start: a Saturday is its own week start; the Friday before is the previous week', () => {
  assert.strictEqual(startOfWeek('2026-10-24', 'sat'), '2026-10-24');
  assert.strictEqual(startOfWeek('2026-10-23', 'sat'), '2026-10-17');
  assert.strictEqual(startOfWeek('2026-10-30', 'sat'), '2026-10-24');
});
check('Monday and Sunday starts are unchanged', () => {
  assert.strictEqual(startOfWeek('2026-10-22', 'mon'), '2026-10-19');
  assert.strictEqual(startOfWeek('2026-10-22', 'sun'), '2026-10-18');
});
check('an unknown or missing value still means Monday (old data.json, hand edits)', () => {
  assert.strictEqual(startOfWeek('2026-10-22', undefined), '2026-10-19');
  assert.strictEqual(startOfWeek('2026-10-22', 'banana'), '2026-10-19');
});
check('every option Settings offers starts the week on exactly that day, for all 7 weekdays and across a year end', () => {
  assert.ok(WEEK_STARTS.some(([k]) => k === 'sat'), 'Saturday is not offered');
  assert.ok(WEEK_STARTS.some(([k]) => k === DEFAULT_SETTINGS.weekStart), 'the default is not an offered option');
  for (const [key, label] of WEEK_STARTS) {
    assert.ok(label && label !== key, `${key} has no label`);
    for (let i = 0; i < 14; i++) {
      for (const base of ['2026-10-18', '2026-12-28']) {
        const iso = addDays(base, i);
        const s = startOfWeek(iso, key);
        assert.strictEqual(weekdayKey(s), key, `${iso} with ${key} start gave ${s}`);
        assert.ok(s <= iso && iso < addDays(s, 7), `${iso} is outside its own week ${s}`);
      }
    }
  }
});

check('weekSchedule (the strip + weekly target) runs Saturday -> Friday', () => {
  const w = weekSchedule(() => [], '2026-10-22', 'sat');
  assert.deepStrictEqual(w.days.map(d => d.wk), ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri']);
  assert.strictEqual(w.start, '2026-10-17');
  assert.strictEqual(w.end, '2026-10-23');
});

const sess = date => ({ fm: { date }, rows: [{ distance_km: 5 }] });
check('sessions and distance are counted per Saturday-start week', () => {
  const ws = [sess('2026-10-23'), sess('2026-10-24'), sess('2026-10-25')];   // Fri | Sat, Sun
  /* On Sunday 25th the Saturday week holds Sat+Sun; the Friday belongs to the week before. */
  assert.strictEqual(sessionsInWeek(ws, '2026-10-25', 'sat'), 2);
  assert.strictEqual(sessionsInWeek(ws, '2026-10-25', 'mon'), 3);     // Mon 19 - Sun 25
  assert.strictEqual(distanceInWeek(ws, '2026-10-25', 'sat'), 10);
});
check('weekStreak follows the Saturday boundary', () => {
  /* Fri 16 Oct and Sat 24 Oct: with a Saturday start they are in adjacent weeks
     (Sat 10-Fri 16, Sat 17-Fri 23 is empty) -> the gap week breaks the streak. */
  assert.strictEqual(weekStreak(['2026-10-24'], 'sat', '2026-10-25'), 1);
  assert.strictEqual(weekStreak(['2026-10-16', '2026-10-24'], 'sat', '2026-10-25'), 1);
  assert.strictEqual(weekStreak(['2026-10-20', '2026-10-24'], 'sat', '2026-10-25'), 2);
});
check('streakRisk names Friday as the last day to save a Saturday-start week', () => {
  const r = streakRisk(3, { done: 0 }, '2026-10-22', 'sat');
  assert.ok(r && r.by === 'Friday', `got ${r && r.by}`);
});

check('the Settings dropdown is built from WEEK_STARTS, not a hand-typed pair', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'settings-tab.js'), 'utf8');
  const i = src.indexOf("'Week starts on'");
  assert.ok(i > 0, 'setting not found');
  const block = src.slice(i, i + 500);
  assert.ok(/WEEK_STARTS/.test(block), 'the dropdown does not read WEEK_STARTS');
});

console.log(`${n} checks passed`);
