'use strict';
/* The guided setup screen's ORDER, and its one flood.

   THE BUG THIS LOCKS (issues #2 and #9, from the 0.10.2 live review at phone
   width): this screen asked HOW MANY before it asked WHAT KIND, and then put
   the only control anyone came here for below everything else. The render
   order was equipment -> sets -> Guide -> minutes -> toggles -> sound ->
   preview -> Start, so "Get after it" led to a screen where Start was off
   the bottom of a 390px phone and first-run testers reported the app had
   not started.

   Two things fix it and both are order, not styling:
     1. Guide first — it decides which dial comes next.
     2. Start immediately after the dial and its preview, with everything
        that is READ rather than DECIDED (the kit, the circuit's extras, the
        music) below it.

   And one thing is styling: ONE FLOOD. Lime landed on the selected Guide
   card, the dial readout, the range thumb and the toggles as well as Start —
   five accents competing with the one button the screen exists to reach.

   render() cannot be called in node (it pulls the whole page graph and a
   live vault), so the order is checked where it is written — the
   page-headings.test.cjs precedent. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const src = strip(read('page-session-setup.js'));
const body = src.slice(src.indexOf('function render(ctx, root)'), src.indexOf('function setsBlock('));
assert.ok(body.length > 200, 'render() not found — this guard must be renamed with it');

const at = (needle, what) => {
  const i = body.indexOf(needle);
  assert.ok(i >= 0, `${what} is gone from render() — ${needle}`);
  return i;
};

/* ---- GUARD 1: what kind, then how many, then go ---- */
{
  const guide = at("el('span', {}, 'Guide')", 'the Guide section');
  const modes = at('wrap.append(modes)', 'the Guide radio group');
  const dial = at("if (ui.mode === 'timed') wrap.append(minutesBlock", 'the one dial');
  const preview = at('wrap.append(preview)', 'the preview line');
  const start = at("gv-setup-start' }, start)", 'the Start button');

  assert.ok(guide < modes && modes < dial,
    'Guide must come BEFORE the dial — it is what decides which dial you get');
  assert.ok(dial < preview && preview < start,
    'the dial and the total it produces must come before Start, or Start quotes a number nobody has seen');
}

/* ---- GUARD 2: Start is above everything that is merely read ---- */
{
  const start = at("gv-setup-start' }, start)", 'the Start button');
  for (const [needle, what] of [
    ['wrap.append(equipmentBlock', 'the equipment list'],
    ['wrap.append(togglesBlock', "the circuit's toggles"],
    ["el('span', {}, 'Sound')", 'the music row'],
  ]) {
    assert.ok(at(needle, what) > start,
      `${what} must sit BELOW Start — it is read, not decided, and above the button it pushes Start off a phone`);
  }
}

/* ---- GUARD 3: ONE DIAL, NEVER BOTH ---- */
{
  /* The two dials are the two arms of one conditional. Appending both — or
     appending the sets dial unconditionally — puts a set count on a timed
     circuit, where the clock overwrites it the moment the schedule builds. */
  assert.match(body, /if \(ui\.mode === 'timed'\) wrap\.append\(minutesBlock\([^)]*\)\);\s*\n\s*else wrap\.append\(setsBlock\(/,
    'the sets dial and the minutes dial must be the two arms of ONE conditional, never both on screen');
}

/* ---- GUARD 4: ONE FLOOD, and it is Start ---- */
{
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(body, /class: 'gv-guidesetup'/,
    'the screen needs its own scope class, or the ink discipline below leaks into the plan picker and settings');

  /* Every other accent on this screen is pulled back to ink. Scoped, so the
     same components keep their lime everywhere else in the app. */
  for (const [sel, what] of [
    ['\\.gv-guidesetup \\.gv-optrow\\.on', 'the selected Guide card'],
    ['\\.gv-guidesetup \\.gv-optrow-tick', "the selected Guide's tick"],
    ['\\.gv-guidesetup \\.gv-dial-value', 'the dial readout'],
    ['\\.gv-app \\.gv-guidesetup \\.gv-switch\\.on', 'the toggles'],
    ['\\.gv-app \\.gv-guidesetup \\.gv-dial-range::-webkit-slider-thumb', 'the range thumb'],
  ]) {
    const rule = css.match(new RegExp(`${sel}[^{]*\\{[^}]*\\}`));
    assert.ok(rule, `${what} has no ink rule — it is still competing with Start`);
    assert.match(rule[0], /var\(--gv-ink\)/,
      `${what} must be ink on this screen: one flood per screen, and here it is Start`);
  }

  /* And the button itself is still the flood. */
  assert.match(body, /class: 'gv-btn-go'/, 'Start must stay the flood');
}

/* ---- GUARD 5: the leftover stepper chrome is gone, not merely unused ---- */
{
  const css = read('styles.css');
  const live = css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\.gv-setsrow/.test(live),
    'the old per-exercise stepper rules must go with the markup — dead CSS is how a rewritten screen quietly regrows its old face');
  assert.ok(!/gv-setsrow/.test(strip(read('page-session-setup.js'))),
    'nothing may still render gv-setsrow chrome');
}

console.log('setup order OK (Guide, then one dial, then Start — with the reading matter below it, and one flood)');
