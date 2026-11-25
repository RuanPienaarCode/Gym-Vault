'use strict';
/* Audit 25 Nov 2026, lane L6 "log + history" — finding #28, History half.

   History sessions did not link to their exercises. In an open session each
   exercise name that has a page in the library is now a button to that page
   (route 'exercise' with { exercise, path }, the same params Records and the
   library pass), and Back returns to History with that session still open. A
   name with no exercise note stays plain text: the detail page would only bounce
   it to the library. Drives the real controller. Synthetic data. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.notices.length = 0; H.modals.length = 0;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

const row = (exercise, set, o) => Object.assign({ exercise, set, reps: '', weight_kg: '', seconds: '', note: '', distance_km: '' }, o);
const SESSION = { name: '2026-11-20 Upper', fm: { date: '2026-11-20', plan: 'Synthetic Plan', day: 'Upper', duration_min: 42 },
  rows: [row('Push-ups', 1, { reps: '12' }), row('Mystery Move', 1, { reps: '5' })], file: { path: 'Gym/Workouts/2026-11-20 Upper.md' } };

(async () => {
  await check('#28 an exercise name in an open session opens its page; Back returns to the session', async () => {
    const b = await H.boot({ workouts: [SESSION], settings: { soundMode: 'silent' } });
    b.ctx.nav('history', { session: SESSION.name });
    const link = H.page(b.ctx).querySelectorAll('button').find(x => x.textContent === 'Push-ups');
    assert.ok(link, 'the exercise name is not a button');
    assert.strictEqual(link.getAttribute('type'), 'button');
    H.click(link);
    assert.strictEqual(b.ctx.state.page, 'exercise');
    assert.strictEqual(b.ctx.state.params.exercise, 'Push-ups');
    assert.strictEqual(b.ctx.state.params.path, 'Gym/Exercises/Push-ups.md');
    assert.strictEqual(b.ctx.backTo('exercises'), 'history', 'Back would not return to History');
    b.ctx.back('exercises');
    assert.strictEqual(b.ctx.state.page, 'history');
    assert.strictEqual(b.ctx.state.params.session, SESSION.name, 'Back did not reopen the session');
  });

  await check('#28 a name with no exercise note stays plain text', async () => {
    const b = await H.boot({ workouts: [SESSION], settings: { soundMode: 'silent' } });
    b.ctx.nav('history', { session: SESSION.name });
    const btn = H.page(b.ctx).querySelectorAll('button').find(x => x.textContent === 'Mystery Move');
    assert.ok(!btn, 'an exercise with no page is a dead-end button');
    assert.ok(H.page(b.ctx).querySelectorAll('.gv-set-ex').some(x => x.textContent === 'Mystery Move'), 'the name is gone');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit-1125 log history links OK (${results.length} cases)`);
  process.exit(0);
})();
