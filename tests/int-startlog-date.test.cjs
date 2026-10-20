'use strict';
/* AUDIT L4-04 (integration): Running › This week › Log on a PAST day must open a
   log dated THAT day. page-running passes { date } as ctx.startLog's third
   argument and page-log.startDraft honours it (tests/f3-log-past-day.test.cjs);
   this pins the link between them in the REAL controller, which used to drop
   the third argument, so the row never flipped to done and could be logged
   again. Drives the real controller through tests/live-session-harness.js. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');
const { todayISO, addDays } = require('../src/dates');

(async () => {
  const b = await H.boot({ planBody: '## D (any)\n\n- Push-ups | 3 x 10\n', settings: { soundMode: 'silent' } });
  const plan = b.ctx.activePlan();
  const past = addDays(todayISO(), -2);
  b.ctx.startLog(plan, plan.model.days[0], { date: past });
  const draft = b.ctx.state.logDraft;
  assert.ok(draft, 'startLog opened a draft');
  assert.strictEqual(draft.date, past, `a past day's log is dated that day, not today (got ${draft.date})`);

  b.ctx.state.logDraft = null;
  b.ctx.startLog(plan, plan.model.days[0]);
  assert.strictEqual(b.ctx.state.logDraft.date, todayISO(), 'with no date it is still today');

  console.log('startLog date OK (a past day logs under its own date; no date is today)');
  process.exit(0);
})().catch(e => { console.error(`FAIL ${e.message}`); process.exit(1); });
