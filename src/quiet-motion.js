'use strict';
/* CALM MOTION — Settings › Calm motion.

   For someone the gym's movement distracts: no confetti, no looping pulse,
   flicker, blink or marquee, and exercise images held still. The app root and
   the gym's modals carry QUIET_CLASS; styles.css gives every
   prefers-reduced-motion rule a twin scoped to it (quietTwin below names the
   twin; tests/quiet-motion.test.cjs pins one per rule), so the class does
   exactly what the OS setting does, and nothing riskier. */

const QUIET_CLASS = 'gv-quiet-motion';

function quietMotionOn(settings) {
  const v = settings ? settings.quietMotion : undefined;
  return v === true || v === 'true';
}

/* The selector a reduced-motion rule's twin uses: the class goes ON the
   .gv-app root (after its skin classes) when the selector names it,
   otherwise above the selector. */
function quietTwin(sel) {
  const s = String(sel).trim().replace(/\s+/g, ' ');
  const i = s.indexOf('.gv-app');
  if (i < 0) return `.${QUIET_CLASS} ${s}`;
  /* the END of the root compound, so skin classes still lead (.gv-app.gv-skin-x.gv-quiet-motion) */
  let at = i + '.gv-app'.length;
  while (at < s.length && /[\w.-]/.test(s[at])) at++;
  return s.slice(0, at) + '.' + QUIET_CLASS + s.slice(at);
}

module.exports = { QUIET_CLASS, quietMotionOn, quietTwin };
