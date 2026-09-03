'use strict';
/* ONE NUMBER, ONE JOB (issue #3).

   THE BUG THIS REPRODUCES, from a first-run smoke test of the live set
   screen. Two things on screen both looked like the rep count:

     a huge "3" in the centre with "Tap to start now" under it
     a "− 1" on the floor directly beneath it, next to Done

   The reporter could not tell which was the live count, which was the
   target, and which was a countdown, and logged by guessing.

   BOTH halves were real.

   THE COUNTDOWN. attachCountIn reuses the live count's own node — one
   element, so the count-in and the count occupy the same place. The class
   that was supposed to tell them apart, `gv-rc-countin`, was added on every
   single set and HAD NO CSS RULE AT ALL. It styled nothing. So a countdown
   at 3 was pixel-for-pixel a rep count of 3, and nothing on screen named it.

   THE SECOND NUMERAL. Undo rendered as a minus icon beside a bare "1", at
   thumb height under the big count — a stepper showing 1, to anyone reading
   rather than remembering. It is a correction, not a counter. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

/* ---- 1. THE COUNT-IN LOOKS DIFFERENT FROM A COUNT ---- */
{
  /* The class is applied — it always was. What it must now do is change how
     the numeral reads. A class with no rule is the bug, not the fix. */
  assert.match(strip(read('rep-counter-shared.js')), /countEl\.classList\.add\('gv-rc-countin'\)/,
    'the countdown must still mark the numeral');

  /* Anchored at a line start, so the .theme-dark override cannot stand in
     for the base rule — deleting the light-theme rule and leaving the dark
     one is exactly the shape this guard has to catch. */
  const rule = css.match(/^\.gv-rc-count\.gv-rc-countin\s*\{[^}]*\}/m);
  assert.ok(rule, '.gv-rc-countin had NO rule at all — it marked every set and styled nothing');
  assert.match(rule[0], /-webkit-text-stroke|color:\s*transparent/,
    'a countdown must not be solid ink like a rep you earned — hollow says "waiting", solid says "scored"');

  /* GO is the beat where it becomes a count, so GO lands solid. */
  const go = css.match(/^\.gv-rc-count\.gv-rc-countin\.gv-rc-countin-go\s*\{[^}]*\}/m);
  assert.ok(go, 'GO needs its own treatment — it is the transition, not more waiting');
  assert.match(go[0], /-webkit-text-stroke:\s*0/, 'GO fills in');
}

/* ---- 2. AND IT SAYS WHAT IT IS ---- */
{
  const src = strip(read('rep-counter-shared.js'));
  assert.match(src, /'Counting you in'/,
    'colour alone is not an explanation — the number must be named while it is not a count');
  assert.match(src, /gv-rc-countin-label/, 'via its own node');
  assert.ok(css.includes('.gv-rc-countin-label'), 'which needs a rule, or it inherits the numeral\'s size');

  /* AND IT MUST GO AWAY. A label reading "Counting you in" left over a live
     rep count is the same confusion pointing the other way. */
  const restore = src.slice(src.indexOf('const restore = ()'), src.indexOf('};', src.indexOf('const restore = ()')));
  assert.match(restore, /removeChild\(label\)/,
    'the label must be torn down with the countdown, from the SAME place that clears its classes — '
    + 'restore() runs on both onDone and stop(), and a set can be abandoned mid-count-in');
  assert.match(restore, /label && label\.parentNode/,
    'guarded: restore() can run twice, and a second removeChild would throw');
}

/* ---- 3. NO SECOND NUMBER ON THE FLOOR ---- */
{
  const src = strip(read('page-session.js'));

  /* The floor is what sits under the count at thumb height. */
  const i = src.indexOf("const bar = el('div', { class: 'gv-rc-bar gv-session-rcbar' },");
  assert.ok(i >= 0, 'the counter floor must still be built here');
  const bar = [null, src.slice(i, src.indexOf(';', i))];
  assert.ok(!/undoBtn/.test(bar[1]),
    'undo is a correction, not a counter — beside the live count it read as a stepper sitting at 1');
  assert.match(bar[1], /doneBtn/, 'Done stays: it is what you reach for without looking up');
  assert.match(bar[1], /muteButton/, 'and mute');

  /* It is not deleted — it moves in beside Type, where 0.10.1 already put
     the control you reach for once rather than mid-rep. */
  assert.match(src, /\{ label: 'Undo a rep', hint: '[^']+', node: undoBtn, closeOnUse: true \}/,
    'undo must still be reachable — hiding a correction entirely is worse than showing it in the wrong place');

  /* And wherever it renders, it carries no bare numeral. */
  for (const f of ['page-session.js', 'rep-counter-modal.js']) {
    const s2 = strip(read(f));
    assert.ok(!/ico\('minus'\), el\('span', \{\}, '1'\)/.test(s2),
      `${f}: "− 1" beside a live count is a second number, whichever counter it is on`);
    assert.match(s2, /ico\('minus'\), el\('span', \{\}, 'Undo'\)/,
      `${f}: the control says what it does instead of showing a figure`);
  }
}

/* ---- 4. the count itself is untouched ---- */
{
  const src = strip(read('page-session.js'));
  assert.match(src, /const zone = el\('div', \{ class: 'gv-rc-zone gv-session-zone'/,
    'the tap zone IS the counter and stays the one live number on the screen');
  assert.match(src, /'aria-label': `Tap to count a rep for \$\{entry\.exercise\}`/,
    'and says so');
}

console.log('one number OK (the countdown reads as a countdown and says so; the floor holds no second figure)');
