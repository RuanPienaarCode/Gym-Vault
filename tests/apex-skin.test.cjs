'use strict';
/* THE APEX SKIN (design 10 "Lock-In Apex") — the contracts that are easy to
   break without anything visibly failing on a desktop.

   What each block pins, and the mistake it was written against:

   1 DEFAULT + FLOOR/EDITORIAL KEPT: Apex is the default and first in the
     dropdown; the two older skins stay selectable (a saved skin is never
     migrated, so removing one would strand its users).
   2 FONT: Barlow Condensed 800 + 900 italic are embedded (no network on iOS),
     display-swapped, credited in NOTICE, and the display stack falls back to
     Anton and then a system condensed face.
   3 ACCENTS FLOW: no colour literal in any Apex rule except the token blocks
     (and the one tuned-lime block). A hardcoded #C3F04A in a rule is exactly
     how Volt, Blaze, Electric and Punch would quietly stay lime. Checked
     again through the real cascade: the CTA's fill IS each accent's own lime.
   4 AMBER IS NOT AN ACCENT: the streak colour is the same under all five.
   5 LIGHT + DARK: every Apex surface token has both a light value and a dark
     twin (one value cannot serve both themes).
   6 SLABS: every element that draws the leaning ::before is also positioned
     and isolated, names a --gv-slab fill, and never has overflow:hidden (it
     would clip its own pseudo-element). No clip-path anywhere.
   7 REDUCED MOTION: every animation Apex declares has a reduced-motion
     override that stops it (ticker, CTA pulse, glow pulses, fills).
   7b LOOPS ARE FREE: nothing that repeats forever animates anything but
     transform and opacity (no filter, text-shadow or box-shadow frames).
   8 iOS 15 FLOOR: none of :has(), color-mix(), dvh, @property, backdrop-filter
     or a bare :focus-visible in the stylesheet.
   9 THE LANE-B ELEMENTS are styled in every skin (floor base) and Apex hides
     the older record list, which its PB moments replace. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
/* GV_STYLES_CSS points the guard at a deliberately broken copy (mutation testing). */
const css = process.env.GV_STYLES_CSS ? fs.readFileSync(process.env.GV_STYLES_CSS, 'utf8') : read('src/styles.css');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
const bare = strip(css);
const rules = cx.load();

/* ---------- 1 ---------- */
const { SKINS, DEFAULT_SETTINGS } = require('../src/constants');
assert.strictEqual(DEFAULT_SETTINGS.skin, 'apex', 'Apex must be the default skin');
assert.deepStrictEqual(SKINS.map(s => s[0]), ['apex', 'lockin', 'floor', 'editorial', 'calm'], 'dropdown order is apex, lockin, floor, editorial, calm — none removed (lockin is pinned by lockin-skin.test.cjs)');
/* Floor IS the base stylesheet, so it has no block of its own. */
for (const [key] of SKINS.filter(s => s[0] !== 'floor')) assert.ok(new RegExp(`gv-skin-${key}\\b`).test(bare), `no CSS for skin ${key}`);

/* ---------- 2 ---------- */
const font = read('src/font.css');
for (const w of [800, 900]) {
  assert.ok(new RegExp(`font-family:\\s*'Barlow Condensed';\\s*font-style:\\s*italic;\\s*font-weight:\\s*${w};\\s*font-display:\\s*swap;\\s*src:\\s*url\\(data:font/woff2;base64,[A-Za-z0-9+/=]{2000,}\\)`).test(font),
    `Barlow Condensed ${w} italic must be embedded as a data URI with font-display: swap`);
}
const notice = read('NOTICE');
assert.ok(/Barlow Condensed/.test(notice) && /SIL Open Font License/.test(notice) && /Anton/.test(notice), 'NOTICE must credit both embedded faces under the OFL');
const display = /--gv-display:\s*('Barlow Condensed'[^;]*);/.exec(bare);
assert.ok(display, 'Apex must set --gv-display to Barlow Condensed');
assert.ok(/'Barlow Condensed',\s*'Anton'/.test(display[1]) && /sans-serif$/.test(display[1].trim()), 'display stack: Barlow Condensed, then Anton, then system faces');

/* ---------- the Apex section ---------- */
const banner = css.indexOf('SKIN: APEX');
assert.ok(banner > 0, 'SKIN: APEX banner missing');
const bannerLine = css.slice(0, banner).split('\n').length;
/* The Apex section ends where the Lock In banner begins: Lock In has its own token blocks and its own guard. */
const lockBanner = css.indexOf('SKIN: LOCK IN');
const lockLine = lockBanner > 0 ? css.slice(0, lockBanner).split('\n').length : Infinity;
assert.ok(lockLine > bannerLine, 'the Lock In section must come after the Apex section');
/* Rules written against `.gv-skin-poster` (the hook Apex and Lock In share) are read by the cascade engine as one rule
   per skin, so the Apex rules are everything in the section that does not name Lock In: the shared ones count as Apex's. */
const apex = rules.filter(r => r.line >= bannerLine && r.line < lockLine && !/gv-skin-lockin/.test(r.selector));
assert.ok(apex.length > 80, 'the Apex section parsed to almost nothing');
const TOKEN_SEL = new Set(['.gv-app.gv-skin-apex', '.theme-dark .gv-app.gv-skin-apex', '.gv-app.gv-skin-apex.gv-accent-lime']);

/* ---------- 3 ---------- */
{
  const offenders = [];
  for (const r of apex) {
    if (TOKEN_SEL.has(r.selector)) continue;
    for (const d of r.decls) {
      if (d.prop.startsWith('--') && !/#[0-9a-f]{3,8}\b/i.test(d.value)) continue;
      const lit = d.value.match(/#[0-9a-f]{3,8}\b/gi);
      if (lit) offenders.push(`:${r.line} ${r.selector} { ${d.prop}: ${d.value} }`);
    }
  }
  assert.deepStrictEqual(offenders, [], 'a colour hex outside the Apex token blocks bypasses the accent setting:\n' + offenders.join('\n'));
  const lime = apex.filter(r => /#c3f04a/i.test(r.decls.map(d => d.value).join(' ')));
  assert.deepStrictEqual(lime.map(r => r.selector), ['.gv-app.gv-skin-apex.gv-accent-lime'], 'the mockup lime may live only in the tuned-lime block');
}
const ACCENTS = ['lime', 'volt', 'blaze', 'electric', 'punch'];
{
  /* the fill the CTA really paints, per accent, against that accent's own lime */
  const limeOf = (theme, accent) => cx.computed(cx.appChain({ theme, skin: 'apex', accent }), '--gv-lime', rules);
  const seen = new Set();
  for (const theme of ['light', 'dark']) for (const accent of ACCENTS) {
    const chain = cx.appChain({ theme, skin: 'apex', accent }, 'div.gv-hero-action', 'button.gv-btn-go');
    const fill = cx.hex(cx.paintedBackground(chain, rules).colour);
    const want = cx.hex(cx.parseColor(cx.resolveVars(limeOf(theme, accent).chain, limeOf(theme, accent).value, rules)));
    assert.strictEqual(fill, want, `${theme}/${accent}: the CTA slab paints ${fill}, the accent's own lime is ${want}`);
    if (theme === 'dark') seen.add(fill);
  }
  assert.strictEqual(seen.size, 5, 'five accents must paint five different CTA fills');
}

/* ---------- 4 ---------- */
{
  const colours = new Set();
  for (const theme of ['light', 'dark']) {
    const per = new Set();
    for (const accent of ACCENTS) {
      const chain = cx.appChain({ theme, skin: 'apex', accent }, 'div.gv-streak', 'div.gv-streak-read', 'div.gv-streak-num');
      per.add(cx.hex(cx.parseColor(cx.resolveVars(chain, cx.computed(chain, 'color', rules).value, rules))));
    }
    assert.strictEqual(per.size, 1, `${theme}: the streak number changed with the accent (${[...per]}) — amber must not be accent-tied`);
    colours.add([...per][0]);
  }
  const amber = c => { const { r, g, b } = cx.parseColor(c); return r > g && g > b && r > 140; };
  for (const c of colours) assert.ok(amber(c), `streak colour ${c} is not amber`);
}

/* ---------- 5 ---------- */
{
  /* the shared poster block and Apex's own block both declare tokens under this selector: read them as one, later wins */
  const decl = sel => Object.fromEntries(apex.filter(r => r.selector === sel).flatMap(r => r.decls).map(d => [d.prop, d.value]));
  const light = decl('.gv-app.gv-skin-apex'), dark = decl('.theme-dark .gv-app.gv-skin-apex');
  const need = ['--gv-bg', '--gv-surface', '--gv-line', '--gv-line-2', '--gv-ink', '--gv-ink-dim', '--gv-amber',
    '--gv-accent-text', '--gv-poster-chip', '--gv-poster-cell', '--gv-poster-track', '--gv-apex-hero-hi', '--gv-apex-hero-lo', '--gv-poster-sheen'];
  for (const k of need) {
    assert.ok(light[k], `Apex light is missing ${k}`);
    assert.ok(dark[k], `Apex dark is missing ${k}`);
  }
  for (const k of ['--gv-bg', '--gv-surface', '--gv-ink', '--gv-poster-sheen']) assert.notStrictEqual(light[k], dark[k], `${k} is identical in both themes — one value cannot serve both`);
  assert.strictEqual(dark['--gv-bg'].toLowerCase(), '#0a0b0d', 'dark is the mockup: graphite #0A0B0D');
}

/* ---------- 6 ---------- */
{
  const before = apex.filter(r => /::before$/.test(r.selector) && r.decls.some(d => d.prop === 'transform' && /skewX/.test(d.value)) && r.decls.some(d => d.prop === 'z-index' && d.value === '-1'));
  const slabSelectors = before.map(r => r.selector.replace(/::before$/, ''));
  const slabs = slabSelectors.filter(s => s.startsWith('.gv-app'));
  assert.ok(slabs.length >= 20, `expected the slab list, found ${slabs.length}`);
  const positioned = new Set(apex.filter(r => r.decls.some(d => d.prop === 'isolation' && d.value === 'isolate') && r.decls.some(d => d.prop === 'position' && d.value === 'relative')).map(r => r.selector));
  for (const s of slabs) assert.ok(positioned.has(s), `${s} draws a slab ::before but is not position:relative + isolation:isolate (the pseudo would paint behind the page)`);
  for (const s of slabs) {
    const declared = apex.some(r => r.selector === s && r.decls.some(d => d.prop === '--gv-slab')) ||
      apex.some(r => r.decls.some(d => d.prop === '--gv-slab') && r.selector.replace(/:(hover|focus|active)$/, '').replace(/\.(on|done|today|rest|is-beaten|gv-btn-ghost|gv-btn-danger-ghost|gv-tag-type)\b/g, '').replace(/\.theme-dark /, '') === s.replace(/\.theme-dark /, ''));
    assert.ok(declared, `${s} has a slab ::before but never names a --gv-slab fill`);
  }
  for (const r of apex) {
    const base = r.selector.replace(/:(hover|focus|active)$/, '');
    if (slabs.includes(base) && r.decls.some(d => d.prop === 'overflow' && d.value !== 'visible')) assert.fail(`${r.selector} (a slab) sets overflow:${r.decls.find(d => d.prop === 'overflow').value} and would clip its own ::before`);
  }
  assert.ok(!/\bclip-path\s*:/.test(bare), 'clip-path is banned (review linter, and it clips focus rings)');
}

/* ---------- 7 ---------- */
{
  const animated = apex.filter(r => !r.media && r.decls.some(d => d.prop === 'animation' && !/^none\b/.test(d.value)));
  assert.ok(animated.length >= 4, `expected the ticker, pulse and glow animations, found ${animated.length}`);
  const calm = new Set(apex.filter(r => r.media && /prefers-reduced-motion:\s*reduce/.test(r.media) && r.decls.some(d => d.prop === 'animation' && /^none\b/.test(d.value))).map(r => r.selector));
  for (const r of animated) assert.ok(calm.has(r.selector), `${r.selector} animates forever but has no prefers-reduced-motion rule that stops it`);
  const fills = apex.filter(r => r.media && /prefers-reduced-motion/.test(r.media) && r.decls.some(d => d.prop === 'transition' && d.value === 'none'));
  assert.ok(fills.some(r => /gv-pb-target-fill/.test(r.selector)), 'the live target fill must stop transitioning under reduced motion');
}

/* ---------- 7b. what a LOOP may animate ----------
   A loop runs for as long as the screen is open, on a phone, so each frame has to be
   free. `transform` and `opacity` are composited off the main thread; `filter`,
   `text-shadow` and `box-shadow` repaint the shadow every frame (the target halo
   drop-shadow and the 128px new-PB figure's text-shadow were exactly that). A glow
   that should pulse is a pseudo-element carrying a FIXED shadow whose opacity moves. */
{
  const keyframes = {};
  const kfRe = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = kfRe.exec(bare))) {
    let depth = 0, i = m.index + m[0].length - 1;
    const open = i;
    for (; i < bare.length; i++) { if (bare[i] === '{') depth++; else if (bare[i] === '}' && --depth === 0) break; }
    const props = new Set();
    for (const frame of bare.slice(open + 1, i).matchAll(/\{([^{}]*)\}/g)) for (const d of frame[1].split(';')) { const k = d.split(':')[0].trim(); if (k) props.add(k.toLowerCase()); }
    keyframes[m[1]] = props;
  }
  assert.ok(Object.keys(keyframes).length >= 4, 'the keyframes parsed to almost nothing');
  const LOOPABLE = new Set(['transform', 'opacity']);
  const loops = [];
  for (const r of apex) {
    for (const d of r.decls) {
      if (d.prop !== 'animation' || !/\binfinite\b/.test(d.value)) continue;
      const name = Object.keys(keyframes).find(k => new RegExp('(^|\\s)' + k + '(\\s|$)').test(d.value));
      assert.ok(name, `${r.selector} loops \`${d.value}\` but no @keyframes in the stylesheet matches it`);
      loops.push({ r, name });
      const bad = [...keyframes[name]].filter(p => !LOOPABLE.has(p));
      assert.deepStrictEqual(bad, [], `src/styles.css:${r.line} ${r.selector} loops @keyframes ${name}, which animates ${bad.join(', ')} - only transform and opacity may loop ` +
        '(put the glow on a pseudo-element with a fixed shadow and animate its opacity)');
    }
  }
  assert.ok(loops.length >= 4, `expected the ticker, CTA pulse and both glow loops, found ${loops.length}`);
  const names = new Set(loops.map(l => l.name));
  for (const n of ['gv-poster-marquee', 'gv-apex-pulse', 'gv-apex-halo', 'gv-apex-glow', 'gv-live-blink']) assert.ok(names.has(n), `the ${n} loop is no longer found by this guard`);
  /* the shadow itself is static: the loop rules that carry a glow declare no animated-property keyframes of their own */
  for (const sel of ['.theme-dark .gv-app.gv-skin-apex .gv-pb-target.is-beaten::after', '.theme-dark .gv-app.gv-skin-apex .gv-pb-new::after']) {
    const rule = apex.find(r => r.selector === sel && r.decls.some(d => d.prop === 'animation'));
    assert.ok(rule, `${sel} should carry the loop (a pseudo-element, not the element or its text)`);
  }
}

/* ---------- 8 ---------- */
{
  for (const [re, what] of [[/:has\(/, ':has()'], [/color-mix\(/, 'color-mix()'], [/\b\d+dvh\b/, 'dvh'], [/@property/, '@property'],
    [/backdrop-filter/, 'backdrop-filter'], [/\(\?<[=!]/, 'lookbehind']]) assert.ok(!re.test(bare), `${what} is not safe on the iOS 15 floor`);
  /* A :focus-visible INSIDE `@supports [not] selector(:focus-visible) { ... }` is the guard the message below asks
     for (15.0-15.3 evaluate it false and skip the block); only a bare one is the hazard. Blank the guarded blocks
     (their preludes too), then look. */
  let unguarded = bare;
  for (const g of [...bare.matchAll(/@supports\s+(?:not\s+)?selector\(\s*:focus-visible\s*\)\s*\{/g)].reverse()) {
    let depth = 0, i = g.index + g[0].length - 1;
    for (; i < unguarded.length; i++) { if (unguarded[i] === '{') depth++; else if (unguarded[i] === '}' && --depth === 0) break; }
    unguarded = unguarded.slice(0, g.index) + unguarded.slice(g.index, i + 1).replace(/[^\n]/g, ' ') + unguarded.slice(i + 1);
  }
  const focus = [...unguarded.matchAll(/([^{}]*):focus-visible[^{}]*\{/g)];
  assert.deepStrictEqual(focus.map(m => m[0]), [], 'a bare :focus-visible invalidates its whole rule on iOS 15.0-15.3; guard it with @supports selector()');
  assert.ok(!/\bcqw\b|\bcontainer-type\b|:where\(|inset:/.test(bare.slice(banner)), 'container queries, :where() and the inset shorthand are newer than the floor');
}

/* ---------- 9 ---------- */
{
  const base = rules.filter(r => r.line < bannerLine && !r.media);
  const has = c => base.some(r => r.selector.split(/[\s>]/).some(p => p === c || p.startsWith(c + '.') || p.startsWith(c + ':')));
  for (const c of ['.gv-pb-reach', '.gv-rx li.gv-rx-reach', '.gv-week-progress', '.gv-week-progress-num', '.gv-week-progress-togo', '.gv-streak-risk', '.gv-pb-target', '.gv-pb-target-label',
    '.gv-pb-target-fill', '.gv-pb-moment', '.gv-pb-moment-swap', '.gv-pb-old', '.gv-pb-new', '.gv-pb-delta', '.gv-recrow.gv-rec-new', '.gv-rec-prev', '.gv-rec-delta']) {
    assert.ok(base.some(r => r.selector.includes(c)), `${c} has no Floor/Editorial base rule — the new elements must be styled in every skin`);
  }
  const hidden = sel => rules.find(r => r.selector === sel && r.decls.some(d => d.prop === 'display' && d.value === 'none'));
  assert.ok(hidden('.gv-ticker'), 'the ticker is hidden outside Apex');
  assert.ok(rules.find(r => r.selector === '.gv-app.gv-skin-apex .gv-ticker' && r.decls.some(d => d.prop === 'display' && d.value === 'block')), 'Apex shows the ticker');
  assert.ok(hidden('.gv-app.gv-skin-apex .gv-session-records'), 'Apex hides the older record list its PB moments replace');
  assert.ok(!rules.some(r => /gv-skin-(floor|editorial)[^,]*\.gv-session-records/.test(r.selector) && r.decls.some(d => d.prop === 'display' && d.value === 'none')), 'Floor and Editorial keep the record list');
}

console.log('apex skin OK (default + three skins; Barlow Condensed embedded + credited; accents flow through tokens; amber fixed; light/dark twins; slabs well-formed; reduced motion; iOS 15 floor; new elements styled in every skin)');
