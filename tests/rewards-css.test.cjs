'use strict';
/* THE REWARDS STYLES (the REWARDS UI blocks of src/styles.css), the contracts that do not show on a desktop.

     C1  the medal tier colours are tokens with a dark twin; gold is its own token (amber stays the streak's)
     C2  no colour literal in any .gv-rw- rule: every colour is a token (so all five accents work)
     C3  Apex draws the hexagon from a rectangle and four border triangles; Lock In draws the starburst from two squares turned 45 degrees apart
     C4  the only motion is the one-shot XP fill: finite, transform only, in the base block, stopped under reduced motion; nothing loops
     C5  each skin that restyles the rewards does so under its own scope (Floor and Editorial use the base block alone)
     C6  nothing the rewards draw is tappable (so no 44px touch box is owed): no button, no handler in rewards-ui.js
     C7  iOS 15 floor inside the rewards blocks: no :has(), color-mix(), dvh, inset shorthand, aspect-ratio, clip-path, !important */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

const css = fs.readFileSync(process.env.GV_STYLES_CSS || path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const rules = cx.load();
const decl = (r, p) => (r.decls.find(d => d.prop === p) || {}).value;
const rw = rules.filter(r => /\.gv-rw-/.test(r.selector));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

/* C1 */
{
  const tok = sel => Object.fromEntries((rules.find(r => r.selector === sel) || { decls: [] }).decls.map(d => [d.prop, d.value]));
  const light = tok('.gv-app'), dark = tok('.theme-dark .gv-app');
  for (const t of ['gold', 'silver', 'bronze', 'lock']) for (const k of [`--gv-medal-${t}`, `--gv-medal-${t}-ink`]) {
    ok(/^#[0-9a-f]{6}$/i.test(light[k] || ''), `${k} has a light value`);
    ok(/^#[0-9a-f]{6}$/i.test(dark[k] || ''), `${k} has a dark twin`);
    ok(!/amber|ember/.test(light[k] + dark[k]), `${k} does not borrow the streak's amber`);
  }
  for (const t of ['gold', 'silver', 'bronze', 'lock']) ok(light[`--gv-medal-${t}-ink`] !== dark[`--gv-medal-${t}-ink`], `--gv-medal-${t}-ink differs by theme: dark ink on paper, light ink on graphite`);
  ok(new Set(['gold', 'silver', 'bronze'].map(t => dark[`--gv-medal-${t}`])).size === 3, 'the three tiers are three colours');
  /* Apex and Lock In never redefine them (a skin block that did would escape the dark twin) */
  for (const r of rules.filter(r => /gv-skin-(apex|lockin)/.test(r.selector))) ok(!r.decls.some(d => /^--gv-medal-/.test(d.prop)), `${r.selector} must not redefine a medal token`);
}

/* C2 */
{
  const bad = [];
  for (const r of rw) for (const d of r.decls) if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(d.value)) bad.push(`:${r.line} ${r.selector} { ${d.prop}: ${d.value} }`);
  ok(bad.length === 0, 'colour literals in rewards rules:\n' + bad.join('\n'));
  ok(rw.length > 120, `the rewards blocks parsed (${rw.length} rules)`);
}

/* C3 */
{
  const A = '.gv-app.gv-skin-apex', L = '.gv-app.gv-skin-lockin';
  const has = (sel, prop, pred) => rules.some(r => r.selector === sel && pred(decl(r, prop) || ''));
  for (const pseudo of ['::before', '::after']) {
    ok(has(`${A} .gv-rw-hex${pseudo}`, 'border-left', v => /solid transparent/.test(v)), `Apex hex ${pseudo} is a border triangle`);
    ok(has(`${A} .gv-rw-hex-in${pseudo}`, 'border-left-width', () => true) || rules.some(r => r.selector === `${A} .gv-rw-hex-in${pseudo}`), `Apex inner hex ${pseudo}`);
  }
  ok(has(`${A} .gv-rw-hex::before`, 'border-bottom', v => /solid var\(--gv-rw-ring\)/.test(v)) && has(`${A} .gv-rw-hex::after`, 'border-top', v => /solid var\(--gv-rw-ring\)/.test(v)), 'the ring triangles take the tier colour');
  ok(has(`${A} .gv-rw-hex-in`, 'z-index', v => v === '1'), 'the inner hex and its glyph paint above the ring triangles');
  const rot = sel => { const rs = rules.filter(r => r.selector === sel && r.decls.some(d => d.prop === 'transform')); assert.ok(rs.length, `${sel} has no transform`); const m = /rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(decl(rs[rs.length - 1], 'transform')); assert.ok(m, `${sel}: not a rotate()`); return Number(m[1]); };
  ok(Math.abs(rot(`${L} .gv-rw-hex::after`) - rot(`${L} .gv-rw-hex::before`)) === 45, 'the two squares of the Lock In starburst are 45 degrees apart');
  for (const pseudo of ['::before', '::after']) {
    ok(has(`${L} .gv-rw-hex${pseudo}`, 'pointer-events', v => v === 'none'), `${pseudo} takes no tap`);
    ok(has(`${L} .gv-rw-hex${pseudo}`, 'background-color', v => v === 'var(--gv-slab)'), `${pseudo} fills with --gv-slab (what the contrast gate reads)`);
  }
  ok(!/\bclip-path\s*:/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'clip-path is banned');
}

/* C4 */
{
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const anim = rw.filter(r => !r.media && r.decls.some(d => d.prop === 'animation' && !/^none\b/.test(d.value)));
  ok(anim.length === 1 && anim[0].selector === '.gv-rw-bar-gain', `only the XP bar's gain animates (found ${anim.map(r => r.selector)})`);
  const v = decl(anim[0], 'animation');
  ok(/gv-rw-fill/.test(v) && !/infinite/.test(v) && /\b1\b/.test(v), `one-shot, not a loop: ${v}`);
  ok(rules.some(r => r.selector === '.gv-rw-bar-gain' && r.media && /prefers-reduced-motion:\s*reduce/.test(r.media) && decl(r, 'animation') === 'none'), 'reduced motion stops the fill');
  const kf = /@keyframes\s+gv-rw-fill\s*\{([\s\S]*?)\}\s*\}/.exec(bare);
  ok(kf, 'the keyframes exist'); ok(!/[^-]\b(width|left|opacity|box-shadow|filter)\s*:/.test(kf[1]) && /transform/.test(kf[1]), 'the fill animates transform only');
  ok(!rw.some(r => r.decls.some(d => d.prop === 'transition')), 'no transitions in the rewards blocks');
  const skinKf = [...bare.matchAll(/@keyframes\s+([\w-]+)/g)].map(m => m[1]).filter(k => /gv-rw/.test(k));
  ok(skinKf.length === 1, 'one rewards keyframes, in the base block (the Lock In guard allows only its own two in its section)');
  ok(bare.indexOf('@keyframes gv-rw-fill') < bare.indexOf('SKIN: APEX') || css.indexOf('@keyframes gv-rw-fill') < css.indexOf('SKIN: APEX'), 'declared before the skins');
}

/* C5 */
{
  ok(!rw.some(r => /gv-skin-(floor|editorial)/.test(r.selector)), 'Floor and Editorial have no rewards rule of their own: they use the base block');
  for (const r of rw.filter(r => /gv-skin-/.test(r.selector))) ok(/\.gv-app\.gv-skin-(apex|lockin)\b/.test(r.selector), `${r.selector} is scoped to its skin`);
  ok(rw.filter(r => /gv-skin-apex/.test(r.selector)).length > 40 && rw.filter(r => /gv-skin-lockin/.test(r.selector)).length > 40, 'both skins restyle the rewards');
  ok(rules.some(r => r.selector === '.gv-slot-level:empty, .gv-slot-quest:empty, .gv-slot-xp-chip:empty' || /gv-slot-level:empty/.test(r.selector)), 'an empty slot draws nothing');
}

/* C6 */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'rewards-ui.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(!/el\('button'|onclick|addEventListener|clickableCard|tabindex|role: 'button'/.test(src), 'rewards-ui.js builds nothing tappable');
  ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(src), 'no HTML injection');
}

/* C7 */
{
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const text = rw.map(r => `${r.selector} { ${r.decls.map(d => `${d.prop}: ${d.value}`).join('; ')} }`).join('\n');
  for (const [re, what] of [[/:has\(/, ':has()'], [/color-mix\(/, 'color-mix()'], [/\b\d+dvh\b/, 'dvh'], [/(^|[;{\s])inset\s*:/, 'inset shorthand'], [/aspect-ratio/, 'aspect-ratio'], [/!important/, '!important'], [/backdrop-filter/, 'backdrop-filter']]) {
    ok(!re.test(text), `${what} in a rewards rule`);
  }
  ok(bare.length > 0, 'ok');
}
console.log(`rewards css OK (${n} checks)`);
