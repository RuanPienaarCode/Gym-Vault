'use strict';
/* Found by the runtime pass of the 25 Nov 2026 fix wave (real code in a
   headless browser), not by any unit test:

   R1  A timed circuit hides the tab bar, so its only way out is "Back to the
       log". Leaving the log then overwrote the timed mark, and Resume / the
       "Session in progress" pill opened the list - the very thing finding 24
       set out to end. The timed mark must survive the trip through the log.
   R2  A session logged for an earlier day saved `duration_min: 1`: the minute
       the log page had been open today. It keeps only time actually entered.
   R3  Three touch targets still measured under 44px on a phone. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
/* Loads the fake obsidian module the live-session tests share, so controller.js
   and page-log.js can be required in plain node. */
require('./live-session-harness.js');

/* ---------- R1 ---------- */
{
  const { nextLiveMark, resumeTarget } = require('../src/controller');
  assert.strictEqual(typeof nextLiveMark, 'function', 'controller must export nextLiveMark');
  const timed = { timed: { intervals: [] }, entries: [] };
  let mark = nextLiveMark(null, 'session', timed);
  assert.strictEqual(mark.view, 'timed');
  mark = nextLiveMark(mark, 'log', timed); // "Back to the log", then a tab
  assert.strictEqual(mark.view, 'timed', 'the log reached from a timed circuit must not erase the timed mark');
  assert.strictEqual(resumeTarget(timed, mark), 'session', 'Resume returns to the timed screen');

  const guided = { entries: [] };
  mark = nextLiveMark(null, 'session', guided);
  mark = nextLiveMark(mark, 'log', guided);
  assert.strictEqual(mark.view, 'log', 'set by set has its tab bar: the last screen left is the one that counts');
  assert.strictEqual(resumeTarget(guided, mark), 'log');

  const other = { timed: { intervals: [] }, entries: [] };
  mark = nextLiveMark({ draft: timed, view: 'timed' }, 'log', other);
  assert.strictEqual(mark.draft, other, 'a mark never carries over to a different draft');
  assert.strictEqual(mark.view, 'log');
  assert.deepStrictEqual(nextLiveMark({ draft: timed, view: 'timed' }, 'plans', timed), { draft: timed, view: 'timed' }, 'a page that is not live leaves the mark alone');
}

/* ---------- R2 ---------- */
{
  const { savedMinutes, sessionMinutes } = require('../src/page-log');
  assert.strictEqual(typeof savedMinutes, 'function', 'page-log must export savedMinutes');
  const now = Date.parse('2026-11-25T12:00:00');
  const reps = { date: '2026-11-24', startedAt: now - 60000, entries: [{ exercise: 'Push-ups', target: '3 x 10', sets: [{ reps: '10', done: true }] }] };
  assert.strictEqual(savedMinutes(reps, '2026-11-25', now), undefined, 'a back-dated session with no entered time saves no length, not the minute the page was open');
  const hold = { date: '2026-11-24', startedAt: now - 60000, entries: [{ exercise: 'Plank', target: '2 x 90s', duration: true, sets: [{ seconds: '90', done: true }, { seconds: '90', done: true }] }] };
  assert.strictEqual(savedMinutes(hold, '2026-11-25', now), 3, 'entered time is kept: two 90 s holds are 3 minutes');
  const today = { ...reps, date: '2026-11-25' };
  assert.strictEqual(savedMinutes(today, '2026-11-25', now), sessionMinutes(today, now), "today's session keeps the one minutes rule");
}

/* ---------- R3 ---------- */
{
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.gv-app\.gv-skin-calm \.gv-page \.gv-chip::before\s*\{[^}]*top:\s*-9px;[^}]*bottom:\s*-9px/, "Calm's 26px filter chip needs a 44px touch box");
  assert.match(css, /\.gv-app\.gv-narrow \.gv-mm-seg \.gv-segmented-btn\s*\{\s*min-height:\s*44px/, 'Muscle Map Basic/Detailed is 44px tall on a phone');
  assert.match(css, /\.gv-app\.gv-narrow \.gv-day-item-link\s*\{\s*min-height:\s*44px/, "a plan page's tappable exercise row is 44px tall on a phone");
}
console.log('runtime-pass fixes OK (timed resume, back-dated length, touch boxes)');
