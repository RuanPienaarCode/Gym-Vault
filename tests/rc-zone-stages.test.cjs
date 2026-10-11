'use strict';
/* THE COUNTER ZONE'S COLOUR RAMP (0.13.1).

   Ruan, on the live rep / hold counter: "target should be different colours
   till the final goal". The zone had one colour family all the way and was
   the accent green at the end, so a hold at 37s of a 30s target looked like
   every stage before it. Now it climbs through four stages and only the last
   is the user's accent:

     warm  a cool tint       --gv-stage-warm
     hot   amber             --gv-stage-hot  (= --gv-amber)
     peak  red               --gv-stage-peak (NOT --gv-ember: orange, and the
                                              dark ember is Blaze's exact hex)
     done  the accent flood  --gv-lime

   This replaces the 0.13.1 "flood ink" guard (green flood only). Everything
   is computed from the stylesheet's OWN tokens and opacities — nothing here
   restates a colour — for 4 stages x 2 themes x 5 accents:

     1. STAGE COLOURS. warm / hot / peak are not accent-tied (no --gv-lime in
        their rules); done is the accent and nothing else is.
     2. DISTINCT. Every stage shows against the bare page (dE >= 15). The composited stage colours (flood over the page) are
        pairwise different by CIE76 dE: consecutive stages >= 30, any two
        stages >= 20. Blaze (orange) vs peak is the case that forced the red.
     3. READABLE. Every piece of text (count, target label, hint), with the
        colour the cascade actually gives it, is >= 4.5:1 on its stage:
        against the flood, and — until the target is met the flood only
        covers the BOTTOM of the zone — against the bare base too; against
        both bases the zone can sit on (the page, and the guided screen's
        accent ghost); with the breathing filter at its brightest.
     4. NOTHING ELSE FIGHTS: no skin restyles a stage, the animations and the
        reduced-motion stop are still there, and the hit pulse starts from the
        stage's own opacity (a hard-coded 0.75 would dim the dark theme's
        0.95 flood for 620ms, below AA). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(process.env.GV_STYLES_CSS || path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');   // comments carry apostrophes, braces and selectors

/* ---- colour maths ---- */
const hex = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (f, b, a) => f.map((v, i) => v * a + b[i] * (1 - a));
const bright = (c, k) => c.map(v => Math.min(255, v * k));
const lab = c => {
  const [r, g, b] = c.map(lin);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const t = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))];
};
const dE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

/* ---- stylesheet access ---- */
function rules() {
  const out = [];
  const re = /(?:^|\})\s*([^{}@][^{}]*)\{([^}]*)\}/gm;
  let m;
  while ((m = re.exec(CSS))) out.push({ sels: m[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')), body: m[2] });
  return out;
}
const RULES = rules();
const rulesFor = sel => RULES.filter(r => r.sels.includes(sel));
const decl = (body, prop) => { const m = body.match(new RegExp('(?:^|[;\\s])' + prop + ':\\s*([^;]+)')); return m ? m[1].trim() : null; };
/* The LAST rule for `sel` that declares `prop` (same specificity: source order wins). */
const last = (sel, prop) => { let v = null; for (const r of rulesFor(sel)) { const d = decl(r.body, prop); if (d !== null) v = d; } return v; };

const ACCENTS = ['lime', 'volt', 'blaze', 'electric', 'punch'];
const SKINS = ['apex', 'floor', 'editorial'];
const THEMES = ['light', 'dark'];
const STAGES = ['warm', 'hot', 'peak', 'done'];
const PARTS = ['count', 'target', 'hint'];

/* A token's value for an app root wearing a skin + an accent, in a theme: the
   REAL cascade, not a guess at it. Every token-declaring rule whose selector is
   classes only (`.gv-app`, `.gv-app.gv-skin-apex`, `.theme-dark .gv-app.gv-accent-blaze`,
   `.gv-app.gv-skin-apex.gv-accent-lime` ...) is matched against the root's classes;
   the winner per property is the highest specificity (class count), then the
   latest in the file. This matters: the DEFAULT skin (Apex) re-declares the page
   colours, both inks and --gv-amber, and its lime accent is not the base lime —
   a guard that read only `.gv-app` measured colours nobody sees. */
function tokens(theme, accent, skin) {
  const have = new Set(['gv-app', `gv-skin-${skin}`, `gv-accent-${accent}`]);
  const best = {};
  RULES.forEach((r, order) => {
    for (const sel of r.sels) {
      const m = sel.match(/^(\.theme-dark )?((?:\.[a-z0-9-]+)+)$/);
      if (!m) continue;
      if (m[1] && theme !== 'dark') continue;
      const classes = m[2].split('.').filter(Boolean);
      if (!classes.every(c => have.has(c))) continue;
      const spec = classes.length + (m[1] ? 1 : 0);
      for (const d of r.body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) {
        const cur = best[d[1]];
        if (!cur || spec > cur.spec || (spec === cur.spec && order >= cur.order)) best[d[1]] = { spec, order, v: d[2].trim() };
      }
    }
  });
  const t = {};
  for (const k of Object.keys(best)) t[k] = best[k].v;
  return t;
}
function resolve(val, t, depth = 0) {
  assert.ok(depth < 6, `var() loop at ${val}`);
  val = val.trim();
  const v = val.match(/^var\((--[a-z0-9-]+)\)$/);
  if (v) { assert.ok(t[v[1]] !== undefined, `token ${v[1]} is not declared`); return resolve(t[v[1]], t, depth + 1); }
  return val;
}
const colour = (val, t) => { const r = resolve(val, t); assert.ok(/^#[0-9a-f]{3,6}$/i.test(r), `not a hex colour: ${val} -> ${r}`); return hex(r); };

let n = 0;
const ok = (c, msg) => { assert.ok(c, msg); n++; };

/* The flood's declared background token + opacity per stage. */
const floodDecl = stage => {
  const sel = stage === 'warm' ? '.gv-rc-zone[data-fill]::before' : `.gv-rc-zone[data-fill="${stage}"]::before`;
  return { bg: last(sel, 'background'), op: last(sel, 'opacity') };
};

/* 1 — which colours the stages are made of. */
for (const s of STAGES) {
  const f = floodDecl(s);
  ok(f.bg && f.op, `no flood rule for the ${s} stage`);
  if (s === 'done') ok(f.bg === 'var(--gv-lime)', `done must be the accent (var(--gv-lime)), got ${f.bg}`);
  else ok(/^var\(--gv-stage-(warm|hot|peak)\)$/.test(f.bg) && !/gv-lime/.test(f.bg), `${s} must be a --gv-stage-* token, never the accent, got ${f.bg}`);
  ok(f.op === `var(--gv-stage-${s}-a)`, `${s} opacity must come from --gv-stage-${s}-a, got ${f.op}`);
}
ok(floodDecl('hot').bg === 'var(--gv-stage-hot)' && floodDecl('peak').bg === 'var(--gv-stage-peak)' && floodDecl('warm').bg === 'var(--gv-stage-warm)', 'each stage uses its own token');
for (const skin of SKINS) for (const theme of THEMES) {
  const t = tokens(theme, 'lime', skin);
  ok(resolve('var(--gv-stage-hot)', t) === resolve('var(--gv-amber)', t), `hot is the amber token (${skin} / ${theme})`);
}
for (const skin of SKINS) for (const accent of ACCENTS) for (const theme of THEMES) {
  const t = tokens(theme, accent, skin);
  for (const s of ['warm', 'hot', 'peak']) {
    const a = parseFloat(resolve(`var(--gv-stage-${s}-a)`, t));
    ok(a > 0 && a <= 1, `${theme}/${accent}: --gv-stage-${s}-a out of range (${a})`);
  }
  ok(parseFloat(resolve('var(--gv-stage-done-a)', t)) > 0, `${theme}/${accent}: done opacity`);
}

/* 2 + 3 — the numbers. */
const MIN_NEXT = 30, MIN_ANY = 20, MIN_PAGE = 15, AA = 4.5;
const report = [];
for (const skin of SKINS) for (const theme of THEMES) for (const accent of ACCENTS) {
  const t = tokens(theme, accent, skin);
  const bg = colour('var(--gv-bg)', t);
  const ghost = colour('var(--gv-lime-ghost)', t);
  const eff = {};
  for (const s of STAGES) {
    const f = floodDecl(s);
    const c = colour(f.bg, t), o = parseFloat(resolve(f.op, t));
    eff[s] = mix(c, bg, o);
  }
  /* distinct — from each other, and the first from the bare page it rises on */
  for (const s of STAGES) {
    const d = dE(eff[s], bg);
    ok(d >= MIN_PAGE, `${skin} / ${theme} / ${accent}: ${s} is only dE ${d.toFixed(1)} from the bare page (< ${MIN_PAGE}) — the stage would not show`);
  }
  for (let i = 0; i < 3; i++) {
    const d = dE(eff[STAGES[i]], eff[STAGES[i + 1]]);
    ok(d >= MIN_NEXT, `${skin} / ${theme} / ${accent}: ${STAGES[i]} -> ${STAGES[i + 1]} differ by dE ${d.toFixed(1)} (< ${MIN_NEXT}) — the ramp must be visibly stepped`);
  }
  for (let i = 0; i < 4; i++) for (let j = i + 2; j < 4; j++) {
    const d = dE(eff[STAGES[i]], eff[STAGES[j]]);
    ok(d >= MIN_ANY, `${skin} / ${theme} / ${accent}: ${STAGES[i]} vs ${STAGES[j]} differ by dE ${d.toFixed(1)} (< ${MIN_ANY})`);
  }
  /* readable */
  for (const s of STAGES) {
    const f = floodDecl(s);
    const fc = colour(f.bg, t), fo = parseFloat(resolve(f.op, t));
    const breathes = s === 'hot' || s === 'peak';
    for (const part of PARTS) {
      const sel = `.gv-rc-zone[data-fill="${s}"] .gv-rc-${part}`;
      const cv = last(sel, 'color') || last(`.gv-rc-${part}`, 'color');
      ok(cv, `no colour for ${part} on ${s}`);
      const ink = colour(cv, t);
      for (const [baseName, base] of [['page', bg], ['accent ghost', ghost]]) {
        const floods = [mix(fc, base, fo)];
        if (breathes) floods.push(mix(bright(fc, 1.13), base, fo));
        for (const fl of floods) {
          const r = ratio(ink, fl);
          report.push([theme, accent, s, part, r]);
          ok(r >= AA, `${skin} / ${theme} / ${accent} / ${s} / ${part} (${cv}) on the flood over ${baseName}: ${r.toFixed(2)}:1 (< ${AA})`);
        }
        if (s !== 'done') {   /* the flood has not reached the text yet */
          const r = ratio(ink, base);
          ok(r >= AA, `${skin} / ${theme} / ${accent} / ${s} / ${part} (${cv}) on the bare ${baseName}: ${r.toFixed(2)}:1 (< ${AA})`);
        }
      }
    }
  }
}

/* 4 — nothing else fights. */
for (const r of RULES) for (const sel of r.sels) {
  if (/gv-rc-zone/.test(sel) && /data-fill/.test(sel) && /gv-skin-/.test(sel)) ok(false, `a skin restyles a stage: ${sel}`);
}
ok(/animation:\s*gv-fill-breathe 1500ms[^;]*infinite/.test(CSS.match(/\.gv-rc-zone\[data-fill="hot"\]::before\s*\{[^}]*\}/)[0]), 'hot still breathes');
ok(/animation:\s*gv-fill-breathe 820ms[^;]*infinite/.test(CSS.match(/\.gv-rc-zone\[data-fill="peak"\]::before\s*\{[^}]*\}/)[0]), 'peak still breathes, faster');
ok(/animation:\s*gv-fill-hit 620ms/.test(CSS.match(/\.gv-rc-zone\[data-fill="done"\]::before\s*\{[^}]*\}/)[0]), 'done still pulses once');
const hit = CSS.match(/@keyframes gv-fill-hit\s*\{([\s\S]*?)\}\s*\}/)[0];
ok(!/opacity:\s*0\.\d+/.test(hit), 'the hit pulse must start from the stage opacity token, not a hard-coded fraction');
ok(/0%\s*\{\s*opacity:\s*var\(--gv-stage-done-a\)/.test(hit), 'the hit pulse starts at --gv-stage-done-a');
/* A tap must not recolour the count on a stage: the punch flick and the zone's
   flash both set it to the accent, which spends the accent before "done" and is
   accent-on-accent ON "done". */
ok(/\.gv-rc-zone\[data-fill\]:not\(\[data-fill="idle"\]\) \.gv-rc-count\.gv-punch\s*\{\s*animation-name:\s*gv-punch-flood/.test(CSS), 'a staged zone must use the colourless punch');
const flood = CSS.match(/@keyframes gv-punch-flood\s*\{([\s\S]*?\})\s*\}/);
ok(flood && !/color/.test(flood[1]) && /transform/.test(flood[1]), 'gv-punch-flood must be transform-only');
for (const r of RULES) {
  if (r.sels.some(s => /gv-rc-flash/.test(s) && /gv-rc-count/.test(s)) && /(^|[;\s])color:/.test(r.body)) {
    ok(r.sels.every(s => /:not\(\[data-fill\]\)|\[data-fill="idle"\]/.test(s)), `the flash may only recolour the count on a bare zone, not a staged one: ${r.sels.join(', ')}`);
  }
}
const rm = CSS.match(/@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.gv-rc-zone\[data-fill\]::before\s*\{([^}]*)\}/);
ok(rm && /animation:\s*none/.test(rm[1]), 'reduced motion still stops the stage loops');

console.log(`counter zone stages OK (${n} checks, ${report.length} contrast measurements; worst text ${Math.min(...report.map(x => x[4])).toFixed(2)}:1)`);
