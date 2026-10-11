'use strict';
/* THE MUSCLE MAP'S STYLES AND ITS RENDERER'S HYGIENE: the rules that nothing in the
   other guard suites would notice breaking.

   M1  THE LOAD RAMP IS A TOKEN PAIR: --gv-load-lo / --gv-load-hi are declared in the
       base .gv-app block with dark twins in .theme-dark .gv-app, are literal colours
       (not var(--gv-lime*) and not var(--gv-amber*): the ramp is neither the accent nor
       the streak), and resolve to the SAME colour in every skin and under every accent.
   M2  BOTH ENDS READ: lo and hi hold 3:1 against the page (--gv-bg) and against the
       mannequin they are painted on (--gv-line), in every theme x skin: a working muscle
       that disappears into the body is not a working muscle. The holding tone (the
       accent's deep tone in light, the accent in dark) holds 3:1 against the page.
   M3  NO COLOUR LITERAL, NO !important in any muscle-map or viewer-map rule: skins and
       accents move the colours through tokens, and every colour here is one.
   M4  SVG ATTRIBUTES ONLY: the renderer never writes an inline style (iOS 15 and the
       review linter both care), and never touches innerHTML.
   M5  THE iOS 15 FLOOR in the files this feature added: no .at(), structuredClone,
       Object.hasOwn, findLast, lookbehind, :has(), color-mix(), dvh, @property.
   M6  THE VIEWER'S MAP MODE: the stage swaps the dark picture mat for the page colour,
       scrolls, hides the photos and shows the map host only in map mode; the touch rule
       that leaves pinch-zoom alone is never overridden with `none`.
   M7  THE THUMBNAIL FILLS ITS FRAME and takes no pointer of its own.
   GV_STYLES_CSS points the CSS half at a deliberately broken copy (mutation testing). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const css = process.env.GV_STYLES_CSS ? fs.readFileSync(process.env.GV_STYLES_CSS, 'utf8') : read('src/styles.css');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
const rules = cx.load();
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = hex => { const v = parseInt(hex.slice(1), 16); return 0.2126 * lin(v >> 16) + 0.7152 * lin((v >> 8) & 255) + 0.0722 * lin(v & 255); };
const ratio = (a, b) => { const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
const resolved = (o, prop) => { const c = cx.computed(cx.appChain(o), prop, rules); return cx.hex(cx.parseColor(cx.resolveVars(c.chain, c.value, rules))); };

/* ---------- M1 ---------- */
const block = sel => { const m = new RegExp(`(?:^|\\n)${sel.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`).exec(bare); return m ? m[1] : ''; };
const base = block('.gv-app'), dark = block('.theme-dark .gv-app');
const decl = (b, k) => { const m = new RegExp(`${k}:\\s*([^;]+);`).exec(b); return m ? m[1].trim() : null; };
for (const k of ['--gv-load-lo', '--gv-load-hi']) {
  const l = decl(base, k), d = decl(dark, k);
  ok(l && /^#[0-9a-f]{6}$/i.test(l), `${k}: a literal hex in the base .gv-app block (got ${l})`);
  ok(d && /^#[0-9a-f]{6}$/i.test(d), `${k}: a literal hex dark twin in .theme-dark .gv-app (got ${d})`);
  ok(l.toLowerCase() !== d.toLowerCase(), `${k}: the dark twin is a different value`);
}
{
  const seen = { light: new Set(), dark: new Set() };
  for (const theme of ['light', 'dark']) for (const skin of ['floor', 'editorial', 'apex', 'lockin']) for (const accent of ['lime', 'volt', 'blaze', 'electric', 'punch']) {
    seen[theme].add(resolved({ theme, skin, accent }, '--gv-load-lo') + resolved({ theme, skin, accent }, '--gv-load-hi'));
  }
  eq([seen.light.size, seen.dark.size], [1, 1], 'M1 the ramp is the same in every skin and under every accent (not accent-tied, not skin-tied)');
  ok([...seen.light][0] !== [...seen.dark][0], 'M1 and differs between the themes');
}

/* ---------- M2 ---------- */
for (const theme of ['light', 'dark']) for (const skin of ['floor', 'editorial', 'apex', 'lockin']) for (const accent of ['lime', 'volt', 'blaze', 'electric', 'punch']) {
  const o = { theme, skin, accent };
  const bg = resolved(o, '--gv-bg'), body = resolved(o, '--gv-line');
  for (const k of ['--gv-load-lo', '--gv-load-hi']) {
    const c = resolved(o, k);
    ok(ratio(c, bg) >= 3, `${theme}/${skin}: ${k} ${c} on the page ${bg} is ${ratio(c, bg).toFixed(2)}:1 (< 3)`);
    ok(ratio(c, body) >= 3, `${theme}/${skin}: ${k} ${c} on the mannequin ${body} is ${ratio(c, body).toFixed(2)}:1 (< 3)`);
  }
  const hold = resolved(o, theme === 'dark' ? '--gv-lime' : '--gv-lime-deep');
  ok(ratio(hold, bg) >= 3, `${theme}/${skin}/${accent}: the holding tone ${hold} on the page ${bg} is ${ratio(hold, bg).toFixed(2)}:1 (< 3)`);
}

/* ---------- M3 ---------- */
const all = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const mine = all.filter(m => /\.gv-mm\b|\.gv-mm-|\.gv-mv-map\b|\.gv-mv-is-map\b|\.gv-mv-mode\b/.test(m[1]));
ok(mine.length > 40, `expected the muscle map's rules to parse (${mine.length})`);
{
  const lit = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\b(white|black|red|green|blue|orange|yellow|gray|grey|amber|lime)\b(?!-)/i;
  const bad = [];
  for (const m of mine) for (const d of m[2].split(';')) {
    const v = d.split(':').slice(1).join(':');
    if (/^\s*--/.test(d)) continue;
    if (lit.test(v.replace(/var\([^)]*\)/g, ''))) bad.push(`${m[1].trim()} { ${d.trim()} }`);
    if (/!important/.test(d)) bad.push(`!important: ${m[1].trim()}`);
  }
  eq(bad, [], 'M3 a colour literal or !important in a muscle-map rule bypasses the skins and accents:\n' + bad.join('\n'));
  /* and each declaration appears once per rule */
  for (const m of mine) {
    const props = m[2].split(';').map(d => d.split(':')[0].trim()).filter(Boolean);
    eq(props.filter((p, i) => props.indexOf(p) !== i), [], `M3 duplicate declaration in ${m[1].trim()}`);
  }
}

/* ---------- M4 + M5 ---------- */
const FILES = ['muscle-map.js', 'motion-library.js', 'motion-geom.js', 'motion-body.js', 'motion-front.js', 'media-viewer.js', 'media-cycle.js'];
const code = f => read('src/' + f).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
{
  const mm = code('muscle-map.js'), mv = code('media-viewer.js');
  ok(!/\.style\b|setAttribute\(\s*['"]style['"]/.test(mm), 'M4 muscle-map.js writes no inline style (SVG attributes only)');
  ok(!/\.style\b|setAttribute\(\s*['"]style['"]/.test(mv), 'M4 media-viewer.js writes no inline style');
  for (const f of [...FILES, 'page-session.js', 'page-exercise-detail.js', 'settings-tab.js']) ok(!/innerHTML|outerHTML|insertAdjacentHTML/.test(code(f)), `M4 ${f}: no innerHTML`);
}
for (const f of FILES) {
  const c = code(f);
  ok(!/\.at\(\s*-?\d/.test(c), `M5 ${f}: Array.prototype.at is iOS 15.4`);
  ok(!/structuredClone/.test(c), `M5 ${f}: structuredClone is iOS 15.4`);
  ok(!/Object\.hasOwn\(/.test(c), `M5 ${f}: Object.hasOwn is iOS 15.4`);
  ok(!/\.findLast(Index)?\(/.test(c), `M5 ${f}: findLast is iOS 15.4`);
  ok(!/\(\?<[=!]/.test(c), `M5 ${f}: regex lookbehind is a parse-time error before iOS 16.4`);
  ok(!/require\(\s*['"](?:node:)?(fs|path|os|child_process|crypto|electron)['"]/.test(c), `M5 ${f}: no Node/Electron API`);
}
ok(!/:has\(|color-mix\(|\bdvh\b|@property|overflow:\s*clip|(^|[;{\s])inset\s*:/m.test(bare.slice(bare.indexOf('MUSCLE MAP (muscle-map.js)'), bare.indexOf('ACCENT PALETTES'))), 'M5 the muscle-map section uses no :has / color-mix / dvh / @property / overflow: clip / inset shorthand');
ok(!/:focus-visible/.test(bare.slice(bare.indexOf('MUSCLE MAP (muscle-map.js)'), bare.indexOf('ACCENT PALETTES'))), 'M5 no bare :focus-visible (the stage uses :focus)');

/* ---------- M6 ---------- */
{
  const rule = sel => mine.filter(m => m[1].trim() === sel).map(m => m[2]).join(';');
  const stage = rule('.gv-mv-stage.gv-mv-is-map');
  ok(/background-color:\s*var\(--gv-bg\)/.test(stage), 'M6 the map stage is painted in the page colour, not the dark picture mat');
  ok(/overflow-y:\s*auto/.test(stage), 'M6 and scrolls');
  ok(/display:\s*none/.test(rule('.gv-mv-map')), 'M6 the map host is hidden by default (photos mode)');
  ok(/display:\s*flex/.test(rule('.gv-mv-is-map .gv-mv-map')), 'M6 and shown in map mode');
  ok(/display:\s*none/.test(rule('.gv-mv-is-map .gv-mv-img')), 'M6 the stacked photos are out of sight in map mode');
  ok(!all.some(m => /\.gv-mv-/.test(m[1]) && /touch-action:\s*none/.test(m[2])), 'M6 touch-action: none on anything in the viewer would block the browser\'s own pinch-zoom');
}

/* ---------- M7 ---------- */
{
  const mini = mine.filter(m => m[1].trim() === '.gv-mm-mini').map(m => m[2]).join(';');
  ok(/position:\s*absolute/.test(mini) && /top:\s*0/.test(mini) && /bottom:\s*0/.test(mini) && /left:\s*0/.test(mini) && /right:\s*0/.test(mini), 'M7 the miniature fills its frame');
  ok(/height:\s*100%/.test(mine.filter(m => /\.gv-mm-mini \.gv-mm-svg/.test(m[1])).map(m => m[2]).join(';')), 'M7 and so does its figure');
}

console.log(`muscle map css OK (${n} checks: the ramp is a token pair with dark twins, the same in every skin and accent, 3:1 on the page and on the body; no colour literal; SVG attributes only; iOS 15 floor in the new files; the viewer's map mode; the miniature fills its frame)`);
