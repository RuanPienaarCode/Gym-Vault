'use strict';
/* THE LIVE "BEAT YOUR BEST" TARGET (Apex skin): reps screen and hold screen.

   Drives the REAL controller and the REAL guided screen (tests/
   live-session-harness.js). What has to be true:

     - it shows "Beat 12 / You're on N / x to go" against the best the session
       started with (sess.workoutsAtStart) - raised to a better set this session
       has already logged (fix wave F2, R2-09: one bar for the live flag and the
       announcement);
     - it updates IN PLACE as reps are counted - the node survives every tap, so
       the screen is not re-rendered per rep (the count-in, the meter and the
       power-up all depend on that);
     - it turns .is-beaten exactly when applyCompletion would call the set a
       record (records.isRecord) - one rule, checked both ways below;
     - it is absent wherever the screen would not celebrate: a weighted entry
       (its record is weight, which the tap counter never observes), an exercise
       with no history, a run.

   History (harness default): Push-ups best 12 reps, Plank best 40 s. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

async function guided(planBody, opts) {
  const b = await H.boot(Object.assign({ planBody, settings: { guideRestSeconds: 0 } }, opts));
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  return b;
}
const q = (b, sel) => H.page(b.ctx).querySelector(sel);
const text = (b, sel) => { const n = q(b, sel); return n ? n.textContent : null; };
const widthOf = n => { const m = /width:\s*([\d.]+)%/.exec(n.getAttribute('style') || ''); return m ? Number(m[1]) : null; };
const tapN = (b, n) => { const z = q(b, '.gv-session-zone'); for (let i = 0; i < n; i++) { H.tapZone(z); H.advance(800); } };

(async () => {
  await check('1. reps screen shows the contract elements against the starting best (12)', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000);
    const t = q(b, '.gv-pb-target');
    assert.ok(t, 'a .gv-pb-target is on the reps screen');
    assert.strictEqual(text(b, '.gv-pb-target-label'), 'Beat 12');
    assert.strictEqual(text(b, '.gv-pb-target-now'), "You're on 0");
    assert.strictEqual(text(b, '.gv-pb-target-togo'), '13 to go');
    assert.ok(q(b, '.gv-pb-target-bar').querySelector('.gv-pb-target-fill'), 'bar > fill');
    assert.strictEqual(widthOf(q(b, '.gv-pb-target-fill')), 0);
  });

  await check('2. six reps: "You\'re on 6", "7 to go", 50% - and the SAME node, not a re-render', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000);
    const before = q(b, '.gv-pb-target');
    const zoneBefore = q(b, '.gv-session-zone');
    tapN(b, 6);
    assert.strictEqual(H.countText(b.ctx), '6');
    assert.strictEqual(q(b, '.gv-pb-target'), before, 'the target node survives the taps (updated in place)');
    assert.strictEqual(q(b, '.gv-session-zone'), zoneBefore, 'and so does the zone: nothing re-rendered per rep');
    assert.strictEqual(text(b, '.gv-pb-target-now'), "You're on 6");
    assert.strictEqual(text(b, '.gv-pb-target-togo'), '7 to go');
    assert.strictEqual(widthOf(q(b, '.gv-pb-target-fill')), 50);
    assert.ok(!before.classList.contains('is-beaten'));
  });

  await check('3. twelve reps TIES the best: not beaten, 1 to go, bar full', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000); tapN(b, 12);
    assert.ok(!q(b, '.gv-pb-target').classList.contains('is-beaten'));
    assert.strictEqual(text(b, '.gv-pb-target-togo'), '1 to go');
    assert.strictEqual(widthOf(q(b, '.gv-pb-target-fill')), 100);
  });

  await check('4. thirteen reps beats it: .is-beaten, label "New PB", bar capped at 100', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000); tapN(b, 15);
    const t = q(b, '.gv-pb-target');
    assert.ok(t.classList.contains('is-beaten'));
    assert.strictEqual(text(b, '.gv-pb-target-label'), 'New PB');
    assert.strictEqual(text(b, '.gv-pb-target-now'), "You're on 15");
    assert.strictEqual(widthOf(q(b, '.gv-pb-target-fill')), 100, 'never past the track');
  });

  await check('5. ONE RULE: .is-beaten at the moment Done would record it (12 -> no record, 13 -> record)', async () => {
    for (const [n, expectBeaten] of [[12, false], [13, true]]) {
      H.killProcess();
      const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
      H.advance(6000); tapN(b, n);
      assert.strictEqual(q(b, '.gv-pb-target').classList.contains('is-beaten'), expectBeaten, `${n} reps: beaten flag`);
      H.click(H.byText(H.page(b.ctx), 'Done'));
      const sess = b.ctx.state.session;
      const recorded = ((sess && sess.records) || (b.ctx.state.sessionCarry && b.ctx.state.sessionCarry.records) || []).length;
      assert.strictEqual(recorded > 0, expectBeaten, `${n} reps: the session's own record detection must agree with the live flag`);
    }
  });

  await check('6. the target moves up when this session logs a better set (fix wave F2, R2-09: max of the start best and this session\'s own)', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 2 x 10\n');
    H.advance(6000); tapN(b, 14);
    H.click(H.byText(H.page(b.ctx), 'Done'));
    H.advance(6000);
    assert.strictEqual(text(b, '.gv-pb-target-label'), 'Beat 14', 'set 2 chases the 14 just set; "Beat 12" was stale and disagreed with the announcement (tests/f2-repeat-best.test.cjs pins the rule)');
  });

  await check('7. a weighted entry gets no target (its record is weight; the counter observes reps)', async () => {
    const b = await guided('## D (any)\n\n- Goblet Squat | 1 x 8\n', {
      workouts: [H.workout('2026-01-01', [{ exercise: 'Goblet Squat', set: 1, reps: '8', weight_kg: '20', seconds: '', note: '', distance_km: '' }])],
    });
    H.advance(6000);
    assert.ok(q(b, '.gv-session-zone'), 'fixture: on the counter screen');
    assert.strictEqual(q(b, '.gv-pb-target'), null);
  });

  await check('8. an exercise never logged gets no target', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n', { workouts: [] });
    H.advance(6000);
    assert.ok(q(b, '.gv-session-zone'));
    assert.strictEqual(q(b, '.gv-pb-target'), null);
  });

  await check('9. hold screen: Beat 40s, counts up with the clock, beaten past it', async () => {
    const b = await guided('## D (any)\n\n- Plank | 1 x 60s\n');
    const t = q(b, '.gv-pb-target');
    assert.ok(t, 'the hold screen carries the target too');
    assert.strictEqual(text(b, '.gv-pb-target-label'), 'Beat 40s');
    H.advance(5420 + 20000);
    assert.strictEqual(q(b, '.gv-pb-target'), t, 'ticks update in place');
    assert.strictEqual(text(b, '.gv-pb-target-now'), "You're on 20s");
    assert.strictEqual(text(b, '.gv-pb-target-togo'), '21s to go');
    assert.strictEqual(widthOf(q(b, '.gv-pb-target-fill')), 50);
    H.advance(21000);
    assert.ok(t.classList.contains('is-beaten'), '41 s beats a 40 s best');
    assert.strictEqual(text(b, '.gv-pb-target-label'), 'New PB');
  });

  /* ---- the screen-reader announcement ------------------------------------
     The group's aria-label is rewritten every rep and a label is not spoken, so
     a VoiceOver user heard nothing when the record fell. A polite live region
     says "New personal best" - ONCE, on the transition, not on every rep after. */
  const liveOf = b => { const n = q(b, '.gv-pb-target').querySelector('.gv-sr-only'); assert.ok(n, 'the target carries a .gv-sr-only live region'); return n; };
  /* every write to the region's text, in order, so "announces once" is counted
     rather than inferred from the final string (re-writing the same words each
     rep re-announces them, and the final string cannot show that). */
  const spy = node => {
    const proto = Object.getPrototypeOf(node), d = Object.getOwnPropertyDescriptor(proto, 'textContent');
    const writes = [];
    Object.defineProperty(node, 'textContent', { configurable: true, get() { return d.get.call(this); }, set(v) { writes.push(String(v)); d.set.call(this, v); } });
    return writes;
  };

  await check('10. VoiceOver: a polite status region exists, empty until the record falls', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000); tapN(b, 5);
    const live = liveOf(b);
    assert.strictEqual(live.getAttribute('aria-live'), 'polite', 'polite: it must not cut off the rep count being spoken');
    assert.strictEqual(live.getAttribute('role'), 'status');
    assert.strictEqual(live.textContent, '', 'nothing to announce while the best still stands');
  });

  await check('11. "New personal best" is announced ONCE, when the target is first beaten - not on each later rep', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000); tapN(b, 12);                       // ties the best: not beaten
    const live = liveOf(b); const writes = spy(live);
    assert.strictEqual(live.textContent, '');
    tapN(b, 1);                                         // 13th rep: beaten
    assert.strictEqual(live.textContent, 'New personal best');
    assert.deepStrictEqual(writes.filter(Boolean), ['New personal best'], 'spoken exactly once on the transition');
    const at = writes.length;
    tapN(b, 4);                                         // reps 14..17: past the record, nothing new to say
    assert.strictEqual(writes.length, at, 'no further write to the live region on later reps: each write would be re-announced');
    assert.strictEqual(text(b, '.gv-pb-target-now'), "You're on 17", 'the reps were counted');
  });

  await check('12. the announcement fires on the way UP only: undo below the record clears it, crossing again speaks again', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000); tapN(b, 13);
    const live = liveOf(b);
    assert.strictEqual(live.textContent, 'New personal best');
    H.click(H.byLabel(H.page(b.ctx), 'Counter settings'));   // Undo lives in the counter-settings sheet
    H.click(H.byLabel(H.page(b.ctx), 'Undo last rep'));      // back to 12: no longer beaten
    assert.strictEqual(live.textContent, '', 'the stale words are not left for a reader to find');
    const writes = spy(live);
    tapN(b, 1);                                          // 13 again
    assert.deepStrictEqual(writes.filter(Boolean), ['New personal best']);
  });

  await check('13. a re-render that finds the set already past the record does not re-announce it', async () => {
    const b = await guided('## D (any)\n\n- Push-ups | 1 x 10\n');
    H.advance(6000); tapN(b, 14);
    b.ctx.rerender();
    assert.ok(q(b, '.gv-pb-target').classList.contains('is-beaten'), 'fixture: still beaten after the re-render');
    assert.strictEqual(liveOf(b).textContent, '', 'it was announced when it happened; a fresh region must not say it again');
  });

  await check('14. hold screen: announced once as the clock passes the best, not on every tick after', async () => {
    const b = await guided('## D (any)\n\n- Plank | 1 x 60s\n');
    H.advance(5420 + 20000);
    const live = liveOf(b); const writes = spy(live);
    H.advance(21000);                                    // 41 s > 40 s best
    assert.ok(q(b, '.gv-pb-target').classList.contains('is-beaten'));
    assert.deepStrictEqual(writes.filter(Boolean), ['New personal best']);
    const at = writes.length;
    H.advance(5000);
    assert.strictEqual(writes.length, at, 'five more seconds of ticks write nothing');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error('  FAIL ' + name + '\n       ' + (err && err.message)); } else console.log('  ok   ' + name);
  }
  if (bad) { console.error(`${bad} live-target check(s) failed`); process.exit(1); }
  console.log('session pb target OK');
  process.exit(0);
})();
