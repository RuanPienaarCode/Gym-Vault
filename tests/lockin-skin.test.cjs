'use strict';
/* THE LOCK IN SKIN (design 07 "Lock In") — the contracts that are easy to break
   without anything visibly failing on a desktop. Lock In reuses Apex's
   mechanism (slabs, tokens) and none of its colours, so most of these are the
   Apex guards re-aimed at the `.gv-skin-lockin` section of src/styles.css.

   1  REGISTERED, NOT DEFAULT, NO JS: `lockin` is the second dropdown entry (after
      apex, which stays the default); the controller and the rep-counter modal
      apply `gv-skin-<key>` generically; picking the style never writes the accent;
      the Style description says the skin is designed around Blaze.
   2  ACCENTS FLOW: no colour literal in any Lock In rule outside its three token
      blocks (light, dark, and the Blaze tune), and no rgb()/named colour either.
      The mockup orange lives ONLY in the Blaze block. Checked again through the real
      cascade: the CTA, the primary button and the day cell each paint EACH accent's
      own lime, and black ink (never white) is what is read on it.
   3  AMBER AND EMBER ARE NOT ACCENTS: the streak sticker and the streak warning are
      the same under all five accents.
   4  LIGHT + DARK: every Lock In token has a twin; dark is the mockup's own values.
   5  SLABS: every element that draws the leaning ::before is positioned, isolated,
      names a --gv-slab, and never clips itself. No clip-path anywhere.
   6  STARBURSTS: the streak number and the PB moment each draw their star as two
      squares turned 45 degrees apart (the only way to a star without clip-path).
   7  TOUCH: every Lock In control keeps a 44px box (the drawn slab may be shorter,
      via --gv-slab-pull); the destructive 40px icon-btn-small exception is pinned.
   8  MOTION: every infinite animation animates only transform and opacity and has a
      prefers-reduced-motion stop; the stopped ticker starts on a whole word.
   9  iOS 15 FLOOR: no :has(), color-mix(), dvh, @property, backdrop-filter, lookbehind,
      inset: shorthand, container queries or bare :focus-visible in the section.
   10 THE 0.13.0 ELEMENTS are all styled; the older record list is hidden (the PB
      moments replace it); Floor/Editorial still show it; reading surfaces are untouched.
   11 EVERY RULE IS SCOPED to `.gv-app.gv-skin-lockin` (so Apex, Floor and Editorial
      cannot be touched) and colours buttons from the .gv-app ancestor.
   12 A LONG DAY NAME cannot push Start off a phone (the hero title steps down). */
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

const banner = css.indexOf('SKIN: LOCK IN');
assert.ok(banner > 0, 'SKIN: LOCK IN banner missing');
assert.ok(banner > css.indexOf('SKIN: APEX'), 'the Lock In section must come after the Apex section (its rules win ties by order)');
const bannerLine = css.slice(0, banner).split('\n').length;
const lock = rules.filter(r => r.line >= bannerLine);
const lockText = bare.slice(banner);
assert.ok(lock.length > 120, `the Lock In section parsed to almost nothing (${lock.length} rules)`);
const THEMES = ['light', 'dark'];
const ACCENTS = ['lime', 'volt', 'blaze', 'electric', 'punch'];
const decl = (r, p) => (r.decls.find(d => d.prop === p) || {}).value;
const ruleOf = sel => lock.find(r => r.selector === sel);

/* ---------- 1 ---------- */
{
  const { SKINS, DEFAULT_SETTINGS } = require('../src/constants');
  assert.strictEqual(DEFAULT_SETTINGS.skin, 'apex', 'Lock In is NOT the default: Apex stays it');
  assert.deepStrictEqual(SKINS.map(s => s[0]), ['apex', 'lockin', 'floor', 'editorial'], 'lockin is registered right after apex, nothing removed');
  assert.strictEqual(SKINS[1][1], 'Lock In — black + one hot accent, slanted slabs, giant italic type');
  /* the skin is a class the shell applies generically: no per-skin branch in the JS */
  const controller = read('src/controller.js');
  assert.ok(/classList\.add\(`gv-skin-\$\{plugin\.settings\.skin \|\| 'apex'\}`/.test(controller), 'the controller must apply gv-skin-<key> from the setting, whatever the key');
  assert.ok(!/lockin/.test(controller), 'the controller must not special-case lockin');
  assert.ok(/addClass\(`gv-skin-\$\{this\.skin\}`\)/.test(read('src/rep-counter-modal.js')), 'the rep-counter modal must apply gv-skin-<key> too');
  const tab = read('src/settings-tab.js');
  const at = tab.indexOf(".setName('Style')"), to = tab.indexOf(".setName('Accent color')");
  const style = at > 0 && to > at ? [tab.slice(at, to)] : null;
  assert.ok(style, 'the Style setting was not found');
  assert.ok(!/settings\.accent/.test(style[0]), 'picking a style must not write (or reset) the accent');
  assert.ok(/Blaze/.test(style[0]) && /Lock In/.test(style[0]), 'the Style description must say Lock In is designed around Blaze');
  assert.ok(/Lock In/.test(read('README.md')), 'README must list the Lock In style');
}

/* ---------- 2 ---------- */
const TOKEN_SEL = new Set(['.gv-app.gv-skin-lockin', '.theme-dark .gv-app.gv-skin-lockin', '.gv-app.gv-skin-lockin.gv-accent-blaze']);
{
  const offenders = [];
  for (const r of lock) {
    if (TOKEN_SEL.has(r.selector)) continue;
    for (const d of r.decls) {
      const v = d.value;
      /* rgba(0, 0, 0, 0) is "transparent" in the slab's own gradient, not a colour choice. */
      const rgb = (v.match(/rgba?\([^)]*\)/g) || []).filter(x => !/^rgba\(0,\s*0,\s*0,\s*0\)$/.test(x));
      const named = /(^|[\s,(])(white|black|red|orange|yellow|green|blue|cyan|magenta|lime|gray|grey)(?=[\s,;)]|$)/i.test(v);
      if (/#[0-9a-f]{3,8}\b/i.test(v) || rgb.length || named) offenders.push(`:${r.line} ${r.selector} { ${d.prop}: ${v} }`);
    }
  }
  assert.deepStrictEqual(offenders, [], 'a colour literal outside the Lock In token blocks bypasses the accent setting (use a token):\n' + offenders.join('\n'));

  /* the mockup's orange lives ONLY in the Blaze block, and no other accent has a block */
  const orange = lock.filter(r => /#ff4d00|#ff6b1a|#f23500/i.test(r.decls.map(d => d.value).join(' ')));
  assert.deepStrictEqual(orange.map(r => r.selector), ['.gv-app.gv-skin-lockin.gv-accent-blaze'], 'the mockup orange may live only in the Blaze tune');
  const blaze = Object.fromEntries(ruleOf('.gv-app.gv-skin-lockin.gv-accent-blaze').decls.map(d => [d.prop, d.value.toLowerCase()]));
  assert.strictEqual(blaze['--gv-lime'], '#ff4d00', 'Blaze flood is the mockup #FF4D00');
  assert.strictEqual(blaze['--gv-lime-hi'], '#ff6b1a');
  assert.strictEqual(blaze['--gv-li-lo'], '#f23500', 'the flood runs to the mockup #F23500');
  assert.ok(blaze['--gv-lime-deep'] && blaze['--gv-flood-dim'], 'Blaze must also name its deep tone (small text on paper) and flood dim');
  assert.deepStrictEqual(lock.filter(r => /gv-accent-/.test(r.selector) && !/gv-accent-blaze$/.test(r.selector)).map(r => r.selector), [], 'only Blaze is tuned: the other four accents work as picked');
  assert.ok(!/gv-skin-lockin[^{]*\{[^}]*--gv-lime:/.test(lockText.replace(/\.gv-app\.gv-skin-lockin\.gv-accent-blaze\s*\{[^}]*\}/, '')), 'no other Lock In rule may re-point --gv-lime');

  /* through the real cascade: each accent's own lime is what a primary slab paints, and BLACK ink is read on it */
  const limeOf = (theme, accent) => {
    const c = cx.appChain({ theme, skin: 'lockin', accent });
    return cx.hex(cx.parseColor(cx.resolveVars(c, cx.computed(c, '--gv-lime', rules).value, rules)));
  };
  const stock = {};
  for (const accent of ACCENTS) stock[accent] = cx.hex(cx.parseColor(cx.resolveVars(cx.appChain({ theme: 'dark', skin: 'floor', accent }), cx.computed(cx.appChain({ theme: 'dark', skin: 'floor', accent }), '--gv-lime', rules).value, rules)));
  const INK = '#0a0a0a';
  const flooded = [
    ['primary button', ['button.gv-btn', 'span']],
    ['Finish', ['div.gv-log-foot', 'button.gv-btn-finish']],
    ['Start (not on the hero)', ['div.gv-session-nextwrap', 'button.gv-btn-go']],
    /* the flood is the Today HEAD (design 07): kicker, title, sub. The list, Start and week sit on the page. */
    ['hero title', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-stage', 'h2.gv-display.gv-hero-title']],
    ['hero title: giant word', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-stage', 'h2.gv-display.gv-hero-title.is-split', 'span.gv-title-first']],
    ['hero title: outlined rest', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-stage', 'h2.gv-display.gv-hero-title.is-split', 'span.gv-title-rest']],
    ['hero sub', ['div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'p.gv-hero-sub']],
    ['done day', ['div.gv-week', 'div.gv-day.done', 'div.gv-day-name']],
    ['PB moment name', ['div.gv-session-complete', 'div.gv-pb-moment', 'h3.gv-pb-moment-name']],
    ['PB moment new value', ['div.gv-session-complete', 'div.gv-pb-moment', 'div.gv-pb-moment-swap', 'b.gv-pb-new']],
    ['newest record value', ['div.gv-card-list', 'div.gv-card.gv-recrow.gv-rec-new', 'div.gv-recrow-margin']],
    ['beaten live target', ['div.gv-pb-target.is-beaten', 'span.gv-pb-target-label']],
  ];
  const seen = new Set();
  for (const theme of THEMES) for (const accent of ACCENTS) {
    const want = limeOf(theme, accent);
    if (accent === 'blaze') assert.strictEqual(want, '#ff4d00', `${theme}: Blaze under Lock In is the mockup orange`);
    else assert.strictEqual(want, stock[accent], `${theme}/${accent}: Lock In must leave the accent exactly as picked`);
    if (theme === 'dark') seen.add(want);
    for (const [label, inner] of flooded) {
      const t = cx.textColor(cx.appChain({ theme, skin: 'lockin', accent }, ...inner), rules);
      assert.strictEqual(cx.hex(t.bg), want, `${theme}/${accent}: ${label} is painted ${cx.hex(t.bg)}, the accent's own lime is ${want}`);
      assert.strictEqual(cx.hex(t.fg), INK, `${theme}/${accent}: ${label} reads ${cx.hex(t.fg)} on the accent; it must be the near-black ink (white on the accent is never used)`);
    }
  }
  assert.strictEqual(seen.size, 5, 'five accents must paint five different floods');
  /* ...and ONLY the Today head: the list, the Start slab's row and the other pages' heroes are on the page's own colour */
  for (const theme of THEMES) for (const accent of ACCENTS) {
    const want = limeOf(theme, accent);
    for (const [label, inner] of [
      ['Today list name', ['div.gv-hero.gv-hero-today', 'ul.gv-rx', 'li', 'span']],
      ['Today BRING label', ['div.gv-hero.gv-hero-today', 'div.gv-chips.gv-today-kit', 'span.gv-kicker.gv-today-kit-label']],
      ['Running hero title', ['div.gv-hero', 'h2.gv-display.gv-hero-title']],
      ['Running hero sub', ['div.gv-hero', 'p.gv-hero-sub']]]) {
      const t = cx.textColor(cx.appChain({ theme, skin: 'lockin', accent }, ...inner), rules);
      assert.notStrictEqual(cx.hex(t.bg), want, `${theme}/${accent}: ${label} is painted on the accent flood; only the Today head floods`);
    }
  }
}

/* ---------- 3 ---------- */
{
  const star = (theme, accent) => { const c = cx.appChain({ theme, skin: 'lockin', accent }, 'div.gv-streak', 'div.gv-streak-read', 'div.gv-streak-num'); return cx.hex(cx.parseColor(cx.resolveVars(c, cx.computed(c, '--gv-slab', rules).value, rules))); };
  const risk = (theme, accent) => { const c = cx.appChain({ theme, skin: 'lockin', accent }, 'p.gv-streak-risk'); return cx.hex(cx.parseColor(cx.resolveVars(c, cx.computed(c, 'color', rules).value, rules))); };
  const amber = c => { const { r, g, b } = cx.parseColor(c); return r > g && g > b && r > 140; };
  for (const theme of THEMES) {
    for (const fn of [star, risk]) {
      const per = new Set(ACCENTS.map(a => fn(theme, a)));
      assert.strictEqual(per.size, 1, `${theme}: ${fn === star ? 'the streak sticker' : 'the streak warning'} changed with the accent (${[...per]}) — amber must not be accent-tied`);
      assert.ok(amber([...per][0]), `${[...per][0]} is not amber`);
    }
  }
  /* and nothing outside the token blocks reaches for amber/ember except the streak's own sticker/warning */
  const reach = lock.filter(r => !TOKEN_SEL.has(r.selector) && r.decls.some(d => /--gv-(amber|ember)\b/.test(d.value))).map(r => `:${r.line} ${r.selector}`);
  assert.deepStrictEqual(reach, [], 'amber and ember are the streak\'s alone (via --gv-li-star / --gv-amber-text):\n' + reach.join('\n'));
}

/* ---------- 4 ---------- */
{
  const tok = sel => Object.fromEntries(ruleOf(sel).decls.map(d => [d.prop, d.value.toLowerCase()]));
  const light = tok('.gv-app.gv-skin-lockin'), dark = tok('.theme-dark .gv-app.gv-skin-lockin');
  const need = ['--gv-bg', '--gv-surface', '--gv-line', '--gv-line-2', '--gv-ink', '--gv-ink-dim', '--gv-amber', '--gv-ember', '--gv-accent-text',
    '--gv-li-chip', '--gv-li-cell', '--gv-li-track', '--gv-li-sheen', '--gv-li-pop', '--gv-li-pop-ink', '--gv-li-pop-hover'];
  for (const k of need) {
    assert.ok(light[k], `Lock In light is missing ${k}`);
    assert.ok(dark[k], `Lock In dark is missing ${k}`);
  }
  for (const k of ['--gv-bg', '--gv-surface', '--gv-ink', '--gv-ink-dim', '--gv-li-sheen', '--gv-li-pop', '--gv-li-pop-ink', '--gv-li-chip']) assert.notStrictEqual(light[k], dark[k], `${k} is identical in both themes — one value cannot serve both`);
  const mockup = { '--gv-bg': '#0a0a0a', '--gv-surface': '#171717', '--gv-line': '#2b2b2b', '--gv-ink': '#ffffff', '--gv-ink-dim': '#a6a6a6' };
  for (const [k, v] of Object.entries(mockup)) assert.strictEqual(dark[k], v, `dark is the mockup: ${k} ${v}`);
  assert.strictEqual(light['--gv-ink-fixed'], '#0a0a0a', 'the fixed ink on every flood is the mockup black');
  assert.strictEqual(light['--gv-li-paper'], '#ffffff');
  assert.ok(!dark['--gv-li-paper'] && !dark['--gv-ink-fixed'], 'the fixed tokens are not re-pointed per theme');
  assert.ok(/barlow condensed/.test(light['--gv-display']), 'the display face is Barlow Condensed (embedded in font.css; no new font)');
  assert.strictEqual((css.match(/@font-face/g) || []).length, 0, 'no @font-face in styles.css — the faces live in src/font.css');
}

/* ---------- 5 ---------- */
let slabs = [];
{
  const before = lock.filter(r => /::before$/.test(r.selector) && r.decls.some(d => d.prop === 'transform' && /skewX/.test(d.value)) && r.decls.some(d => d.prop === 'z-index' && d.value === '-1'));
  slabs = before.map(r => r.selector.replace(/::before$/, '')).filter(s => s.startsWith('.gv-app'));
  assert.ok(slabs.length >= 20, `expected the slab list, found ${slabs.length}`);
  const positioned = new Set(lock.filter(r => r.decls.some(d => d.prop === 'isolation' && d.value === 'isolate') && r.decls.some(d => d.prop === 'position' && d.value === 'relative')).map(r => r.selector));
  for (const s of slabs) assert.ok(positioned.has(s), `${s} draws a slab ::before but is not position:relative + isolation:isolate (the pseudo would paint behind the page)`);
  for (const s of slabs) {
    const declared = lock.some(r => r.selector === s && r.decls.some(d => d.prop === '--gv-slab')) ||
      lock.some(r => r.decls.some(d => d.prop === '--gv-slab') && r.selector.replace(/:(hover|focus|active)$/, '').replace(/\.(on|done|today|rest|is-beaten|gv-btn-ghost|gv-btn-danger-ghost|gv-tag-type|gv-btn-small)\b/g, '').replace(/\.theme-dark /, '') === s.replace(/\.theme-dark /, ''));
    assert.ok(declared, `${s} has a slab ::before but never names a --gv-slab fill`);
  }
  for (const r of lock) {
    const base = r.selector.replace(/:(hover|focus|active)$/, '');
    if (slabs.includes(base) && r.decls.some(d => d.prop === 'overflow' && d.value !== 'visible')) assert.fail(`${r.selector} (a slab) sets overflow:${decl(r, 'overflow')} and would clip its own ::before`);
  }
  assert.ok(!/\bclip-path\s*:/.test(lockText), 'clip-path is banned (review linter, and it clips focus rings)');
  /* a slab element may not carry a ::before of its own for anything else */
  const starred = lock.filter(r => /^\.gv-app\.gv-skin-lockin \.gv-streak-num::/.test(r.selector));
  const pseudos = new Set(starred.map(r => r.selector.replace(/^.*(::\w+)$/, '$1')));
  assert.ok(pseudos.has('::before') && pseudos.has('::after'), 'the streak number carries the star on its ::before and ::after');
}

/* ---------- 6 ---------- */
{
  const rot = sel => { const r = lock.filter(x => x.selector === sel && x.decls.some(d => d.prop === 'transform')).pop(); assert.ok(r, `${sel} has no transform`); const m = /rotate\((-?\d+(?:\.\d+)?)deg\)/.exec(decl(r, 'transform')); assert.ok(m, `${sel} is not a rotate()`); return Number(m[1]); };
  for (const [host, a, b] of [['.gv-streak-num', '.gv-app.gv-skin-lockin .gv-streak-num::before', '.gv-app.gv-skin-lockin .gv-streak-num::after'],
    ['.gv-pb-moment-kicker', '.gv-app.gv-skin-lockin .gv-pb-moment-kicker::before', '.gv-app.gv-skin-lockin .gv-pb-moment-kicker::after'],
    /* Today's hero badge (design fidelity): the same two-squares starburst, on the hero's own sticker */
    ['.gv-badge-fig', '.gv-app.gv-skin-lockin .gv-badge-fig::before', '.gv-app.gv-skin-lockin .gv-badge-fig::after']]) {
    const d = Math.abs(rot(b) - rot(a));
    assert.strictEqual(d, 45, `${host}: the two squares of the starburst must be turned 45 degrees apart (they are ${d})`);
    for (const sel of [a, b]) {
      const r = lock.find(x => x.selector === sel && x.decls.some(d2 => d2.prop === 'background-color'));
      assert.ok(r, `${sel} must fill the square`);
      assert.strictEqual(decl(r, 'pointer-events') || (lock.find(x => x.selector === sel && x.decls.some(d2 => d2.prop === 'pointer-events')) || { decls: [] }).decls.find(d2 => d2.prop === 'pointer-events').value, 'none', `${sel} must not take a tap`);
    }
  }
  const pb = ruleOf('.gv-app.gv-skin-lockin .gv-pb-moment::after');
  assert.ok(pb && decl(pb, 'content') === "'PB'", 'the PB moment sticker is marked PB');
}

/* ---------- 7 ---------- */
{
  const PHONE = ['is-mobile', 'is-phone', 'is-ios'];
  const LOG = ['div.gv-card.gv-log-card', 'div.gv-log-sets', 'div.gv-log-set'];
  const TOUCH = [
    ['.gv-btn', ['button.gv-btn'], 'h'],
    ['.gv-btn.gv-btn-small', ['button.gv-btn.gv-btn-small'], 'h'],
    ['.gv-btn ghost small (skip / review)', ['button.gv-btn.gv-btn-ghost.gv-btn-small.gv-session-skip'], 'h'],
    ['.gv-btn.gv-btn-danger-ghost', ['button.gv-btn.gv-btn-danger-ghost'], 'h'],
    ['.gv-chip', ['button.gv-chip'], 'h'],
    ['.gv-chip.on', ['button.gv-chip.on'], 'h'],
    ['.gv-segmented-btn', ['button.gv-segmented-btn'], 'h'],
    ['.gv-btn-hero-ghost.gv-hero-manual', ['div.gv-hero', 'button.gv-btn-hero-ghost.gv-hero-manual'], 'h'],
    ['.gv-btn-go', ['div.gv-hero', 'div.gv-hero-action', 'button.gv-btn-go'], 'h'],
    ['.gv-btn-finish', ['button.gv-btn-finish'], 'h'],
    ['.gv-icon-btn', ['button.gv-icon-btn'], 'wh'],
    ['.gv-head-btn', ['div.gv-head', 'button.gv-head-btn'], 'wh'],
    ['.gv-set-done', [...LOG, 'button.gv-set-done'], 'wh'],
    ['.gv-dial-step', ['div.gv-session-page', 'button.gv-dial-step'], 'wh'],
    ['.gv-timed-play', ['div.gv-session-page', 'button.gv-timed-play'], 'wh'],
  ];
  const DELIBERATE = [['.gv-icon-btn-small', ['div.gv-card', 'button.gv-icon-btn.gv-icon-btn-small'], 40]];
  const PASSIVE = ['.gv-tag', '.gv-badge', '.gv-ex-best', '.gv-day', '.gv-tile', '.gv-logo .gv-ico', '.gv-setup-logo', '.gv-session-complete-ico', '.gv-hero-chip',
    '.gv-week-progress', '.gv-pb-target', '.gv-pb-moment', '.gv-pb-delta', '.gv-rec-delta', '.gv-recrow.gv-rec-new',
    /* rewards: drawn, never tappable (tests/rewards-css.test.cjs C6 pins that rewards-ui.js builds no control) */
    '.gv-rw-xpchip', '.gv-rw-quest', '.gv-rw-unlock'];
  const CONTROLS = ['.gv-btn', '.gv-btn-go', '.gv-btn-finish', '.gv-btn-hero-ghost', '.gv-icon-btn', '.gv-head-btn', '.gv-set-done', '.gv-dial-step', '.gv-timed-play', '.gv-chip', '.gv-segmented-btn'];
  /* TRIPWIRE: a new slab must be measured as a control or listed as passive */
  const keys = slabs.map(s => s.replace(/^\.gv-app\.gv-skin-lockin /, ''));
  const unknown = keys.filter(k => !CONTROLS.includes(k) && !PASSIVE.includes(k));
  assert.deepStrictEqual(unknown, [], 'a new Lock In slab is neither measured as a control nor listed as passive in lockin-skin.test.cjs:\n' + unknown.join('\n'));
  const unprobed = CONTROLS.filter(k => !TOUCH.some(t => t[1][t[1].length - 1].split('.').slice(1).includes(k.slice(1))));
  assert.deepStrictEqual(unprobed, [], 'these control slabs have no touch-target probe: ' + unprobed.join(', '));

  const px = v => { const m = /^(\d+(?:\.\d+)?)px$/.exec(String(v).trim()); return m ? Number(m[1]) : null; };
  const dim = (chain, longhand, min) => {
    let best = null;
    for (const prop of [longhand, min]) {
      const hit = cx.declarationsFor(chain, [prop], rules)[0];
      const v = hit ? px(hit.decl.value) : null;
      if (v !== null && (best === null || v > best.v)) best = { v, rule: hit.rule, prop };
    }
    return best;
  };
  const failures = [];
  let checked = 0;
  for (const theme of THEMES) for (const narrow of [true, false]) {
    const o = { theme, skin: 'lockin', accent: 'blaze', host: PHONE, narrow };
    const where = `phone/${theme}${narrow ? '/narrow' : ''}`;
    for (const [label, inner, axes] of TOUCH) {
      const chain = cx.appChain(o, ...inner);
      for (const [ax, longhand, min] of [['h', 'height', 'min-height'], ['w', 'width', 'min-width']]) {
        if (!axes.includes(ax)) continue;
        const got = dim(chain, longhand, min);
        checked++;
        if (!got) failures.push(`${where}  ${label}: no ${longhand}/${min} declared`);
        else if (got.v < 44) failures.push(`${where}  ${label}: ${ax === 'h' ? 'height' : 'width'} ${got.v}px (${got.prop} at src/styles.css:${got.rule.line} \`${got.rule.selector}\`) is under 44px`);
      }
      if (axes === 'wh') {
        const hit = cx.declarationsFor(chain, ['flex', 'flex-shrink'], rules)[0];
        const v = hit ? (hit.decl.prop === 'flex' ? hit.decl.value.trim().split(/\s+/)[1] : hit.decl.value.trim()) : '1';
        checked++;
        if (v !== '0') failures.push(`${where}  ${label}: flex-shrink is ${v}, so a crowded row shrinks it below 44 (set flex: 0 0 auto)`);
      }
    }
    for (const [label, inner, expect] of DELIBERATE) {
      const got = dim(cx.appChain(o, ...inner), 'height', 'min-height');
      checked++;
      if (!got || got.v !== expect) failures.push(`${where}  ${label}: expected the documented ${expect}px, got ${got ? got.v : 'none'}`);
    }
  }
  assert.deepStrictEqual(failures, [], `${failures.length} of ${checked} touch-target checks failed. Raise min-height to 44 and pull the drawn slab in with --gv-slab-pull:\n` + failures.join('\n'));
  /* a pulled-in slab never drops below a button */
  for (const r of lock) {
    const d = r.decls.find(x => x.prop === '--gv-slab-pull'), h = r.decls.find(x => x.prop === 'min-height');
    if (d && h && !r.media) assert.ok(px(h.value) - 2 * px(d.value) >= 28, `src/styles.css:${r.line} ${r.selector}: the drawn slab is ${px(h.value) - 2 * px(d.value)}px tall`);
  }
}

/* ---------- 8 ---------- */
{
  const kfs = {};
  const kfRe = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = kfRe.exec(lockText))) {
    let depth = 0, i = m.index + m[0].length - 1;
    const open = i;
    for (; i < lockText.length; i++) { if (lockText[i] === '{') depth++; else if (lockText[i] === '}' && --depth === 0) break; }
    const props = new Set();
    for (const frame of lockText.slice(open + 1, i).matchAll(/\{([^{}]*)\}/g)) for (const d of frame[1].split(';')) { const k = d.split(':')[0].trim(); if (k) props.add(k.toLowerCase()); }
    kfs[m[1]] = props;
  }
  assert.deepStrictEqual(Object.keys(kfs).sort(), ['gv-li-marquee', 'gv-li-pulse'], 'Lock In declares the ticker and the CTA pulse, and nothing else moves on its own');
  const looping = lock.filter(r => !r.media && r.decls.some(d => d.prop === 'animation' && !/^none\b/.test(d.value)));
  assert.ok(looping.length >= 2, `expected the ticker and the CTA pulse, found ${looping.length}`);
  const calm = new Set(lock.filter(r => r.media && /prefers-reduced-motion:\s*reduce/.test(r.media) && r.decls.some(d => d.prop === 'animation' && /^none\b/.test(d.value))).map(r => r.selector));
  for (const r of looping) {
    assert.ok(calm.has(r.selector), `${r.selector} animates forever but has no prefers-reduced-motion rule that stops it`);
    const v = decl(r, 'animation');
    assert.ok(/\binfinite\b/.test(v), `${r.selector}: ${v}`);
    const name = Object.keys(kfs).find(k => new RegExp('(^|\\s)' + k + '(\\s|$)').test(v));
    assert.ok(name, `${r.selector} loops \`${v}\` but no @keyframes of Lock In matches it`);
    const bad = [...kfs[name]].filter(p => p !== 'transform' && p !== 'opacity');
    assert.deepStrictEqual(bad, [], `${r.selector} loops @keyframes ${name}, which animates ${bad.join(', ')} - only transform and opacity may loop`);
  }
  /* stopped, the ticker begins on a whole word */
  const RM = /prefers-reduced-motion:\s*reduce/;
  const rm = sel => lock.find(r => r.selector === sel && r.media && RM.test(r.media));
  assert.strictEqual(decl(rm('.gv-app.gv-skin-lockin .gv-ticker > div'), 'min-width'), '0', 'reduced motion: the stopped track must not stay 200% wide');
  assert.strictEqual(decl(rm('.gv-app.gv-skin-lockin .gv-ticker span'), 'flex'), '0 0 auto', 'reduced motion: the words keep their natural width, so the first is whole');
  assert.ok(parseFloat(decl(rm('.gv-app.gv-skin-lockin .gv-ticker span'), 'padding-left')) >= 8, 'reduced motion: the first word is inset from the strip edge');
  assert.ok(lock.some(r => r.media && RM.test(r.media) && /gv-pb-target-fill/.test(r.selector) && decl(r, 'transition') === 'none'), 'the live target fill stops transitioning under reduced motion');
}

/* ---------- 9 ---------- */
{
  for (const [re, what] of [[/:has\(/, ':has()'], [/color-mix\(/, 'color-mix()'], [/\b\d+dvh\b/, 'dvh'], [/@property/, '@property'],
    [/backdrop-filter/, 'backdrop-filter'], [/\(\?<[=!]/, 'lookbehind'], [/\bcqw\b|\bcontainer-type\b|:where\(/, 'container queries / :where()'], [/(^|[;{\s])inset\s*:/, 'the inset shorthand'],
    [/:focus-visible/, 'a bare :focus-visible (invalid before iOS 15.4: it drops the whole rule)'], [/\baspect-ratio\b/, 'aspect-ratio']]) {
    assert.ok(!re.test(lockText), `${what} is not safe on the iOS 15 floor (found in the Lock In section)`);
  }
  assert.ok(!/!important/.test(lockText), '!important is flagged by the review linter');
}

/* ---------- 10 ---------- */
{
  const mentions = c => lock.some(r => r.selector.startsWith('.gv-app.gv-skin-lockin') || r.selector.startsWith('.theme-dark .gv-app.gv-skin-lockin') ? r.selector.includes(c) : false);
  for (const c of ['.gv-ticker', '.gv-pb-reach', '.gv-week-progress', '.gv-streak-risk', '.gv-pb-target', '.gv-pb-moment', '.gv-rec-new']) assert.ok(mentions(c), `${c} is not styled under Lock In`);
  assert.ok(lock.find(r => r.selector === '.gv-app.gv-skin-lockin .gv-ticker' && decl(r, 'display') === 'block'), 'Lock In shows the ticker (the base hides it)');
  assert.ok(lock.find(r => r.selector === '.gv-app.gv-skin-lockin .gv-session-records' && decl(r, 'display') === 'none'), 'Lock In hides the older record list its PB moments replace');
  assert.ok(!rules.some(r => /gv-skin-(floor|editorial)[^,]*\.gv-session-records/.test(r.selector) && decl(r, 'display') === 'none'), 'Floor and Editorial keep the record list');
  /* reading surfaces get no slab treatment */
  const READING = ['.gv-howto', '.gv-prose', '.gv-prose-list', '.markdown-rendered', '.gv-plan-intro'];
  const touched = lock.filter(r => READING.some(c => r.selector.includes(c))).map(r => `:${r.line} ${r.selector}`);
  assert.deepStrictEqual(touched, [], 'reading surfaces (plan prose, how-to, markdown) keep the calm register and are not restyled by Lock In:\n' + touched.join('\n'));
}

/* ---------- 11 ---------- */
{
  const stray = lock.filter(r => !/gv-skin-lockin/.test(r.selector)).map(r => `:${r.line} ${r.selector}`);
  assert.deepStrictEqual(stray, [], 'every Lock In rule must be scoped to .gv-skin-lockin, or it would leak into the other skins:\n' + stray.join('\n'));
  const unanchored = lock.filter(r => !/^(\.theme-dark |body\.is-phone )?\.gv-app\.gv-skin-lockin(\.gv-narrow|\.gv-accent-blaze)?($|[\s.:>])/.test(r.selector)).map(r => `:${r.line} ${r.selector}`);
  assert.deepStrictEqual(unanchored, [], 'a rule that colours a button needs the .gv-app ancestor (app.css out-ranks a bare class):\n' + unanchored.join('\n'));
  /* nothing before the banner mentions it: Apex, Floor and Editorial are byte-for-byte untouched by this skin */
  assert.ok(!/gv-skin-lockin/.test(bare.slice(0, banner)), 'no rule above the Lock In section may mention the skin');
  /* the section runs to the end of the file */
  assert.ok(!/SKIN: (APEX|EDITORIAL)/.test(css.slice(banner)), 'the Lock In section must be last');
}

/* ---------- 12 ---------- */
{
  const sel = '.gv-app.gv-skin-lockin .gv-hero-title';
  const fsOf = s => { const r = rules.find(x => x.selector === s && !x.media && x.decls.some(d => d.prop === 'font-size')); assert.ok(r, `no font-size rule for ${s}`); return decl(r, 'font-size'); };
  assert.strictEqual(fsOf(sel), 'clamp(52px, 19vw, 92px)', 'the normal title size is the one a day name fits at (a word must not break)');
  const lh = parseFloat(decl(rules.find(r => r.selector === sel && r.decls.some(d => d.prop === 'line-height')), 'line-height'));
  const heightOf = (value, vw, chars) => {
    const f = cx.pxOf(value, vw);
    const avail = vw - 2 * 12 - 2 * 16;
    return Math.round(Math.ceil(chars * 0.5 * f / avail) * f * lh + 20);
  };
  for (const vw of [320, 390]) {
    assert.ok(heightOf(fsOf(sel), vw, 95) > 300, `fixture: the uncapped title must be the problem the classes solve (${vw})`);
    assert.ok(heightOf(fsOf(sel + '.is-xlong'), vw, 95) <= 220, `${vw}px: a 95-character day name still makes a > 220px title; .is-xlong must step it down`);
    assert.ok(heightOf(fsOf(sel + '.is-long'), vw, 70) <= 220, `${vw}px: a 70-character day name still makes a > 220px title; .is-long must step it down`);
  }
  assert.ok(cx.pxOf(fsOf(sel + '.is-xlong'), 390) < cx.pxOf(fsOf(sel + '.is-long'), 390) && cx.pxOf(fsOf(sel + '.is-long'), 390) < cx.pxOf(fsOf(sel), 390), 'the three steps get smaller');
}

console.log('lockin skin OK (registered after apex, not default, no JS; accents flow through tokens, Blaze tuned to the mockup orange, black ink on every flood; amber fixed; light/dark twins; slabs + starbursts well-formed; 44px touch boxes; motion stops; iOS 15 floor; 0.13.0 elements styled; scoped; long names step down)');
