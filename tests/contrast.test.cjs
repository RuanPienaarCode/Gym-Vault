'use strict';
/* WCAG AA gates on the accent palettes, read from src/styles.css itself
   (the single source of every accent hex). Two pairs matter per accent:
     deep on white        — small text on paper (goal numerals, rx values)
     flood-dim on accent  — small text on the accent flood (shout lines)
   Both must clear 4.5:1 (the text is 10.5–11px/800 — never "large"). A new
   palette that fails here must be darkened before it ships. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');

const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = hex => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => {
  const [h, l] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (h + 0.05) / (l + 0.05);
};

/* Collect palettes: the .gv-app defaults plus every gv-accent block. */
const palettes = {};
const blockRe = /\.gv-app(?:\.gv-accent-([a-z]+))?\s*\{([^}]*)\}/g;
let m;
while ((m = blockRe.exec(css))) {
  const name = m[1] || 'lime';
  const get = key => { const mm = m[2].match(new RegExp(`--gv-${key}:\\s*(#[0-9a-fA-F]{6})`)); return mm ? mm[1] : null; };
  const lime = get('lime'), deep = get('lime-deep'), dim = get('flood-dim');
  if (lime && deep && dim) palettes[name] = { lime, deep, dim };
}

const names = Object.keys(palettes);
assert.ok(names.length >= 5, `expected the 5 accent palettes, found: ${names.join(', ')}`);

for (const [name, p] of Object.entries(palettes)) {
  const deepOnWhite = ratio(p.deep, '#ffffff');
  const dimOnFlood = ratio(p.dim, p.lime);
  assert.ok(deepOnWhite >= 4.5, `${name}: deep ${p.deep} on white = ${deepOnWhite.toFixed(2)} (< 4.5)`);
  assert.ok(dimOnFlood >= 4.5, `${name}: flood-dim ${p.dim} on ${p.lime} = ${dimOnFlood.toFixed(2)} (< 4.5)`);
}

console.log(`contrast OK (${names.length} palettes: ${names.join(', ')})`);
