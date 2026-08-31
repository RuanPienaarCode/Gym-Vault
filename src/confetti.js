'use strict';
/* Hand-rolled canvas confetti — no libraries, no network, no innerHTML (a
   <canvas> paints itself; nothing here is markup). Reads the CURRENT
   --gv-lime* custom properties off the app root via getComputedStyle so a
   burst always matches the user's chosen skin/accent, with no new hex added
   here (sealed palette — see styles.css's ACCENT PALETTES banner).

   A rare celebration by design (record broken, goal reached, or a session
   that landed one of those — see page-session.js for the trigger rules);
   this module only knows how to draw one burst and clean itself up.

   SHAPE: a pop, then a fall. Pieces leave a single origin on a radial
   impulse with an upward bias, air drag kills that impulse inside ~half a
   second, and from there gravity and a per-piece sway carry them down at a
   capped terminal speed. The two phases are one continuous simulation, not
   two animations spliced together — drag is what hands the piece from the
   explosion to the fall, so there is no seam to get wrong.

   FRAME-RATE: the step is REAL elapsed time, never a fixed 1/60. This
   module used to advance a hard-coded dt = 1/60 per rAF callback, which is
   only correct on a 60Hz panel — on a ProMotion iPhone or a 120Hz display
   rAF fires twice as often, so the whole burst played at DOUBLE SPEED and
   was over before it read as anything. Anything time-based added here must
   keep using the measured delta. */

const COLOR_VARS = ['--gv-lime', '--gv-lime-hi', '--gv-lime-deep'];
const DURATION_MS = 3400;   /* pop + a fall long enough to watch land */
const FADE_MS = 800;        /* tail fade, so the burst ends rather than cuts */
const PIECE_COUNT = 90;
const GRAVITY = 260;        /* px/s^2 — deliberately under real gravity: paper */
const DRAG = 1.9;           /* per-second exponential decay of the pop impulse */
const TERMINAL_VY = 330;    /* px/s fall cap — above this pieces read as streaks */
const MAX_STEP_S = 0.05;    /* clamp: a backgrounded tab must not teleport them */

function prefersReducedMotion(win) {
  const w = win || window;
  return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/* Fires one burst anchored to `hostEl` (pass the .gv-app root so
   getComputedStyle resolves the LIVE skin/accent classes). `opts.origin`
   ({x, y} in CSS pixels) moves the blast centre; it defaults to a little
   above the middle of the viewport, which is where the eye already is when
   a record callout has just appeared. Returns a canceller — call it to stop
   early and remove the canvas (navigation / unmount safety); it's always
   safe to call more than once.

   No-op (returns a no-op canceller) when reduced motion is requested or
   canvas/rAF aren't available — callers still show their text callout
   regardless of whether the animation actually played. Never throws: a
   confetti failure must never break set logging. */
function burst(hostEl, opts) {
  try {
    if (!hostEl) return () => {};
    const doc = hostEl.ownerDocument || document;
    const win = (doc.defaultView) || window;
    /* Ask the host's OWN window, not the global one: in an Obsidian popout
       the burst is drawn in a second window that can carry a different
       reduced-motion answer than the main one. */
    if (prefersReducedMotion(win)) return () => {};
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

    const o = opts || {};
    const origin = o.origin || {};
    const ox = typeof origin.x === 'number' ? origin.x : w / 2;
    const oy = typeof origin.y === 'number' ? origin.y : h * 0.42;

    const rand = (a, b) => a + Math.random() * (b - a);
    const pieces = Array.from({ length: PIECE_COUNT }, () => {
      /* Radial, then biased upward. A symmetric ring reads as a shockwave;
         the upward push is what makes it read as thrown rather than dropped,
         and it buys the fall the height it needs to be visible at all. */
      const angle = rand(0, Math.PI * 2);
      const speed = rand(260, 640);
      return {
        x: ox + Math.cos(angle) * rand(0, 14),
        y: oy + Math.sin(angle) * rand(0, 14),
        w: rand(5, 10), h: rand(8, 16),
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - rand(140, 300),
        rot: rand(0, Math.PI * 2), vr: rand(-5, 5),
        flip: rand(0, Math.PI * 2), vf: rand(2.2, 6),
        sway: rand(8, 30), swayPhase: rand(0, Math.PI * 2), swaySpeed: rand(1.4, 3.2),
        color: colors[Math.floor(Math.random() * colors.length)],
      };
    });

    const start = win.performance ? win.performance.now() : Date.now();
    let last = start;
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
      /* Measured, not assumed — see the FRAME-RATE note above. */
      const dt = Math.min(MAX_STEP_S, Math.max(0, (now - last) / 1000));
      last = now;
      const drag = Math.exp(-DRAG * dt);

      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, w, h);
      ctx2d.globalAlpha = t > DURATION_MS - FADE_MS
        ? Math.max(0, (DURATION_MS - t) / FADE_MS)
        : 1;

      let airborne = 0;
      for (const p of pieces) {
        /* Drag first, then gravity: the impulse decays, the pull does not.
           That ordering is the whole pop-to-fall handover. */
        p.vx *= drag;
        p.vy *= drag;
        p.vy += GRAVITY * dt;
        if (p.vy > TERMINAL_VY) p.vy = TERMINAL_VY;

        p.swayPhase += p.swaySpeed * dt;
        p.x += (p.vx + Math.sin(p.swayPhase) * p.sway) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.flip += p.vf * dt;

        if (p.y < h + 40) airborne++;

        ctx2d.save();
        ctx2d.translate(p.x, p.y);
        ctx2d.rotate(p.rot);
        /* Tumble: the piece is a rectangle seen edge-on now and then, which
           is what stops 90 identical blocks reading as a swarm of pixels. */
        ctx2d.scale(1, Math.cos(p.flip));
        ctx2d.fillStyle = p.color;
        ctx2d.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx2d.restore();
      }

      /* Nothing left on screen is the real end; the duration is only a cap. */
      if (t >= DURATION_MS || airborne === 0) { stop(); return; }
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
