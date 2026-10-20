'use strict';
/* WAVE 2, item 6 (audit L3-12): A TYPED COUNT DURING THE COUNT-IN WINS.

   The count-in borrows the big numeral and rewrites it every tick (5, 4, 3...).
   Opening "Type the count" in that window put the number box INTO that node, and
   the very next tick's textContent wiped it - the box vanished under the user's
   thumb, and what they had typed was lost. Typing now ends the count-in first
   (the same hand-over a tap or Tick does), so there is nothing left to overwrite
   the box, and the typed number is the count.

   Covers the guided screen end to end and the shared pair (attachCountIn +
   typeCountButton) that the rep-counter modal also uses. */
const assert = require('node:assert');
const H = require('./live-session-harness.js');

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.speech.length = 0;
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const PLAN = '## D (any)\n\n- Push-ups | 2 x 10\n';
async function session() {
  const b = await H.boot({ planBody: PLAN, settings: { guideRestSeconds: 0, soundMode: 'silent' }, exercises: [H.ex('Push-ups')] });
  const plan = b.ctx.activePlan(); b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  await H.flush();
  return b;
}
function typeButton(b) {
  if (!H.page(b.ctx).querySelector('.gv-cs')) H.click(H.byLabel(H.page(b.ctx), 'Counter settings'));
  return H.page(b.ctx).querySelectorAll('button').find(x => /Type the count/.test(x.getAttribute('aria-label') || ''));
}
const box = b => H.page(b.ctx).querySelector('input.gv-rc-typein');
const countEl = b => H.page(b.ctx).querySelector('.gv-rc-count, .gv-session-count');

(async () => {
  await check('W2-6a. the number box survives the next count-in ticks and keeps what was typed', async () => {
    const b = await session();
    H.advance(1200);                                    // mid count-in
    assert.ok(!b.ctx.state.session.countedIn, 'fixture: still counting in');
    H.click(typeButton(b));
    assert.ok(box(b), 'fixture: the number box opened');
    box(b).value = '12';
    H.advance(2500);                                    // several more ticks of the old count-in
    assert.ok(box(b), 'the count-in\'s next tick removed the number box');
    assert.strictEqual(box(b).value, '12');
  });

  await check('W2-6b. committing it makes 12 the count, and the count-in is over', async () => {
    const b = await session();
    H.advance(1200);
    H.click(typeButton(b));
    box(b).value = '12';
    H.fire(box(b), 'keydown', { key: 'Enter' });
    H.advance(6000);                                    // the rest of the old count-in's time
    assert.strictEqual(b.ctx.state.session.counter.count, 12, `counter holds ${b.ctx.state.session.counter.count}`);
    assert.strictEqual(countEl(b).textContent, '12', `the numeral reads "${countEl(b).textContent}"`);
    assert.ok(b.ctx.state.session.countedIn, 'the count-in is over');
  });

  await check('W2-6c. control: typing AFTER the count-in is unchanged', async () => {
    const b = await session();
    H.advance(6000);
    H.click(typeButton(b));
    box(b).value = '7';
    H.fire(box(b), 'keydown', { key: 'Enter' });
    assert.strictEqual(b.ctx.state.session.counter.count, 7);
    assert.strictEqual(countEl(b).textContent, '7');
  });

  await check('W2-6d. the shared pair (the modal\'s path): typing ends the count-in before the box opens', async () => {
    const { attachCountIn, typeCountButton } = require('../src/rep-counter-shared');
    const { el } = require('../src/dom');
    const zone = el('div', {}), countEl = el('div', { class: 'gv-rc-count' }, '0');
    zone.append(countEl);
    let handedOver = 0, n = 0;
    const ci = attachCountIn(zone, countEl, { muted: () => true, settings: { soundMode: 'silent' }, onDone: () => { handedOver++; countEl.textContent = '0'; } });
    const btn = typeCountButton(countEl, { get: () => n, set: v => { n = v; } });
    zone.append(btn);
    H.advance(1200);
    H.click(btn);
    assert.strictEqual(ci.armed(), true, 'the count-in did not end when typing began');
    const input = countEl.querySelector('input');
    assert.ok(input, 'number box present');
    input.value = '9';
    H.advance(6000);
    assert.ok(countEl.querySelector('input'), 'a later tick removed the number box');
    H.fire(input, 'keydown', { key: 'Enter' });
    assert.strictEqual(n, 9);
    assert.strictEqual(handedOver, 1, 'hand-over fired exactly once');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL  ${name}\n      ${String(err && err.message || err).split('\n').join('\n      ')}`); }
    else console.log(`ok    ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} failed`); process.exit(1); }
  console.log(`w2 typed count countin OK (${results.length} cases)`);
  process.exit(0);
})();
