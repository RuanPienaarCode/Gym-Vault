'use strict';
/* AUDIT 16 NOV 2026, LANE STYLE: five stylesheet findings, each pinned by what the cascade actually gives.

   #16  The count-in numeral and the challenge rest clock are HOLLOW (transparent fill, 2px outline). In dark mode
        the outline took the hairline token (--gv-line-2), 1.5-1.9:1 on the page in four skins, and during a rest
        that outline is the only readout of the clock. A large numeral needs 3:1 (WCAG 1.4.11), counting the 0.85
        opacity the rule also applies. Measured for both selectors, in both chains they appear in (the full-screen
        challenge modal, and the live-set page for the count-in), across themes x skins x accents x Calm colours.
   #52  Sets mode's "next set" chips are 13px bold text under `opacity: 0.6`: 2.4:1 on light paper. Text needs 4.5:1
        on every surface the ladder can sit on (the bare page, the poster stripes, the warm/hot/peak floods of the
        zone), and the chip must still read as quieter than the current set's.
   #51  The challenge / rep-counter numeral is clamp(64px, 34vw, 320px). On a landscape iPhone (844x390, 667x375) it
        is ~290px in a ~324px zone, and the set ladder under it ends off the bottom edge. The numeral is also capped
        by the window's height inside the modal, and portrait sizes do not move.
   #50  `@media (min-width: 620px)` makes Today's tiles four columns by WINDOW width, and the poster hero title sizes
        by `vw`. In a 320-480px split-view pane (the controller puts gv-narrow on the root for that) the tiles must
        keep their narrow layout and the title must fit the pane.
   #48  Calm, live set at 375px: the top label "Exercise 1/3 · Set 1/5" (.gv-session-ord) was 4px too long for its
        slot, because Calm's own 13px .gv-btn size wins over the 11px skip buttons beside it.

   The probes are computed, not read: tests/css-cascade.js runs specificity + source order over src/styles.css.
   Set STYLE_REPORT=1 to print every measured number instead of asserting. */
const assert = require('node:assert');
const cx = require('./css-cascade.js');
const { SKINS, ACCENTS, CALM_PALETTES, POSTER_SKINS } = require('../src/constants');

/* Sibling combinators (the week header's) are refused by the cascade engine and cannot reach any probed node. */
const all = cx.load().filter(r => !/[+~]/.test(r.selector.replace(/\[[^\]]*\]/g, '')));

let failed = 0;
const REPORT = !!process.env.STYLE_REPORT;
/* assert.deepStrictEqual prints a diff of every entry; a failing list reads better as a message. */
const none = (bad, msg) => assert.ok(bad.length === 0, msg || bad.join('\n'));
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
};

const THEMES = ['dark', 'light'];
const SKIN_KEYS = SKINS.map(s => s[0]);
const ACCENT_KEYS = ACCENTS.map(a => a[0]);
/* skin x accent, plus Calm with each of its own palettes ('accent' is "Calm with the user's accent": already in the grid). */
const COMBOS = SKIN_KEYS.flatMap(skin => ACCENT_KEYS.map(accent => [skin, accent]))
  .concat(CALM_PALETTES.map(p => p[0]).filter(k => k !== 'accent').map(p => ['calm', p]));
const rootClasses = (skin, accent) => ['div.modal', 'gv-app', 'gv-skin-' + skin].concat(POSTER_SKINS.indexOf(skin) >= 0 ? ['gv-skin-poster'] : [], ['gv-accent-' + accent]);

/* body > modal-container > the modal (it wears .gv-app and the skin, src/challenge-modal.js) > contentEl > the zone. */
const modalChain = (o, zone, ...inner) => cx.chainOf([
  'body.theme-' + o.theme,
  'div.modal-container.mod-dim',
  rootClasses(o.skin, o.accent).join('.') + '.gv-repcounter-modal.gv-challenge-modal',
  'div.modal-content.gv-xp-host',
  zone || 'div.gv-rc-zone',
  ...inner,
]);
/* The live-set page: the same numeral inside the guided session's zone. */
const pageChain = (o, ...inner) => cx.appChain(o, 'div.gv-session-page', 'div.gv-session-body', 'div.gv-rc-zone.gv-session-zone', ...inner);

/* The outline colour that wins on the element: the shorthand or the longhand, whichever the cascade picks. */
function strokeColour(chain) {
  const hit = cx.declarationsFor(chain, ['-webkit-text-stroke', '-webkit-text-stroke-color'], all)[0];
  if (!hit) throw new Error('no -webkit-text-stroke on the element');
  let value = cx.resolveVars(chain, hit.decl.value, all);
  if (hit.decl.prop === '-webkit-text-stroke') value = value.replace(/^\s*[\d.]+px\s+/, '');
  const c = cx.parseColor(value);
  if (!c) throw new Error('cannot read the outline colour "' + value + '" (' + hit.rule.selector + ' line ' + hit.rule.line + ')');
  return { c, rule: hit.rule };
}
const opacityOf = chain => { const o = cx.computed(chain, 'opacity', all); return o ? Number(o.value) : 1; };
const withAlpha = (c, a) => ({ r: c.r, g: c.g, b: c.b, a: c.a * a });
const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });

/* ---------------- #16 ---------------- */
{
  const PROBES = [
    ['count-in numeral, challenge modal', (o) => modalChain(o, null, 'div.gv-rc-count.gv-rc-countin')],
    ['rest clock, challenge modal', (o) => modalChain(o, null, 'div.gv-rc-count.gv-challenge-resting')],
    ['count-in numeral, live-set page', (o) => pageChain(o, 'div.gv-rc-count.gv-session-count.gv-rc-countin')],
  ];
  check('#16 the hollow numeral outline is >= 3:1 against the page, with its opacity, in every theme x skin x accent', () => {
    const bad = [];
    let n = 0;
    for (const [name, build] of PROBES) for (const theme of THEMES) for (const [skin, accent] of COMBOS) {
      const chain = build({ theme, skin, accent });
      const bg = cx.paintedBackground(chain.slice(0, -1), all);
      const s = strokeColour(chain);
      const seen = over(withAlpha(s.c, opacityOf(chain)), bg.colour);
      const r = cx.ratio(seen, bg.colour);
      n++;
      if (REPORT) console.log(`${name.padEnd(36)} ${theme}/${skin}/${accent}`.padEnd(70) + r.toFixed(2));
      if (r < 3) bad.push(`${name} ${theme}/${skin}/${accent}: ${r.toFixed(2)}:1 (outline from line ${s.rule.line} \`${s.rule.selector}\`)`);
    }
    none(bad, `${bad.length} of ${n} measurements are under 3:1:\n` + bad.slice(0, 12).join('\n'));
  });
}

/* ---------------- #52 ---------------- */
{
  const STAGES = [null, 'warm', 'hot', 'peak'];
  const zoneFor = stage => 'div.gv-rc-zone' + (stage ? '[data-fill=' + stage + ']' : '');
  const chipChain = (o, stage, state) => modalChain(o, zoneFor(stage), 'div.gv-challenge-ladder', 'span.gv-challenge-chip.' + state);
  /* What the zone looks like behind the chip. `breathe` is the dark theme's brightest flood (rc-zone-stages.test.cjs). */
  function surfaces(o, stage) {
    const zone = modalChain(o, zoneFor(stage));
    const page = cx.paintedBackground(zone, all).colour;
    const ghost = cx.parseColor(cx.resolveVars(zone, 'var(--gv-lime-ghost)', all));
    const out = [['page', page], ['accent ghost', over(ghost, page)]];
    if (stage) {
      const colour = cx.parseColor(cx.resolveVars(zone, 'var(--gv-stage-' + stage + ')', all));
      const a = Number(cx.resolveVars(zone, 'var(--gv-stage-' + stage + '-a)', all));
      for (const base of [page, over(ghost, page)]) {
        out.push(['flood', over(withAlpha(colour, a), base)]);
        if (stage !== 'warm') out.push(['flood, breathing', over(withAlpha({ r: Math.min(255, colour.r * 1.13), g: Math.min(255, colour.g * 1.13), b: Math.min(255, colour.b * 1.13), a: 1 }, a), base)]);
      }
    }
    return out;
  }
  const textSeen = (chain, bg) => {
    const f = cx.computed(chain, 'color', all);
    const fg = cx.parseColor(cx.resolveVars(f.chain, f.value, all));
    return over(withAlpha(fg, opacityOf(chain)), bg);
  };
  check('#52 a "next set" chip is >= 4.5:1 on the page, the stripes and every stage flood, in every theme x skin x accent', () => {
    const bad = [];
    for (const theme of THEMES) for (const [skin, accent] of COMBOS) for (const stage of STAGES) {
      const o = { theme, skin, accent };
      const chain = chipChain(o, stage, 'next');
      for (const [where, bg] of surfaces(o, stage)) {
        const r = cx.ratio(textSeen(chain, bg), bg);
        if (REPORT) console.log(`chip.next ${theme}/${skin}/${accent}/${stage || 'idle'}/${where}`.padEnd(70) + r.toFixed(2));
        if (r < 4.5) bad.push(`${theme}/${skin}/${accent} stage ${stage || 'none'} on ${where}: ${r.toFixed(2)}:1`);
      }
    }
    none(bad, `${bad.length} measurements under 4.5:1:\n` + bad.slice(0, 12).join('\n'));
  });
  check('#52 a "next set" chip still reads quieter than the open set\'s chip (lighter text on the page, or a hairline border where the text is the same ink)', () => {
    const bad = [];
    for (const theme of THEMES) for (const [skin, accent] of COMBOS) for (const stage of STAGES) {
      const o = { theme, skin, accent };
      const next = chipChain(o, stage, 'next'), now = chipChain(o, stage, 'now');
      const bg = surfaces(o, stage)[0][1];
      const rn = cx.ratio(textSeen(next, bg), bg), rw = cx.ratio(textSeen(now, bg), bg);
      const border = chain => { const h = cx.declarationsFor(chain, ['border', 'border-color'], all)[0]; return cx.resolveVars(chain, h.decl.value, all).replace(/\s+/g, ' '); };
      const quieterText = rn < rw - 0.05;
      const quieterBorder = border(next) !== border(now);
      if (!quieterText && !quieterBorder) bad.push(`${theme}/${skin}/${accent}/${stage || 'none'}: text ${rn.toFixed(2)} vs ${rw.toFixed(2)}, same border`);
      if (stage === null && !quieterText) bad.push(`${theme}/${skin}/${accent}: on the bare page the next chip's text is not lighter than the open one's (${rn.toFixed(2)} vs ${rw.toFixed(2)})`);
    }
    none(bad, bad.slice(0, 12).join('\n'));
  });
}

/* ---------------- #51 ---------------- */
{
  /* Evaluate the font-size shapes this file uses: clamp(), min(), calc(), px, vw, vh. */
  const evalLen = (value, vw, vh, vars) => {
    let js = value;
    for (const k of Object.keys(vars || {})) js = js.split('var(' + k + ')').join(String(vars[k]));
    js = js.replace(/(-?[\d.]+)vw/g, '($1*' + vw + '/100)').replace(/(-?[\d.]+)vh/g, '($1*' + vh + '/100)')
      .replace(/([\d.]+)px/g, '$1').replace(/clamp\(/g, 'CLAMP(').replace(/\bmin\(/g, 'Math.min(').replace(/\bmax\(/g, 'Math.max(').replace(/calc\(/g, '(');
    // eslint-disable-next-line no-new-func
    return Function('CLAMP', '"use strict"; return (' + js + ');')((lo, mid, hi) => Math.max(lo, Math.min(mid, hi)));
  };
  const sizeIn = (chain, vw, vh) => { const f = cx.computed(chain, 'font-size', all); return evalLen(f.value, vw, vh); };
  const modal = o => modalChain(o, null, 'div.gv-rc-count');
  const page = o => pageChain(o, 'div.gv-rc-count');

  /* The zone's height is the screen less the bar (20px padding + a 44px button + 2px rule = 66px, one row above 480px
     wide) and the home-indicator inset; the stack under the numeral is the hint (10 + 16), the target line (6 + 16), the
     ladder (10 + ~26) and the count-in label (2 + 14): ~100px. The numeral has line-height 1. */
  const BAR = 66, STACK = 100;
  check('#51 at 844x390 and 667x375 the numeral plus what stacks under it fits the zone, in every skin', () => {
    const bad = [];
    for (const [vw, vh, inset] of [[844, 390, 21], [667, 375, 0], [812, 375, 21]]) {
      for (const skin of SKIN_KEYS) {
        const size = sizeIn(modal({ theme: 'light', skin, accent: 'lime' }), vw, vh);
        const zone = vh - BAR - inset;
        if (size + STACK > zone) bad.push(`${vw}x${vh} ${skin}: numeral ${size.toFixed(0)}px + ${STACK}px stack > zone ${zone}px`);
      }
    }
    none(bad, bad.join('\n'));
  });
  check('#51 portrait and desktop sizes do not change: the modal numeral equals the plain .gv-rc-count rule', () => {
    const bad = [];
    for (const [vw, vh] of [[390, 844], [430, 932], [375, 667], [320, 568], [768, 1024], [1024, 768], [1440, 900], [1280, 800]]) {
      for (const skin of SKIN_KEYS) {
        const o = { theme: 'light', skin, accent: 'lime' };
        const a = sizeIn(modal(o), vw, vh);
        const base = evalLen('clamp(64px, 34vw, 320px)', vw, vh);
        if (Math.abs(a - base) > 0.01) bad.push(`${vw}x${vh} ${skin}: ${a.toFixed(1)}px, was ${base.toFixed(1)}px`);
      }
    }
    none(bad, bad.join('\n'));
  });
  check('#51 the live-set page numeral is left alone (its own tiers size it)', () => {
    for (const skin of SKIN_KEYS) {
      const chain = page({ theme: 'light', skin, accent: 'lime' });
      const f = cx.computed(chain, 'font-size', all);
      assert.ok(!/vh/.test(f.value) || /gv-session-count/.test(f.rule.selector), `${skin}: ${f.value} from ${f.rule.selector}`);
    }
  });
}

/* ---------------- #50 ---------------- */
{
  /* A wide window: the rules the stylesheet keys to a minimum window width apply. Which are modelled here as matching. */
  const asWide = media => all.map(r => (r.media && /^@media\s*\(\s*min-width\s*:\s*(620|481)px\s*\)$/.test(r.media) ? Object.assign({}, r, { media: null }) : r));
  const wide = asWide();
  const tiles = (o, narrow, rules) => {
    const root = cx.appChain(Object.assign({ narrow }, o), 'div.gv-tiles');
    const tile = cx.appChain(Object.assign({ narrow }, o), 'div.gv-tiles', 'div.gv-tile:nth-child(2n)');
    const cols = cx.declarationsFor(root, ['grid-template-columns'], rules)[0];
    const right = cx.declarationsFor(tile, ['border-right'], rules)[0];
    return { cols: cols && cols.decl.value, right: right && right.decl.value.replace(/\s+/g, ' ') };
  };
  check('#50 in a narrow pane Today\'s tiles stay two columns whatever the window width, in every skin', () => {
    const bad = [];
    for (const theme of THEMES) for (const skin of SKIN_KEYS) {
      const t = tiles({ theme, skin, accent: 'lime' }, true, wide);
      if (/repeat\(\s*4/.test(t.cols)) bad.push(`${theme}/${skin}: columns ${t.cols}`);
      if (t.right !== '0') bad.push(`${theme}/${skin}: every second tile keeps border-right ${t.right}`);
    }
    none(bad, bad.join('\n'));
  });
  check('#50 in a pane that is not narrow the wide window still gets four columns', () => {
    for (const theme of THEMES) for (const skin of SKIN_KEYS) {
      const t = tiles({ theme, skin, accent: 'lime' }, false, wide);
      assert.ok(/repeat\(\s*4/.test(t.cols), `${theme}/${skin}: columns ${t.cols}`);
    }
  });
  check('#50 the poster hero title\'s giant first word fits a narrow pane under a wide window', () => {
    const evalSize = (chain, rules, vw, n) => {
      const hit = cx.declarationsFor(chain, ['font-size'], rules)[0];
      let js = hit.decl.value.split('var(--gv-t1-n)').join(String(n));
      js = js.replace(/(-?[\d.]+)vw/g, '($1*' + vw + '/100)').replace(/([\d.]+)px/g, '$1').replace(/clamp\(/g, 'CLAMP(').replace(/\bmin\(/g, 'Math.min(').replace(/calc\(/g, '(');
      return Function('CLAMP', '"use strict"; return (' + js + ');')((lo, mid, hi) => Math.max(lo, Math.min(mid, hi)));
    };
    const bad = [];
    for (const skin of POSTER_SKINS) for (const n of [4, 5, 6, 7, 8]) {
      const title = narrow => cx.appChain({ theme: 'light', skin, accent: 'lime', narrow }, 'div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-stage', 'h2.gv-display.gv-hero-title.is-split', 'span.gv-title-first');
      /* the size the same stylesheet gives when the WINDOW is a 320px pane: what fits the narrowest split pane */
      const fits = evalSize(title(false), all, 320, n);
      const inWide = evalSize(title(true), wide, 1024, n);
      const inWideRule = cx.declarationsFor(title(true), ['font-size'], wide)[0].rule;
      if (inWide > fits + 0.01) bad.push(`${skin} word of ${n}: ${inWide.toFixed(1)}px in a narrow pane under a 1024px window, ${fits.toFixed(1)}px fits (rule line ${inWideRule.line})`);
      /* and a phone is not touched: no wide-window rule applies at <= 480px */
      const phone = evalSize(title(true), all, 390, n), phoneOld = evalSize(title(false), all, 390, n);
      if (Math.abs(phone - phoneOld) > 0.01) bad.push(`${skin} word of ${n}: a 390px phone changed ${phoneOld.toFixed(1)} -> ${phone.toFixed(1)}px`);
    }
    none(bad, bad.join('\n'));
  });
}

/* ---------------- #48 ---------------- */
/* The label is `.gv-session-ord` (page-session.js: `Exercise 1/3 · Set 1/5`), the flexible item of the top row; the two skip
   buttons beside it are `flex: 0 0 auto`, so whatever the buttons take the label loses. Calm has no tracking and no
   upper-casing on the label (its `*` reset), so the label itself is not the lever: the buttons are. `.gv-app .gv-session-skip`
   sets 11px at (0,2,0) and Calm's `.gv-app.gv-skin-calm .gv-btn { font-size: 13px }` at (0,3,0) beat it. */
check('#48 Calm at the narrow tier gives the label at least 4px back: the skip buttons are 11px there, as in every other skin', () => {
  const skip = (skin, narrow, theme) => cx.appChain({ theme, skin, accent: 'lime', narrow }, 'div.gv-session-page', 'div.gv-session-top', 'div.gv-session-top-row', 'div.gv-session-top-extra', 'div.gv-session-skips', 'button.gv-btn.gv-btn-ghost.gv-btn-small.gv-session-skip', 'span');
  const size = chain => cx.pxOf(cx.computed(chain, 'font-size', all).value);
  /* "Set" + "Exercise": 11 characters at ~0.55em each; the width the buttons give back is that times the size they drop by. */
  const CHARS = 'SetExercise'.length;
  for (const theme of THEMES) {
    const before = size(skip('calm', false, theme)), after = size(skip('calm', true, theme));
    const saved = CHARS * 0.55 * (before - after);
    assert.ok(saved >= 4, `${theme}: Calm narrow skip buttons drop ${before}px -> ${after}px, about ${saved.toFixed(1)}px back (< 4)`);
  }
  /* Calm at a wide pane, and every other skin, are untouched. */
  assert.strictEqual(size(skip('calm', false, 'light')), 13, 'Calm at a wide pane stays 13px');
  for (const skin of ['floor', 'editorial']) for (const narrow of [false, true]) assert.strictEqual(size(skip(skin, narrow, 'light')), 11, skin + ' keeps the 11px skip buttons');
});

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('audit-1116 style css OK');
