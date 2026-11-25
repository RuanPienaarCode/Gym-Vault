'use strict';
/* AUDIT 25 NOV 2026, LANE SESSION: the guided-setup screen.

   #38b A one-exercise day ("Pull-ups | 5 sets through the day") opened in the
        remembered timed mode and became 19 back-to-back intervals. It now opens
        set by set for this session, says why in one line, and timed is still one
        tap away. The remembered guideMode setting is NOT overwritten by it.
   #16  "4 exercises, 3 each" under the dial and "4 EXERCISES · 12 SETS · YOU SET
        THE PACE" under it said the same thing twice. The summary line stays.
   #45  The setup screen matched an exercise note by sameName only, while
        data.findMissingExercises also accepts the safeName form ("90/90 Hip
        Switch" is saved as the note "90-90 Hip Switch"). One rule now.

   Drives the REAL controller and setup screen (tests/live-session-harness.js). */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess();
  try { await fn(); results.push([name, null]); }
  catch (e) { results.push([name, e]); }
};

async function setup(planBody, exercises, settings) {
  const b = await H.boot({ planBody, exercises, settings: Object.assign({ soundMode: 'silent' }, settings) });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  return b;
}
const root = b => H.page(b.ctx);
const modeCard = (b, name) => root(b).querySelectorAll('[role=radio]').find(c => c.getAttribute('aria-label') === name);
const checked = (b, name) => modeCard(b, name).getAttribute('aria-checked') === 'true';
const whyLine = b => root(b).querySelector('.gv-setup-why');
const start = b => root(b).querySelector('.gv-btn-go');

(async () => {
  await check('#38b. a one-exercise day opens set by set, with one line saying why', async () => {
    const b = await setup('## D (any)\n\n- Pull-ups | 5 x 3\n', [H.ex('Pull-ups')], { guideMode: 'timed' });
    assert.ok(checked(b, 'Reps'), 'Reps is selected');
    assert.ok(!checked(b, 'Timed circuit'), 'timed is not');
    assert.ok(whyLine(b) && /one exercise/i.test(whyLine(b).textContent), `the why line: ${whyLine(b) && whyLine(b).textContent}`);
    assert.strictEqual(start(b).textContent, 'Start session');
  });

  await check('#38b. Start on it is set by set and leaves the remembered guideMode alone', async () => {
    const b = await setup('## D (any)\n\n- Pull-ups | 5 x 3\n', [H.ex('Pull-ups')], { guideMode: 'timed' });
    H.click(start(b));
    assert.ok(b.ctx.state.logDraft && !b.ctx.state.logDraft.timed, 'a set-by-set draft');
    assert.strictEqual(b.ctx.state.logDraft.entries[0].sets.length, 5);
    assert.strictEqual(b.plugin.settings.guideMode, 'timed', 'the remembered mode is still timed');
  });

  await check('#38b. timed is still one tap away on that day', async () => {
    const b = await setup('## D (any)\n\n- Pull-ups | 5 x 3\n', [H.ex('Pull-ups')], { guideMode: 'timed' });
    H.click(modeCard(b, 'Timed circuit'));
    assert.ok(checked(b, 'Timed circuit'));
    assert.ok(!whyLine(b), 'the why line goes once timed is picked');
    H.click(start(b));
    assert.ok(b.ctx.state.logDraft.timed, 'a timed draft');
  });

  await check('#38b. control: a two-exercise day and a run-only day keep the remembered timed mode', async () => {
    let b = await setup('## D (any)\n\n- Pull-ups | 3 x 3\n- Push-ups | 3 x 10\n', [H.ex('Pull-ups'), H.ex('Push-ups')], { guideMode: 'timed' });
    assert.ok(checked(b, 'Timed circuit'));
    assert.ok(!whyLine(b));
    H.killProcess();
    b = await setup('## D (any)\n\n- Long Trail Run | 1 x per the ladder\n', [H.ex('Long Trail Run', { unit: 'km' })], { guideMode: 'timed' });
    assert.ok(checked(b, 'Timed circuit'), 'a run is not set-by-set work');
  });

  await check('#38b. control: a remembered Reps mode says nothing about it', async () => {
    const b = await setup('## D (any)\n\n- Pull-ups | 5 x 3\n', [H.ex('Pull-ups')], { guideMode: 'reps' });
    assert.ok(checked(b, 'Reps'));
    assert.ok(!whyLine(b), 'nothing changed, so nothing to explain');
  });

  await check('#16. the dial does not repeat the summary line\'s count', async () => {
    const b = await setup('## D (any)\n\n- Push-ups | 3 x 10\n- Squats | 3 x 12\n', [H.ex('Push-ups'), H.ex('Squats')], { guideMode: 'reps' });
    const note = root(b).querySelector('.gv-dial-note');
    const summary = root(b).querySelector('.gv-setup-preview');
    assert.match(summary.textContent, /2 exercises · 6 sets/, `fixture: ${summary.textContent}`);
    assert.strictEqual(note.textContent, '', `the dial note says "${note.textContent}"`);
  });

  await check('#16. control: a mixed plan still explains what the dial will do', async () => {
    const b = await setup('## D (any)\n\n- Push-ups | 3 x 10\n- Plank | 1 x 30s\n', [H.ex('Push-ups'), H.ex('Plank', { unit: 'seconds' })], { guideMode: 'reps' });
    assert.match(root(b).querySelector('.gv-dial-note').textContent, /varies/);
  });

  await check('#45. a "90/90" plan line finds its "90-90" note (unit seconds -> a 40 s interval)', async () => {
    const b = await setup('## D (any)\n\n- 90/90 Hip Switch | 3 x 40\n- Push-ups | 3 x 10\n',
      [H.ex('90-90 Hip Switch', { unit: 'seconds', type: 'mobility' }), H.ex('Push-ups')],
      { guideMode: 'timed', guideMinutes: 10, guideWarmup: false, guideCooldown: false });
    H.click(start(b));
    const iv = b.ctx.state.logDraft.timed.intervals.find(i => i.kind === 'work' && i.exercise === '90/90 Hip Switch');
    assert.ok(iv, 'fixture: the line is scheduled');
    assert.strictEqual(iv.unit, 'seconds', 'the note\'s unit was found');
    assert.strictEqual(iv.seconds, 40);
  });

  const failed = results.filter(([, e]) => e);
  for (const [name, e] of results) console.log(`${e ? 'FAIL' : 'ok  '} ${name}${e ? `\n  ${e.message}` : ''}`);
  if (failed.length) process.exit(1);
  console.log(`audit-1125 session setup OK (${results.length} checks)`);
  process.exit(0);
})();
