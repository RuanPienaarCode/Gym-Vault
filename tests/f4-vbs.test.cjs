'use strict';
/* M-03 / L5-04 (usability fix wave 20 Oct 2026): THE NAVBAR CLEARANCE MUST NOT
   VANISH ON A PHONE WITH A NORMAL NAVBAR.

   Obsidian's app.css sets, on `.is-phone`, the UNITLESS `--view-bottom-spacing: 0`,
   and a length (`calc(safe-area - keyboard + navbar-height)`) only under
   `.is-phone.is-floating-nav, .is-phone.auto-full-screen`. The page rule was

       body.is-phone .gv-app .gv-page {
         padding-bottom: max(calc(32px + env()), calc(var(--view-bottom-spacing, ...) + 12px));
       }

   `calc(0 + 12px)` is a number plus a length: INVALID AT COMPUTED-VALUE TIME, so
   the whole max() - floor included - fell back to `unset`, padding-bottom 0, on
   every phone whose navbar is not floating: every page ended flush against the
   bottom edge (and the home indicator). It cannot be caught at parse time and no
   fallback inside var() helps; the only cure is never to do arithmetic on the host
   variable, and to apply the host's number only where the host guarantees it is a
   length - the same two classes it keys its own rule on.

   Three things are pinned: (1) the host variable is never an operand of calc();
   (2) every use of it is gated on those two classes, so a unitless 0 never reaches
   a declaration; (3) the outcome on a phone without a floating navbar is the base
   floor, and the bar-bearing Apex/Lock In page keeps its 24px with no extra margin. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};

const rules = cx.load();
const VAR = '--view-bottom-spacing';

/* The text of every var(--view-bottom-spacing, ...) token in a value, and the
   value with the token blanked out, so what surrounds it can be examined. */
function tokens(value) {
  const out = [];
  let at = value.indexOf('var(' + VAR);
  while (at !== -1) {
    let depth = 0, i = at + 3;
    for (; i < value.length; i++) { if (value[i] === '(') depth++; else if (value[i] === ')' && --depth === 0) break; }
    out.push({ start: at, end: i + 1 });
    at = value.indexOf('var(' + VAR, i);
  }
  return out;
}
const claims = rules.filter(r => r.decls.some(d => d.value.includes(VAR)));

check('the host navbar variable is never inside calc() (a unitless 0 makes calc(var + 12px) invalid)', () => {
  assert.ok(claims.length >= 2, `expected the page rule and the bar rule to use ${VAR}, found ${claims.length}`);
  for (const r of claims) for (const d of r.decls) {
    for (const t of tokens(d.value)) {
      let depth = 0, calcDepth = 0;
      const before = d.value.slice(0, t.start);
      /* Walk the text before the token, tracking whether an unclosed calc( encloses it. */
      const stack = [];
      for (let i = 0; i < before.length; i++) {
        if (before[i] === '(') { stack.push(/calc\s*$/.test(before.slice(0, i))); }
        else if (before[i] === ')') stack.pop();
      }
      assert.ok(!stack.some(Boolean), `src/styles.css:${r.line} \`${r.selector}\` ${d.prop}: ${VAR} is an operand of calc(): ${d.value}`);
    }
  }
});

const GATE = /\.is-floating-nav|\.auto-full-screen/;
check('the page clearance rule applies only where the host guarantees a length', () => {
  const pageRules = claims.filter(r => /\.gv-page\s*$/.test(r.selector.trim()));
  assert.ok(pageRules.length >= 1, 'a .gv-page rule claims the clearance');
  for (const r of pageRules) {
    assert.ok(GATE.test(r.selector), `src/styles.css:${r.line} \`${r.selector}\` is not gated on .is-floating-nav / .auto-full-screen: on a phone with a normal navbar the host variable is the unitless 0 and this declaration collapses to padding-bottom: 0`);
  }
});

const chain = (bodyCls, extra) => cx.chainOf([`body.${bodyCls}`, 'div.gv-app.gv-skin-floor' + (extra || ''), 'main.gv-page']);
const winner = (c, prop) => (cx.declarationsFor(c, [prop], rules)[0] || {});

check('a phone with a normal navbar keeps the base bottom padding (no host variable on it)', () => {
  const w = winner(chain('is-phone'), 'padding-bottom');
  assert.ok(w.decl, 'padding-bottom resolves');
  assert.ok(!w.decl.value.includes(VAR), `padding-bottom on a non-floating phone is taken from ${VAR}: ${w.decl.value}`);
  assert.ok(/32px/.test(w.decl.value), `expected the 32px floor, got ${w.decl.value}`);
});

check('a floating-navbar phone takes the host clearance, floored', () => {
  for (const cls of ['is-phone.is-floating-nav', 'is-phone.auto-full-screen']) {
    const w = winner(chain(cls), 'padding-bottom');
    assert.ok(w.decl && w.decl.value.includes(VAR), `${cls}: padding-bottom does not use the host clearance: ${w.decl && w.decl.value}`);
    assert.ok(/max\(/.test(w.decl.value), `${cls}: the host value must be floored with max(): a keyboard makes it negative. Got ${w.decl.value}`);
  }
});

check('Apex/Lock In pages above their tab bar keep 24px and no extra margin', () => {
  const c = cx.chainOf(['body.is-phone.is-floating-nav', 'div.gv-app.gv-skin-apex.gv-skin-poster.gv-narrow', 'main.gv-page']);
  const pad = winner(c, 'padding-bottom');
  assert.strictEqual(pad.decl && pad.decl.value, '24px', `padding-bottom ${pad.decl && pad.decl.value}`);
  const mar = winner(c, 'margin-bottom');
  assert.ok(mar.decl && mar.decl.value === '0', `the page's bottom margin must be reset where the bar carries the clearance, got ${mar.decl && mar.decl.value}`);
});

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('f4-vbs OK');
