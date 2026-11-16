'use strict';
/* CALM COLOURS (16 Nov 2026). Settings > Calm colours: eight complete palettes
   for the Calm style, each a paper AND its own accent, in light and dark:
   Sage + your accent (the default, what Calm always was), Oat, Sea glass,
   Blush, Lavender, Honey, Sky, and Lagoon, built from the ten colours Ruan
   supplied (lime cream through Yale blue).

   A palette is a Calm-only accent: the app root wears gv-accent-<key> in place
   of the user's accent while the style is Calm, so everything that already
   follows the accent class (modals, the cascade tests) follows the palette.
     P1  the list, and the default that changes nothing
     P2  accentFor: the palette only while the style is Calm
     P3  every palette declares its full light and dark token blocks
     P4  palettes are Calm-only: no rule names one without .gv-skin-calm
     P5  nothing in src/ puts the raw accent on a root (accentFor is the door)
     P6  Lagoon carries all ten supplied colours
     P7  each palette is its own entry in the Style dropdown (per device)
   Readability and "never white" for each palette live in contrast.test.cjs,
   light-paper.test.cjs and rc-zone-stages.test.cjs, which iterate them. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { CALM_PALETTES, DEFAULT_SETTINGS, ACCENTS, accentFor } = require('../src/constants');
const { cleanLook, LOOK_FIELDS } = require('../src/device-look');

const SRC = path.join(__dirname, '..', 'src');
const css = fs.readFileSync(process.env.GV_STYLES_CSS || path.join(SRC, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
let failed = 0;
const check = (name, fn) => { try { fn(); console.log('  ok   ' + name); } catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); } };
const KEYS = CALM_PALETTES.map(p => p[0]);
const OWN = KEYS.filter(k => k !== 'accent');
const block = sel => { const m = css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.]/g, '\\.') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : null; };

check('P1 eight palettes; the default is "your accent" and changes nothing', () => {
  assert.deepStrictEqual(KEYS, ['accent', 'oat', 'sea', 'blush', 'lavender', 'honey', 'sky', 'lagoon']);
  assert.strictEqual(DEFAULT_SETTINGS.calmPalette, 'accent');
  for (const [, label] of CALM_PALETTES) assert.ok(label && label.length > 3);
  for (const k of OWN) assert.ok(!ACCENTS.some(a => a[0] === k), `${k} must not collide with an accent key`);
});

check('P2 accentFor: the palette while the style is Calm, the accent otherwise', () => {
  assert.strictEqual(accentFor({ skin: 'calm', accent: 'olive', calmPalette: 'sea' }), 'sea');
  assert.strictEqual(accentFor({ skin: 'calm', accent: 'olive', calmPalette: 'accent' }), 'olive');
  assert.strictEqual(accentFor({ skin: 'calm', accent: 'olive' }), 'olive');
  assert.strictEqual(accentFor({ skin: 'apex', accent: 'blaze', calmPalette: 'sea' }), 'blaze', 'another style never wears a Calm palette');
  assert.strictEqual(accentFor({ skin: 'calm', accent: 'olive', calmPalette: 'neon' }), 'olive', 'an unknown palette is ignored');
  assert.strictEqual(accentFor({ skin: 'calm' }), 'lime');
  assert.strictEqual(accentFor(null), 'lime');
});

check('P3 every palette declares its light and dark tokens', () => {
  const LIGHT = ['bg', 'surface', 'line', 'line-2', 'ink', 'ink-dim', 'accent-solid', 'lime', 'lime-hi', 'lime-deep', 'lime-ghost', 'flood-dim'];
  const DARK = ['bg', 'surface', 'line', 'line-2', 'ink', 'ink-dim', 'lime', 'lime-ghost'];
  for (const k of OWN) {
    const l = block(`.gv-app.gv-skin-calm.gv-accent-${k}`), d = block(`.theme-dark .gv-app.gv-skin-calm.gv-accent-${k}`);
    assert.ok(l, `${k}: no light block`); assert.ok(d, `${k}: no dark block`);
    for (const t of LIGHT) assert.ok(new RegExp(`--gv-${t}:\\s*#[0-9a-fA-F]{6}`).test(l), `${k} light: --gv-${t}`);
    for (const t of DARK) assert.ok(new RegExp(`--gv-${t}:\\s*#[0-9a-fA-F]{6}`).test(d), `${k} dark: --gv-${t}`);
  }
});

check('P4 palettes are Calm-only', () => {
  const sels = [...css.matchAll(/([^{}]+)\{/g)].flatMap(m => m[1].split(',')).map(s => s.trim());
  for (const k of OWN) for (const s of sels) if (new RegExp(`gv-accent-${k}\\b`).test(s)) assert.ok(/gv-skin-calm/.test(s), `\`${s}\` names ${k} outside Calm`);
});

check('P5 the raw accent never reaches a root: accentFor is the only door', () => {
  const allowed = new Set(['constants.js', 'settings-tab.js', 'device-look.js', 'main.js']);
  for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js'))) {
    const text = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    if (!allowed.has(f)) assert.ok(!/\b(settings|st)\.accent\b/.test(text), `${f} reads the raw accent; use accentFor(settings)`);
  }
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8');
  assert.ok(!/accent:\s*this\.settings\.accent/.test(main), 'main.js hands the rep counter the raw accent');
});

check('P6 Lagoon carries all ten supplied colours', () => {
  const both = (block('.gv-app.gv-skin-calm.gv-accent-lagoon') || '') + (block('.theme-dark .gv-app.gv-skin-calm.gv-accent-lagoon') || '');
  for (const hex of ['#d9ed92', '#b5e48c', '#99d98c', '#76c893', '#52b69a', '#34a0a4', '#168aad', '#1a759f', '#1e6091', '#184e77']) assert.ok(both.toLowerCase().includes(hex), `${hex} is not in Lagoon`);
});

check('P7 every palette is its own entry in the Style dropdown, per device', () => {
  /* 16 Nov 2026: a separate "Calm colours" row was missed ("I only see one calm theme"). */
  const { styleChoices, styleValue, parseStyle, SKINS } = require('../src/constants');
  const choices = styleChoices();
  const values = choices.map(c => c[0]);
  assert.deepStrictEqual(values.filter(v => !/^calm/.test(v)), SKINS.map(s => s[0]).filter(k => k !== 'calm'), 'the other styles are listed once each, in order');
  assert.deepStrictEqual(values.filter(v => /^calm/.test(v)), ['calm', 'calm:oat', 'calm:sea', 'calm:blush', 'calm:lavender', 'calm:honey', 'calm:sky', 'calm:lagoon']);
  for (const [v, label] of choices) if (/^calm/.test(v)) assert.ok(/^Calm · /.test(label), `${v} must read as a Calm theme: ${label}`);
  assert.strictEqual(new Set(choices.map(c => c[1])).size, choices.length, 'no two entries share a label');
  /* value <-> settings, both ways */
  assert.deepStrictEqual(parseStyle('apex'), { skin: 'apex' }, 'another style leaves the Calm palette alone');
  assert.deepStrictEqual(parseStyle('calm'), { skin: 'calm', calmPalette: 'accent' });
  assert.deepStrictEqual(parseStyle('calm:lagoon'), { skin: 'calm', calmPalette: 'lagoon' });
  assert.deepStrictEqual(parseStyle('calm:neon'), { skin: 'calm', calmPalette: 'accent' }, 'an unknown palette is plain Calm');
  assert.strictEqual(styleValue({ skin: 'calm', calmPalette: 'lagoon' }), 'calm:lagoon');
  assert.strictEqual(styleValue({ skin: 'calm', calmPalette: 'accent' }), 'calm');
  assert.strictEqual(styleValue({ skin: 'calm' }), 'calm');
  assert.strictEqual(styleValue({ skin: 'apex', calmPalette: 'lagoon' }), 'apex');
  assert.strictEqual(styleValue({}), 'apex');
  for (const v of values) assert.strictEqual(styleValue(Object.assign({ accent: 'lime' }, parseStyle(v))), v, `${v} round-trips`);
  /* the tab builds Style from it and saves both fields in one go */
  const tab = fs.readFileSync(path.join(SRC, 'settings-tab.js'), 'utf8');
  assert.match(tab, /styleChoices\(\)/);
  assert.match(tab, /setLooks\(parseStyle\(/);
  assert.ok(!/setName\('Calm colours'\)/.test(tab), 'the separate Calm colours row is gone: one place to pick');
  assert.ok(LOOK_FIELDS.includes('calmPalette'));
  assert.deepStrictEqual(cleanLook({ calmPalette: 'sea' }), { calmPalette: 'sea' });
  assert.strictEqual(cleanLook({ calmPalette: 'neon' }), null);
});

if (failed) { console.error(`calm-palettes: ${failed} failed`); process.exit(1); }
