'use strict';
/* W4-9a / L5-07 (usability fix wave 2, 20 Oct 2026): ANTON IS SET AT THE ONE WEIGHT IT HAS.

   Anton ships a single weight (400). The host gives headings and buttons weights of its own
   (h2 680, h3 660, button 500), and a face that is asked for a weight it lacks gets a SYNTHESISED
   bold on WebKit: smeared counters on the big condensed type. On Floor and Editorial the page titles
   (h2.gv-toolbar-title, h2.gv-logtop-title), the h3 section titles (Progress photos, Medals), the
   big action buttons (.gv-btn-go, .gv-btn-finish) and the plan-name badge inherit exactly that.
   (.gv-display already says weight 400 and says why.) Apex and Lock In use Barlow Condensed, which
   has the weights, and are not touched.

   The host's own rules are not in CI, so they are passed to the cascade as data (the way
   host-input-width does): app.css 1.14 sets h2 680, h3 660, button 500. Found by walking
   getComputedStyle over 18 pages: every Anton element on Floor/Editorial with a weight other than 400. */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const rules = cx.load().filter(r => !/[+~]/.test(r.selector.replace(/\[[^\]]*\]/g, '')));
const HOST = [
  { selector: 'h2', decls: [{ prop: 'font-weight', value: '680' }] },
  { selector: 'h3', decls: [{ prop: 'font-weight', value: '660' }] },
  { selector: 'button', decls: [{ prop: 'font-weight', value: '500' }] },
];
const TITLES = {
  'page title (h2.gv-toolbar-title)': ['main.gv-page', 'div.gv-toolbar', 'h2.gv-toolbar-title'],
  'log title (h2.gv-logtop-title)': ['main.gv-page', 'div.gv-logtop', 'h2.gv-logtop-title'],
  'section title (h3.gv-section-title span)': ['main.gv-page', 'h3.gv-section-title', 'span'],
  'Start / Next (button.gv-btn-go)': ['main.gv-page', 'div.gv-hero-action', 'button.gv-btn-go.clickable-icon'],
  'Bank it (button.gv-btn-finish span)': ['main.gv-page', 'div.gv-log-foot', 'button.gv-btn-finish.clickable-icon', 'span'],
};
for (const skin of ['floor', 'editorial']) {
  for (const theme of ['light', 'dark']) {
    for (const [label, inner] of Object.entries(TITLES)) {
      check(`${skin}/${theme}: ${label} resolves weight 400`, () => {
        const chain = cx.chainOf([`body.theme-${theme}`, 'div.workspace-leaf-content', `div.view-content.gv-app.gv-skin-${skin}.gv-accent-lime`, ...inner]);
        const w = cx.computed(chain, 'font-weight', rules, HOST);
        assert.ok(w, 'no weight resolves at all');
        assert.strictEqual(w.value, '400', `computes font-weight ${w.value}${w.rule.host ? ' (the host\'s ' + w.rule.selector + ' rule)' : ' from ' + w.rule.selector}: Anton has only 400, so WebKit synthesises a bold`);
      });
    }
  }
}

if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('w4-anton-weight OK');
