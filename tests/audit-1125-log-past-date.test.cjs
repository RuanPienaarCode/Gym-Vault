'use strict';
/* Audit 25 Nov 2026, lane L6 "log + history" — finding #21.

   THERE WAS NO WAY TO LOG A WORKOUT FOR AN EARLIER DAY. "Log manually" and
   "Log a freestyle session" always dated the session today; the date at the top
   of the log was printed, not a control. Now:
     a. the date is a native date control (max = today, pastDate the one
        validator): picking an earlier day moves draft.date, keeps every set
        already logged, and the header says plainly which day it saves on;
     b. History has "Log a past session", which starts the same freestyle log
        Today's "Log a freestyle session" does (ctx.startLog(null, null, …))
        with the date control focused.
   A back-dated save names the note by that day and the rewards are dated that
   day too. Drives the real controller and log page. Synthetic data. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');
const { todayISO, addDays, fmtShort } = require('../src/dates');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.notices.length = 0; H.modals.length = 0;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

const today = todayISO();
const yesterday = addDays(today, -1);
const dateBox = b => H.page(b.ctx).querySelectorAll('input').find(i => i.getAttribute('type') === 'date');
const pick = (b, iso) => { const d = dateBox(b); d.value = iso; H.fire(d, 'change'); };
const repsBox = (b, i) => H.page(b.ctx).querySelectorAll('input').filter(x => /^Reps/.test(x.getAttribute('aria-label') || ''))[i];
const type = (input, v) => { input.value = v; H.fire(input, 'input'); };
const header = b => H.page(b.ctx).querySelector('.gv-logtop').textContent;

async function log(extra) {
  const b = await H.boot(Object.assign({ planBody: '## D (any)\n\n- Push-ups | 2 x 10\n', settings: { soundMode: 'silent' } }, extra || {}));
  const plan = b.ctx.activePlan();
  b.ctx.startLog(plan, plan.model.days[0]);
  return b;
}

(async () => {
  await check('#21a the log header carries a date control: today, never later', async () => {
    const b = await log();
    const d = dateBox(b);
    assert.ok(d, 'no date control on the log page');
    assert.strictEqual(d.getAttribute('max'), today, 'the control must not offer a future day');
    assert.strictEqual(d.value, today);
    assert.ok(d.getAttribute('aria-label'), 'the control needs an accessible name');
    assert.ok(!/will be saved on/.test(header(b)), 'a today session needs no "saved on" line');
  });

  await check('#21a picking an earlier day moves the draft, keeps what is logged, and says so', async () => {
    const b = await log();
    type(repsBox(b, 0), '14');
    const draft = b.ctx.state.logDraft;
    pick(b, yesterday);
    assert.strictEqual(b.ctx.state.logDraft, draft, 'changing the day replaced the draft');
    assert.strictEqual(draft.date, yesterday);
    assert.strictEqual(draft.entries[0].sets[0].reps, '14', 'the typed set was lost');
    assert.strictEqual(dateBox(b).value, yesterday, 'the redrawn control shows the new day');
    assert.ok(header(b).indexOf(`This session will be saved on ${fmtShort(yesterday)}`) >= 0, `header: ${header(b)}`);
  });

  await check('#21a a future or empty day is refused and the draft keeps its day', async () => {
    const b = await log();
    pick(b, addDays(today, 2));
    assert.strictEqual(b.ctx.state.logDraft.date, today, 'a future day was accepted');
    assert.ok(H.notices.some(n => /today or an earlier day/.test(n)), `no notice: ${H.notices}`);
    pick(b, '');
    assert.strictEqual(b.ctx.state.logDraft.date, today, 'an emptied control blanked the day');
    assert.strictEqual(dateBox(b).value, today);
  });

  await check('#21a a back-dated session saves under that day, and its rewards are dated that day', async () => {
    const b = await log({ settings: { soundMode: 'silent', rewards: true } });
    const appended = [];
    b.ctx.io.saveWorkout = async w => { b.saved.push(JSON.parse(JSON.stringify(w))); return `Gym/Workouts/${w.date} D.md`; };
    b.ctx.io.readRewards = async () => ({ entries: [], keys: new Set() });
    b.ctx.io.appendRewards = async awards => { appended.push(awards); return { appended: awards }; };
    H.click(H.byLabel(H.page(b.ctx), 'Mark done'));
    pick(b, yesterday);
    H.click(H.byText(H.page(b.ctx), 'Save session'));
    for (let i = 0; i < 6; i++) await H.flush();
    assert.strictEqual(b.saved.length, 1);
    assert.strictEqual(b.saved[0].date, yesterday, 'the note was not dated the picked day');
    assert.strictEqual(appended.length, 1, 'fixture: an award was written');
    assert.ok(appended[0].length && appended[0].every(a => a.date === yesterday), `awards dated ${appended[0].map(a => a.date)}`);
  });

  await check('#21b History offers "Log a past session": a freestyle log with the date control focused', async () => {
    const b = await H.boot({ settings: { soundMode: 'silent' } });
    const focused = [];
    const orig = H.N.prototype.focus;
    H.N.prototype.focus = function () { focused.push(this); };
    try {
      const calls = [];
      const real = b.ctx.startLog;
      b.ctx.startLog = (...a) => { calls.push(a); return real(...a); };
      b.ctx.nav('history');
      const btn = H.byText(H.page(b.ctx), 'Log a past session');
      assert.ok(btn, 'History has no "Log a past session" button');
      assert.strictEqual(btn.getAttribute('type'), 'button');
      H.click(btn);
      assert.strictEqual(calls.length, 1);
      assert.strictEqual(calls[0][0], null, 'not a freestyle start (plan)');
      assert.strictEqual(calls[0][1], null, 'not a freestyle start (day)');
      assert.strictEqual(b.ctx.state.page, 'log');
      assert.strictEqual(b.ctx.state.logDraft.plan, '');
      assert.strictEqual(b.ctx.state.logDraft.day, '');
      H.advance(1);
      assert.ok(focused.indexOf(dateBox(b)) >= 0, 'the date control was not focused');
      /* One-shot: a later redraw of the same log does not grab focus again. */
      focused.length = 0;
      b.ctx.rerender(); H.advance(1);
      assert.ok(focused.indexOf(dateBox(b)) < 0, 'the date control grabbed focus on an ordinary redraw');
    } finally { H.N.prototype.focus = orig; }
  });

  await check('#21b with a session already open it asks first (the existing replace-draft confirm)', async () => {
    const b = await log();
    H.click(H.byLabel(H.page(b.ctx), 'Mark done'));
    const live = b.ctx.state.logDraft;
    b.ctx.nav('history');
    H.click(H.byText(H.page(b.ctx), 'Log a past session'));
    assert.strictEqual(b.ctx.state.logDraft, live, 'the open session was replaced without asking');
    const m = H.modals[H.modals.length - 1];
    assert.ok(m && m.opts && m.opts.title === 'A session is already open', `no confirm: ${m && m.opts && m.opts.title}`);
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit-1125 log past date OK (${results.length} cases)`);
  process.exit(0);
})();
