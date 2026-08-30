'use strict';
/* Every route must render a real heading.

   The suite renders no DOM, so this checks the source instead. It matters
   beyond the rotor: ctx.nav() moves focus to the page's first heading after a
   route change, and `focusPageHeading()` silently NO-OPS when there isn't
   one — so a page without a heading gives a screen-reader user no signal that
   the view changed at all, and nothing reports the omission.

   A styled div is not a heading. These two were the last holdouts after the
   0.3.0 accessibility pass: the log page had no heading element of any kind,
   and the guided session's rest phase — a whole route of its own — titled
   itself with a `.gv-kicker` div. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* Every page module renders at least one heading element. */
{
  const pages = fs.readdirSync(path.join(__dirname, '..', 'src'))
    .filter(f => f.startsWith('page-') && f.endsWith('.js'));
  assert.ok(pages.length >= 10, `expected the page modules to be found, got ${pages.length}`);

  const missing = pages.filter(f => !/el\(\s*'h[1-6]'/.test(strip(read(f))));
  assert.deepStrictEqual(missing, [],
    `these pages render no heading element, so ctx.nav's focus-move silently does nothing on them: ${missing.join(', ')}`);
}

/* The two specific holdouts, pinned by the class that carries their styling —
   a rename would fail this loudly rather than quietly dropping the tag. */
{
  assert.match(strip(read('page-log.js')), /el\(\s*'h2',\s*\{\s*class:\s*'gv-logtop-title'/,
    'the log page\'s title must stay a real heading, not revert to a styled div');
  assert.match(strip(read('page-session.js')), /el\(\s*'h2',\s*\{\s*class:\s*'gv-kicker gv-session-rest-title'/,
    'the guided rest phase must keep a real heading — it is its own route and has no other title');
}

/* Those two now render as <h2>, so their styling must zero the margin Obsidian
   puts on bare headings, or promoting the tag shifts the layout. */
{
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const cls of ['gv-logtop-title', 'gv-kicker']) {
    const rule = css.match(new RegExp(`\\.${cls}\\s*\\{[^}]*\\}`));
    assert.ok(rule, `.${cls} rule missing`);
    assert.match(rule[0], /margin:\s*0/,
      `.${cls} renders as an <h2>; without margin:0 it inherits app.css's heading margin and moves the layout`);
  }
}

console.log('page headings OK (every route has a real heading; the two promoted ones keep margin:0)');
