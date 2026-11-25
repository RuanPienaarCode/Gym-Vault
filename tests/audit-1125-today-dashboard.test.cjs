'use strict';
/* Today, audit 25 Nov 2026 (lane L4). One guard per finding:
     F22  a rest day never offers "Start Rest"; the rest-day hero carries the
          Start for the next TRAINING day; the Calm short Today keeps its shape
     F30  "Choose another workout" opens the picker and starts ONE day without
          changing the active plan
     F32  plans exist but none is on: one message, not two
     F33  "Go to Plans" behaves like a tab tap (clears Back)
     F43  the minutes estimate agrees with a day name that states its length
     F18  the Apex ticker does not repeat the Start button's "Lock in"
     F6   a failed plan switch says so and the screen reloads anyway
     F49  "Don't break it" does not show when the week is already kept
   GV_DASHBOARD_JS points at a broken copy (mutation testing). */
const assert = require('node:assert');
const H = require('./audit-1125-today-harness');
const { WEEKDAYS } = require('../src/constants');
const { todayISO, weekdayKey, addDays, startOfWeek } = H.dates;

let failed = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(
  () => console.log('  ok   ' + name),
  e => { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); });

const TODAY = todayISO();
const KEY = weekdayKey(TODAY);
const wk = n => WEEKDAYS[(WEEKDAYS.indexOf(KEY) + n) % 7];
const REST = (weekday, name) => H.mkDay(weekday, name || 'Rest', []);
const rendered = o => H.renderToday(o);
const heroOf = r => H.first(r.root, 'gv-hero');
const texts = r => H.buttons(r.root).map(H.buttonText);

const queue = [];
const run = (name, fn) => queue.push(() => check(name, fn));

/* ---------------- F22 ---------------- */
run('F22 rest-day hero: Start for the next TRAINING day under Log recovery, never "Start Rest"', () => {
  const plan = H.mkPlan('Split', [REST(KEY), REST(wk(1)), H.mkDay(wk(2), 'Legs')], { active: 'true' });
  const r = rendered({ plans: [plan] });
  const hero = heroOf(r);
  assert.ok(H.hasButton(hero, /^Log recovery$/), 'Log recovery is still there');
  const go = H.findButton(hero, /^Start Legs$/);
  assert.ok(go, `the rest-day hero offers Start Legs; buttons: ${texts(r).join(' | ')}`);
  assert.ok(!texts(r).some(t => /^Start Rest/.test(t)), 'never Start Rest');
  const kids = hero.children;
  assert.ok(kids.indexOf(H.findButton(hero, /^Log recovery$/)) < kids.indexOf(go), 'Start sits under Log recovery');
  return H.click(go).then(() => {
    assert.strictEqual(r.calls.start.length, 1);
    assert.strictEqual(r.calls.start[0][1].name, 'Legs');
  });
});

run('F22 nothing scheduled today: a rest day tomorrow is skipped, not offered', () => {
  const plan = H.mkPlan('Split', [REST(wk(1)), H.mkDay(wk(3), 'Upper')], { active: 'true' });
  const r = rendered({ plans: [plan] });
  assert.ok(H.hasButton(r.root, /^Start Upper$/), `buttons: ${texts(r).join(' | ')}`);
  assert.ok(!texts(r).some(t => /^Start Rest/.test(t)), 'never Start Rest');
  assert.ok(!/Next up: Rest/.test(H.txt(H.first(r.root, 'gv-hero-sub'))), 'the line does not name the rest day');
});

run('F22 a plan whose only upcoming day is a rest day offers no Start at all', () => {
  const plan = H.mkPlan('Split', [REST(wk(1))], { active: 'true' });
  const r = rendered({ plans: [plan] });
  assert.ok(!texts(r).some(t => /^Start /.test(t)), `buttons: ${texts(r).join(' | ')}`);
});

run('F22 Calm short Today: the rest hero gets the button, no extra text', () => {
  const plan = H.mkPlan('Split', [REST(KEY), H.mkDay(wk(2), 'Legs')], { active: 'true' });
  const plain = rendered({ plans: [plan], settings: { skin: 'calm' } });
  assert.ok(H.hasButton(heroOf(plain), /^Start Legs$/), 'Calm has the Start button');
  const sub = H.txt(H.first(plain.root, 'gv-hero-sub'));
  assert.strictEqual(sub, 'Rest is where the adaptation happens.', 'the sub line is unchanged');
});

/* ---------------- F30 ---------------- */
const two = () => {
  const main = H.mkPlan('Main', [H.mkDay(KEY, 'Push'), H.mkDay(wk(2), 'Pull')], { active: 'true' });
  const lunch = H.mkPlan('Lunch', [H.mkDay(wk(3), 'Lunch Circuit')], { active: 'false' });
  return { main, lunch };
};

run('F30 Today carries a quiet "Choose another workout", not a second lime button', () => {
  const { main, lunch } = two();
  const r = rendered({ plans: [main, lunch] });
  const b = H.findButton(r.root, /^Choose another workout$/);
  assert.ok(b, `buttons: ${texts(r).join(' | ')}`);
  assert.ok(!H.clsOf(b).includes('gv-btn-go'), 'not the lime button');
  assert.ok(H.clsOf(b).includes('gv-btn-hero-ghost'), 'the ghost style the Log manually button wears');
});

run('F30 picking a plan starts that day ONCE through ctx.start and leaves the active plan alone', async () => {
  const { main, lunch } = two();
  let setCalls = 0;
  const r = rendered({ plans: [main, lunch], io: { setActivePlan: async () => { setCalls++; } } });
  const before = H.opened.length;
  await H.click(H.findButton(r.root, /^Choose another workout$/));
  assert.strictEqual(H.opened.length, before + 1, 'a modal opened');
  const modal = H.opened[H.opened.length - 1];
  const rowsText = H.txt(modal.contentEl);
  assert.ok(/Lunch/.test(rowsText) && /Lunch Circuit/.test(rowsText), 'the switched-off plan is listed with its day');
  assert.ok(rowsText.indexOf('Main') < rowsText.indexOf('Lunch'), 'plans in use first');
  const lunchStart = H.buttons(modal.contentEl).find(b => /Lunch Circuit/.test(b.attrs['aria-label'] || ''));
  assert.ok(lunchStart, 'a Start button names the day it opens');
  await H.click(lunchStart);
  assert.strictEqual(r.calls.start.length, 1, 'started once');
  assert.strictEqual(r.calls.start[0][0], lunch);
  assert.strictEqual(r.calls.start[0][1].name, 'Lunch Circuit');
  assert.strictEqual(r.calls.guided.length, 0, 'went through ctx.start, which reads Settings → Start opens');
  assert.strictEqual(setCalls, 0, 'the active plan is untouched');
  assert.ok(modal.closed, 'the picker closes');
});

run('F30 no plan has anything to train: no action offered', () => {
  const r = rendered({ plans: [H.mkPlan('Rest only', [REST(KEY)], { active: 'true' })] });
  assert.ok(!H.hasButton(r.root, /^Choose another workout$/));
  assert.ok(!H.hasButton(rendered({ plans: [] }).root, /^Choose another workout$/));
});

/* ---------------- F32 / F33 ---------------- */
const allOff = () => [H.mkPlan('A', [H.mkDay(wk(2), 'Push')], { active: 'false' }), H.mkPlan('B', [H.mkDay(wk(3), 'Pull')], { active: 'false' })];

run('F32 plans exist but none is on: ONE message', () => {
  const r = rendered({ plans: allOff() });
  const all = H.txt(r.root);
  assert.ok(/No active plan/.test(all) && /Switch a plan on to fill Today/.test(all), 'the first message stays');
  assert.ok(!/No plan yet/.test(all), 'no "No plan yet"');
  assert.ok(!/build your own/.test(all), 'no second instruction');
  assert.ok(!H.hasButton(r.root, /^Go to Plans$/), 'no second button to Plans');
  assert.ok(H.hasButton(r.root, /^Choose a plan$/));
});

run('F32 a vault with no plans at all keeps "No plan yet"', () => {
  const r = rendered({ plans: [] });
  const all = H.txt(r.root);
  assert.ok(/No plan yet/.test(all) && /build your own/.test(all));
  assert.ok(!/No active plan/.test(all), 'only one message');
  assert.ok(H.hasButton(r.root, /^Go to Plans$/));
});

run('F33 Go to Plans acts like a tab tap (reset the Back history)', async () => {
  const r = rendered({ plans: [] });
  await H.click(H.findButton(r.root, /^Go to Plans$/));
  assert.deepStrictEqual(r.calls.nav[0], ['plans', null, { reset: true }]);
});

/* ---------------- F43 ---------------- */
const item = (n, sets, target) => ({ exercise: n, sets, target });
run('F43 a name that states its length wins, with no 15-minute floor', () => {
  const { estMinutes } = H.dashboard;
  const items = [item('Squat', 2, '8'), item('Row', 2, '8')];
  assert.strictEqual(estMinutes({ name: '8-minute Primer', items }), 8);
  assert.strictEqual(estMinutes({ name: '12 minute Flow', items }), 12);
  assert.strictEqual(estMinutes({ name: '15-min Core', items }), 15);
  assert.strictEqual(estMinutes({ name: 'A · 20 min Express', items }), 20);
  assert.strictEqual(estMinutes({ name: '45-Minute Long Run', items }), 45);
});
run('F43 no stated length: the estimate without the floor, minimum 5', () => {
  const { estMinutes } = H.dashboard;
  assert.strictEqual(estMinutes({ name: 'Primer', items: [item('Squat', 2, '8'), item('Row', 2, '8')] }), 5, '7.2 min rounds to 5, not 15');
  assert.strictEqual(estMinutes({ name: 'Primer', items: [item('Squat', 1, '8')] }), 5, 'a sensible minimum of 5');
  assert.strictEqual(estMinutes({ name: 'Push', items: Array.from({ length: 4 }, (_, i) => item('E' + i, 3, '10')) }), 20, '21.6 min -> 20');
  assert.strictEqual(estMinutes(27), 50, 'a bare set count still works');
});
run('F43 a repeat count before "min" is not a length ("4 x 3 min")', () => {
  const { estMinutes } = H.dashboard;
  assert.strictEqual(estMinutes({ name: 'Intervals 4 x 3 min', items: [item('Run', 4, '3 min')] }), 10, 'read from the lines: 12 min -> 10');
});
run('F43 the hero shows the stated length', () => {
  const plan = H.mkPlan('P', [H.mkDay(KEY, '8-minute Primer', [item('Squat', 3, '8'), item('Row', 3, '8'), item('Press', 3, '8')])], { active: 'true' });
  const r = rendered({ plans: [plan] });
  assert.ok(/~8 min/.test(H.txt(heroOf(r))), H.txt(heroOf(r)));
  assert.ok(/est\. 8 min/.test(H.txt(heroOf(r))));
});

/* ---------------- F18 ---------------- */
run('F18 "Lock in" is the Start button\'s label and nothing else on the Apex screen', () => {
  const plan = H.mkPlan('P', [H.mkDay(KEY, 'Push Day')], { active: 'true' });
  const r = rendered({ plans: [plan], settings: { skin: 'apex' } });
  const ticker = H.first(r.root, 'gv-ticker');
  assert.ok(ticker, 'the Apex ticker is drawn');
  assert.ok(!/Lock in/.test(H.txt(ticker)), `ticker: ${H.txt(ticker)}`);
  assert.ok(H.hasButton(r.root, /^Lock in$/), 'the button keeps the words');
});

/* ---------------- F6 ---------------- */
const failing = () => ({ setActivePlan: async () => { throw new Error('disk full'); } });
const MSG = 'Could not switch plan. Try again.';

run('F6 plan swap: a failed switch says so and reloads', async () => {
  const { main, lunch } = two();
  const quiet = console.error; console.error = () => {};
  try {
    const r = rendered({ plans: [main, lunch], io: failing() });
    await H.click(H.findButton(r.root, /^Main/));
    const modal = H.opened[H.opened.length - 1];
    await modal.onPick(lunch);
    assert.deepStrictEqual(r.calls.notice, [MSG]);
    assert.strictEqual(r.calls.reload, 1, 'reload in finally');
  } finally { console.error = quiet; }
});
run('F6 plan swap: success still says what happened and reloads', async () => {
  const { main, lunch } = two();
  const r = rendered({ plans: [main, lunch] });
  await H.click(H.findButton(r.root, /^Main/));
  await H.opened[H.opened.length - 1].onPick(lunch);
  assert.deepStrictEqual(r.calls.notice, ['switched to Lunch.']);
  assert.strictEqual(r.calls.reload, 1);
});
run('F6 "Choose a plan": a failed switch says so and reloads', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    const plans = allOff();
    const r = rendered({ plans, io: failing() });
    await H.click(H.findButton(r.root, /^Choose a plan$/));
    await H.opened[H.opened.length - 1].onPick(plans[0]);
    assert.deepStrictEqual(r.calls.notice, [MSG]);
    assert.strictEqual(r.calls.reload, 1);
  } finally { console.error = quiet; }
});
run('F6 "Make it active": a failed switch says so and reloads', async () => {
  const quiet = console.error; console.error = () => {};
  try {
    const plan = H.mkPlan('Implicit', [H.mkDay(KEY, 'Push')], {});
    const r = rendered({ plans: [plan], io: failing() });
    await H.click(H.findButton(r.root, /^Make it active$/));
    assert.deepStrictEqual(r.calls.notice, [MSG]);
    assert.strictEqual(r.calls.reload, 1);
  } finally { console.error = quiet; }
});

/* ---------------- F49 ---------------- */
run('F49 a challenge go this week keeps the streak: no "Don\'t break it"', () => {
  const lastWeekFri = addDays(startOfWeek(TODAY, 'mon'), -3);
  const sess = date => ({ name: date, fm: { date, plan: 'Main', day: 'Push' }, rows: [{ exercise: 'Push-ups', reps: '10', done: true }] });
  const go = { name: 'go', fm: { date: TODAY, kind: 'challenge' }, rows: [{ exercise: 'Push-ups', reps: '30', done: true }] };
  const plan = H.mkPlan('Main', [H.mkDay('mon', 'A'), H.mkDay('wed', 'B'), H.mkDay('fri', 'C')], { active: 'true' });
  const withGo = rendered({ plans: [plan], workouts: [sess(lastWeekFri), go] });
  assert.strictEqual(H.first(withGo.root, 'gv-streak-risk'), null, 'the week is kept by the go (the flame counts it)');
  const without = rendered({ plans: [plan], workouts: [sess(lastWeekFri)] });
  assert.ok(H.first(without.root, 'gv-streak-risk'), 'positive control: an empty week still warns');
});

(async () => {
  for (const q of queue) await q();
  if (failed) { console.error(`${failed} failed`); process.exit(1); }
  console.log('audit-1125 today dashboard OK');
})();
