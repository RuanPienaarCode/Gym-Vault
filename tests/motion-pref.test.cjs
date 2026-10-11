'use strict';
/* MOTION COUNTING IS REMEMBERED PER EXERCISE (0.13.x, from Ruan's phone use:
   "when setting motion on for exercises it should remember the preference").

   The pure half. The preference lives on the exercise note as
   `motion_counting: true` — absent means OFF, exactly like every note that
   predates the key — and is read and written the same way `motion_sensitivity`
   is. What this file pins is the RULE for what a screen starts with:

     on entering an exercise, motion is ON iff the user already chose it this
     session FOR THIS EXERCISE, otherwise the exercise's saved preference.

   The session used to hold ONE flag, so a toggle on exercise A carried into B
   and a note's preference could not exist. None of this touches a DOM, a
   clock or a device. */
const assert = require('node:assert');
const mc = require('../src/motion-count');

const results = [];
const check = (name, fn) => { try { fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };

/* ---------- motionPref: reading the key off a note's frontmatter ---------- */

check('motionPref: true, "true" and a padded/cased "TRUE" are ON', () => {
  for (const v of [true, 'true', ' true ', 'TRUE', 'True']) {
    assert.strictEqual(mc.motionPref({ motion_counting: v }), true, JSON.stringify(v));
  }
});

check('motionPref: absent, blank, false and anything else is OFF — a hand-edited note must never throw', () => {
  for (const v of [undefined, null, '', 'false', false, 'no', 'yes', '1', 1, 'maybe', 0, [], ['true']]) {
    assert.strictEqual(mc.motionPref({ motion_counting: v }), false, JSON.stringify(v));
  }
  assert.strictEqual(mc.motionPref({}), false, 'a note without the key is OFF — exactly as before');
  assert.strictEqual(mc.motionPref(undefined), false, 'no fm at all');
  assert.strictEqual(mc.motionPref(null), false);
});

/* ---------- setMotionPref: writing it ---------- */

check('setMotionPref ON adds exactly one key and leaves every other key alone', () => {
  const fm = { type: 'strength', muscles: ['chest'], motion_sensitivity: 'high', unit: 'reps' };
  const before = JSON.stringify(fm);
  mc.setMotionPref(fm, true);
  assert.strictEqual(fm.motion_counting, true);
  assert.deepStrictEqual(Object.keys(fm), ['type', 'muscles', 'motion_sensitivity', 'unit', 'motion_counting']);
  delete fm.motion_counting;
  assert.strictEqual(JSON.stringify(fm), before, 'nothing but the one key changed');
});

check('setMotionPref OFF REMOVES the key (it is never written as false) and leaves the rest', () => {
  const fm = { type: 'strength', motion_counting: true, unit: 'reps' };
  mc.setMotionPref(fm, false);
  assert.ok(!Object.prototype.hasOwnProperty.call(fm, 'motion_counting'), 'the key must be gone, not false');
  assert.deepStrictEqual(fm, { type: 'strength', unit: 'reps' });
});

check('setMotionPref OFF on a note that never had the key is a no-op', () => {
  const fm = { type: 'strength' };
  mc.setMotionPref(fm, false);
  assert.deepStrictEqual(fm, { type: 'strength' });
});

check('setMotionPref OFF also clears a hand-written `false` line (tidy: one off-state)', () => {
  const fm = { motion_counting: 'false' };
  mc.setMotionPref(fm, false);
  assert.ok(!('motion_counting' in fm));
});

/* ---------- initialMotion: the rule ---------- */

const sessWith = choices => ({ motionOn: false, motionChoices: choices });

check('initialMotion: no choice this session + saved ON -> ON, and it is a REMEMBERED start (no gesture behind it)', () => {
  assert.deepStrictEqual(mc.initialMotion(sessWith({}), 'Push-ups', true), { on: true, remembered: true });
});

check('initialMotion: no choice + no saved pref -> OFF (a note without the key behaves exactly as today)', () => {
  assert.deepStrictEqual(mc.initialMotion(sessWith({}), 'Push-ups', false), { on: false, remembered: false });
});

check('initialMotion: chosen ON this session beats a missing pref (a plan line with no note behind it)', () => {
  const r = mc.initialMotion(sessWith({ 'step-ups': true }), 'Step-ups', false);
  assert.deepStrictEqual(r, { on: true, remembered: false });
});

check('initialMotion: chosen OFF this session beats a saved ON (the user just switched it off)', () => {
  assert.deepStrictEqual(mc.initialMotion(sessWith({ 'push-ups': false }), 'Push-ups', true), { on: false, remembered: false });
});

check('initialMotion: a choice for exercise A does NOT leak into exercise B', () => {
  const sess = sessWith({ 'push-ups': true });
  assert.deepStrictEqual(mc.initialMotion(sess, 'Dips', false), { on: false, remembered: false }, 'B has no pref -> OFF');
  assert.deepStrictEqual(mc.initialMotion(sess, 'Dips', true), { on: true, remembered: true }, 'B follows ITS OWN pref');
});

check('initialMotion: exercise names are compared the way the rest of the app does (case, padding)', () => {
  const sess = sessWith({ 'push-ups': true });
  assert.strictEqual(mc.initialMotion(sess, '  PUSH-UPS ', false).on, true);
});

check('initialMotion: a session that has never recorded a choice (no map) is not an error', () => {
  assert.deepStrictEqual(mc.initialMotion({ motionOn: true }, 'Push-ups', false), { on: false, remembered: false },
    'the old single flag no longer decides anything — only a recorded choice or the note does');
  assert.deepStrictEqual(mc.initialMotion(null, 'Push-ups', true), { on: true, remembered: true });
  assert.deepStrictEqual(mc.initialMotion(undefined, undefined, false), { on: false, remembered: false });
});

check('initialMotion does not mutate the session', () => {
  const sess = sessWith({ 'push-ups': true });
  const before = JSON.stringify(sess);
  mc.initialMotion(sess, 'Dips', true);
  mc.initialMotion(sess, 'Push-ups', false);
  assert.strictEqual(JSON.stringify(sess), before);
});

/* ---------- chooseMotion: recording a choice ---------- */

check('chooseMotion records the choice for THAT exercise only, and mirrors it on sess.motionOn', () => {
  const sess = { motionOn: false };
  mc.chooseMotion(sess, 'Push-ups', true);
  assert.strictEqual(sess.motionOn, true);
  assert.strictEqual(mc.initialMotion(sess, 'push-ups', false).on, true);
  assert.strictEqual(mc.initialMotion(sess, 'Dips', false).on, false, 'no leak');
  mc.chooseMotion(sess, 'Dips', false);
  assert.strictEqual(sess.motionOn, false);
  assert.strictEqual(mc.initialMotion(sess, 'Push-ups', false).on, true, 'A is still what the user chose');
});

/* ---------- failure copy: a start nobody tapped must not claim "declined" ---------- */

check('motionFailureCopy: a user-gesture start keeps the existing notices, word for word', () => {
  const denied = mc.motionFailureCopy('denied', true);
  assert.strictEqual(denied.notice, 'Gym: motion access was declined — counting by tap instead. Enable Motion & Orientation for Obsidian in iOS Settings to use it.');
  for (const s of ['unsupported', 'nosensor']) {
    assert.strictEqual(mc.motionFailureCopy(s, true).notice, 'Gym: this device has no motion sensor available — counting by tap instead.', s);
  }
});

check('motionFailureCopy: a remembered (no-gesture) start NEVER produces a notice, and tells you how to resume', () => {
  const denied = mc.motionFailureCopy('denied', false);
  assert.strictEqual(denied.notice, null, 'no "declined" for a start the user did not tap');
  assert.strictEqual(denied.hint, 'Tap the movement button to turn counting back on');
  for (const s of ['unsupported', 'nosensor']) {
    const r = mc.motionFailureCopy(s, false);
    assert.strictEqual(r.notice, null, s);
    assert.strictEqual(r.hint, 'No motion sensor here — counting by tap', s);
  }
});

const failed = results.filter(r => r[1]);
for (const [name, e] of results) console.log(`  ${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n       ${String(e.message).split('\n').join('\n       ')}` : ''}`);
if (failed.length) { console.log(`motion pref: ${failed.length} of ${results.length} FAILED`); process.exitCode = 1; }
else console.log(`motion pref OK (${results.length} checks: key read/write, initialMotion rule, no leak between exercises, failure copy)`);
