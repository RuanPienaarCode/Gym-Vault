'use strict';
/* OBSIDIAN'S TITLE BAR WEARS THE GYM'S PAPER.

   The leaf header (back/forward, the "Gym" title) sits outside .gv-app, where
   the skin tokens never reach, and Obsidian paints it with
   --background-primary: white in light mode, above a tinted gym. This copies
   the app root's resolved --gv-bg onto the leaf container as
   --background-primary, so the bar matches the style and theme in use.
   Called from controller.syncChrome and on Obsidian's css-change.
   tests/leaf-paper.test.cjs */

function paintLeaf(rootEl, leafEl, win) {
  try {
    if (!rootEl || !leafEl || !leafEl.style || !win || typeof win.getComputedStyle !== 'function') return '';
    const bg = String(win.getComputedStyle(rootEl).getPropertyValue('--gv-bg') || '').trim();
    if (bg) leafEl.style.setProperty('--background-primary', bg);
    else leafEl.style.removeProperty('--background-primary');
    return bg;
  } catch (e) { return ''; }
}

module.exports = { paintLeaf };
