'use strict';
/* THE LIVE SET'S POSTER CHROME (Apex + Lock In; src/live-chrome.js, and the
   `posterSkin` branch of src/page-session.js).

   Designs 10 and 07 draw the live set (phone B) as: close + "Move n of N", the
   name, a sub line, a rail of set pips, the PB target, the count, a weight
   stepper, and a sheet with what comes next and one big "Tick set" slab. Two
   things must hold at once:

     1  THE POSTER SKINS GET IT, with the same controls doing the same jobs
        (Tick completes the set exactly as Done did; the skip buttons are the
        same buttons, moved; the stepper writes what typing writes).
     2  FLOOR AND EDITORIAL DO NOT: not one poster node in their DOM, and the
        old labels ("Done"), classes and top bar exactly as before. The new
        markup is built for the poster skins only, so there is nothing to hide.

   Part A is the pure functions; part B drives the REAL controller and guided
   screen (tests/live-session-harness.js) in all four skins. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');
const live = require('../src/live-chrome.js');

let n = 0;
const ok = (c, msg) => { assert.ok(c, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

/* ---------------- A. the pure part ---------------- */
for (const skin of ['apex', 'lockin', undefined, '']) {
  ok(live.isLockInSkin(skin), `${skin}: wears the poster chrome (an unset skin is Apex, the default)`);
  eq(live.tickCopy(skin), { label: 'Tick set', poster: true }, `${skin}: the primary slab reads "Tick set"`);
}
for (const skin of ['floor', 'editorial']) {
  ok(!live.isLockInSkin(skin), `${skin}: keeps the plain screen`);
  eq(live.tickCopy(skin), { label: 'Done', poster: false }, `${skin}: keeps "Done"`);
}
eq(live.moveLabel(0, 4), 'Move 1 of 4');
eq(live.railLabel(1, 3), 'Set 2 of 3');
eq(live.railPips([{ done: true }, {}, {}], 1), ['done', 'cur', 'todo'], 'the set on screen is "cur", a ticked one "done"');
eq(live.railPips([{ touched: true }, {}, {}, { done: true }], 1), ['done', 'cur', 'todo', 'done'], 'a typed set counts as handled, one ahead of you too');
eq(live.railPips([{}, {}, {}], 2), ['todo', 'todo', 'cur'], 'a set skipped over is not "done"');
eq(live.railPips(undefined, 0), [], 'no sets, no pips');

const DIPS = { exercise: 'Dips', target: '12', sets: [{ done: true, reps: '9' }, {}, {}] };
eq(live.subLine(DIPS, 1), 'Aim 12 · set 1 was 9 reps', 'the plan target, then what the set before logged');
eq(live.subLine({ exercise: 'X', target: '8-12 @ 60kg', sets: [{}, {}] }, 0), 'Aim 8-12 @ 60kg', 'nothing logged yet: only the target');
eq(live.subLine({ exercise: 'X', target: 'submax', sets: [{}] }, 0), 'submax', 'a target that is not a number is not prefixed');
eq(live.subLine({ exercise: 'X', target: '', sets: [{}] }, 0), '', 'no target, nothing before: an empty line, not a made-up one');
eq(live.subLine({ exercise: 'X', target: '', sets: [{ done: true, reps: '1' }, {}] }, 1), 'set 1 was 1 rep', 'singular');
eq(live.subLine({ exercise: 'P', duration: true, target: '45s', sets: [{ done: true, seconds: '40' }, {}] }, 1, s => `${s}!`), 'Aim 45s · set 1 was 40!', 'a hold reads back its time through the caller\'s formatter');
eq(live.subLine({ exercise: 'X', target: '', sets: [{ done: true }, {}] }, 1), '', 'a handled set with no figure says nothing');

const DRAFT = { entries: [DIPS, { exercise: 'Bench Press', target: '8-12 @ 60kg', sets: [{}, {}, {}, {}] }, { exercise: 'Plank', target: '', sets: [{}] }] };
eq(live.nextUp(DRAFT, { entryIndex: 0, setIndex: 1 }), { last: false, name: 'Dips', detail: 'Set 3 of 3', sameExercise: true }, 'same movement: the next set');
eq(live.nextUp(DRAFT, { entryIndex: 0, setIndex: 2 }), { last: false, name: 'Bench Press', detail: '4 × 8-12 @ 60kg', sameExercise: false }, 'a new movement: its sets and target');
eq(live.nextUp(DRAFT, { entryIndex: 1, setIndex: 3 }), { last: false, name: 'Plank', detail: '1 set', sameExercise: false }, 'no target: just the count');
eq(live.nextUp(DRAFT, { entryIndex: 2, setIndex: 0 }), { last: true, name: '', detail: '', sameExercise: false }, 'the last set leads nowhere');
eq(live.nextUp(DRAFT, { entryIndex: 9, setIndex: 0 }), null, 'a finished session has no next');

/* ---------------- B. the real screen ---------------- */
const results = [];
const check = async (name, fn) => { H.killProcess(); try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); } };

async function guided(skin, planBody, opts) {
  const b = await H.boot(Object.assign({ planBody, settings: { skin, guideRestSeconds: 90 } }, opts));
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  H.advance(6000);
  return b;
}
const q = (b, sel) => H.page(b.ctx).querySelector(sel);
const qa = (b, sel) => H.page(b.ctx).querySelectorAll(sel);
/* the fake DOM matches ONE compound selector, so a descendant is two steps */
const inside = (b, outer, inner) => { const o = q(b, outer); return o ? o.querySelector(inner) : null; };
const tapN = (b, k) => { const z = q(b, '.gv-session-zone'); for (let i = 0; i < k; i++) { H.tapZone(z); H.advance(800); } };
const everyClass = b => { const s = new Set(); const walk = el => { for (const c of el.childNodes) if (c.nodeType === 1) { for (const k of c.classList) s.add(k); walk(c); } }; walk(H.page(b.ctx)); return [...s]; };
const POSTER_CLASS = /^(gv-live|gv-rc-tapchip|gv-pb-target-kicker|gv-pb-target-marks)/;
const PLAN = '## D (any)\n\n- Push-ups | 3 x 10\n- Goblet Squat | 1 x 8 @ 20kg\n- Plank | 1 x 45s\n';

(async () => {
  for (const skin of ['apex', 'lockin']) {
    await check(`${skin}: the reps screen is the poster arrangement`, async () => {
      const b = await guided(skin, PLAN);
      ok(q(b, '.gv-live'), 'the body is the poster body');
      eq(q(b, '.gv-live-chip').textContent, 'Move 1 of 3', 'the move chip names the exercise position');
      ok(q(b, '.gv-live-toprow').querySelector('button[aria-label="End session"]'), 'the close button is in the top row');
      eq(q(b, '.gv-live-name').textContent, 'Push-ups', 'the name is the real exercise');
      const rail = q(b, '.gv-live-rail');
      eq(rail.getAttribute('aria-label'), 'Set 1 of 3');
      eq(qa(b, '.gv-live-pip').map(p => ['is-done', 'is-cur', 'is-todo'].find(c => p.classList.contains(c))), ['is-cur', 'is-todo', 'is-todo'], 'one pip per set, the first is current');
      eq(q(b, '.gv-live-sub').textContent, 'Aim 10', 'the plan target, with what it is');
      const tick = q(b, '.gv-live-tick');
      eq(tick.textContent.trim(), 'Tick set', 'the primary slab copy');
      ok(tick.classList.contains('gv-btn-go'), 'it is the app\'s own slab button');
      eq(q(b, '.gv-rc-tapchip').textContent, 'Tap to count');
      eq(q(b, '.gv-rc-tapchip').getAttribute('aria-hidden'), 'true', 'the chip is decoration: the zone\'s own label says it');
      eq(q(b, '.gv-pb-target-kicker').textContent, 'PB target');
      eq(q(b, '.gv-pb-target-marks').children.map(c => c.textContent), ['0', '0% of PB', 'PB 12'], 'the scale under the bar is the real best');
      /* the rest row is where Tick leads, from the same flow the rest screen uses */
      eq(q(b, '.gv-live-lbl').textContent, 'Rest · starts on tick');
      eq(inside(b, '.gv-live-ring', 'b').textContent, '1:30', 'the rest the settings give it');
      ok(/^Up next: Push-ups/.test(q(b, '.gv-live-nx').textContent) && /Set 2 of 3/.test(q(b, '.gv-live-nx').textContent), 'up next: the next set of the same exercise');
    });

    await check(`${skin}: Tick set completes the set exactly as Done did, and the skips are the same buttons in the sheet`, async () => {
      const b = await guided(skin, PLAN);
      tapN(b, 4);
      const sheet = q(b, '.gv-live-sheet');
      const skips = sheet.querySelector('.gv-live-skips');
      eq(skips.querySelectorAll('button').map(x => x.getAttribute('aria-label')), ['Skip this set', 'Skip this exercise'], 'both skips live in the sheet, labelled as before');
      eq(skips.querySelector('.gv-session-skip-kicker').textContent, 'Skip', 'and the word that says what they do');
      ok(!inside(b, '.gv-session-top', '.gv-session-skip'), 'they are not also in the top row');
      H.click(H.byText(H.page(b.ctx), 'Tick set'));
      const draft = b.ctx.state.logDraft;
      eq(draft.entries[0].sets[0].reps, '4', 'the four counted reps were written');
      ok(draft.entries[0].sets[0].done, 'and the set is done');
      eq(b.ctx.state.session.phase, 'resting', 'which starts the rest, as it always did');
    });

    await check(`${skin}: the weight stepper writes what typing writes`, async () => {
      const b = await guided(skin, PLAN);
      H.click(H.byLabel(H.page(b.ctx), 'Skip this exercise'));
      const set = () => b.ctx.state.logDraft.entries[1].sets[0];
      ok(q(b, '.gv-live-weight'), 'a weighted entry gets the stepper');
      const input = inside(b, '.gv-live-weightval', 'input');
      eq(input.value, '20', 'it shows the plan\'s weight');
      H.click(H.byLabel(H.page(b.ctx), 'Weight plus 2.5 kilograms'));
      eq(set().weight_kg, '22.5', 'plus adds a 2.5 kg plate');
      eq(input.value, '22.5', 'and the field shows it');
      ok(set().touched, 'a stepped figure is the user\'s, like a typed one');
      for (let i = 0; i < 12; i++) H.click(H.byLabel(H.page(b.ctx), 'Weight minus 2.5 kilograms'));
      eq(set().weight_kg, '0', 'minus stops at zero');
      ok(!q(b, '.gv-session-weightrow'), 'the plain weight row is not also there');
    });

    await check(`${skin}: the hold screen carries the poster sheet, and the pause row survives`, async () => {
      const b = await guided(skin, '## D (any)\n\n- Plank | 1 x 45s\n');
      ok(q(b, '.gv-live-hold'), 'the zone is the hold zone');
      eq(q(b, '.gv-rc-tapchip').textContent, 'Tap to stop', 'the hold is running after the count-in');
      ok(!q(b, '.gv-live-tick'), 'a hold has no Tick slab: stopping IS completing');
      ok(inside(b, '.gv-live-sheet', '.gv-live-skips'), 'but it has the sheet and the skips');
      const pause = H.byLabel(H.page(b.ctx), 'Pause');
      ok(pause, 'the pause button is there');
      H.click(pause);
      eq(q(b, '.gv-rc-tapchip').textContent, 'Tap to resume');
      const done = q(b, '.gv-hold-done');
      eq(done.textContent.trim(), 'Tick set', 'the paused Done carries the poster copy');
      ok(!done.disabled, 'and is enabled while paused');
      eq(q(b, '.gv-hold-spacer').textContent.trim(), 'Tick set', 'its hidden twin has the same label so the pause button stays centred');
      H.click(done);
      ok(b.ctx.state.logDraft.entries[0].sets[0].done, 'it still completes the hold');
    });

    await check(`${skin}: the zone keeps its stage meter (the stage ramp is untouched)`, async () => {
      const b = await guided(skin, PLAN);
      const zone = q(b, '.gv-session-zone');
      eq(zone.getAttribute('data-fill'), 'idle');
      tapN(b, 6);
      ok(['warm', 'hot'].includes(zone.getAttribute('data-fill')), 'six of ten reps is staged');
      tapN(b, 4);
      eq(zone.getAttribute('data-fill'), 'done', 'ten of ten floods the accent');
      eq(q(b, '.gv-rc-target').textContent, 'Target 10 reps', 'the zone\'s own target line is still the text that is measured on every stage');
    });

    await check(`${skin}: with no rest set, the row says "Up next" and draws no ring`, async () => {
      const b = await guided(skin, PLAN, { settings: { skin, guideRestSeconds: 0 } });
      eq(q(b, '.gv-live-lbl').textContent, 'Up next');
      ok(!q(b, '.gv-live-ring'), 'no ring: nothing is about to be timed');
      ok(/^Up next: Push-ups/.test(q(b, '.gv-live-nx').textContent));
    });

    await check(`${skin}: the last set says so, and an open set still has a caption`, async () => {
      const b = await guided(skin, '## D (any)\n\n- Push-ups | 1 x submax\n');
      eq(q(b, '.gv-live-lbl').textContent, 'Last set');
      eq(q(b, '.gv-live-nx').textContent, "Then you're done");
      ok(!q(b, '.gv-live-ring'), 'no rest ring when no rest follows');
      eq(q(b, '.gv-rc-target').textContent, 'Reps', 'an open-ended set names what the numeral counts');
    });
  }

  for (const skin of ['floor', 'editorial']) {
    await check(`${skin}: no poster node anywhere, and the plain labels and bar are as they were`, async () => {
      for (const body of [PLAN, '## D (any)\n\n- Goblet Squat | 1 x 8 @ 20kg\n', '## D (any)\n\n- Plank | 1 x 45s\n']) {
        H.killProcess();
        const b = await guided(skin, body);
        eq(everyClass(b).filter(c => POSTER_CLASS.test(c)), [], `${skin}: ${body.split('\n')[2]}: not one poster class in the DOM`);
        ok(inside(b, '.gv-session-top', '.gv-session-skip'), 'the skip buttons are still in the top bar');
        ok(!H.byText(H.page(b.ctx), 'Tick set'), 'nothing says "Tick set"');
        ok(q(b, '.gv-session-rcbar'), 'the old control bar is the one on screen');
      }
      const b = await guided(skin, PLAN);
      const done = H.byText(H.page(b.ctx), 'Done');
      eq(done.className.split(/\s+/).filter(c => c !== 'clickable-icon').sort(), ['gv-btn', 'gv-btn-small'], 'Done is the small ghost-less button it always was');
      eq(q(b, '.gv-pb-target').children.map(c => c.className).filter(Boolean).sort(), ['gv-pb-target-bar', 'gv-pb-target-label', 'gv-pb-target-now', 'gv-pb-target-togo', 'gv-sr-only'], 'the PB target has exactly its old five parts');
    });
  }

  let failed = 0;
  for (const [name, e] of results) {
    if (e) { failed++; console.error(`FAIL ${name}\n     ${e && e.message}`); }
  }
  if (failed) { console.error(`${failed} of ${results.length} live chrome cases failed`); process.exit(1); }
  console.log(`live chrome OK (${n} checks across ${results.length} real-screen cases: poster in Apex and Lock In, absent in Floor and Editorial)`);
})();
