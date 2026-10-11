'use strict';
/* THE iOS-SAFETY REVIEW NOTES ON THE APEX SKIN (pre-0.13.0), kept from coming back.

   Each block below is a defect that was invisible on a desktop and written down
   by a reviewer, with the reason it slipped through:

   1 THE ARROW SELECTOR MATCHED NOTHING. dom.ico(name, cls) puts BOTH classes on
     ONE span - `<span class="gv-ico gv-pb-arrow"><svg/></span>` - and the CSS said
     `.gv-pb-arrow .gv-ico svg` (a descendant .gv-ico that never exists). The arrow
     quietly stayed at the generic 18px. The chain here is read from what
     renderComplete REALLY emits, not typed by hand, so a markup change and a
     selector change cannot drift apart again.
   2 A HOST <h3> TINTED THE NEW-PB NAME. Obsidian's bare `h3` rule (app.css,
     1.14.4 :13187) sets colour, letter-spacing, font-style and font-variant from
     the theme's --h3-* variables. The plugin's rule reset none of them, so a theme
     that colours headings coloured the exercise name in Floor and Editorial.
   4 THE NAV UNDERLINE POKED OUT OF A SCROLLER. `.gv-nav` is `overflow-x: auto`,
     which forces overflow-y to auto; a `bottom: -1px` pseudo-element on a tab made
     it 1px taller than its scrollport and the bar scrolled sideways AND nudged
     vertically.
   5 TOUCH TARGETS UNDER 44px. Apex set .gv-btn 40, .gv-btn-small 34 and .gv-chip
     38. The TOUCH box is the element's own box; the drawn slab may be shorter
     (--gv-slab-pull pulls it in), the box may not.

   (Item 3, the looping paint animations, lives in apex-skin.test.cjs beside the
   reduced-motion guard it extends.)

   Like host-input-width.test.cjs, app.css is Obsidian's proprietary file and is
   absent in CI, so the one host rule needed is restated as data below. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const cx = require('./css-cascade.js');

const root = path.join(__dirname, '..');
const SRC = path.join(root, 'src');
const rules = cx.load();
const css = fs.readFileSync(process.env.GV_STYLES_CSS || path.join(SRC, 'styles.css'), 'utf8');

/* ---------- render the REAL completion screen against a DOM stub ---------- */
const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false },
};
const origLoad = Module._load;
Module._load = (req, ...rest) => {
  if (req === 'obsidian') return stub;
  if (req === './motion-source') return { motionAvailable: () => false, startMotionCounter: async () => () => {} };
  if (req === './page-log') return { buildRows: () => [], finishSession: () => {}, keepDraft: () => {} };
  return origLoad(req, ...rest);
};
const mkNode = tag => {
  const node = {
    tagName: tag, nodeType: 1, className: '', children: [], attrs: {},
    style: { setProperty() {}, removeProperty() {} },
    classList: {
      add(...c) { node.className = (node.className + ' ' + c.join(' ')).trim(); },
      remove() {}, toggle() {}, contains: c => node.className.split(' ').includes(c),
    },
    setAttribute(k, v) { node.attrs[k] = v; },
    addEventListener() {}, click() {},
    append(...kids) { node.children.push(...kids.flat().filter(Boolean)); },
    querySelector: () => null, insertBefore() {}, remove() {}, removeChild() {},
  };
  return node;
};
global.document = {
  createElement: mkNode, createTextNode: t => ({ nodeType: 3, text: String(t) }),
  addEventListener() {}, removeEventListener() {}, visibilityState: 'visible',
};
global.window = global.window || { setInterval: () => 1, clearInterval: () => {}, setTimeout, clearTimeout };
const { renderComplete } = require(path.join(SRC, 'page-session'));
Module._load = origLoad;

const ctx = { view: null, settings: {}, data: { goals: [] }, state: {}, app: {}, nav() {} };
const draft = { startedAt: Date.now() - 600000, entries: [{ sets: [{ done: true, touched: true, reps: '14' }] }] };
const page = mkNode('main');
renderComplete(ctx, page, draft, { records: [{ key: 'Dips/reps', exercise: 'Dips', kind: 'reps', val: '14', prev: 12 }], goalCount: 0, muted: true, completionCelebrated: true, confettiStop: null });

/* the element chain (outermost first, below main.gv-page) down to the first node `pick` accepts */
const classesOf = n => String(n.className).split(/\s+/).filter(Boolean);
function pathTo(pick) {
  const walk = (n, trail) => {
    for (const k of n.children || []) {
      if (!k || k.nodeType !== 1) continue;
      const here = trail.concat(k);
      if (pick(k)) return here;
      const hit = walk(k, here);
      if (hit) return hit;
    }
    return null;
  };
  return walk(page, []);
}
const specOf = n => String(n.tagName).toLowerCase() + classesOf(n).map(c => '.' + c).join('');

const THEMES = ['light', 'dark'];
const SKINS = ['floor', 'editorial', 'apex', 'lockin'];

/* ---------- 1. the arrow's size lands on the emitted <svg> ---------- */
{
  const trail = pathTo(n => classesOf(n).includes('gv-pb-arrow'));
  assert.ok(trail, 'fixture: a record with an old value renders .gv-pb-arrow');
  const arrow = trail[trail.length - 1];
  assert.deepStrictEqual(classesOf(arrow).sort(), ['gv-ico', 'gv-pb-arrow'],
    'ico() puts BOTH classes on one span: the selector must not expect a nested .gv-ico');
  const want = { floor: 26, editorial: 26, apex: 30, lockin: 30 };
  let n = 0;
  for (const theme of THEMES) for (const skin of SKINS) {
    /* the svg Obsidian's setIcon appends inside the span */
    const chain = cx.appChain({ theme, skin }, ...trail.map(specOf), 'svg');
    for (const prop of ['width', 'height']) {
      const hit = cx.declarationsFor(chain, [prop], rules)[0];
      assert.ok(hit, `${theme}/${skin}: no ${prop} rule reaches the arrow's svg`);
      assert.strictEqual(hit.decl.value, `${want[skin]}px`,
        `${theme}/${skin}: the arrow's svg ${prop} resolves to ${hit.decl.value} from src/styles.css:${hit.rule.line} \`${hit.rule.selector}\`, expected ${want[skin]}px ` +
        '(the 18px generic icon rule wins when the arrow selector matches nothing)');
      n++;
    }
  }
  assert.strictEqual(n, 16);
}

/* ---------- 2. the host's bare h3 cannot colour or space the name ---------- */
const HOST_H3 = {
  from: 'Obsidian 1.14.4 app.css:13187 (`h3, .markdown-rendered h3`)',
  rules: [{
    selector: 'h3', line: 13187, media: null,
    decls: [
      { prop: 'font-variant', value: 'var(--h3-variant)' },
      { prop: 'letter-spacing', value: 'var(--h3-letter-spacing)' },
      { prop: 'color', value: 'var(--h3-color)' },
      { prop: 'font-style', value: 'var(--h3-style)' },
    ],
  }],
  props: ['color', 'letter-spacing', 'font-style', 'font-variant'],
};
{
  const trail = pathTo(n => classesOf(n).includes('gv-pb-moment-name'));
  assert.ok(trail, 'fixture: the moment renders its exercise name');
  assert.strictEqual(String(trail[trail.length - 1].tagName).toLowerCase(), 'h3', 'the name is the <h3> the host rule is aimed at');
  /* the encoding bites: with no plugin rules at all, the host wins every property */
  const bare = cx.appChain({ theme: 'light', skin: 'floor' }, ...trail.map(specOf));
  for (const prop of HOST_H3.props) {
    const hit = cx.declarationsFor(bare, [prop], [], HOST_H3.rules)[0];
    assert.ok(hit && hit.rule.host, `fixture: the host h3 rule should reach ${prop}`);
  }
  const bad = [];
  for (const theme of THEMES) for (const skin of SKINS) {
    const chain = cx.appChain({ theme, skin }, ...trail.map(specOf));
    for (const prop of HOST_H3.props) {
      const hit = cx.declarationsFor(chain, [prop], rules, HOST_H3.rules)[0];
      if (!hit || hit.rule.host) bad.push(`${theme}/${skin}: ${prop} is set by the HOST h3 rule (${HOST_H3.from})`);
    }
  }
  assert.deepStrictEqual(bad, [], 'a theme\'s --h3-* variables would restyle the new-PB name; reset it on .gv-pb-moment-name:\n' + bad.join('\n'));
  /* Apex's lean comes from the embedded faces, which are ALL italic: the
     reset's `font-style: normal` still selects them, because a family with only
     italic faces has nothing else to pick. If a roman face is ever added, Apex
     must say `font-style: italic` itself. */
  const fontCss = fs.readFileSync(path.join(SRC, 'font.css'), 'utf8');
  const faces = fontCss.match(/@font-face\s*\{[^}]*'Barlow Condensed'[^}]*\}/g) || [];
  assert.ok(faces.length >= 2, 'fixture: the Barlow Condensed faces are embedded');
  for (const f of faces) assert.ok(/font-style:\s*italic/.test(f), 'every embedded Barlow face is italic');
}

/* ---------- 4. nothing in the scrolling nav pokes out of it ---------- */
{
  const navPseudos = rules.filter(r => /\.gv-nav(-btn)?\b/.test(r.selector) && /::?(before|after)\b/.test(r.selector));
  assert.ok(navPseudos.some(r => /gv-skin-apex .gv-nav-btn\.on::after/.test(r.selector)), 'fixture: the Apex active-tab bar is a nav pseudo-element');
  const negative = [];
  for (const r of navPseudos) for (const d of r.decls) {
    if (['top', 'right', 'bottom', 'left'].includes(d.prop) && /(^|[\s(])-\s*[\d.]/.test(d.value)) negative.push(`src/styles.css:${r.line} ${r.selector} { ${d.prop}: ${d.value} }`);
  }
  assert.deepStrictEqual(negative, [],
    '.gv-nav is overflow-x:auto, which makes overflow-y auto too: a pseudo-element with a negative offset makes the bar scroll by that much.\n' + negative.join('\n'));
}

/* ---------- 5. every interactive Apex slab has a >= 44px touch box ---------- */
{
  const PHONE = ['is-mobile', 'is-phone', 'is-ios'];
  const LOG = ['div.gv-card.gv-log-card', 'div.gv-log-sets', 'div.gv-log-set'];
  /* [label, inner chain, which dimensions must reach 44] */
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
  /* Slabs that are not controls. */
  const PASSIVE = ['.gv-tag', '.gv-badge', '.gv-ex-best', '.gv-day', '.gv-tile', '.gv-logo .gv-ico', '.gv-setup-logo', '.gv-session-complete-ico', '.gv-hero-chip-row',
    '.gv-week-progress', '.gv-pb-target', '.gv-pb-moment', '.gv-pb-delta', '.gv-rec-delta', '.gv-recrow.gv-rec-new',
    /* the live set's "Move n of N" chip and its "Tap to count" chip: labels, not controls */
    '.gv-live-chip', '.gv-rc-tapchip'];
  /* Deliberately under 44, with the reason the stylesheet gives: row-level
     remove buttons are destructive and sit beside content you scroll past. */
  const DELIBERATE = [['.gv-icon-btn-small', ['div.gv-card', 'button.gv-icon-btn.gv-icon-btn-small'], 40]];

  /* TRIPWIRE: a new slab must be classed as a control (and so measured) or as passive. */
  const slabKeys = rules.filter(r => /^\.gv-app\.gv-skin-apex .*::before$/.test(r.selector)
    && r.decls.some(d => d.prop === 'transform' && /skewX/.test(d.value)) && r.decls.some(d => d.prop === 'z-index' && d.value === '-1'))
    .map(r => r.selector.replace(/^\.gv-app\.gv-skin-apex /, '').replace(/::before$/, ''));
  assert.ok(slabKeys.length >= 20, 'the slab list parsed to almost nothing');
  const CONTROLS = ['.gv-btn', '.gv-btn-go', '.gv-btn-finish', '.gv-btn-hero-ghost', '.gv-icon-btn', '.gv-head-btn', '.gv-set-done', '.gv-dial-step', '.gv-timed-play', '.gv-chip', '.gv-segmented-btn'];
  const unknown = slabKeys.filter(k => !CONTROLS.includes(k) && !PASSIVE.includes(k));
  assert.deepStrictEqual(unknown, [], 'a new Apex slab is neither measured as a control nor listed as passive in apex-review-notes.test.cjs:\n' + unknown.join('\n'));
  /* every control slab is actually probed by some TOUCH entry (its class is on that entry's element) */
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
    const o = { theme, skin: 'apex', accent: 'lime', host: PHONE, narrow };
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
    }
    /* A fixed-size control in a crowded flex row (the session header) must not be squeezed under 44 by it:
       the declared width is only the CEILING unless flex-shrink is 0. */
    for (const [label, inner, axes] of TOUCH) {
      if (axes !== 'wh') continue;
      const hit = cx.declarationsFor(cx.appChain(o, ...inner), ['flex', 'flex-shrink'], rules)[0];
      const v = hit ? (hit.decl.prop === 'flex' ? hit.decl.value.trim().split(/\s+/)[1] : hit.decl.value.trim()) : '1';
      checked++;
      if (v !== '0') failures.push(`${where}  ${label}: flex-shrink is ${v === undefined ? 'default 1' : v}, so a crowded row shrinks it below its 44px (set flex: 0 0 auto)`);
    }
    for (const [label, inner, expect] of DELIBERATE) {
      const got = dim(cx.appChain(o, ...inner), 'height', 'min-height');
      checked++;
      if (!got || got.v !== expect) failures.push(`${where}  ${label}: expected the documented ${expect}px, got ${got ? got.v : 'none'} - if this is now 44, delete the exception`);
    }
  }
  assert.deepStrictEqual(failures, [],
    `${failures.length} of ${checked} touch-target checks failed. Raise the element's min-height to 44 and, if the drawn slab should stay shorter, ` +
    'pull it in with --gv-slab-pull (see the Apex slab rules):\n' + failures.join('\n'));

  /* The inset is only legitimate if it never eats more than the box can spare:
     a drawn slab under 28px would be a sliver, not a button. */
  const insets = [];
  for (const r of rules) {
    const d = r.decls.find(x => x.prop === '--gv-slab-pull');
    const h = r.decls.find(x => x.prop === 'min-height');
    if (d && h && !r.media && /gv-skin-apex/.test(r.selector)) insets.push({ r, drawn: px(h.value) - 2 * px(d.value) });
  }
  assert.ok(insets.length >= 4, 'fixture: the Apex controls that draw a shorter slab than their box name --gv-slab-pull');
  for (const { r, drawn } of insets) assert.ok(drawn >= 28, `src/styles.css:${r.line} ${r.selector}: the drawn slab is ${drawn}px tall`);
}

/* ---------- 9. a short phone gets a compact target ----------
   The runtime proof (375x667 and a host-bars-off 560px, reps and hold, both themes) is
   in the harness: _preview/apex-progress.html. What a stylesheet guard CAN pin is that the
   compact rule exists, is height-keyed (iOS 15 supports max-height), and really is smaller
   than the full-size target it replaces - so it cannot be deleted or emptied unnoticed. */
{
  const decl = (r, p) => (r.decls.find(d => d.prop === p) || {}).value;
  /* the rule for `sel` (inside the short-phone media block, or outside any) that DECLARES `prop` */
  const find = (sel, media, prop) => rules.find(r => r.selector === sel && (media ? r.media && media.test(r.media) : !r.media) && r.decls.some(d => d.prop === prop));
  const SHORT = /^@media\s*\(max-height:\s*7\d\dpx\)$/;
  const vert = v => { const t = String(v).trim().split(/\s+/).map(x => parseFloat(x)); const top = t[0], bot = t.length >= 3 ? t[2] : t[0]; return top + bot; };
  const sel = '.gv-app.gv-skin-apex .gv-pb-target';
  const full = find(sel, null, 'padding'), compact = find(sel, SHORT, 'padding');
  assert.ok(compact, 'no @media (max-height: 7xxpx) rule compacts the Apex .gv-pb-target');
  assert.ok(vert(decl(compact, 'padding')) + vert(decl(compact, 'margin')) <= vert(decl(full, 'padding')) + vert(decl(find(sel, null, 'margin'), 'margin')) - 16,
    'the compact target must give back at least 16px of vertical padding+margin');
  const maxOf = v => Math.max(...(String(v).match(/\d+(\.\d+)?px/g) || []).map(parseFloat));
  const label = '.gv-app.gv-skin-apex .gv-pb-target-label';
  assert.ok(maxOf(decl(find(label, SHORT, 'font-size'), 'font-size')) <= maxOf(decl(find(label, null, 'font-size'), 'font-size')) - 8, 'the compact label is a real step down in size');
  const bar = '.gv-app.gv-skin-apex .gv-pb-target-bar';
  assert.ok(parseFloat(decl(find(bar, SHORT, 'height'), 'height')) < parseFloat(decl(find(bar, null, 'height'), 'height')), 'the compact bar is thinner');
  /* nothing in the short-phone block may restyle colour or reintroduce an animation */
  for (const r of rules.filter(r => r.media && SHORT.test(r.media) && /gv-skin-apex/.test(r.selector))) {
    for (const d of r.decls) assert.ok(!/^(color|animation|filter|box-shadow|text-shadow|background)/.test(d.prop), `${r.selector}: the short-phone block only resizes (found ${d.prop})`);
  }
}

/* ---------- 10. the Apex hero title cannot push Start off a phone ----------
   A day name is user text. At the Apex size (19vw, 92px cap) a 95-character name wrapped
   to ten lines and put Start at y=1102 on an 844px screen. page-dashboard.js adds
   .is-long / .is-xlong by length (pinned in today-apex-progress.test.cjs); this checks the
   CSS those classes select. The line count is a MODEL (an average glyph of 0.5em in the
   condensed face, calibrated against the browser harness: a 95-character name at 390px
   wraps to 5 lines at 35.9px), so it is a tripwire for a deleted or no-op rule, not a
   layout oracle - the runtime pass in the harness is the oracle. */
{
  const sel = '.gv-app.gv-skin-apex .gv-hero-title';
  const size = (s) => (rules.find(r => r.selector === s && !r.media && r.decls.some(d => d.prop === 'font-size')) || {}).decls;
  const fsOf = s => { const d = size(s); assert.ok(d, `no font-size rule for ${s}`); return d.find(x => x.prop === 'font-size').value; };
  assert.strictEqual(fsOf(sel), 'clamp(52px, 19vw, 92px)', 'the normal Apex hero size is the mockup\'s and must not be capped for ordinary names');
  const lh = parseFloat(rules.find(r => r.selector === sel && r.decls.some(d => d.prop === 'line-height')).decls.find(d => d.prop === 'line-height').value);
  const heightOf = (value, vw, chars) => {
    const fs = cx.pxOf(value, vw);
    const avail = vw - 2 * 12 - 2 * 16;          /* narrow page gutter, hero padding */
    const lines = Math.ceil(chars * 0.5 * fs / avail);
    return Math.round(lines * fs * lh + 20);      /* + the leaning bar and its margin */
  };
  for (const vw of [320, 390]) {
    const unmanaged = heightOf(fsOf(sel), vw, 95);
    const managed = heightOf(fsOf(sel + '.is-xlong'), vw, 95);
    assert.ok(unmanaged > 300, `fixture: the uncapped title must be the problem the classes solve (${unmanaged}px at ${vw})`);
    assert.ok(managed <= 220, `${vw}px: a 95-character day name still makes a ~${managed}px title (> 220); .is-xlong must step it down`);
    const mid = heightOf(fsOf(sel + '.is-long'), vw, 70);
    assert.ok(mid <= 220, `${vw}px: a 70-character day name makes a ~${mid}px title (> 220); .is-long must step it down`);
  }
  assert.ok(cx.pxOf(fsOf(sel + '.is-long'), 390) < cx.pxOf(fsOf(sel), 390), '.is-long is smaller than the normal title');
  assert.ok(cx.pxOf(fsOf(sel + '.is-xlong'), 390) < cx.pxOf(fsOf(sel + '.is-long'), 390), '.is-xlong is smaller than .is-long');
}

/* ---------- 11. History rows keep their actions inside the card ----------
   `.gv-session-when { flex: 0 0 auto }` let a long "Day · Plan" string (the user's own text,
   288px at 390) take its full width, so the summary wrapped to four lines and the delete
   button landed at x=416 on a 390px phone, clipped by .gv-session-card's overflow:hidden.
   The rule that matters is structural: the actions never shrink, the two text blocks may,
   and a flex item only can if it also lifts its automatic min-width. */
{
  const flexOf = (chain) => {
    const f = cx.declarationsFor(chain, ['flex', 'flex-shrink'], rules)[0];
    if (!f) return { shrink: 1 };
    return { shrink: Number(f.decl.prop === 'flex' ? (f.decl.value.trim().split(/\s+/)[1] || 1) : f.decl.value) };
  };
  const minW = chain => { const h = cx.declarationsFor(chain, ['min-width'], rules)[0]; return h ? h.decl.value : 'auto'; };
  for (const theme of THEMES) for (const skin of SKINS) {
    const head = ['div.gv-card.gv-session-card', 'div.gv-session-head'];
    const at = (...inner) => cx.appChain({ theme, skin }, ...head, ...inner);
    const where = `${theme}/${skin}`;
    assert.strictEqual(flexOf(at('div.gv-card-actions')).shrink, 0, `${where}: the history row's actions must not shrink (flex: 0 0 auto)`);
    for (const cls of ['div.gv-session-when', 'div.gv-session-meta']) {
      assert.ok(flexOf(at(cls)).shrink > 0, `${where}: ${cls} must be allowed to shrink, or a long day/plan name pushes the actions out of the card`);
      assert.strictEqual(minW(at(cls)), '0', `${where}: ${cls} needs min-width: 0, or its content width stops it shrinking`);
    }
  }
}

/* ---------- 12. a switch's thumb is visible against its own track ----------
   Guided setup recolours an ON switch's track to --gv-ink (one flood per screen) and the
   thumb stayed --gv-ink-fixed: ink on ink in light, so an enabled switch read as a plain
   dark bar. The thumb is a ::after, which the cascade engine never matches, so the pseudo
   rules are fed to it as plain element rules (selector minus ::after) - the same cascade,
   the thumb treated as the element that carries the declaration. Needs 3:1 (1.4.11). */
{
  const thumbRules = rules.filter(r => /\.gv-switch[^\s]*::after$/.test(r.selector) && !r.media)
    .map(r => Object.assign({}, r, { selector: r.selector.replace(/::after$/, '') }));
  assert.ok(thumbRules.length >= 3, 'fixture: the switch thumb rules parsed');
  const ctxs = [['guided setup', ['div.gv-guidesetup', 'div.gv-card.gv-optrow']], ['settings / elsewhere', ['div.gv-card.gv-optrow']]];
  const bad = [];
  let n = 0;
  for (const theme of THEMES) for (const skin of SKINS) for (const accent of ['lime', 'volt', 'blaze', 'electric', 'punch']) {
    for (const [label, ctxChain] of ctxs) for (const on of [true, false]) {
      const chain = cx.appChain({ theme, skin, accent }, ...ctxChain, `span.gv-switch${on ? '.on' : ''}`);
      const track = cx.paintedBackground(chain, rules).colour;
      const hit = cx.declarationsFor(chain, ['background', 'background-color'], thumbRules)[0];
      assert.ok(hit, `${label}: no thumb colour for ${on ? 'on' : 'off'}`);
      const thumb = cx.parseColor(cx.resolveVars(chain, hit.decl.value, rules));
      const r = cx.ratio(thumb, track);
      n++;
      if (r < 3) bad.push(`${theme}/${skin}/${accent} ${label} ${on ? 'ON' : 'off'}: thumb ${cx.hex(thumb)} on track ${cx.hex(track)} = ${r.toFixed(2)}:1 (src/styles.css:${hit.rule.line} \`${hit.rule.selector}::after\`)`);
    }
  }
  assert.deepStrictEqual(bad, [], `${bad.length} of ${n} switch thumb/track pairs under 3:1 (first 8):\n` + bad.slice(0, 8).join('\n'));
}

/* ---------- 13. a full-bleed bar bleeds by the page's REAL padding ----------
   `.gv-session-top` pulled out by a literal -18px inside a narrow page padded 12px: 6px past the
   viewport on the live, rest and complete screens, so the page scrolled sideways. Whatever a
   bar pulls out by on a side must equal what the page pads that side by, at every combination
   the app can be in (phone host or not, narrow pane or not). */
{
  const sideOf = (chain, props, side) => {
    /* the winning declaration among the shorthand and the side longhand; a shorthand is read as top/right/bottom/left */
    const hit = cx.declarationsFor(chain, props.concat([props[0] + '-' + side]), rules)[0];
    assert.ok(hit, `${props[0]}-${side} is declared nowhere for ${chain[chain.length - 1].tag}`);
    if (hit.decl.prop !== props[0]) return cx.resolveVars(chain, hit.decl.value, rules);
    const resolved = cx.resolveVars(chain, hit.decl.value, rules);
    const t = resolved.replace(/calc\(\s*-1\s*\*\s*([^)]+)\)/g, (_m, x) => '-' + x.trim()).trim().split(/\s+/);
    const [a, b = a, c = a, d = b] = t;
    return { top: a, right: b, bottom: c, left: d }[side];
  };
  const bad = [];
  let n = 0;
  for (const theme of THEMES) for (const skin of SKINS) for (const host of [[], ['is-phone', 'is-mobile', 'is-ios']]) for (const narrow of [true, false]) {
    const o = { theme, skin, host, narrow };
    const where = `${theme}/${skin}${host.length ? '/phone' : ''}${narrow ? '/narrow' : ''}`;
    const page = cx.appChain(o);
    for (const [label, inner] of [['.gv-session-top', ['div.gv-session-page', 'div.gv-session-top']]]) {
      const chain = cx.appChain(o, ...inner);
      for (const side of ['left', 'right']) {
        const bleed = -parseFloat(sideOf(chain, ['margin'], side));
        const pad = parseFloat(String(sideOf(page, ['padding'], side)).replace(/^calc.*$/, 'NaN'));
        n++;
        if (bleed !== pad) bad.push(`${where}: ${label} pulls out ${bleed}px on the ${side}, the page pads ${pad}px`);
      }
    }
  }
  assert.deepStrictEqual(bad, [], `${bad.length} of ${n} bleed checks failed (first 8):\n` + bad.slice(0, 8).join('\n'));
}

/* ---------- 14. the rep-counter modal's bar wraps instead of clipping its close X ----------
   Seven controls (motion, mute, help, type, undo, done, close) are ~400px at the 44px touch
   size in a 366px phone bar; the close X, last in the row, hung 12px off-screen. The cascade
   engine skips @media, so this reads the rules directly: the bar may wrap, and on a phone-width
   modal the X is ordered ahead of the other controls so it stays beside the label on the top
   row. (The runtime proof at 320/375/390 is in the harness; this keeps the rules from being
   deleted or reversed.) */
{
  const base = rules.find(r => r.selector === '.gv-rc-bar' && !r.media && r.decls.some(d => d.prop === 'flex-wrap'));
  assert.ok(base && base.decls.find(d => d.prop === 'flex-wrap').value === 'wrap', '.gv-rc-bar must wrap (flex-wrap: wrap)');
  const NARROW = /^@media\s*\(max-width:\s*(4[0-9]\d|5[0-9]\d)px\)$/;
  const inNarrow = sel => rules.find(r => r.selector === sel && r.media && NARROW.test(r.media));
  const decl = (r, p) => r && (r.decls.find(d => d.prop === p) || {}).value;
  assert.strictEqual(decl(inNarrow('.gv-rc-controls'), 'display'), 'contents', 'on a phone-width modal the controls join the bar\'s wrapping');
  const x = inNarrow('.gv-rc-controls > .gv-icon-btn[aria-label="Cancel"]'), others = inNarrow('.gv-rc-controls > *');
  assert.ok(x && others, 'the close X and the other controls are ordered on a phone-width modal');
  assert.ok(Number(decl(x, 'order')) < Number(decl(others, 'order')), 'the close X sorts BEFORE the other controls, so it stays on the label\'s row');
  const label = decl(inNarrow('.gv-rc-label'), 'flex');
  assert.ok(/calc\(100%\s*-\s*\d+px\)/.test(label || ''), 'the label takes the top row apart from the X (else the other controls fill it)');
  /* and the code still builds the X as the aria-labelled control the selector names */
  assert.ok(/aria-label': 'Cancel'/.test(fs.readFileSync(path.join(SRC, 'rep-counter-modal.js'), 'utf8')), 'the modal\'s close button must keep aria-label "Cancel" (the order rule keys on it)');
}

/* ---------- 15. a focused set box looks different from an idle one ----------
   `.gv-app.gv-skin-apex .gv-set-input { border-color }` ties `.gv-set-input:focus` on
   specificity (0,3,0) and comes later, so it silently won: no focus state at all. Read
   from the cascade, per skin and theme: the border colour or the box-shadow the FOCUSED
   box wins must differ from the idle one's. */
{
  const borderColour = chain => {
    const hit = cx.declarationsFor(chain, ['border-color', 'border-bottom-color', 'border', 'border-bottom'], rules)[0];
    if (!hit) return null;
    const v = cx.resolveVars(chain, hit.decl.value, rules);
    const tok = v.trim().split(/\s+(?![^(]*\))/).filter(t => cx.parseColor(t));
    return tok.length ? cx.hex(cx.parseColor(tok[tok.length - 1])) : v;
  };
  const shadow = chain => { const h = cx.declarationsFor(chain, ['box-shadow'], rules)[0]; return h && !/^none$/.test(h.decl.value.trim()) ? cx.resolveVars(chain, h.decl.value, rules) : 'none'; };
  const bad = [];
  let n = 0;
  for (const theme of THEMES) for (const skin of SKINS) for (const accent of ['lime', 'volt', 'blaze', 'electric', 'punch']) {
    const idle = cx.appChain({ theme, skin, accent }, 'div.gv-card.gv-log-card', 'div.gv-log-sets', 'div.gv-log-set', 'input.gv-set-input[type=text]');
    const focus = cx.appChain({ theme, skin, accent }, 'div.gv-card.gv-log-card', 'div.gv-log-sets', 'div.gv-log-set', 'input.gv-set-input[type=text]:focus');
    n++;
    if (borderColour(idle) === borderColour(focus) && shadow(idle) === shadow(focus)) bad.push(`${theme}/${skin}/${accent}: focused border ${borderColour(focus)} / shadow ${shadow(focus)} is the same as idle`);
  }
  assert.deepStrictEqual(bad, [], `${bad.length} of ${n} skin/theme/accent combinations show no focus state on a set box (first 6):\n` + bad.slice(0, 6).join('\n'));
}

/* ---------- 16. the "Active plan" link has a 44px touch box ----------
   It is a 13-14px-tall text link in the Today kicker. The box is a transparent ::before that
   extends it 16px up and down (the engine cannot size a pseudo-element, so the rule is read
   directly): the link keeps its look and its line, and a thumb gets 44px. */
{
  const own = rules.find(r => r.selector === '.gv-app .gv-planswap' && r.decls.some(d => d.prop === 'position'));
  assert.ok(own && own.decls.find(d => d.prop === 'position').value === 'relative', '.gv-planswap must be positioned to anchor its touch box');
  const pseudo = rules.find(r => r.selector === '.gv-planswap::before');
  assert.ok(pseudo, 'the planswap touch-box pseudo-element rule is missing');
  const d = Object.fromEntries(pseudo.decls.map(x => [x.prop, x.value]));
  assert.ok(Number(own.decls.find(x => x.prop === 'z-index') && own.decls.find(x => x.prop === 'z-index').value) >= 1, 'the link needs a z-index: the positioned title below it would otherwise paint over (and swallow taps on) the touch box');
  assert.strictEqual(d.position, 'absolute');
  assert.ok(d.content === "''" || d.content === '""', 'a pseudo-element needs content to exist');
  const up = -parseFloat(d.top), down = -parseFloat(d.bottom);
  assert.ok(up >= 16 && down >= 16, `the touch box reaches only ${up}px above / ${down}px below the 13-14px link: 13 + 16 + 16 is the 44px floor`);
  assert.notStrictEqual(d['pointer-events'], 'none', 'the touch box must receive the tap');
  assert.ok(!/overflow:\s*hidden/.test(rules.filter(r => r.selector === '.gv-kicker').map(r => r.decls.map(x => x.prop + ':' + x.value).join(';')).join(';')), 'a kicker that clips overflow would clip the touch box');
}

/* ---------- 17. three Apex spacing nits ----------
   (a) stopped by reduced motion the ticker's track began mid-word ("OCK IN"): its spans are
   centring flex items of a 200%-wide track, so stopped it must be natural-width and
   left-aligned; (b) the Start slab touched the Equipment label under it; (c) the Running
   stat tiles touched the week list above them. */
{
  const decl = (r, p) => r && (r.decls.find(d => d.prop === p) || {}).value;
  const RM = /prefers-reduced-motion:\s*reduce/;
  const rm = sel => rules.find(r => r.selector === sel && r.media && RM.test(r.media));
  assert.strictEqual(decl(rm('.gv-app.gv-skin-apex .gv-ticker > div'), 'min-width'), '0', 'reduced motion: the stopped track must not stay 200% wide');
  assert.strictEqual(decl(rm('.gv-app.gv-skin-apex .gv-ticker span'), 'flex'), '0 0 auto', 'reduced motion: the words keep their natural width, so the first is whole');
  assert.ok(parseFloat(decl(rm('.gv-app.gv-skin-apex .gv-ticker span'), 'padding-left')) >= 8, 'reduced motion: the first word is inset from the strip edge');
  const plain = sel => rules.find(r => r.selector === sel && !r.media && r.decls.some(d => d.prop.startsWith('margin')));
  assert.ok(parseFloat(decl(plain('.gv-app.gv-skin-apex .gv-setup-start'), 'margin-bottom')) >= 14, 'the Apex Start slab needs room above the Equipment block');
  assert.ok(parseFloat(decl(plain('.gv-app.gv-skin-apex .gv-tiles'), 'margin-top')) >= 12, 'the Apex stat tiles need room under what precedes them');
}

console.log('apex review notes OK (pass 1: arrow svg x 16, host h3 x 8, nav pseudo-elements, 44px touch boxes + flex, short-phone target; pass 2: hero title steps, history row actions, switch thumbs x 160, session-top bleed, rep-counter bar wrap, set-box focus x 40, planswap touch box, spacing nits)');
