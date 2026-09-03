'use strict';
/* DONE MOVES YOU ON (issue #5).

   THE BUG THIS REPRODUCES. Moving through a reps session cost two taps per
   set: Done, then Next. The rest screen counted UP with no target, so it
   never ended — there was no moment at which the rest was over, only a
   button saying you were finished with it. Reported as "each rest wanted
   extra Next taps before the next set started".

   The recommendation was explicit about BOTH halves: "rest (if any) then the
   next set, no extra Next" AND "do not auto-skip rest". So the rest is not
   removed — it is given a length, counts DOWN, and moves on by itself. Next
   stays as "go now", because wanting to cut a rest short is real.

   And the two skip controls were bare chevrons next to the X, with their
   meaning only in an aria-label. The reporter reached for X instead — which
   reads as abandoning the whole session — and described skipping "in a
   panic". */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const { DEFAULT_SETTINGS, GUIDE_REST } = require('../src/constants');

/* ---------- 1. a rest has a length, and zero is a real answer ---------- */
{
  assert.strictEqual(typeof DEFAULT_SETTINGS.guideRestSeconds, 'number',
    'the rest needs a duration, or there is no moment at which it is over');
  assert.ok(DEFAULT_SETTINGS.guideRestSeconds > 0,
    'the default must actually rest — the fix is that the rest ENDS, not that it goes away');

  assert.strictEqual(GUIDE_REST.min, 0,
    '"rest (if any)" — zero is a choice, and it is the one that makes Done a single tap with no screen between');
  assert.ok(GUIDE_REST.max >= 180, 'and a long rest is a legitimate way to train');
  assert.strictEqual(DEFAULT_SETTINGS.guideRestSeconds % GUIDE_REST.step, 0,
    'the default must be reachable from the picker, or it cannot be restored once changed');
  assert.ok(DEFAULT_SETTINGS.guideRestSeconds <= GUIDE_REST.max);
}

/* ---------- 2. the rest counts DOWN and ends by itself ---------- */
{
  const src = strip(read('page-session.js'));

  assert.match(src, /const restTotal = restSecondsFor\(ctx\);/,
    'the rest screen must know how long it is');
  assert.match(src, /Math\.max\(0, restTotal - Math\.round\(\(Date\.now\(\) - sess\.restStartedAt\) \/ 1000\)\)/,
    'counting DOWN from a start stamp — accumulating ticks drifts, and iOS throttles background timers hard enough to show it');
  assert.match(src, /if \(secs <= 0 && sess\.phase === 'resting'\) goNext\(\);/,
    'at zero the rest must move on by ITSELF — that is the whole of "no extra Next"');

  /* Next survives. The ask was to stop REQUIRING the tap. */
  assert.match(src, /nextBtn\.addEventListener\('click', goNext\)/,
    'Next stays as "go now" — cutting a rest short is a real thing to want');

  /* ONE way out of the rest phase. Two copies of that state change would be
     two chances to leave pendingPos behind and resume the wrong set — which
     is why the clock and the button call the same function rather than each
     doing the work. */
  const rest = src.slice(src.indexOf('function renderRest'), src.indexOf('function timedElapsed'));
  assert.strictEqual((rest.match(/sess\.pos = sess\.pendingPos;/g) || []).length, 1,
    'the clock and Next must share one exit, not each carry their own copy of it');
  assert.ok(!/nextBtn\.addEventListener\('click', \(\) => \{/.test(rest),
    'Next must call the shared exit, not inline a second copy of it');
  assert.match(rest, /if \(sess\.phase !== 'resting'\) return;/,
    'and it must be guarded, since a late timer tick can arrive after a tap has already left');
}

/* ---------- 3. no rest configured means no screen at all ---------- */
{
  const src = strip(read('page-session.js'));
  assert.match(src, /\} else if \(restSecondsFor\(ctx\) <= 0\) \{/,
    '"rest (if any)": at zero, Done goes straight to the next set');
  assert.match(src, /for \(const line of callouts\) ctx\.notice\(line\);/,
    'a record or a goal hit still has to reach the user — with no rest screen to land on, it is announced rather than dropped');

  /* The clamp: a hand-edited data.json must not produce a rest that never
     ends, which would be the original bug with extra steps. */
  const helper = src.slice(src.indexOf('function restSecondsFor'), src.indexOf('function completeSet'));
  assert.match(helper, /Math\.max\(GUIDE_REST\.min, Math\.min\(GUIDE_REST\.max/,
    'the stored value must be clamped to the picker\'s own range');
  assert.match(helper, /if \(!Number\.isFinite\(n\)\) return DEFAULT_SETTINGS\.guideRestSeconds;/,
    'and a missing or junk value must fall back, not produce NaN — NaN <= 0 is false, so the rest would never end');
}

/* ---------- 4. the setting is reachable ---------- */
{
  const src = strip(read('settings-tab.js'));
  assert.match(src, /\.setName\('Rest between sets'\)/,
    'a duration nobody can change is a constant with extra steps');
  assert.match(src, /this\.plugin\.settings\.guideRestSeconds = Number\(v\);/,
    'and it must actually store a number — the dropdown hands back a string');
  assert.match(src, /d\.addOption\('0', 'No rest'\)/,
    'zero must be offered, or "rest (if any)" is unreachable');

  /* A dropdown, so it commits immediately: the blur rule (#21) exists for
     half-typed values, and there is no half of "60 seconds". */
  assert.ok(!/commitOnBlur\(this, t\.setValue\(this\.plugin\.settings\.guideRestSeconds/.test(src),
    'a short list of choices must not wait for focus to leave');
}

/* ---------- 5. skipping says what it does ---------- */
{
  const src = strip(read('page-session.js'));

  for (const [word, label] of [['Set', 'Skip this set'], ['Exercise', 'Skip this exercise']]) {
    assert.ok(src.includes(`'aria-label': '${label}' },\n    ico(`) || src.includes(`'aria-label': '${label}' }`),
      `${label} must still exist`);
    assert.ok(src.includes(`el('span', {}, '${word}')`),
      `"${label}" must carry a VISIBLE word — an unlabelled chevron beside the X sent the reporter to X instead`);
  }
  assert.match(src, /el\('span', \{ class: 'gv-session-skip-kicker' \}, 'Skip'\)/,
    'the verb belongs on the group, so each button only needs its noun and the pair still fits a 390px row');

  /* They must no longer be bare icon buttons. */
  assert.ok(!/'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': 'Skip this/.test(src),
    'the icon-only form is what made skipping invisible');

  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.gv-session-skip-kicker\s*\{/, 'the kicker needs a rule or it renders at body size');
  assert.match(css, /\.gv-app \.gv-session-skip\s*\{[^}]*font-size/,
    'and the buttons need to be small enough to sit beside the exercise counter');
}

/* ---------- 6. finishing early is the OTHER half, and it shipped ---------- */
{
  /* The third ask — "bank what I have and end the session" — is the rest
     floor's Finish, added for #1. Pinned here so the two do not drift apart:
     the rest screen is where both "I'm done with this set" and "I'm done
     full stop" are answered. */
  const src = strip(read('page-session.js'));
  assert.match(src, /gv-session-finish/,
    'the rest screen must still offer Finish — skipping the rest of a session and banking it is the same moment');
  assert.match(src, /finishBtn\.addEventListener\('click', \(\) => finishSession\(ctx, draft\)\)/,
    'and it must bank, not merely navigate');
}

console.log('rest flow OK (Done rests then moves on by itself; skipping says so; Next and Finish both stay)');
