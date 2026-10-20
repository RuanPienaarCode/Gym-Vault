'use strict';
/* M-05: iOS keeps `:hover` applied to whatever was tapped last, so an unguarded
   hover rule leaves a button looking pressed (Floor's black Start, the red
   Discard) until the next tap elsewhere. Every `:hover` rule in the source
   stylesheet sits inside `@media (hover: hover)`, which a touch screen does not
   match. tests/css-cascade.js reads that block as matching, so the hover
   contrast probes still measure the desktop hover state. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

function matchBrace(s, open) {
  let d = 0;
  for (let j = open; j < s.length; j++) {
    if (s[j] === '{') d++;
    else if (s[j] === '}' && --d === 0) return j;
  }
  return s.length;
}

const bare = [];
(function walk(start, end, guarded) {
  let i = start;
  while (i < end) {
    while (i < end && /\s/.test(src[i])) i++;
    const open = src.indexOf('{', i);
    if (i >= end || open === -1 || open >= end) break;
    const close = matchBrace(src, open);
    const prelude = src.slice(i, open).trim();
    if (prelude[0] === '@') {
      const isHoverMedia = /^@media\b/.test(prelude) && /\(\s*hover\s*:\s*hover\s*\)/.test(prelude);
      if (/^@(media|supports)\b/.test(prelude)) walk(open + 1, close, guarded || isHoverMedia);
    } else if (/:hover\b/.test(prelude) && !guarded) {
      bare.push(`line ${src.slice(0, i).split('\n').length}: ${prelude.replace(/\s+/g, ' ').slice(0, 90)}`);
    }
    i = close + 1;
  }
})(0, src.length, false);

assert.strictEqual(bare.length, 0,
  `${bare.length} :hover rule(s) outside @media (hover: hover) stay stuck on iOS after a tap:\n  ${bare.slice(0, 12).join('\n  ')}`);
console.log('hover rules guarded OK (every :hover is inside @media (hover: hover))');
