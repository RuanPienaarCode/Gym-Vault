/* APEX IN LIGHT MODE — "missing colour and bg" (26 Oct 2026).
   On paper the poster read as white on near-white: the hero had no ground and
   the bright accent, drawn as a hairline or a ring, all but vanished. Pinned:
   L1 the poster heroes stay graphite in light mode: both dark token blocks name them
   L2 light mode tints the page ground, so white cards stand off it
   L3 thin accent marks read --gv-accent-line, never the bright accent itself
   L4 the lime line tone holds 3:1 on white and on the ground; dark keeps the bright accent
   L5 FOREST (27 Oct 2026, the lime accent's light palette): a green hero whose ink reads,
      sage paper whose green text and lines read, scoped to lime only */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
/* GV_STYLES_CSS points the guard at a deliberately broken copy (mutation testing). */
const css = process.env.GV_STYLES_CSS ? fs.readFileSync(process.env.GV_STYLES_CSS, 'utf8') : fs.readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

const blocks = [];
bare.replace(/([^{}]+)\{([^{}]*)\}/g, (_, sel, body) => { blocks.push({ sels: sel.split(',').map(s => s.trim().replace(/\s+/g, ' ')), body }); });
const decl = (b, prop) => { const m = b.body.match(new RegExp(`(?:^|;)\\s*${prop.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+)`)); return m ? m[1].trim() : null; };
const withSel = sel => blocks.filter(b => b.sels.includes(sel));

const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = h => { const n = parseInt(h.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const HEROES = ['.theme-light .gv-app.gv-skin-apex .gv-hero-head', '.theme-light .gv-app.gv-skin-apex .gv-hero:not(.gv-hero-today)'];
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('  ok   ' + name); };

ok('L1 the graphite surface block and the dark poster block both name the light-mode heroes', () => {
  const graphite = withSel('.theme-dark .gv-app.gv-skin-apex').find(b => decl(b, '--gv-surface'));
  assert.ok(graphite, 'the Apex graphite token block is missing');
  for (const h of HEROES) assert.ok(graphite.sels.includes(h), `${h} must share the graphite tokens`);
  const poster = withSel('.theme-dark .gv-app.gv-skin-poster').find(b => decl(b, '--gv-accent-text'));
  assert.ok(poster, 'the dark poster token block is missing');
  for (const h of HEROES) assert.ok(poster.sels.includes(h), `${h} must take the dark accent text and amber`);
  assert.strictEqual(decl(poster, 'color-scheme'), 'dark');
});

ok('L2 light mode gives Apex a tinted ground', () => {
  const paper = withSel('.gv-app.gv-skin-apex').map(b => decl(b, '--gv-bg')).find(Boolean);
  const ground = withSel('.theme-light .gv-app.gv-skin-apex').map(b => decl(b, '--gv-bg')).find(Boolean);
  assert.ok(ground, 'no light-mode ground for Apex');
  assert.notStrictEqual(ground.toLowerCase(), (paper || '').toLowerCase(), 'the ground must differ from the old near-white paper');
  assert.ok(ratio(ground, '#ffffff') >= 1.1, `white cards must stand off the ground (${ratio(ground, '#ffffff').toFixed(2)}:1)`);
});

ok('L3 the tab underline, rings and left rules read --gv-accent-line', () => {
  const uses = (sel, prop) => withSel(sel).map(b => decl(b, prop)).filter(Boolean).join(' ');
  assert.match(uses('.gv-app.gv-skin-poster .gv-nav-btn.on::after', 'background-color'), /var\(--gv-accent-line\)/, 'tab underline');
  assert.match(uses('.gv-app.gv-skin-apex .gv-rw-hex.is-lime', '--gv-rw-ring'), /var\(--gv-accent-line\)/, 'level hexagon ring');
  assert.match(uses('.gv-app.gv-skin-poster .gv-ring-fill', 'stroke'), /var\(--gv-accent-line\)/, 'week ring');
  assert.match(uses('.gv-app.gv-skin-poster .gv-session-zone.gv-session-zone-live', 'border-color'), /var\(--gv-accent-line\)/, 'live zone edge');
});

ok('L4 the lime line tone holds 3:1 on paper and the ground; dark keeps the bright accent', () => {
  const line = withSel('.gv-app.gv-skin-apex.gv-accent-lime').map(b => decl(b, '--gv-accent-line')).find(Boolean);
  assert.ok(line && /^#[0-9a-f]{6}$/i.test(line), 'tuned lime needs a hex --gv-accent-line');
  const ground = withSel('.theme-light .gv-app.gv-skin-apex').map(b => decl(b, '--gv-bg')).find(Boolean);
  for (const bg of ['#ffffff', ground]) assert.ok(ratio(line, bg) >= 3, `${line} on ${bg} is ${ratio(line, bg).toFixed(2)}:1 (< 3)`);
  const dark = withSel('.theme-dark .gv-app.gv-skin-poster').map(b => decl(b, '--gv-accent-line')).find(Boolean);
  assert.strictEqual(dark, 'var(--gv-lime)', 'dark mode must keep the bright accent for its lines');
  for (const h of HEROES) assert.strictEqual(withSel(h).map(b => decl(b, '--gv-accent-line')).find(Boolean), 'var(--gv-lime)', `${h} draws its lines in the bright accent`);
});

const FOREST = '.theme-light .gv-app.gv-skin-apex.gv-accent-lime';
ok('L5 Forest: green hero, readable ink and green text on sage, lime accent only', () => {
  const tok = (sel, prop) => withSel(sel).map(b => decl(b, prop)).find(Boolean);
  const green = h => { const n = parseInt(h.slice(1), 16); return ((n >> 8) & 255) > (n >> 16) && ((n >> 8) & 255) > (n & 255); };
  const ground = tok(FOREST, '--gv-bg'), surface = tok(FOREST, '--gv-surface');
  assert.ok(ground && green(ground), `Forest ground must lean green (${ground})`);
  for (const bg of [ground, surface, tok(FOREST, '--gv-poster-chip'), tok(FOREST, '--gv-poster-cell')]) {
    assert.ok(ratio(tok(FOREST, '--gv-ink'), bg) >= 7, `ink on ${bg}`);
    assert.ok(ratio(tok(FOREST, '--gv-ink-dim'), bg) >= 4.5, `dim ink on ${bg}`);
    assert.ok(ratio(tok(FOREST, '--gv-accent-text'), bg) >= 4.5, `green text on ${bg} is ${ratio(tok(FOREST, '--gv-accent-text'), bg).toFixed(2)}:1`);
  }
  for (const bg of [ground, surface]) assert.ok(ratio(tok(FOREST, '--gv-accent-line'), bg) >= 3, `green line on ${bg}`);
  const hero = FOREST + ' .gv-hero-head';
  for (const k of ['--gv-apex-hero-hi', '--gv-apex-hero-lo', '--gv-surface']) assert.ok(green(tok(hero, k)), `hero ${k} must be forest green (${tok(hero, k)})`);
  for (const k of ['--gv-apex-hero-hi', '--gv-apex-hero-lo']) {
    assert.ok(ratio(tok(hero, '--gv-ink'), tok(hero, k)) >= 7, `hero ink on ${k}`);
    assert.ok(ratio(tok(hero, '--gv-ink-dim'), tok(hero, k)) >= 4.5, `hero dim ink on ${k}`);
  }
  assert.ok(withSel(FOREST + ' .gv-hero:not(.gv-hero-today)').length, 'Running and Your voice heroes must go Forest too');
  assert.ok(!blocks.some(b => b.sels.some(x => x.startsWith('.theme-light .gv-app.gv-skin-apex.gv-accent-') && !x.startsWith(FOREST))), 'Forest belongs to the lime accent alone');
});

console.log(`apex light mode OK (${n} checks)`);
