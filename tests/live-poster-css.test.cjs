'use strict';
/* THE LIVE SET'S POSTER STYLES (Apex = design 10, Lock In = design 07; phone B).

   page-session.js builds the poster arrangement for these two skins only
   (tests/live-chrome.test.cjs holds the DOM side). This holds the stylesheet
   side: the contracts that fail silently on a desktop and loudly on a phone.

     1  BOTH SKINS HAVE THE BLOCK, as mirror images: the same selectors under
        .gv-skin-apex and .gv-skin-lockin, so a fix to one cannot leave the other
        behind. Every rule is scoped to its skin, so Floor and Editorial are
        untouched by construction.
     2  THE STAGE RAMP IS NOT RESTYLED: no rule here names [data-fill] or a stage.
        The zone's flood (cool, amber, red, then the accent) stays the signal;
        the accent is spent on the zone only at the goal (rc-zone-stages.test.cjs).
     3  TOKENS ONLY, iOS 15: no colour literal, no clip-path, :has(), inset:,
        !important or container query. The sheet's leaning top edge is ONE gradient
        with a hard stop, not a clip-path or a transform.
     4  SLABS: the two chips are positioned, isolated, name a --gv-slab and draw a
        leaning ::before behind themselves.
     5  TOUCH: the weight steppers and the Tick slab keep a 44px box.
     6  MOTION: the one loop (the current pip) animates opacity only and has a
        prefers-reduced-motion stop.
     7  SHORT PHONES: the rest row loses its ring (<= 800px tall) and then goes
        (<= 700px) so the count, the one thing that flexes, keeps its room.
     8  THE SHEET'S TEXT holds 4.5:1 on BOTH ends of the sheet's gradient, in every
        theme and accent (the cascade probe in contrast.test.cjs only knows a flat
        colour, so the gradient's two ends are measured here). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

const file = process.env.GV_STYLES_CSS || path.join(__dirname, '..', 'src', 'styles.css');
const css = fs.readFileSync(file, 'utf8');
const rules = cx.load();
let n = 0;
const ok = (c, msg) => { assert.ok(c, msg); n++; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); n++; };

const SKINS = [
  { key: 'apex', cls: '.gv-skin-apex', tok: 'apex', design: '10' },
  { key: 'lockin', cls: '.gv-skin-lockin', tok: 'li', design: '07' },
];
const LIVE = /gv-live|gv-rc-tapchip|gv-pb-target-(kicker|marks)/;
const decl = (r, p) => (r.decls.find(d => d.prop === p) || {}).value;
const mine = skin => rules.filter(r => !/^@/.test(r.selector) && LIVE.test(r.selector) && r.selector.includes(skin.cls));
const bySel = (skin, sel, media) => mine(skin).find(r => r.selector === `.gv-app${skin.cls} ${sel}` && (media ? r.media && r.media.includes(media) : !r.media));
const px = v => { const m = /^(-?\d+(?:\.\d+)?)px$/.exec(String(v || '').trim()); return m ? Number(m[1]) : null; };

/* ---- 1: the block exists in both skins and is a mirror ---- */
const norm = (sel, skin) => sel.split(skin.cls).join('@SKIN@').split('--gv-' + skin.tok + '-').join('--gv-@TOK@-').split('--gv-apex-').join('--gv-@TOK@-');
const shape = skin => mine(skin).map(r => `${r.media || ''}|${norm(r.selector, skin)}`);
for (const skin of SKINS) {
  ok(css.includes(`the live set, design ${skin.design} layout`), `${skin.key}: the live-set block (design ${skin.design}) is missing`);
  ok(mine(skin).length >= 55, `${skin.key}: the live-set block parsed to almost nothing (${mine(skin).length} rules)`);
  for (const r of rules.filter(r => !/^@/.test(r.selector) && LIVE.test(r.selector))) {
    ok(/^\.gv-app\.gv-skin-(apex|lockin)\b/.test(r.selector), `src/styles.css:${r.line} \`${r.selector}\` styles a poster node outside a skin scope: Floor and Editorial would wear it`);
  }
}
eq(shape(SKINS[0]), shape(SKINS[1]), 'Apex and Lock In carry the same live-set selectors, in the same order');

for (const skin of SKINS) {
  const own = mine(skin);
  /* ---- 2: the stage is not restyled ---- */
  for (const r of own) ok(!/data-fill|gv-rc-zone/.test(r.selector), `${skin.key}: \`${r.selector}\` touches the counter zone's stage; the ramp is not a skin's to restyle`);

  /* ---- 3: tokens only, iOS 15 ---- */
  for (const r of own) {
    for (const d of r.decls) {
      ok(!/#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\bcolor-mix\(/i.test(d.value), `${skin.key}: ${r.selector} { ${d.prop}: ${d.value} } is a colour literal; use a token`);
      ok(!/clip-path|:has\(|\bdvh\b|!important/.test(d.prop + d.value), `${skin.key}: ${r.selector} { ${d.prop} } is not safe on the iOS 15 floor / the lint`);
      ok(d.prop !== 'inset', `${skin.key}: ${r.selector} uses the inset shorthand`);
    }
  }

  /* ---- 4: the chips are real slabs ---- */
  for (const sel of ['.gv-live-chip', '.gv-rc-tapchip']) {
    const r = own.find(x => x.selector.includes(`${sel},`) || x.selector === `.gv-app${skin.cls} ${sel}`) || own.find(x => x.selector.endsWith(sel));
    const slab = rules.find(x => !x.media && x.selector.split(',').some(s => s.trim() === `.gv-app${skin.cls} ${sel}`) && decl(x, 'position'));
    ok(slab, `${skin.key}: ${sel} has no positioned rule`);
    eq([decl(slab, 'position'), decl(slab, 'isolation')], ['relative', 'isolate'], `${skin.key}: ${sel} must be positioned and isolated so its ::before stays behind it`);
    ok(/var\(--gv-(apex|li)-chip\)/.test(decl(slab, '--gv-slab') || ''), `${skin.key}: ${sel} names its --gv-slab (the colour behind its text)`);
    const before = rules.find(x => !x.media && x.selector.split(',').some(s => s.trim() === `.gv-app${skin.cls} ${sel}::before`));
    ok(before, `${skin.key}: ${sel}::before is missing`);
    eq([decl(before, 'z-index'), /skewX\(-?\d+deg\)/.test(decl(before, 'transform') || '')], ['-1', true], `${skin.key}: ${sel}::before is the leaning slab behind the label`);
    ok(!decl(slab, 'overflow'), `${skin.key}: ${sel} must not clip its own ::before`);
  }

  /* ---- 5: touch ---- */
  const step = bySel(skin, '.gv-live-step');
  ok(step && px(decl(step, 'width')) >= 44 && px(decl(step, 'height')) >= 44, `${skin.key}: the weight steppers must keep a 44px box`);
  const tick = bySel(skin, '.gv-live-tick');
  ok(tick && px(decl(tick, 'min-height')) >= 44, `${skin.key}: the Tick slab must keep a 44px box`);
  ok(/^\d+(\.\d+)?ch$/.test(decl(bySel(skin, '.gv-live-weightval input.gv-session-weight'), 'width') || ''), `${skin.key}: the weight figure is sized in characters, so 100+ kg still fits`);

  /* ---- the sheet's leaning edge ---- */
  const sheet = bySel(skin, '.gv-live-sheet');
  ok(sheet, `${skin.key}: no sheet rule`);
  const bg = decl(sheet, 'background-image') || '';
  ok(/^linear-gradient\(\s*1[67]\d(\.\d+)?deg,\s*transparent 0,\s*transparent (\d+)px,\s*var\(--gv-[\w-]+\) \2px,\s*var\(--gv-[\w-]+\) 100%\)$/.test(bg), `${skin.key}: the sheet's leaning edge is one gradient with a hard stop at the same px (got ${bg})`);
  ok(!decl(sheet, 'transform') && !decl(sheet, 'clip-path') && !decl(sheet, 'overflow'), `${skin.key}: the sheet is drawn by its gradient alone`);
  ok(/^-\d+px calc\(-1 \* var\(--gv-page-gutter\)\) 0$/.test(decl(sheet, 'margin') || ''), `${skin.key}: the sheet bleeds by the page gutter variable, never a literal (a narrow page pads 12px, not 18)`);
  ok(/var\(--gv-page-gutter\)/.test(decl(sheet, 'padding') || ''), `${skin.key}: the sheet pads by the same gutter`);

  /* ---- 6: motion ---- */
  const cur = bySel(skin, '.gv-live-pip.is-cur');
  ok(cur && /^gv-live-blink [\d.]+s ease-in-out infinite$/.test(decl(cur, 'animation') || ''), `${skin.key}: the current pip blinks`);
  const calm = rules.find(r => r.media && /prefers-reduced-motion:\s*reduce/.test(r.media) && r.selector === `.gv-app${skin.cls} .gv-live-pip.is-cur`);
  ok(calm && /^none\b/.test(decl(calm, 'animation')), `${skin.key}: the blinking pip has no prefers-reduced-motion stop`);

  /* ---- 7: short phones ---- */
  const at800 = r => r.media && /max-height:\s*800px/.test(r.media);
  const at700 = r => r.media && /max-height:\s*700px/.test(r.media);
  const hidden = pred => rules.filter(r => pred(r) && r.selector.startsWith(`.gv-app${skin.cls} `) && decl(r, 'display') === 'none').map(r => r.selector.slice(`.gv-app${skin.cls} `.length));
  ok(['.gv-live-ring', '.gv-live-lbl'].every(s => hidden(at800).includes(s)), `${skin.key}: at 800px tall the rest row drops its ring and label`);
  ok(['.gv-live-next', '.gv-live-zone .gv-rc-tapchip'].every(s => hidden(at700).includes(s)), `${skin.key}: at 700px tall the rest row and the tap chip go`);
  const big = bySel(skin, '.gv-live-zone .gv-session-count');
  ok(/^min\(\d+vw, \d+vh, (\d+)px\)$/.test(decl(big, 'font-size') || '') && Number(/, (\d+)px\)/.exec(decl(big, 'font-size'))[1]) <= 208, `${skin.key}: the count is sized by BOTH the width and the height it has, capped at the mockup's 208px`);
  eq(decl(big, 'font-style'), 'italic', `${skin.key}: the count is the mockup's italic`);
}

/* ---- 6b: the loop only moves opacity ---- */
{
  const m = /@keyframes\s+gv-live-blink\s*\{([\s\S]*?\})\s*\}/.exec(css);
  ok(m, 'gv-live-blink keyframes are missing');
  const props = new Set([...m[1].matchAll(/([a-z-]+)\s*:/g)].map(x => x[1]));
  eq([...props].filter(p => p !== 'opacity' && p !== 'transform'), [], 'the pip blink animates only transform and opacity');
}

/* ---- 8: the sheet's text on both ends of its gradient ---- */
{
  const THEMES = ['dark', 'light'], ACCENTS = ['lime', 'volt', 'blaze', 'electric', 'punch'];
  const TEXT = [
    ['rest label', ['p.gv-live-lbl']], ['up next', ['p.gv-live-nx']], ['up next detail', ['p.gv-live-nx', 'small']], ['ring time', ['div.gv-live-ring', 'b']],
  ];
  let worst = 99;
  for (const skin of SKINS) for (const theme of THEMES) for (const accent of ACCENTS) {
    const sheetChain = cx.appChain({ theme, skin: skin.key, accent }, 'div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-live-sheet');
    const bg = decl(bySel(skin, '.gv-live-sheet'), 'background-image');
    const ends = [...bg.matchAll(/var\((--gv-[\w-]+)\)/g)].map(m => cx.parseColor(cx.resolveVars(sheetChain, `var(${m[1]})`, rules)));
    eq(ends.length, 2, 'the gradient names its two ends as tokens');
    for (const [label, inner] of TEXT) {
      const chain = cx.appChain({ theme, skin: skin.key, accent }, 'div.gv-session-page', 'div.gv-session-body.gv-live', 'div.gv-live-sheet', 'div.gv-live-next', 'div.gv-live-nextbody', ...inner);
      const found = cx.computed(chain, 'color', rules);
      ok(found, `${label}: a text colour reaches it`);
      const fg = cx.parseColor(cx.resolveVars(found.chain, found.value, rules));
      for (const end of ends) {
        const r = cx.ratio(fg, end);
        worst = Math.min(worst, r);
        ok(r >= 4.5, `${skin.key}/${theme}/${accent}: the sheet's "${label}" is ${r.toFixed(2)}:1 on its gradient end ${cx.hex(end)} (< 4.5)`);
      }
    }
  }
  n += 0;
  console.log(`live poster css OK (${n} checks; the sheet's worst text is ${worst.toFixed(2)}:1 across both skins, both themes, five accents)`);
}
