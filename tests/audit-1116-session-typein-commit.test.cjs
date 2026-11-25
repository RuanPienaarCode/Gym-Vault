'use strict';
/* AUDIT 16 NOV 2026, findings #24 and #38.

   #24  A typed rep count may never commit before Tick set. The number box commits on
        Enter or blur; on an iPhone its numeric pad has no Enter, iOS keeps an input
        focused when a BUTTON is tapped, and the tap zone preventDefault()s touchstart
        so it never blurs either. The handlers below are driven with the box STILL
        OPEN and focused (no blur, no Enter): they must commit it through
        rep-counter-shared.commitOpenTypeIn first, and a tap on the zone must commit
        the number and NOT also add a rep.
   #38  The rep counter pop-up: Done before the counter was armed (during "How many?"
        or the count-in) overwrote the plan's prefill with 0 and marked the set
        logged. It is Cancel now. A deliberate end of an armed set still writes.

   Drives the real guided screen and the real modal through the fake DOM harness. */
const assert = require('node:assert');
const path = require('node:path');
const H = require('./live-session-harness.js');
const shared = require('../src/rep-counter-shared');
const { RepCounterModal } = require(path.join(H.SRC, 'rep-counter-modal'));

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.speech.length = 0; H.notices.length = 0; H.modals.length = 0;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};

/* ---------- guided screen ---------- */
async function guided() {
  const b = await H.boot({ planBody: '## D (any)\n\n- Push-ups | 2 x 10\n', exercises: [H.ex('Push-ups')], settings: { soundMode: 'silent', guideRestSeconds: 0 } });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  H.advance(6000);
  return b;
}
function openBox(b) {
  if (!H.page(b.ctx).querySelector('.gv-cs')) H.click(H.byLabel(H.page(b.ctx), 'Counter settings'));
  const t = H.page(b.ctx).querySelectorAll('button').find(x => /Type the count/.test(x.getAttribute('aria-label') || ''));
  H.click(t);
  const box = H.page(b.ctx).querySelector('input.gv-rc-typein');
  assert.ok(box, 'fixture: the number box is open');
  return box;
}
const sets = b => b.ctx.state.logDraft.entries[0].sets;

/* ---------- modal ---------- */
function modal(opts) {
  const done = [];
  const m = new RepCounterModal({}, Object.assign({ exerciseName: 'Push-ups', settings: { soundMode: 'silent' }, onDone: n => done.push(n) }, opts));
  m.open();
  /* The harness' modal content is not on the page by itself; the count-in hands over only to a connected modal. */
  H.docRoot().appendChild(m.contentEl);
  m.done = done;
  return m;
}
const mbtn = (m, f) => m.contentEl.querySelectorAll('button').find(f);
const justCount = m => H.click(mbtn(m, x => /Just count/.test(x.textContent)));
const doneBtn = m => mbtn(m, x => x.textContent.trim() === 'Done');

(async () => {
  await check('T1. the shared rule: commitOpenTypeIn commits an open box with no blur and no Enter, and says so', async () => {
    const { el } = require('../src/dom');
    const countEl = el('div', { class: 'gv-rc-count' }, '0');
    H.docRoot().appendChild(countEl);
    let n = 0, sets = 0;
    const btn = typeCountButton(countEl, () => n, v => { n = v; sets++; });
    H.docRoot().appendChild(btn);
    assert.strictEqual(shared.commitOpenTypeIn(), false, 'nothing open: nothing committed');
    H.click(btn);
    countEl.querySelector('input').value = '12';
    assert.strictEqual(shared.commitOpenTypeIn(), true, 'an open box is committed');
    assert.strictEqual(n, 12);
    assert.strictEqual(countEl.textContent, '12', 'and the numeral shows it');
    assert.ok(!countEl.querySelector('input'), 'and the box is gone');
    assert.strictEqual(shared.commitOpenTypeIn(), false, 'a second call has nothing left to commit');
    assert.strictEqual(sets, 1, 'the number is set once');
    function typeCountButton(c, get, set) { return shared.typeCountButton(c, { get, set }); }
  });

  await check('T2. guided: Tick set with the box still open saves the typed 12 (not the 0 from before typing)', async () => {
    const b = await guided();
    const box = openBox(b);
    box.value = '12';                                   // typed; no Enter, no blur
    H.click(H.byText(H.page(b.ctx), 'Done'));
    assert.strictEqual(sets(b)[0].done, true);
    assert.strictEqual(sets(b)[0].reps, '12', `saved reps ${JSON.stringify(sets(b)[0].reps)}`);
  });

  await check('T3. guided: a tap on the big zone with the box open commits the number and does NOT also add a rep', async () => {
    const b = await guided();
    const box = openBox(b);
    box.value = '12';
    H.tapZone(H.page(b.ctx).querySelector('.gv-session-zone'));
    assert.strictEqual(b.ctx.state.session.counter.count, 12, `the counter holds ${b.ctx.state.session.counter.count}`);
    assert.strictEqual(H.countText(b.ctx), '12');
    H.advance(800);
    H.tapZone(H.page(b.ctx).querySelector('.gv-session-zone'));
    assert.strictEqual(b.ctx.state.session.counter.count, 13, 'the next tap counts as usual');
  });

  await check('T4. guided: X -> Save session with the box open saves the typed 12', async () => {
    const b = await guided();
    openBox(b).value = '12';
    H.click(H.byLabel(H.page(b.ctx), 'End session'));
    await H.modals.slice().reverse().find(m => m.kind === 'end').opts.onSave();
    assert.deepStrictEqual(b.saved[0].rows.map(r => r.reps), ['12']);
  });

  await check('T5. modal: Done with the box still open returns the typed 12', async () => {
    const m = modal();
    justCount(m); H.advance(6000);
    H.click(mbtn(m, x => /Type the count/.test(x.getAttribute('aria-label') || '')));
    m.contentEl.querySelector('input.gv-rc-typein').value = '12';
    H.click(doneBtn(m));
    assert.deepStrictEqual(m.done, [12]);
  });

  await check('T6. modal: a tap on the zone with the box open commits the typed number and does not add a rep', async () => {
    const m = modal();
    justCount(m); H.advance(6000);
    H.click(mbtn(m, x => /Type the count/.test(x.getAttribute('aria-label') || '')));
    m.contentEl.querySelector('input.gv-rc-typein').value = '12';
    H.tapZone(m.zone);
    assert.strictEqual(m.state.count, 12, `the modal counter holds ${m.state.count}`);
    H.click(doneBtn(m));
    assert.deepStrictEqual(m.done, [12]);
  });

  await check('T7. #38: Done on the "How many?" step is Cancel - onDone is not called', async () => {
    const m = modal();
    H.click(doneBtn(m));
    assert.deepStrictEqual(m.done, [], `onDone fired with ${JSON.stringify(m.done)}`);
  });

  await check('T8. #38: Done during the count-in is Cancel', async () => {
    const m = modal();
    justCount(m); H.advance(1500);
    H.click(doneBtn(m));
    assert.deepStrictEqual(m.done, [], `onDone fired with ${JSON.stringify(m.done)}`);
  });

  await check('T9. #38 control: Done once armed, after real reps, still returns the count; a deliberate 0 on an armed counter still writes', async () => {
    const m = modal();
    justCount(m); H.advance(6000);
    for (let i = 0; i < 3; i++) { H.tapZone(m.zone); H.advance(800); }
    H.click(doneBtn(m));
    assert.deepStrictEqual(m.done, [3]);
    const z = modal();
    justCount(z); H.advance(6000);
    H.click(doneBtn(z));
    assert.deepStrictEqual(z.done, [0], 'an armed counter ended at 0 is a deliberate "I failed the set"');
  });

  await check('T10. #38 through the log page: Done before any rep leaves the plan prefill alone', async () => {
    const b = await H.boot({ planBody: '## D (any)\n\n- Push-ups | 2 x 10\n', exercises: [H.ex('Push-ups')], settings: { soundMode: 'silent' } });
    const plan = b.ctx.activePlan(); b.ctx.startLog(plan, plan.model.days[0]);
    H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Tap-count reps/.test(x.getAttribute('aria-label') || '')));
    const m = H.modals.slice().reverse().find(x => x.exerciseName === 'Push-ups');
    assert.ok(m, 'fixture: the counter modal opened');
    H.click(doneBtn(m));
    const s = b.ctx.state.logDraft.entries[0].sets[0];
    assert.strictEqual(String(s.reps), '10', `prefill overwritten with ${JSON.stringify(s.reps)}`);
    assert.strictEqual(s.touched, false, 'and the set was marked logged');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`audit-1116 session typein commit OK (${results.length} cases)`);
  process.exit(0);
})();
