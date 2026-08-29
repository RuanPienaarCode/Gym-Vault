'use strict';
/* Hand-rolled canvas confetti — no libraries, no network, no innerHTML (a
   <canvas> paints itself; nothing here is markup). Reads the CURRENT
   --gv-lime* custom properties off the app root via getComputedStyle so a
   burst always matches the user's chosen skin/accent, with no new hex added
   here (sealed palette — see styles.css's ACCENT PALETTES banner).

   A rare celebration by design (record broken, goal reached, or a session
   that landed one of those — see page-session.js for the trigger rules);
   this module only knows how to draw one burst and clean itself up. */

const COLOR_VARS = ['--gv-lime', '--gv-lime-hi', '--gv-lime-deep'];
const DURATION_MS = 1800;
const PIECE_COUNT = 80;
const GRAVITY = 420; // px/s^2

function prefersReducedMotion(win) {
  const w = win || window;
  return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* Fires one burst anchored to `hostEl` (pass the .gv-app root so
   getComputedStyle resolves the LIVE skin/accent classes). Returns a
   canceller — call it to stop early and remove the canvas (navigation /
   unmount safety); it's always safe to call more than once.

   No-op (returns a no-op canceller) when reduced motion is requested or
   canvas/rAF aren't available — callers still show their text callout
   regardless of whether the animation actually played. Never throws: a
   confetti failure must never break set logging. */
function burst(hostEl) {
  try {
    if (!hostEl || prefersReducedMotion()) return () => {};
    const doc = hostEl.ownerDocument || document;
    const win = (doc.defaultView) || window;
    if (typeof win.requestAnimationFrame !== 'function') return () => {};

    const canvas = doc.createElement('canvas');
    const ctx2d = canvas.getContext && canvas.getContext('2d');
    if (!ctx2d) return () => {};
    canvas.className = 'gv-confetti-canvas';

    const cs = win.getComputedStyle(hostEl);
    const colors = COLOR_VARS.map(v => (cs.getPropertyValue(v) || '').trim()).filter(Boolean);
    if (!colors.length) colors.push('#84cc16');

    const dpr = win.devicePixelRatio || 1;
    const w = win.innerWidth, h = win.innerHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    doc.body.appendChild(canvas);

    const rand = (a, b) => a + Math.random() * (b - a);
    const pieces = Array.from({ length: PIECE_COUNT }, () => ({
      x: rand(0, w), y: rand(-40, -4),
      w: rand(5, 10), h: rand(8, 16),
      vx: rand(-60, 60), vy: rand(140, 280),
      rot: rand(0, Math.PI * 2), vr: rand(-6, 6),
      color: colors[Math.floor(Math.random() * colors.length)],
    }));

    const start = win.performance ? win.performance.now() : Date.now();
    let rafId = null, done = false;

    const stop = () => {
      if (done) return;
      done = true;
      if (rafId !== null) win.cancelAnimationFrame(rafId);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };

    const frame = now => {
      if (done) return;
      const t = now - start;
      const dt = 1 / 60;
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, w, h);
      for (const p of pieces) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += GRAVITY * dt;
        p.rot += p.vr * dt;
        ctx2d.save();
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(p.rot);
        ctx2d.fillStyle = p.color;
        ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx2d.restore();
      }
      if (t >= DURATION_MS) { stop(); return; }
      rafId = win.requestAnimationFrame(frame);
    };
    rafId = win.requestAnimationFrame(frame);

    return stop;
  } catch (e) {
    console.error('gym-vault confetti', e);
    return () => {};
  }
}

module.exports = { burst, prefersReducedMotion };
