'use strict';
/* CALM SKIN + OLIVE ACCENT (23 Oct 2026): a quieter style, asked for with #568203 as its green.

   What can go wrong silently, and what this pins:
     C1  BOTH ARE OFFERED: Settings builds its dropdowns from SKINS and ACCENTS, so a missing
         entry means the option never appears.
     C2  THE GREEN IS THE ONE ASKED FOR: Olive's solid is exactly #568203, and white on it holds
         4.5:1, because Calm puts white labels on it. (Its TEXT tone is darker on purpose:
         #568203 is only ~4.2:1 on the tinted papers - contrast.test.cjs measures that one.)
     C3  CALM FILLS WITH THE SOLID: its fill token reads --gv-accent-solid first and falls back
         to the deep tone, so every other palette still works.
     C4  TOKENS ONLY: every colour literal in the Calm section sits in its two token blocks
         (light and .theme-dark). A literal in a rule would outrank the base .theme-dark twins
         and paint a light colour into dark mode.
   GV_STYLES_CSS points the CSS half at a deliberately broken copy (mutation testing). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SKINS, ACCENTS, skinClasses } = require('../src/constants');

const css = fs.readFileSync(process.env.GV_STYLES_CSS || path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const lum = hex => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
const block = sel => {
  const at = css.indexOf(sel + ' {');
  assert.ok(at >= 0, `no ${sel} block`);
  return css.slice(at, css.indexOf('}', at));
};

check('C1 Calm is a Style choice and Olive an Accent choice; Calm is not a poster skin', () => {
  assert.ok(SKINS.some(([k]) => k === 'calm'), 'calm missing from SKINS');
  assert.ok(ACCENTS.some(([k]) => k === 'olive'), 'olive missing from ACCENTS');
  assert.deepStrictEqual(skinClasses('calm'), ['gv-skin-calm']);
});

check('C2 Olive\'s solid is #568203 and white on it is at least 4.5:1', () => {
  const m = /--gv-accent-solid:\s*(#[0-9a-fA-F]{6})/.exec(block('.gv-app.gv-accent-olive'));
  assert.ok(m, 'olive declares no --gv-accent-solid');
  assert.strictEqual(m[1].toLowerCase(), '#568203');
  assert.ok(ratio(m[1], '#ffffff') >= 4.5, `white on ${m[1]} is ${ratio(m[1], '#ffffff').toFixed(2)}`);
});

check('C3 Calm fills with the accent\'s solid, falling back to its deep tone', () => {
  assert.match(block('.gv-app.gv-skin-calm'), /--gv-calm-fill:\s*var\(--gv-accent-solid,\s*var\(--gv-lime-deep\)\)/);
});

check('C4 the Calm section has colour literals only in its two token blocks', () => {
  const banner = css.indexOf('SKIN: CALM');
  assert.ok(banner > 0, 'SKIN: CALM banner missing');
  const start = css.lastIndexOf('/*', banner); // from the banner comment's opening, so it strips whole
  const end = css.indexOf('---------- REVIEW FIXES (0.14.0)', start);
  const section = css.slice(start, end > start ? end : css.length).replace(/\/\*[\s\S]*?\*\//g, '');
  const stripped = section
    .replace(/\.theme-dark \.gv-app\.gv-skin-calm \{[^}]*\}/, '')
    .replace(/\.gv-app\.gv-skin-calm \{[^}]*\}/, '');
  const leaks = stripped.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g);
  assert.ok(!leaks, `colour literal(s) in a Calm rule: ${leaks && leaks.join(', ')}`);
});

if (failed) { console.error(`calm-skin: ${failed} guard(s) FAILED`); process.exit(1); }
console.log('calm-skin OK');
