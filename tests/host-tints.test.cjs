'use strict';
/* OBSIDIAN'S BARE `b`, `strong`, `h2` AND `h3` RULES CANNOT TINT THE PLUGIN'S OWN NODES (iOS-safety review, 0.14.0).

   app.css styles every heading and bold node from the THEME's variables:
     h2, h3   { color: var(--hN-color); font-style: var(--hN-style); font-variant: var(--hN-variant); ... }
     b, strong { color: var(--bold-color); font-weight: calc(...) }
   In a default theme those variables are `inherit` / `normal`, so nothing shows. A tinted community theme
   sets them, and wherever the plugin names no value of its own the theme wins: a coloured live-set title,
   an italic small-caps "Session done". Seven classed nodes were exposed (the review named them). The fix
   is a reset on exactly those nodes, so rendered markdown and plan prose (which SHOULD wear the user's
   theme) are untouched.

   Like apex-review-notes.test.cjs, app.css is Obsidian's proprietary file and absent in CI, so the rules
   needed are restated as data (Obsidian 1.14.4 app.css: `h2, .markdown-rendered h2` ~13148, `h3` ~13187,
   `b, strong` ~14534).

   Named cases:
     T1  each named node is the tag and class the stylesheet is written for (read from the sources)
     T2  with no plugin rules at all the host wins every property the reset covers (the fixture bites)
     T3  with the stylesheet, no host rule wins colour / font-style / font-variant (headings) or colour (bold) on any skin and theme
     T4  the reset overrides nothing the plugin set: a property the plugin's own rules won before the reset is still won by the same rule
     T5  reading surfaces keep the host's styling (prose, how-to, rendered markdown, the plan intro)
     T6  the reset sits in the REVIEW FIXES block, has no !important and no colour literal */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const cx = require('./css-cascade.js');

const SRC = path.join(__dirname, '..', 'src');
const cssPath = process.env.GV_STYLES_CSS || path.join(SRC, 'styles.css');
const css = fs.readFileSync(cssPath, 'utf8');
const rules = cx.load();
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');

const heading = t => ({
  selector: t, line: 0, media: null,
  decls: ['variant', 'letter-spacing', 'line-height', 'size', 'color', 'weight', 'style', 'font'].map(k => {
    const prop = { variant: 'font-variant', size: 'font-size', weight: 'font-weight', style: 'font-style', font: 'font-family' }[k] || (k === 'color' ? 'color' : k);
    return { prop, value: k === 'weight' ? 'var(--font-weight)' : `var(--${t}-${k})` };
  }),
});
const bold = sel => ({ selector: sel, line: 0, media: null, decls: [{ prop: 'font-weight', value: 'calc(var(--font-weight) + var(--bold-modifier))' }, { prop: 'color', value: 'var(--bold-color)' }] });
const HOST = [heading('h2'), heading('h3'), bold('b'), bold('strong')];

/* [label, source file, the tag+class the source builds, the chain the stylesheet is written against, props the reset is about] */
const HEADING_PROPS = ['color', 'font-style', 'font-variant'];
const NODES = [
  ['h2.gv-live-name', 'page-session.js', /el\('h2', \{ class: '[^']*\bgv-live-name\b/, ['div.gv-session-page', 'div.gv-live-head', 'div.gv-live-headtext', 'h2.gv-display.gv-session-exname.gv-live-name'], HEADING_PROPS],
  ['h2.gv-session-complete-title', 'page-session.js', /el\('h2', \{ class: '[^']*\bgv-session-complete-title\b/, ['div.gv-session-complete', 'h2.gv-display.gv-session-complete-title'], HEADING_PROPS],
  ['h3.gv-rw-sec-title', 'rewards-ui.js', /el\('h3', \{ class: '[^']*\bgv-rw-sec-title\b/, ['section.gv-rw-medals', 'div.gv-rw-sec', 'h3.gv-section-title.gv-rw-sec-title'], HEADING_PROPS],
  ['h3.gv-rw-profile-level', 'rewards-ui.js', /el\('h3', \{ class: '[^']*\bgv-rw-profile-level\b/, ['article.gv-card.gv-rw-profile', 'div.gv-rw-profile-top', 'div.gv-rw-profile-id', 'h3.gv-rw-profile-level'], HEADING_PROPS],
  ['strong.gv-rw-unlock-name', 'rewards-ui.js', /el\('strong', \{ class: '[^']*\bgv-rw-unlock-name\b/, ['section.gv-rw-unlock', 'div.gv-rw-unlock-text', 'strong.gv-rw-unlock-name'], ['color']],
  ['b.gv-rw-level-title', 'rewards-ui.js', /el\('b', \{ class: '[^']*\bgv-rw-level-title\b/, ['div.gv-slot-level', 'div.gv-rw-level', 'div.gv-rw-level-mid', 'div.gv-rw-level-top', 'b.gv-rw-level-title'], ['color']],
  ['b.gv-badge-num', 'page-dashboard.js', /el\('b', \{ class: '[^']*\bgv-badge-num\b/, ['div.gv-today', 'div.gv-hero.gv-hero-today', 'div.gv-hero-head', 'div.gv-hero-badge', 'div.gv-badge-fig', 'div.gv-badge-in', 'b.gv-badge-num'], ['color']],
];
const THEMES = ['light', 'dark'];
const SKINS = ['floor', 'editorial', 'apex', 'lockin'];
/* The live set's poster (and so its title) exists only under Apex and Lock In; live-poster-css.test.cjs pins that
   every rule that styles a poster node is skin-scoped, and the reset follows it. */
const skinsOf = label => (label === 'h2.gv-live-name' ? ['apex', 'lockin'] : SKINS);

/* the stylesheet up to (not including) the REVIEW FIXES block: what the plugin said before the reset */
const mark = css.indexOf('---------- REVIEW FIXES (0.14.0)');
assert.ok(mark > 0, 'the REVIEW FIXES (0.14.0) block exists at the end of src/styles.css');
const without = cx.parseStylesheet(css.slice(0, mark));

const { check, run } = require('./gym-fake-vault').makeRunner();

check('T1 each named node is the tag and class the stylesheet is written for', () => {
  for (const [label, file, re] of NODES) assert.ok(re.test(read(file)), `${label} is no longer built that way in src/${file}`);
});

check('T2 with no plugin rules at all the host wins every property the reset covers', () => {
  for (const [label, , , inner, props] of NODES) {
    const chain = cx.appChain({ theme: 'light', skin: 'floor' }, ...inner);
    for (const p of props) {
      const hit = cx.declarationsFor(chain, [p], [], HOST)[0];
      assert.ok(hit && hit.rule.host, `fixture: the host rule should reach ${label} ${p}`);
    }
  }
});

check('T3 no host rule wins colour / font-style / font-variant on any skin and theme', () => {
  const bad = [];
  for (const [label, , , inner, props] of NODES) for (const theme of THEMES) for (const skin of skinsOf(label)) {
    const chain = cx.appChain({ theme, skin }, ...inner);
    for (const p of props) {
      const hit = cx.declarationsFor(chain, [p], rules, HOST)[0];
      if (!hit || hit.rule.host) bad.push(`${theme}/${skin}: ${label} ${p} is set by the HOST rule \`${hit ? hit.rule.selector : '(none)'}\``);
    }
  }
  assert.deepStrictEqual(bad, [], 'a tinted theme (--h2-color, --bold-color ...) would restyle these:\n' + bad.join('\n'));
});

check('T4 the reset overrides nothing the plugin set itself', () => {
  const props = ['color', 'font-style', 'font-variant', 'font-weight', 'font-size', 'letter-spacing', 'line-height', 'font-family', 'text-transform'];
  const moved = [];
  for (const [label, , , inner] of NODES) for (const theme of THEMES) for (const skin of skinsOf(label)) {
    const chain = cx.appChain({ theme, skin }, ...inner);
    for (const p of props) {
      const before = cx.declarationsFor(chain, [p], without, HOST)[0];
      const after = cx.declarationsFor(chain, [p], rules, HOST)[0];
      if (before && !before.rule.host && (!after || after.rule.line !== before.rule.line || after.rule.selector !== before.rule.selector)) moved.push(`${theme}/${skin}: ${label} ${p}: \`${before.rule.selector}\` (src/styles.css:${before.rule.line}) no longer wins`);
    }
  }
  assert.deepStrictEqual(moved, [], moved.join('\n'));
});

check('T5 reading surfaces keep the host\'s headings and bold', () => {
  const READING = ['div.gv-howto', 'div.gv-prose', 'div.markdown-rendered', 'div.gv-plan-intro'];
  const bad = [];
  for (const host of READING) for (const theme of THEMES) for (const skin of SKINS) for (const [tag, props] of [['h2', HEADING_PROPS], ['h3', HEADING_PROPS], ['strong', ['color']], ['b', ['color']]]) {
    const chain = cx.appChain({ theme, skin }, host, tag);
    for (const p of props) {
      const hit = cx.declarationsFor(chain, [p], rules, HOST)[0];
      if (hit && !hit.rule.host) bad.push(`${theme}/${skin}: ${host} > ${tag} ${p} is now set by \`${hit.rule.selector}\` (src/styles.css:${hit.rule.line})`);
    }
  }
  assert.deepStrictEqual(bad, [], 'the reset must not reach prose or rendered markdown:\n' + bad.join('\n'));
});

check('T6 the reset is in the REVIEW FIXES block, with no !important and no colour literal', () => {
  const block = css.slice(mark);
  for (const [label] of NODES) assert.ok(block.indexOf(label) >= 0, `${label} has no rule in the REVIEW FIXES block`);
  const decls = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/!important/.test(decls));
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(decls), 'tokens only');
});

run('host-tints');
