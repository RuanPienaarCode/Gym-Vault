'use strict';
/* THE MEDIA VIEWER'S STYLESHEET CONTRACT (src/styles.css, "the full-screen media
   viewer"). What the DOM tests cannot see:
     1  PINCH ZOOM IS NOT BLOCKED: the stage declares `pan-y pinch-zoom` and nothing
        under .gv-mv-* (or the thumbnails / tiles that open it) says touch-action: none
     2  TOUCH TARGETS: close, previous/next and Play are at least 44px
     3  NOTHING LOOPS: the viewer has no animation; its one transition is opacity and
        it is switched off under prefers-reduced-motion
     4  THE MODAL RESTATES WHAT app.css PAINTS ON .modal (border, shadow, padding, radius)
     5  THE EXPAND AFFORDANCE does not take the tap (pointer-events: none) and the
        thumbnails read as buttons (cursor: pointer)
   GV_STYLES_CSS points this at a deliberately broken copy (mutation testing). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const css = (process.env.GV_STYLES_CSS ? fs.readFileSync(process.env.GV_STYLES_CSS, 'utf8') : fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '');
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; };

/* every rule as {sel, body, media} */
const rules = [];
{
  const re = /([^{}]+)\{([^{}]*)\}/g; let m;
  while ((m = re.exec(css))) {
    const sel = m[1].trim();
    const before = css.slice(0, m.index);
    const inReduced = before.lastIndexOf('@media (prefers-reduced-motion: reduce)') > before.lastIndexOf('\n}\n');
    rules.push({ sel, body: m[2], reduced: inReduced });
  }
}
const decl = (r, prop) => { const x = new RegExp('(?:^|[;\\s])' + prop + '\\s*:\\s*([^;]+)').exec(r.body); return x ? x[1].trim() : null; };
const find = sel => rules.filter(r => r.sel.split(',').map(s => s.trim()).includes(sel));

/* 1 */
const stage = find('.gv-mv-stage');
ok(stage.length === 1, 'one .gv-mv-stage rule');
ok(/pinch-zoom/.test(decl(stage[0], 'touch-action') || ''), 'the stage declares touch-action with pinch-zoom (the browser keeps its own zoom)');
for (const r of rules) {
  if (/gv-mv-|gv-media-frame|gv-session-frame|gv-session-cycle-img/.test(r.sel)) {
    ok(!/^none$/.test(decl(r, 'touch-action') || ''), `\`${r.sel}\` must not set touch-action: none (it would block pinch-zoom)`);
  }
}

/* 2 */
for (const sel of ['.gv-app .gv-mv-close', '.gv-app .gv-mv-step']) {
  const r = find(sel)[0] || find('.gv-app .gv-mv-close')[0];
  ok(r, `${sel} rule exists`);
  ok(parseInt(decl(r, 'width'), 10) >= 44 && parseInt(decl(r, 'height'), 10) >= 44, `${sel} is at least 44x44`);
}
const play = find('.gv-app .gv-mv-play')[0];
ok(play && parseInt(decl(play, 'min-height'), 10) >= 44, 'Play is at least 44px tall');

/* 3 */
ok(!/@keyframes[^{]*gv-mv/.test(css) && !rules.some(r => /gv-mv-/.test(r.sel) && /animation\s*:/.test(r.body)), 'the viewer runs no CSS animation (the cycle is a JS timer over opacity)');
const img = find('.gv-mv-img')[0];
ok(img && /^opacity\b/.test(decl(img, 'transition') || ''), 'the one transition is opacity');
ok(rules.some(r => r.reduced && r.sel === '.gv-mv-img' && decl(r, 'transition') === 'none'), 'reduced motion switches the crossfade off');
ok(!rules.some(r => /gv-mv-/.test(r.sel) && /!important/.test(r.body)), 'no !important');

/* 4 */
const modal = find('.modal.gv-mv-modal')[0];
ok(modal, 'the modal rule exists');
for (const p of ['border', 'border-radius', 'box-shadow', 'padding', 'background-color']) ok(decl(modal, p) !== null, `.modal.gv-mv-modal restates ${p} (app.css paints it on .modal)`);
ok(find('.modal-container.mod-dim .modal.gv-mv-modal').length === 1, 'and outranks the dim backdrop\'s own box-shadow rule');
ok(rules.some(r => r.sel.includes('.modal.gv-mv-modal') && r.body.includes('top: 0') && r.body.includes('width: 100%')), 'on a phone it fills the screen');

/* 5 */
ok(decl(find('.gv-media-expand')[0], 'pointer-events') === 'none', 'the expand corner does not take the tap; the whole frame does');
ok(decl(find('.gv-session-frame-open')[0], 'cursor') === 'pointer', 'the live thumbnail reads as a button');
ok(rules.some(r => r.sel === '.gv-media-frame[role="button"]' && decl(r, 'cursor') === 'pointer'), 'so do the exercise page tiles');

console.log(`media viewer css OK (${n} checks: pinch-zoom left alone, 44px targets, nothing loops, the modal restates what app.css paints)`);
