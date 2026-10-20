'use strict';
/* FIX WAVE F2, item 4 (audit L3-03 + R2-14 + L3-04): THE COUNT-IN RACES.

   L3-03. Done (or Skip passing the last set) during the 5 s count-in left the
          count-in RUNNING: it spoke "3, 2, 1, Begin" over the Rest screen and
          then threw "Cannot read properties of null (reading 'count')" from its
          own timer, because the set's counter was gone by then. Every exit from
          a set's screen must stop the count-in it started.
   R2-14. Tick set inside the count-in saved a 0-rep set that counted for XP and
          the quest. The count-in is "not started yet"; a tick on nothing is not
          a set.
   L3-04. A double tap 60 ms apart on the count-in counted a rep (the tap that
          skips arms the counter at once, and a fresh counter has no debounce
          memory), and on a HOLD the second tap stopped the hold at ~0 s. The tap
          that skips the count-in must not also be counted, or stop anything.

   Drives the REAL controller and the REAL guided screen (tests/live-session-
   harness.js: fake clock, recording speech). */
const assert = require('node:assert');
const Module = require('node:module');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  H.speech.length = 0;
  H.notices.length = 0;
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

async function start(planBody, settings) {
  const b = await H.boot({ planBody, settings: Object.assign({ soundMode: 'voice', guideRestSeconds: 10 }, settings || {}) });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const sess = b => b.ctx.state.session;
const sets = b => b.ctx.state.logDraft.entries[0].sets;
const zone = b => H.page(b.ctx).querySelector('.gv-session-zone');
const heardCountIn = () => H.spoken().filter(t => ['5', '4', '3', '2', '1', 'Begin'].includes(t));

(async () => {
  await check('F2-4a. Done during the count-in (a typed count on the screen) stops it: nothing is spoken over Rest and nothing throws', async () => {
    const b = await start('## D (any)\n\n- Push-ups | 2 x 10\n');
    H.advance(1200);                                           // 1.2 s into the 5 s count-in
    sess(b).counter = { count: 6, lastTapAt: -Infinity };      // the user typed 6 reps
    H.speech.length = 0;
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.strictEqual(sess(b).phase, 'resting', 'fixture: on to Rest');
    H.advance(8000);                                           // the old count-in would speak and arm inside this window
    assert.deepStrictEqual(heardCountIn(), [], `the old count-in spoke over Rest: ${JSON.stringify(heardCountIn())}`);
  });

  await check('F2-4b. Skip this set on the LAST set during the count-in: no "Begin" over the completion screen, no throw', async () => {
    const b = await start('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(1200);
    H.speech.length = 0;
    H.click(H.byLabel(H.page(b.ctx), 'Skip this set'));
    assert.ok(H.page(b.ctx).querySelector('.gv-session-complete'), 'fixture: the completion screen');
    H.advance(8000);
    assert.deepStrictEqual(heardCountIn(), [], `the old count-in spoke over the completion screen: ${JSON.stringify(heardCountIn())}`);
  });

  await check('F2-4c. Tick set during the count-in with nothing counted saves NOTHING (no 0-rep set for XP and the quest)', async () => {
    const b = await start('## D (any)\n\n- Push-ups | 2 x 10\n');
    H.advance(1500);
    const before = JSON.stringify(sets(b)[0]);
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.strictEqual(sets(b)[0].done, false, 'the set was not ticked');
    assert.strictEqual(JSON.stringify(sets(b)[0]), before, 'and nothing was written into it');
    assert.strictEqual(sess(b).phase, 'active', 'no rest started');
    assert.deepStrictEqual(sess(b).pos, { entryIndex: 0, setIndex: 0 }, 'still on set 1');
  });

  await check('F2-4d. a Tick on the count-in is a "ready" like a tap: it skips the count-in, and the next real tap counts', async () => {
    const b = await start('## D (any)\n\n- Push-ups | 2 x 10\n');
    H.advance(1500);
    H.click(H.byText(H.page(b.ctx), 'Done'));
    H.advance(1000);
    H.tapZone(zone(b));
    assert.strictEqual(sess(b).counter.count, 1, 'the count-in is over and a tap is rep one');
  });

  await check('F2-4e. a double tap 60 ms apart on the rep count-in: the first skips, the second is NOT rep one', async () => {
    const b = await start('## D (any)\n\n- Push-ups | 2 x 10\n');
    H.advance(1500);
    H.tapZone(zone(b)); H.advance(60); H.tapZone(zone(b));
    assert.strictEqual(sess(b).counter.count, 0, `the skip tap and its echo counted ${sess(b).counter.count} rep(s)`);
    H.advance(800);
    H.tapZone(zone(b));
    assert.strictEqual(sess(b).counter.count, 1, 'a deliberate tap after the debounce still counts');
  });

  await check('F2-4f. a double tap 60 ms apart on the HOLD count-in does not stop the hold at ~0 s', async () => {
    const b = await start('## D (any)\n\n- Plank | 1 x 60s\n');
    H.advance(1500);
    H.tapZone(zone(b)); H.advance(60); H.tapZone(zone(b));
    assert.strictEqual(sess(b).hold.running, true, 'the hold is running');
    assert.strictEqual(sets(b)[0].done, false, 'and the second tap did not save a ~0 s set');
    H.advance(2000);
    assert.strictEqual(sets(b)[0].done, false);
    H.tapZone(zone(b));
    assert.strictEqual(sets(b)[0].done, true, 'a deliberate tap later stops it as before');
  });

  await check('F2-4g. the freestyle modal has the same echo: skip tap, then a tap 60 ms later, counts nothing', () => {
    const origLoad = Module._load;
    const { RepCounterModal } = require('../src/rep-counter-modal');
    Module._load = origLoad;
    let now = 1_000_000;
    const realNow = Date.now; Date.now = () => now;
    try {
      const m = {
        _countIn: { a: false, armed() { return this.a; }, skip() { this.a = true; } },
        state: { count: 0, lastTapAt: -Infinity },
        commits: 0, commitRep() { this.commits++; },
      };
      RepCounterModal.prototype.registerTap.call(m);   // skips the count-in
      now += 60;
      RepCounterModal.prototype.registerTap.call(m);   // the echo
      assert.strictEqual(m.state.count, 0, `the echo counted ${m.state.count} rep(s)`);
      assert.strictEqual(m.commits, 0);
      now += 800;
      RepCounterModal.prototype.registerTap.call(m);
      assert.strictEqual(m.state.count, 1, 'a later tap counts');
    } finally { Date.now = realNow; }
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`f2 count-in races OK (${results.length} cases)`);
})();
