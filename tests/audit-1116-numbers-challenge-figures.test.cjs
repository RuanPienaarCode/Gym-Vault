'use strict';
/* AUDIT 16 NOV 2026, lane NUMBERS: #20, #17, #32, #33, #23 and the three small
   things seen beside them (a goal below 1, "undefined" on a goal card, a goal
   with no target blamed on the user).

   #20  The goal card read the all-time best (exerciseBests) while its own
        challenge line read the best SINCE `started`: 52 push-ups on 1 Oct and a
        "50 Push-ups" challenge started 13 Nov with a 20 logged showed a trophy
        and "52 of 50" beside "baseline 20". stats.goalCurrent is the seam every
        surface calls, so a challenge goal reads challengeStatus().best there.
   #17  A hand-edited `started` threw inside startOfWeek and took the whole
        Goals page down; a date-time value silently dropped the first day.
   #32  The summary's "Next week, beat N" used this go alone; next week's target
        comes from the week's best.
   #33  Pull-ups and Dead Hang (equipment: bar) never appeared; stretches did.
   #23  The count-in is spoken from a timer, so iOS needs sound.unlock() inside
        the tap that begins the count, not only inside the one that opened the
        modal. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const T = require('./f3-stub');
const modals = require('../src/modals');
const captured = [];
modals.FormModal = class { constructor(app, opts) { this.opts = opts; captured.push(this); } open() {} };
const stats = require('../src/stats');
const ch = require('../src/challenge');
const flow = require('../src/challenge-flow');
const goalsPage = require('../src/page-goals');
const { SEED_EXERCISES } = require('../src/seed');
const { row } = require('./rewards-fixtures');

const failures = [];
const test = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${String(e && e.message).split('\n')[0]}`); }
};
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');

const note = (date, rows, fm, name) => ({ name: name || `n-${date}`, fm: Object.assign({ date }, fm || {}), rows, file: { path: `Gym/Workouts/${name || date}.md` } });
const pushups = (date, reps, name) => note(date, [row('Push-ups', { reps })], { plan: 'P', day: 'D' }, name);
const goal = (fm, name) => ({ name: name || '50 Push-ups challenge', file: { path: 'Gym/Goals/g.md' }, fm: Object.assign({ metric: 'exercise-reps', exercise: 'Push-ups', target: 50, challenge: 'weekly', started: '2026-11-13' }, fm || {}) });
const EX = [{ name: 'Push-ups', fm: { unit: 'reps' } }];

/* -------------------------------------------------------------------- #20 */

const history = [pushups('2026-10-01', 52, 'old'), pushups('2026-11-13', 20, 'go')];
const ctxFor = (g, workouts) => ({ workouts, body: [], weekStart: 'mon', today: '2026-11-16', exercises: EX });

test('#20 a challenge goal\'s current figure is the challenge\'s own best since started', () => {
  const g = goal();
  assert.strictEqual(stats.goalCurrent(g, ctxFor(g, history)), 20, 'the card quoted the all-time 52');
});
test('#20 card figure == challengeStatus().best == the pop-up\'s "Best"', () => {
  const g = goal();
  const best = ch.challengeStatus(g, history, { weekStart: 'mon', today: '2026-11-16' }).best;
  assert.strictEqual(best, 20);
  assert.strictEqual(stats.goalCurrent(g, ctxFor(g, history)), best);
});
test('#20 progress and done follow it: 20 of 50 is 40%, no trophy', () => {
  const g = goal();
  const p = stats.goalProgress(g, stats.goalCurrent(g, ctxFor(g, history)));
  assert.ok(p > 0.39 && p < 0.41, `progress ${p}`);
});
test('#20 an undated note and a note from before `started` do not count for a challenge', () => {
  const g = goal();
  const undated = { name: 'u', fm: {}, rows: [row('Push-ups', { reps: 70 })], file: { path: 'u.md' } };
  assert.strictEqual(stats.goalCurrent(g, ctxFor(g, history.concat([undated]))), 20);
});
test('#20 with nothing logged since started the card has no figure (null), not the old best', () => {
  const g = goal();
  assert.strictEqual(stats.goalCurrent(g, ctxFor(g, [pushups('2026-10-01', 52, 'old')])), null);
});
test('#20 an ordinary goal is unchanged: all-time best, undated notes included', () => {
  const g = goal({ challenge: '', started: '' }, 'Fifty push-ups');
  assert.strictEqual(stats.goalCurrent(g, ctxFor(g, history)), 52);
  const undated = { name: 'u', fm: {}, rows: [row('Push-ups', { reps: 70 })], file: { path: 'u.md' } };
  assert.strictEqual(stats.goalCurrent(g, ctxFor(g, history.concat([undated]))), 70);
});
test('#20 the Goals card prints 20 of 50, not a trophy, and says the same as its challenge line', () => {
  /* Dated TODAY so the challenge line is the test-week one whatever day this runs. */
  const today = require('../src/dates').todayISO();
  const g = goal({ started: today });
  const hist = [pushups('2000-10-01', 52, 'old'), pushups(today, 20, 'go')];
  const ctx = { app: {}, data: { goals: [g], workouts: hist, body: [], exercises: EX }, settings: { weekStart: 'mon' }, state: {}, nav() {}, notice() {}, reload() {}, openFile() {}, io: {} };
  const root = T.render(goalsPage, ctx);
  const card = T.findAll(root, 'gv-goal-card')[0];
  assert.ok(!/\bdone\b/.test(card.className), 'the card is marked done');
  assert.strictEqual(T.findAll(card, 'gv-trophy').length, 0, 'trophy shown');
  const nums = T.findAll(card, 'gv-goal-nums')[0].textContent.replace(/\s+/g, ' ');
  assert.ok(/^\s*20 of 50/.test(nums), nums);
  assert.ok(/baseline 20/.test(T.findAll(card, 'gv-goal-challenge')[0].textContent), 'the line still reads baseline 20');
});
test('#20 the header comment no longer claims what the code did not do', () => {
  const head = src('challenge.js').slice(0, 1200);
  assert.ok(/goalCurrent/.test(head), 'challenge.js header should name stats.goalCurrent as the seam that keeps card and line equal');
});

/* -------------------------------------------------------------------- #17 */

const BAD_STARTS = ['yesterday', '2026-11-1', '02/11/2026', '13 Nov 2026', '2026-11-13T09:00', '', undefined, null, 20261113, '2026-13-45'];
test('#17 no hand-edited `started` throws in challengeStatus, weeklyBests or the Goals page', () => {
  for (const started of BAD_STARTS) {
    const g = goal({ started });
    const label = JSON.stringify(started);
    assert.doesNotThrow(() => ch.challengeStatus(g, history, { weekStart: 'mon', today: '2026-11-16' }), `challengeStatus threw for ${label}`);
    assert.doesNotThrow(() => ch.weeklyBests(history, 'Push-ups', { weekStart: 'mon', since: started }), `weeklyBests threw for ${label}`);
    assert.doesNotThrow(() => stats.goalCurrent(g, ctxFor(g, history)), `goalCurrent threw for ${label}`);
    const ctx = { app: {}, data: { goals: [g], workouts: history, body: [], exercises: EX }, settings: { weekStart: 'mon' }, state: {}, nav() {}, notice() {}, reload() {}, openFile() {}, io: {} };
    assert.doesNotThrow(() => T.render(goalsPage, ctx), `the Goals page threw for ${label}`);
  }
});
test('#17 a start that is not a date is treated as no start: every set counts, no week number', () => {
  for (const started of ['yesterday', '2026-11-1', '02/11/2026', '13 Nov 2026', '', undefined]) {
    const s = ch.challengeStatus(goal({ started }), history, { weekStart: 'mon', today: '2026-11-16' });
    assert.strictEqual(s.best, 52, `best for ${JSON.stringify(started)} should be the unfiltered 52`);
    assert.strictEqual(s.weekNo, null, `week number for ${JSON.stringify(started)}`);
  }
});
test('#17 a date-time start reads as its date: the start day\'s sets count, and the week number is set', () => {
  const s = ch.challengeStatus(goal({ started: '2026-11-13T09:00' }), history, { weekStart: 'mon', today: '2026-11-16' });
  assert.strictEqual(s.best, 20, 'the 13 Nov set was dropped');
  assert.strictEqual(s.weeks.length, 1);
  assert.strictEqual(s.weekNo, ch.challengeStatus(goal({ started: '2026-11-13' }), history, { weekStart: 'mon', today: '2026-11-16' }).weekNo);
  const w = ch.weeklyBests(history, 'Push-ups', { weekStart: 'mon', since: '2026-11-13T09:00' });
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].best, 20);
});

/* -------------------------------------------------------------------- #32 */

test('#32 the summary\'s next-week target comes from the week\'s best including this go', () => {
  const g = goal({ target: 50 });
  const first = pushups('2026-11-16', 30, 'first');
  const status = ch.challengeStatus(g, [first], { weekStart: 'mon', today: '2026-11-17' });
  assert.strictEqual(status.testWeek, true, 'control: still the test week');
  assert.strictEqual(typeof ch.nextAfterGo, 'function', 'challenge.nextAfterGo is not exported');
  const quoted = ch.nextAfterGo(status, 20);
  const second = pushups('2026-11-17', 20, 'second');
  const used = ch.challengeStatus(g, [first, second], { weekStart: 'mon', today: '2026-11-23' }).target;
  assert.strictEqual(quoted, 33, 'quoted from this go alone');
  assert.strictEqual(quoted, used, 'the quote and next week\'s real target disagree');
  assert.strictEqual(ch.nextAfterGo(status, 40), ch.nextTarget(40, 50), 'a better go still wins');
  assert.strictEqual(ch.nextAfterGo({ thisWeek: null, goal: 50 }, 20), 22, 'the first go of the week: this go alone');
});
test('#32 the modal prints that figure (driven through finish())', () => {
  const { ChallengeModal } = require('../src/challenge-modal');
  const g = goal({ target: 50 });
  const status = ch.challengeStatus(g, [pushups('2026-11-16', 30, 'first')], { weekStart: 'mon', today: '2026-11-17' });
  const m = new ChallengeModal({}, { title: g.name, exercise: 'Push-ups', status, settings: {} });
  m.contentEl = T.mkNode('div');
  m.setsNow = () => [20];
  const mk = document.createElement;
  document.createElement = tag => { const n = mk(tag); n.focus = () => {}; return n; };
  try { m.finish(); } finally { document.createElement = mk; }
  const verdict = T.findAll(m.contentEl, 'gv-challenge-verdict')[0].textContent.replace(/\s+/g, ' ');
  assert.ok(/Next week, beat 33\./.test(verdict), verdict);
  assert.ok(/Your best this week is still 30/.test(m.contentEl.textContent.replace(/\s+/g, ' ')));
});

/* -------------------------------------------------------------------- #33 */

const seedExercises = SEED_EXERCISES.map(e => ({ name: e.name, fm: { type: e.type, equipment: e.equipment, unit: e.unit } }));
test('#33 Pull-ups and Dead Hang are offered, in the popular order', () => {
  const names = ch.challengeChoices(seedExercises).map(c => c.name);
  assert.ok(names.includes('Pull-ups'), 'Pull-ups is not offered');
  assert.ok(names.includes('Dead Hang'), 'Dead Hang is not offered');
  const pop = ['Push-ups', 'Sit-Up', 'Sit-ups', 'Bodyweight Squat', 'Squats', 'Jump Squat', 'Burpees', 'Pull-ups', 'Tricep Dips', 'Forward Lunges', 'Mountain Climbers', 'Jumping Jacks', 'Plank', 'Side Plank', 'Wall Sit', 'Dead Hang'];
  const lib = new Set(seedExercises.map(e => e.name.toLowerCase()));
  const expected = pop.filter(n => lib.has(n.toLowerCase()));
  assert.deepStrictEqual(names.slice(0, expected.length), expected, 'the popular names that exist must come first, in POPULAR order');
  assert.strictEqual(ch.challengeChoices(seedExercises).find(c => c.name === 'Dead Hang').kind, 'seconds', 'Dead Hang is a hold');
});
test('#33 a pull-up bar is bodyweight; a barbell, or a bar beside a loaded implement, is not', () => {
  const ex = equipment => ({ name: 'X', fm: { unit: 'reps', equipment } });
  assert.strictEqual(ch.challengeChoices([ex('bar')]).length, 1);
  assert.strictEqual(ch.challengeChoices([ex('bar, bodyweight')]).length, 1);
  assert.strictEqual(ch.challengeChoices([ex('barbell')]).length, 0, 'a barbell is a loaded lift');
  assert.strictEqual(ch.challengeChoices([ex('bar, dumbbells')]).length, 0);
  assert.strictEqual(ch.challengeChoices([ex('dumbbells')]).length, 0);
  assert.strictEqual(ch.challengeChoices([ex('kettlebell')]).length, 0);
  assert.strictEqual(ch.challengeChoices([ex('bodyweight')]).length, 1, 'control: bodyweight as before');
});
test('#33 mobility and stretch moves are not offered as max-rep or max-hold challenges', () => {
  const names = ch.challengeChoices(seedExercises).map(c => c.name);
  for (const n of ['Calf Stretch', 'Cat-Cow', "Child's Pose", 'Hamstring Stretch', 'Spinal Twist', 'Shoulder Circles']) assert.ok(!names.includes(n), `${n} is offered`);
  assert.strictEqual(ch.challengeChoices([{ name: 'Hip Opener', fm: { unit: 'seconds', equipment: 'bodyweight', type: 'Mobility' } }]).length, 0, 'case folded');
  assert.strictEqual(ch.challengeChoices([{ name: 'Hand-made', fm: { unit: 'reps', equipment: 'bodyweight' } }]).length, 1, 'an exercise with no type is still offered: nothing says it is a stretch');
  for (const type of ['strength', 'skill', 'cardio']) assert.strictEqual(ch.challengeChoices([{ name: 'Z', fm: { unit: 'reps', equipment: 'bodyweight', type } }]).length, 1, type);
});

/* -------------------------------------------------------------------- #23 */

test('#23 begin() calls sound.unlock() before anything else, so the count-in is inside the tap', () => {
  const sound = require('../src/sound');
  const { ChallengeModal } = require('../src/challenge-modal');
  const log = [];
  const real = { unlock: sound.unlock, audible: sound.audible };
  sound.unlock = () => log.push('unlock');
  sound.audible = () => { log.push('audible'); return false; };
  try {
    const m = new ChallengeModal({}, { title: 't', exercise: 'Push-ups', status: { goal: 50, kind: 'reps' }, settings: {} });
    m.contentEl = T.mkNode('div');
    try { m.begin('max', []); } catch (e) { /* the stub DOM may not hold the rest of the screen; the order is what is pinned */ }
  } finally { sound.unlock = real.unlock; sound.audible = real.audible; }
  assert.strictEqual(log[0], 'unlock', `first call was ${log[0]}`);
});
test('#23 begin() opens with the unlock, and onOpen keeps its own', () => {
  const s = src('challenge-modal.js');
  const body = s.slice(s.indexOf('  begin(mode, plan) {') + '  begin(mode, plan) {'.length).replace(/^\s*(\/\*[\s\S]*?\*\/\s*|\/\/[^\n]*\n\s*)*/, '');
  assert.ok(/^sound\.unlock\(\);/.test(body), `begin() starts with: ${body.slice(0, 60)}`);
  const open = s.slice(s.indexOf('  onOpen() {'), s.indexOf('  onEscapeKey'));
  assert.ok(/sound\.unlock\(\);/.test(open), 'onOpen lost its unlock');
});

/* ------------------------------------------------------------------ extras */

test('extra: the quick picker refuses a goal that rounds to 0 (0.4), and still takes 1 and 0.5 -> 1', () => {
  captured.length = 0;
  const notices = [];
  flow.openNewChallenge({ app: {}, data: { exercises: seedExercises }, notice: m => notices.push(m), settings: {}, io: {} });
  assert.strictEqual(captured.length, 1, 'the picker did not open');
  const { validate } = captured[0].opts;
  assert.ok(validate({ exercise: 'Push-ups', target: '0.4' }), '0.4 would create a "0 Push-ups challenge"');
  assert.ok(validate({ exercise: 'Push-ups', target: '0' }));
  assert.ok(validate({ exercise: 'Push-ups', target: '' }));
  assert.strictEqual(validate({ exercise: 'Push-ups', target: '1' }), null);
  assert.strictEqual(validate({ exercise: 'Push-ups', target: '50' }), null);
});
const render = (g, extra) => {
  const ctx = { app: {}, data: Object.assign({ goals: [g], workouts: [], body: [], exercises: EX }, extra), settings: { weekStart: 'mon' }, state: {}, nav() {}, notice() {}, reload() {}, openFile() {}, io: {} };
  return T.render(goalsPage, ctx).textContent.replace(/\s+/g, ' ');
};
test('extra: a goal with no metric never prints the word "undefined"', () => {
  const text = render({ name: 'Hand made', file: { path: 'g.md' }, fm: { target: 10 } });
  assert.ok(!/undefined/.test(text), text);
});
test('extra: a goal with no target says so, instead of "log a workout to start tracking"', () => {
  const text = render({ name: 'No target', file: { path: 'g.md' }, fm: { metric: 'exercise-reps', exercise: 'Push-ups' } });
  assert.ok(!/log a workout to start tracking/.test(text), text);
  assert.ok(/no target/i.test(text), text);
  const ok = render({ name: 'Fine', file: { path: 'g.md' }, fm: { metric: 'exercise-reps', exercise: 'Push-ups', target: 10 } });
  assert.ok(/log a workout to start tracking/.test(ok), 'control: a real goal with no data still says to log a workout');
});

if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('audit-1116 numbers challenge figures OK');
