'use strict';
/* Three invariants of the guided-setup screen that no rendering test can
   reach and that a reasonable-looking refactor would quietly undo. All three
   were real findings from the iOS/WebKit review of the timed-session change;
   each one fails SILENTLY on a phone — no error, no console line — which is
   exactly why they are pinned here in source rather than left to be noticed.

   The suite renders no pages, so these check the source. That is weaker than
   driving the real app, and stronger than nothing at all — which is what
   these three had. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* 1. THE SPEECH GESTURE CHAIN.

   iOS only allows speechSynthesis after a page has spoken from inside a real
   user-gesture call stack. Timed mode is the first place this app speaks on a
   TIMER (the interval announcement and the "3, 2, 1" count-in), so the Start
   tap is the only gesture that can ever unlock it. Awaiting anything —
   saveSettings() is real disk I/O — before ctx.enterGuided() resolves on a
   later task and breaks that chain, and the whole session then runs silently
   on a phone with nothing to explain it. */
{
  const src = stripComments(read('page-session-setup.js'));
  const m = src.match(/function beginSession\s*\(([\s\S]*?)\n\}/);
  assert.ok(m, 'beginSession must exist — the Start button has no other path into a session');

  assert.ok(!/async\s+function beginSession/.test(src),
    'beginSession must NOT be async: iOS needs the session entered inside the Start tap\'s own call '
    + 'stack, or the spoken countdown is silently never permitted');

  const body = m[0];
  assert.ok(!/\bawait\b/.test(body),
    'beginSession must not await anything — see the speech-gesture note in page-session-setup.js. '
    + 'Settings are saved fire-and-forget AFTER ctx.enterGuided() for this reason');

  /* And the ordering it depends on: entering guided mode must come before the
     settings save, not after it. */
  const enterAt = body.indexOf('ctx.enterGuided()');
  const rememberAt = body.indexOf('rememberSetup(');
  assert.ok(enterAt > 0, 'beginSession must enter guided mode');
  assert.ok(rememberAt > enterAt,
    'the settings save must come AFTER ctx.enterGuided(), so it can never delay entering the session');
}

/* 2. THE ONE NEW RULE THAT MATCHES A NATIVE ELEMENT.

   app.css ships `input[type='range'] { width: 100px; … }` at specificity
   (0,1,1). A bare `.gv-dial-range` is (0,1,0) and LOSES — unscoped, the
   minutes dial rendered as Obsidian's own 100px hairline instead of the
   full-width control the screen is laid out around. Every plugin-invented
   `gv-` class is safe unscoped because the host cannot define a matching
   rule; this one is not, because the host styles the element itself. */
{
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(m => m[1].trim());
  const dialRules = rules.filter(sel => sel.includes('gv-dial-range'));
  assert.ok(dialRules.length, '.gv-dial-range must be styled at all');

  const unscoped = dialRules.filter(sel =>
    sel.split(',').map(s => s.trim()).some(s => s.length && !s.includes('.gv-app')));
  assert.deepStrictEqual(unscoped, [],
    'every .gv-dial-range rule must carry a .gv-app ancestor or app.css\'s '
    + "input[type='range'] (0,1,1) wins: " + unscoped.join(' | '));

  /* The touch target: a 3px-tall native track is not something a thumb finds
     mid-workout, so the input carries a real height and the runnable-track
     pseudo-element carries the look. */
  assert.ok(/\.gv-app \.gv-dial-range::-webkit-slider-thumb/.test(css),
    'the thumb must be painted explicitly — app.css sets -webkit-appearance:none, '
    + 'so accent-color is inert and the host thumb wins otherwise');
}

/* 3. LIGHT AND DARK NEED DIFFERENT DIMMING.

   The disabled warm-up/cool-down switch is dimmed to read as inert. In light
   mode its border is near-black ink on white and survives that. In dark mode
   the border is already --gv-line-2 (#39452a) on --gv-surface (#171c10) — a
   low-contrast pairing to begin with — and the same dimming blends it away
   entirely, leaving a row whose explanation is fully legible beside a control
   that is not there at all. */
{
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/\.gv-optrow-off \.gv-switch\s*\{[^}]*opacity/.test(css),
    'the disabled switch must be dimmed in light mode');
  assert.ok(/\.theme-dark[^{]*\.gv-optrow-off \.gv-switch\s*\{[^}]*opacity/.test(css),
    'dark mode must set its OWN opacity for the disabled switch — reusing the light value '
    + 'makes the control invisible against --gv-surface');
}

console.log('guided setup OK (speech gesture chain, slider scoping, per-theme disabled switch)');
