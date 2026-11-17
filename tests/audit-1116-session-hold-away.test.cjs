'use strict';
/* AUDIT 16 NOV 2026, finding #3 and decision D2: A HOLD LEFT RUNNING IN THE
   BACKGROUND SAVES WHAT THE CLOCK SHOWED WHEN THE PAGE WAS HIDDEN.

   Before: hold.away only withheld the record callout. With a "Plank 120 s" goal and
   the page hidden five minutes, 312 s was saved, GOAL HIT fired and the note made
   that the best. Now, once the away guard has tripped (hidden longer than the 15 s
   grace while the hold ran), the set saves the seconds the clock showed at the
   moment the page was hidden, claims no record and fires no goal. A hold hidden for
   less than the grace is untouched.

   Drives the REAL controller and the REAL guided screen. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.speech.length = 0; H.notices.length = 0;
  H.document.visibilityState = 'visible';
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const PLANK = '## D (any)\n\n- Plank | 2 x 120s\n';   // history best 40 s
const GOAL = { name: 'Hold two minutes', fm: { metric: 'exercise-duration', exercise: 'Plank', target: 120, direction: 'increase' } };
async function start() {
  const b = await H.boot({ planBody: PLANK, goals: [GOAL], exercises: [H.ex('Plank', { unit: 'seconds' })], settings: { soundMode: 'silent', guideRestSeconds: 0 } });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  H.advance(6000);
  assert.ok(b.ctx.state.session.hold && b.ctx.state.session.hold.running, 'fixture: the hold is running');
  return b;
}
const sess = b => b.ctx.state.session;
const zone = b => H.page(b.ctx).querySelector('.gv-session-zone');
const sets = b => b.ctx.state.logDraft.entries[0].sets;
const setHidden = hidden => {
  H.document.visibilityState = hidden ? 'hidden' : 'visible';
  for (const fn of (H.docListeners.visibilitychange || []).slice()) fn();
};
const clockSeconds = b => Math.round((H.clock.now - sess(b).hold.startedAt) / 1000);
const goalHit = b => H.notices.concat(sess(b).pendingCallouts || []).some(n => /GOAL HIT/.test(n)) || sess(b).goalCount > 0;
const bestHit = b => H.notices.concat(sess(b).pendingCallouts || []).some(n => /NEW BEST/.test(n)) || (sess(b).records || []).length > 0;

(async () => {
  await check('D2-a. hidden 5 minutes mid-hold: the set saves the seconds shown at the moment it was hidden', async () => {
    const b = await start();
    H.advance(11000);
    const shown = clockSeconds(b);
    setHidden(true); H.advance(5 * 60 * 1000); setHidden(false);
    H.tapZone(zone(b));
    assert.strictEqual(sets(b)[0].done, true);
    assert.strictEqual(parseFloat(sets(b)[0].seconds), shown, `saved ${sets(b)[0].seconds} s, the clock showed ${shown} s when the page was hidden`);
    assert.ok(!bestHit(b), 'and it claims no record');
  });

  await check('D2-b. the same, when the clamped seconds already exceed the goal: still no GOAL HIT and no NEW BEST', async () => {
    const b = await start();
    H.advance(125000);
    const shown = clockSeconds(b);
    assert.ok(shown >= 120, 'fixture: the clock was past the 120 s goal when the page was hidden');
    setHidden(true); H.advance(5 * 60 * 1000); setHidden(false);
    H.tapZone(zone(b));
    assert.strictEqual(parseFloat(sets(b)[0].seconds), shown, `saved ${sets(b)[0].seconds}`);
    assert.ok(!goalHit(b), 'a hold that left the screen fired a goal');
    assert.ok(!bestHit(b), 'or a record');
  });

  await check('D2-c. control: hidden for less than the 15 s grace saves the full clock and still claims', async () => {
    const b = await start();
    H.advance(10000);
    setHidden(true); H.advance(8000); setHidden(false);
    H.advance(40000);
    const full = clockSeconds(b);
    H.tapZone(zone(b));
    assert.strictEqual(parseFloat(sets(b)[0].seconds), full, 'a glance away must not cut the hold short');
    assert.strictEqual((sess(b).records || []).length, 1, 'and a 58 s plank against a 40 s best is a record');
  });

  await check('D2-d. the numeral shows what will be saved (it does not keep counting an hour nobody watched)', async () => {
    const b = await start();
    H.advance(11000);
    const shown = clockSeconds(b);
    setHidden(true); H.advance(60 * 60 * 1000); setHidden(false);
    H.advance(2000);
    const want = require('../src/dom').fmtSeconds(shown);
    assert.strictEqual(H.countText(b.ctx), want, `the numeral reads ${H.countText(b.ctx)} but ${want} is what saves`);
  });

  await check('D2-e. X -> Back to the log with the away hold on screen saves the clamped seconds', async () => {
    const b = await start();
    H.advance(11000);
    const shown = clockSeconds(b);
    setHidden(true); H.advance(60 * 60 * 1000); setHidden(false);
    H.click(H.byLabel(H.page(b.ctx), 'End session'));
    H.modals.slice().reverse().find(m => m.kind === 'end').opts.onReview();
    assert.strictEqual(parseFloat(sets(b)[0].seconds), shown, `saved ${sets(b)[0].seconds}`);
    const carry = b.ctx.state.sessionCarry;
    assert.strictEqual(((carry && carry.records) || []).length, 0, 'and claimed nothing');
  });

  await check('D2-f. pause after coming back, leave and return, resume, stop: still the seconds at the hide, still no claim', async () => {
    const b = await start();
    H.advance(11000);
    const shown = clockSeconds(b);
    setHidden(true); H.advance(60 * 60 * 1000); setHidden(false);
    H.click(H.byLabel(H.page(b.ctx), 'Pause'));
    b.ctx.nav('dashboard'); b.ctx.enterGuided();
    assert.ok(sess(b).hold && sess(b).hold.paused, 'fixture: came back paused');
    H.click(H.byLabel(H.page(b.ctx), 'Resume'));
    H.tapZone(zone(b));
    assert.strictEqual(parseFloat(sets(b)[0].seconds), shown, `saved ${sets(b)[0].seconds}`);
    assert.ok(!bestHit(b) && !goalHit(b));
  });

  await check('D2-g. the figure survives a kill while paused (draft-store keeps it)', async () => {
    const store = H.makeStorage();
    const b0 = await H.boot({ planBody: PLANK, storage: store, exercises: [H.ex('Plank', { unit: 'seconds' })], settings: { soundMode: 'silent', guideRestSeconds: 0 } });
    const plan = b0.ctx.activePlan(); b0.ctx.startGuided(plan, plan.model.days[0]);
    H.click(H.page(b0.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
    H.advance(6000); H.advance(11000);
    const shown = clockSeconds(b0);
    setHidden(true); H.advance(60 * 60 * 1000); setHidden(false);
    H.click(H.byLabel(H.page(b0.ctx), 'Pause'));
    const live = b0.ctx.state.logDraft.live;
    assert.ok(live && live.paused && live.paused.away === true, 'fixture: the pause was written as away');
    assert.ok(Math.abs(live.paused.awaySeconds - shown) <= 0.5, `awaySeconds ${live.paused.awaySeconds} against a clock that showed ${shown}`);
    H.killProcess();
    const b1 = await H.boot({ storage: store, planBody: PLANK, exercises: [H.ex('Plank', { unit: 'seconds' })], settings: { soundMode: 'silent', guideRestSeconds: 0 } });
    b1.ctx.resumeDraft(); b1.ctx.enterGuided();
    assert.ok(sess(b1).hold && sess(b1).hold.paused, 'fixture: restored paused');
    H.click(H.byLabel(H.page(b1.ctx), 'Resume'));
    H.tapZone(zone(b1));
    assert.strictEqual(parseFloat(b1.ctx.state.logDraft.entries[0].sets[0].seconds), shown, 'saved the seconds at the hide after a relaunch');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit-1116 session hold away OK (${results.length} cases)`);
  process.exit(0);
})();
