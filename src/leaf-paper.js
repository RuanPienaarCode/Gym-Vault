'use strict';
/* OBSIDIAN'S TITLE BAR WEARS THE GYM'S PAPER.

   The leaf header (back/forward, the "Gym" title) sits outside .gv-app, where
   the skin tokens never reach, and Obsidian paints it with
   --background-primary: white in light mode, above a tinted gym. This copies
   the app root's resolved --gv-bg onto the leaf container as
   --background-primary, so the bar matches the style and theme in use.

   BOTH variables are needed (audit 16 Nov 2026, #22). In Obsidian 1.15.1 the
   title bar (.view-header) paints with
   background-color: var(--file-header-background), and
   --file-header-background: var(--background-primary) is declared ONCE at body
   level, so its value is resolved there and an override of --background-primary
   on the leaf never reaches it. Setting --file-header-background on the leaf
   container as well is what makes the header take the gym's colour. Only the
   leaf container is ever written: no body, no .mod-root, no mobile navbar.

   Called from controller.syncChrome and on Obsidian's css-change; clearLeaf is
   called when the view stops, so the paper does not outlive the gym.
   tests/leaf-paper.test.cjs */

const PROPS = ['--background-primary', '--file-header-background'];

function paintLeaf(rootEl, leafEl, win) {
  try {
    if (!rootEl || !leafEl || !leafEl.style || !win || typeof win.getComputedStyle !== 'function') return '';
    const bg = String(win.getComputedStyle(rootEl).getPropertyValue('--gv-bg') || '').trim();
    for (const prop of PROPS) {
      if (bg) leafEl.style.setProperty(prop, bg);
      else leafEl.style.removeProperty(prop);
    }
    return bg;
  } catch (e) { return ''; }
}

/* Take the paper off the leaf (view teardown). Never throws. */
function clearLeaf(leafEl) {
  try {
    if (!leafEl || !leafEl.style) return;
    for (const prop of PROPS) leafEl.style.removeProperty(prop);
  } catch (e) { /* nothing to clear */ }
}

module.exports = { paintLeaf, clearLeaf };
