'use strict';
/* AUDIT 16 NOV 2026, lane NUMBERS: #19 (decision D1, contract K1), #34, #35.

   #19  A weekly-challenge go is saved as an ordinary workout note, so every
        "how many sessions" figure counted it: four one-rep goes read "4 of 4
        done - Week done", completed a "4 Workouts a Week" goal and paid +100 XP
        each. D1: a go is NOT a session. It still feeds Records, the goal's best,
        the week streak, per-set XP and the PB bonus. The ONE rule is
        stats.isChallengeRun(workout) (K1: fm.kind === 'challenge', or - for notes
        saved before this - an empty fm.plan with a "challenge" day name).
   #34  A go that beats the all-time best never earned the PB XP line.
   #35  Changing "Week starts on" mid-week paid week-streak / quest twice,
        because the ledger keys are built from the first day of the week.

   Every check below was written against the unfixed code and seen failing. */
const assert = require('node:assert');
const T = require('./f3-stub');
const stats = require('../src/stats');
const progress = require('../src/progress');
const rewards = require('../src/rewards');
const ledger = require('../src/rewards-ledger');
const dashboard = require('../src/page-dashboard');
const { challengeStatus } = require('../src/challenge');
const { saveRun } = require('../src/challenge-flow');
const { row, sets, day, daysOnFrom, EXERCISES } = require('./rewards-fixtures');
const { todayISO, startOfWeek, addDays, weekdayKey } = require('../src/dates');

const failures = [];
const test = (name, fn) => {
  const done = r => console.log(`  ok   ${name}`);
  const bad = e => { failures.push(name); console.error(`FAIL ${name}: ${String(e && e.message).split('\n')[0]}`); };
  try { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => done(), bad); done(); } catch (e) { bad(e); }
  return null;
};

/* A saved note as data.js reads it back. `kind` is the K1 frontmatter key. */
const note = (date, rows, fm, name) => ({
  name: name || `${date} x`, fm: Object.assign({ date }, fm || {}), rows,
  file: { path: `Gym/Workouts/${name || `${date} x`}.md` },
});
const challengeGo = (date, reps, name) => note(date, [row('Push-ups', { reps })], { plan: '', day: '50 Push-ups challenge', kind: 'challenge' }, name);
const oldChallengeGo = (date, reps, name) => note(date, [row('Push-ups', { reps })], { plan: '', day: '50 Push-ups challenge' }, name);
const session = (date, name) => note(date, sets('Bench Press', 3, { kg: 60, reps: 5 }), { plan: 'Upper', day: 'Push' }, name);

/* ---------------------------------------------------------------- the rule */

test('K1 stats.isChallengeRun is exported and reads fm.kind', () => {
  assert.strictEqual(typeof stats.isChallengeRun, 'function', 'isChallengeRun is not exported');
  assert.strictEqual(stats.isChallengeRun(challengeGo('2026-11-16', 1)), true);
});
test('K1 a note saved before today: empty plan + a "challenge" day name is a run', () => {
  assert.strictEqual(stats.isChallengeRun(oldChallengeGo('2026-11-16', 1)), true);
  assert.strictEqual(stats.isChallengeRun(note('2026-11-16', [], { plan: '', day: 'Weekly CHALLENGE' })), true, 'case folded');
});
test('K1 an ordinary session is not a run, even when its plan day says "challenge"', () => {
  assert.strictEqual(stats.isChallengeRun(session('2026-11-16')), false);
  assert.strictEqual(stats.isChallengeRun(note('2026-11-16', [], { plan: 'Upper', day: 'Challenge day' })), false, 'a plan day named Challenge is a real session');
  assert.strictEqual(stats.isChallengeRun(note('2026-11-16', [], { plan: '', day: 'Freestyle' })), false);
  for (const bad of [null, undefined, {}, { fm: null }]) assert.strictEqual(stats.isChallengeRun(bad), false);
});

/* ------------------------------------------------- the figures that count */

const WEEK = '2026-11-16';           // a Monday
const goes = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'].map((d, i) => challengeGo(d, 1, `go ${i}`));

test('#19 four one-rep goes are zero sessions this week (stats.sessionsInWeek)', () => {
  assert.strictEqual(stats.sessionsInWeek(goes, '2026-11-19', 'mon'), 0);
  assert.strictEqual(stats.sessionsInWeek(goes.map(g => oldChallengeGo(g.fm.date, 1, g.name)), '2026-11-19', 'mon'), 0, 'old-format notes too');
  assert.strictEqual(stats.sessionsInWeek(goes.concat([session('2026-11-18', 's')]), '2026-11-19', 'mon'), 1, 'a real session still counts');
});
test('#19 the all-time session count leaves them out (stats.sessionCount)', () => {
  assert.strictEqual(stats.sessionCount(goes), 0);
  assert.strictEqual(stats.sessionCount(goes.concat([session('2026-11-18', 's'), session('2026-11-19', 't')])), 2);
});
test('#19 the week ring says 0 done, not "4 of 4 done - Week done"', () => {
  const wp = progress.weekProgress({ workouts: goes, goals: [{ fm: { metric: 'workouts-per-week', target: 4 } }], daysOn: () => [], today: '2026-11-19', weekStart: 'mon' });
  assert.strictEqual(wp.done, 0);
  assert.strictEqual(wp.met, false);
});
test('#19 a "4 Workouts a Week" goal is not met by challenge goes (stats.goalCurrent)', () => {
  const g = { fm: { metric: 'workouts-per-week', target: 4 } };
  const cur = stats.goalCurrent(g, { workouts: goes, body: [], weekStart: 'mon', today: '2026-11-19', exercises: [] });
  assert.strictEqual(cur, 0);
  assert.ok(stats.goalProgress(g, cur) < 1, 'the goal must not be complete');
});
test('#19 stats.sessionDates (the day strip / "Logged for today") skips runs; workoutDates (activity) keeps them', () => {
  assert.strictEqual(typeof stats.sessionDates, 'function', 'sessionDates is not exported');
  const all = goes.concat([session('2026-11-12', 's')]);
  assert.deepStrictEqual(stats.sessionDates(all), ['2026-11-12']);
  assert.deepStrictEqual(stats.workoutDates(all), ['2026-11-12', '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19'], 'the heat grid still shows the day');
});
test('#19 the week streak is still kept alive by a week with only a go', () => {
  const ws = [session('2026-11-10', 'a'), challengeGo('2026-11-17', 5, 'b')];
  assert.strictEqual(stats.weekStreak(stats.workoutDates(ws), 'mon', '2026-11-18'), 2);
});

const exercises = EXERCISES.concat([]);
test('#19 medals: Iron Week, Century and Consistency ignore runs; Week Streak keeps them', () => {
  const ws = [];
  for (let w = 0; w < 5; w++) for (let k = 0; k < 4; k++) ws.push(challengeGo(addDays('2026-10-19', w * 7 + k), 1, `go ${w}-${k}`));
  const m = Object.fromEntries(rewards.medals({ workouts: ws, exercises, weekStart: 'mon' }).map(x => [x.key, x]));
  assert.strictEqual(m['iron-week'].progress.value, 0, 'Iron Week counted a week of goes');
  assert.strictEqual(m['century'].progress.value, 0, 'Century counted goes');
  assert.strictEqual(m['consistency'].progress.value, 0, 'Consistency counted weeks of goes');
  assert.strictEqual(m['week-streak'].progress.value, 5, 'a week with only a go keeps the streak alive');
  assert.strictEqual(m['rep-machine'].progress.value, 20, 'the reps are real reps');
});
test('#19 Century == the non-challenge session count; Iron Week == best sessionsInWeek', () => {
  const ws = [session('2026-11-02', 'a'), session('2026-11-03', 'b'), session('2026-11-04', 'c'), challengeGo('2026-11-05', 9, 'd'), challengeGo('2026-11-06', 9, 'e')];
  const m = Object.fromEntries(rewards.medals({ workouts: ws, exercises, weekStart: 'mon' }).map(x => [x.key, x]));
  assert.strictEqual(m['century'].progress.value, stats.sessionCount(ws));
  assert.strictEqual(m['century'].progress.value, 3);
  assert.strictEqual(m['iron-week'].progress.value, stats.sessionsInWeek(ws, '2026-11-04', 'mon'));
});
test('#19 the weekly quest does not count a go as progress', () => {
  const schedule = { mon: [day('Push', [['Push-ups', 2, '5']])] };
  const common = { daysOn: daysOnFrom(schedule), exercises, today: '2026-11-18', weekStart: 'mon' };
  const q = rewards.questFor({ ...common, workouts: [challengeGo('2026-11-16', 30, 'a'), oldChallengeGo('2026-11-17', 30, 'b')] });
  assert.strictEqual(q.done, 0);
  assert.strictEqual(q.complete, false);
  const real = rewards.questFor({ ...common, workouts: [note('2026-11-16', sets('Push-ups', 1, { reps: 5 }), { plan: 'P', day: 'Push' }, 'real')] });
  assert.strictEqual(real.done, 5, 'control: a real session still counts');
});

const sched = { mon: [day('Push', [['Push-ups', 2, '5']])] };
const awardCommon = (extra) => Object.assign({
  daysOn: daysOnFrom(sched), exercises, weekStart: 'mon', settings: {}, workouts: [], ledgerState: ledger.parseLedger(''),
}, extra);

test('#19 awardsForSession for a go: no +100 "Session finished", per-set XP kept', () => {
  const a = rewards.awardsForSession(awardCommon({ workoutKey: 'Gym/Workouts/go.md', date: '2026-11-16', sets: [row('Push-ups', { reps: 12 }), row('Push-ups', { reps: 9, set: 2 })], kind: 'challenge' }));
  assert.ok(!a.some(x => x.kind === 'session'), `a session line was paid: ${JSON.stringify(a)}`);
  const s = a.find(x => x.kind === 'sets');
  assert.ok(s && s.xp === 10, 'per-set XP stays');
});
test('#19 control: the same rows as an ordinary session still pay the +100', () => {
  const a = rewards.awardsForSession(awardCommon({ workoutKey: 'Gym/Workouts/s.md', date: '2026-11-16', sets: [row('Push-ups', { reps: 12 })] }));
  assert.ok(a.some(x => x.kind === 'session' && x.xp === 100));
});
test('#19 a go in the second week still earns the streak-week XP (the streak counts it)', () => {
  const a = rewards.awardsForSession(awardCommon({
    workoutKey: 'Gym/Workouts/go.md', date: '2026-11-17', sets: [row('Push-ups', { reps: 12 })], kind: 'challenge',
    workouts: [session('2026-11-10', 'prev')],
  }));
  assert.ok(a.some(x => x.kind === 'streak' && x.xp === 20), `no streak line: ${JSON.stringify(a)}`);
});
test('#19 a go never completes the weekly quest, however many reps', () => {
  const a = rewards.awardsForSession(awardCommon({ workoutKey: 'Gym/Workouts/go.md', date: '2026-11-16', sets: [row('Push-ups', { reps: 50 })], kind: 'challenge' }));
  assert.ok(!a.some(x => x.kind === 'quest'), 'quest paid for a go');
  const ctl = rewards.awardsForSession(awardCommon({ workoutKey: 'Gym/Workouts/s.md', date: '2026-11-16', sets: [row('Push-ups', { reps: 50 })] }));
  assert.ok(ctl.some(x => x.kind === 'quest'), 'control: the same reps in a real session complete it');
});
test('#19 a path reused by a go is still paid (no session line exists to find, so the sets line decides)', () => {
  const state = ledger.parseLedger('| 2026-11-16 | sets | sets:Gym/Workouts/go.md | 5 | 1 set logged |\n');
  assert.strictEqual(rewards.sessionKeySuffix(state, 'Gym/Workouts/go.md', 123), '#123');
  assert.strictEqual(rewards.sessionKeySuffix(ledger.parseLedger(''), 'Gym/Workouts/go.md', 123), '', 'control: a path never paid keeps the plain key');
});

/* The dashboard reads the same rule: a go does not make today "logged". */
test('#19 Today: a go is not "Logged for today", the Start button is not "Log another session", the strip has no done day', () => {
  const today = todayISO();
  const plan = { name: 'My Plan', fm: { active: 'true' } };
  const dayObj = day('Push', [['Bench Press', 3, '5']]);
  dayObj.weekday = weekdayKey(today);
  plan.model = { days: [dayObj], intro: [] };
  const mk = workouts => {
    const ctx = {
      app: {}, data: { workouts, exercises, goals: [], body: [], plans: [plan] }, settings: { weekStart: 'mon', rewards: false }, state: {}, io: {},
      nav() {}, notice() {}, reload() {}, startGuided() {}, startLog() {},
      activePlan: () => plan, activePlanIsImplicit: () => false, mainPlans: () => [plan], parallelPlans: () => [], fallbackPlans: () => [],
      daysOn: wk => (wk === weekdayKey(today) ? [{ plan, day: dayObj }] : []),
    };
    return T.render(dashboard, ctx);
  };
  /* The stub's append() drops bare strings from textContent, and the hero's sub line is one. */
  const sub = root => T.findAll(root, 'gv-hero-sub')[0].children.join(' ');
  const withGo = mk([challengeGo(today, 1, 'go')]);
  const text = withGo.textContent.replace(/\s+/g, ' ');
  assert.ok(!/Logged for today/.test(sub(withGo)), 'a go made today "logged"');
  assert.ok(!/Log another session/.test(text), 'the Start button turned into Log another session');
  assert.strictEqual(T.findAll(withGo, 'gv-day').filter(n => /\bdone\b/.test(n.className)).length, 0, 'the strip marked a day done');
  assert.ok(/0\s+sessions this week/.test(text), `tile: ${text.slice(0, 400)}`);
  const withReal = mk([session(today, 's')]);
  assert.ok(/Logged for today/.test(sub(withReal)), 'control: a real session still marks the day');
  assert.ok(/Log another session/.test(withReal.textContent), 'control: and turns Start into Log another session');
  assert.strictEqual(T.findAll(withReal, 'gv-day').filter(n => /\bdone\b/.test(n.className)).length, 1, 'control: one done day');
});

/* ------------------------------------------------------------ #34 PB bonus */

const flowCtx = (workouts, exs) => {
  const saved = [], appended = [];
  const ctx = {
    app: {}, data: { workouts, exercises: exs || exercises, goals: [] }, settings: { weekStart: 'mon' }, state: {}, daysOn: () => [],
    notice() {}, reload() {},
    io: {
      saveWorkout: async s => { saved.push(s); return `Gym/Workouts/${s.date} ${s.day}.md`; },
      readRewards: async () => ledger.parseLedger(''),
      appendRewards: async a => { appended.push(...a); return { appended: a }; },
    },
  };
  return { ctx, saved, appended };
};
const goalOf = (name, metric, exercise, target) => ({ name, fm: { metric, exercise, target, challenge: 'weekly', started: '2026-11-01' } });

(async () => {
  await test('K1 saveRun writes kind: challenge on the note', async () => {
    const { ctx, saved } = flowCtx([]);
    await saveRun(ctx, goalOf('50 Push-ups challenge', 'exercise-reps', 'Push-ups', 50), [20], 'max', Date.now());
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(saved[0].kind, 'challenge');
    assert.strictEqual(saved[0].plan, '');
  });
  await test('#34 a go that beats the all-time best pays the +50 PB line once, with the per-set XP and no session XP', async () => {
    const { ctx, appended } = flowCtx([note('2026-10-01', [row('Push-ups', { reps: 52 })], { plan: 'P', day: 'D' }, 'old')]);
    await saveRun(ctx, goalOf('60 Push-ups challenge', 'exercise-reps', 'Push-ups', 60), [55, 30], 'max', Date.now());
    const pb = appended.filter(a => a.kind === 'pb');
    assert.strictEqual(pb.length, 1, `PB lines: ${JSON.stringify(appended)}`);
    assert.strictEqual(pb[0].xp, 50);
    assert.ok(/Push-ups 55/.test(pb[0].note), pb[0].note);
    assert.ok(appended.some(a => a.kind === 'sets' && a.xp === 10), 'per-set XP');
    assert.ok(!appended.some(a => a.kind === 'session'), 'no session XP');
  });
  await test('#34 a go at or under the best, or the first ever go, pays no PB', async () => {
    for (const [history, reps] of [[[note('2026-10-01', [row('Push-ups', { reps: 52 })], { plan: 'P', day: 'D' }, 'old')], 52], [[note('2026-10-01', [row('Push-ups', { reps: 52 })], { plan: 'P', day: 'D' }, 'old')], 40], [[], 40]]) {
      const { ctx, appended } = flowCtx(history);
      await saveRun(ctx, goalOf('60 Push-ups challenge', 'exercise-reps', 'Push-ups', 60), [reps], 'max', Date.now());
      assert.ok(!appended.some(a => a.kind === 'pb'), `a PB was paid for ${reps} over ${history.length ? 52 : 'nothing'}`);
    }
  });
  await test('#34 a hold beats the best HOLD, not the best reps', async () => {
    const plank = [{ name: 'Plank', fm: { unit: 'seconds' } }];
    const old = note('2026-10-01', [row('Plank', { sec: 60 })], { plan: 'P', day: 'D' }, 'old');
    const { ctx, appended } = flowCtx([old], plank);
    await saveRun(ctx, goalOf('3-minute Plank challenge', 'exercise-duration', 'Plank', 180), [75], 'max', Date.now());
    const pb = appended.filter(a => a.kind === 'pb');
    assert.strictEqual(pb.length, 1, JSON.stringify(appended));
    assert.ok(/Plank 75s/.test(pb[0].note), pb[0].note);
  });

  /* ---------------------------------------------------- #35 week-start change */

  const q = (extra) => awardCommon(Object.assign({ daysOn: daysOnFrom(sched) }, extra));
  await test('#35 week-streak: Mon pays under a Monday week; the same calendar days under a Saturday week do not pay again', () => {
    const hist = [session('2026-11-09', 'prev')];
    const first = rewards.awardsForSession(q({ workoutKey: 'a.md', date: '2026-11-16', sets: [row('Bench Press', { reps: 5, kg: 60 })], workouts: hist, weekStart: 'mon' }));
    const paid = first.filter(x => x.kind === 'streak');
    assert.strictEqual(paid.length, 1, 'control: Monday pays it');
    assert.strictEqual(paid[0].key, 'week-streak:2026-11-16');
    const state = ledger.parseLedger('| 2026-11-16 | streak | week-streak:2026-11-16 | 20 | 2-week streak kept |\n');
    const again = rewards.awardsForSession(q({ workoutKey: 'b.md', date: '2026-11-17', sets: [row('Bench Press', { reps: 5, kg: 60 })], workouts: hist.concat([session('2026-11-16', 'mon')]), weekStart: 'sat', ledgerState: state }));
    assert.ok(!again.some(x => x.kind === 'streak'), `paid twice: ${JSON.stringify(again)}`);
  });
  await test('#35 week-streak control: a streak line from the PREVIOUS week does not block this week', () => {
    const state = ledger.parseLedger('| 2026-11-10 | streak | week-streak:2026-11-09 | 20 | kept |\n');
    const a = rewards.awardsForSession(q({ workoutKey: 'b.md', date: '2026-11-17', sets: [row('Bench Press', { reps: 5, kg: 60 })], workouts: [session('2026-11-09', 'prev')], weekStart: 'mon', ledgerState: state }));
    assert.ok(a.some(x => x.kind === 'streak'));
  });
  await test('#35 quest: paid on Tue under a Saturday week, not paid again on Wed under a Monday week', () => {
    const rep5 = (d, n) => note(d, sets('Push-ups', 1, { reps: 5 }), { plan: 'P', day: 'Push' }, n);
    const sun = rep5('2026-11-15', 'sun');
    const tue = rep5('2026-11-17', 'tue');
    const sat = rewards.awardsForSession(q({ workoutKey: 'tue.md', date: '2026-11-17', sets: tue.rows, workouts: [sun], weekStart: 'sat' }));
    const paid = sat.find(x => x.kind === 'quest');
    assert.ok(paid, 'control: the Saturday week pays the quest');
    assert.strictEqual(paid.key, 'quest:2026-11-14');
    const state = ledger.parseLedger(`| 2026-11-17 | quest | ${paid.key} | 120 | q |\n`);
    const wed = rep5('2026-11-18', 'wed');
    const mon = rewards.awardsForSession(q({ workoutKey: 'wed.md', date: '2026-11-18', sets: wed.rows, workouts: [sun, tue], weekStart: 'mon', ledgerState: state }));
    assert.ok(!mon.some(x => x.kind === 'quest'), `quest paid twice: ${JSON.stringify(mon)}`);
  });
  await test('#35 questFor.paid is true when a quest line of this week exists under the other week key', () => {
    const state = ledger.parseLedger('| 2026-11-17 | quest | quest:2026-11-14 | 120 | q |\n');
    const rep = (d, n) => note(d, sets('Push-ups', 1, { reps: 10 }), { plan: 'P', day: 'Push' }, n);
    const qs = rewards.questFor({ daysOn: daysOnFrom(sched), exercises, today: '2026-11-18', weekStart: 'mon', workouts: [rep('2026-11-17', 'x')], ledger: state });
    assert.strictEqual(qs.key, 'quest:2026-11-16');
    assert.strictEqual(qs.paid, true);
  });

  if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
  console.log('audit-1116 numbers challenge counting OK');
})();
