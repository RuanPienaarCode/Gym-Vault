'use strict';
/* WAVE 2, item 2 (audit L1-13), the READ side: the guided run screen prefills
   the minutes box from the last run of that exercise. That conversion also
   rounded to 0.1 min, so a remembered 2745 s run came back as 45.8 min and was
   re-saved as 2748 s. The box must hold 45.75 and save 2745 s. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

(async () => {
  H.killProcess();
  const b = await H.boot({
    planBody: '## D (any)\n\n- Easy Run | 1 x 30 min\n',
    exercises: [H.ex('Easy Run', { unit: 'km' })],
    workouts: [H.workout('2026-01-01', [{ exercise: 'Easy Run', set: 1, reps: '', weight_kg: '', seconds: '2745', note: '', distance_km: '5' }])],
    settings: { soundMode: 'silent', guideRestSeconds: 0 },
  });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  const boxes = H.page(b.ctx).querySelectorAll('input.gv-session-distance');
  assert.strictEqual(boxes.length, 2, 'fixture: the run screen with two boxes');
  assert.strictEqual(boxes[1].value, '45.75', `the minutes prefill lost precision: "${boxes[1].value}"`);
  console.log('w2 run prefill OK');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
