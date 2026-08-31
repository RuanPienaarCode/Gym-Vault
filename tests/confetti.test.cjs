'use strict';
/* confetti.js — the simulation, driven against a fake clock and a stub canvas.

   WHAT THIS IS GUARDING: this burst used to advance a hard-coded dt = 1/60
   on every rAF callback. That is only correct on a 60Hz panel — on a
   ProMotion iPhone rAF fires at 120Hz, so the celebration played at double
   speed and was gone before it registered. The frame-rate test below is the
   real point of this file: the same wall-clock time must produce the same
   motion whatever the refresh rate.

   The drawing is not tested (canvas 2D calls have no return value). What IS
   testable is every number computed before one is issued, and that is the
   part that was wrong. */
const assert = require('node:assert');
const confetti = require('../src/confetti');

/* ---------- stubs ---------- */

function makeCtx() {
  const calls = [];
  const rec = name => (...a) => calls.push([name, ...a]);
  return {
    calls,
    setTransform: rec('setTransform'), clearRect: rec('clearRect'),
    save: rec('save'), restore: rec('restore'), translate: rec('translate'),
    rotate: rec('rotate'), scale: rec('scale'), fillRect: rec('fillRect'),
    globalAlpha: 1, fillStyle: '',
  };
}

/* A DOM thin enough to run the module and nothing more. `frames` is the
   fake vsync queue; `tick(ms)` advances the clock by one frame. */
function makeEnv(opts) {
  const o = opts || {};
  const ctx = makeCtx();
  const body = { children: [], appendChild(n) { this.children.push(n); n.parentNode = this; },
                 removeChild(n) { this.children = this.children.filter(c => c !== n); n.parentNode = null; } };
  let queue = [], nextId = 1, now = 0;
  const win = {
    innerWidth: 400, innerHeight: 800, devicePixelRatio: 1,
    performance: { now: () => now },
    matchMedia: () => ({ matches: !!o.reducedMotion }),
    getComputedStyle: () => ({ getPropertyValue: v => (o.noColors ? '' : '#84cc16') }),
    requestAnimationFrame(cb) { const id = nextId++; queue.push({ id, cb }); return id; },
    cancelAnimationFrame(id) { queue = queue.filter(f => f.id !== id); },
  };
  const doc = {
    defaultView: win, body,
    createElement: () => ({
      style: {}, className: '', parentNode: null,
      getContext: () => (o.noCanvas ? null : ctx),
    }),
  };
  const host = { ownerDocument: doc };
  return {
    host, ctx, body, win,
    tick(ms) { now += ms; const due = queue; queue = []; due.forEach(f => f.cb(now)); },
    pending: () => queue.length,
    nowMs: () => now,
  };
}

/* Positions are read back off the translate() calls — the only place the
   module reveals where a piece actually is. */
function positions(ctx) {
  return ctx.calls.filter(c => c[0] === 'translate').map(c => ({ x: c[1], y: c[2] }));
}
function lastFramePositions(ctx, count) {
  const all = positions(ctx);
  return all.slice(all.length - count);
}

/* ---------- 1. frame-rate independence (the regression that mattered) ---- */

/* Same origin, same seed sequence: drive one env at 60fps and one at 120fps
   over the SAME wall-clock span. A fixed-dt implementation moves the 120Hz
   copy twice as far; a measured-dt one lands them together. */
{
  const seeded = () => { let s = 12345; return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648; };
  const realRandom = Math.random;

  Math.random = seeded();
  const a = makeEnv();
  confetti.burst(a.host, { origin: { x: 200, y: 300 } });
  for (let i = 0; i < 60; i++) a.tick(1000 / 60);   // 1000ms at 60fps

  Math.random = seeded();
  const b = makeEnv();
  confetti.burst(b.host, { origin: { x: 200, y: 300 } });
  for (let i = 0; i < 120; i++) b.tick(1000 / 120); // 1000ms at 120fps

  Math.random = realRandom;

  const pa = lastFramePositions(a.ctx, 90);
  const pb = lastFramePositions(b.ctx, 90);
  assert.strictEqual(pa.length, 90, '60fps run must draw all 90 pieces');
  assert.strictEqual(pb.length, 90, '120fps run must draw all 90 pieces');

  let worst = 0;
  for (let i = 0; i < pa.length; i++) {
    worst = Math.max(worst, Math.abs(pa[i].x - pb[i].x), Math.abs(pa[i].y - pb[i].y));
  }
  /* Integration error between step sizes is unavoidable; a doubling of speed
     is not. At 1s in, pieces have fallen ~200px — a fixed-dt bug shows up
     here as a divergence of that order, not a few px. */
  assert.ok(worst < 12, `120Hz must track 60Hz over the same wall-clock time (worst drift ${worst.toFixed(1)}px)`);
}

/* ---------- 2. the shape: pop outward, then fall ------------------------ */

{
  const env = makeEnv();
  confetti.burst(env.host, { origin: { x: 200, y: 300 } });

  env.tick(16);
  const t0 = lastFramePositions(env.ctx, 90);
  /* Pieces leave a single origin, so at the first frame they are still bunched. */
  const spread0 = Math.max(...t0.map(p => Math.hypot(p.x - 200, p.y - 300)));
  assert.ok(spread0 < 60, `pieces must start bunched at the origin (spread ${spread0.toFixed(0)}px)`);

  /* By ~200ms the impulse has thrown them well clear — that is the explosion. */
  for (let i = 0; i < 12; i++) env.tick(16);
  const t200 = lastFramePositions(env.ctx, 90);
  const spread200 = Math.max(...t200.map(p => Math.hypot(p.x - 200, p.y - 300)));
  assert.ok(spread200 > 90, `pieces must blow outward early (spread ${spread200.toFixed(0)}px at ~200ms)`);

  /* Some must have gone UP: a burst that only rains is the old behaviour. */
  const rose = t200.filter(p => p.y < 300).length;
  assert.ok(rose >= 15, `an upward-biased pop must lift a good share of pieces (only ${rose} above origin)`);

  /* Then gravity wins: by ~1.6s the centre of mass is below where it started
     and still descending. */
  const meanY = ps => ps.reduce((s, p) => s + p.y, 0) / ps.length;
  for (let i = 0; i < 87; i++) env.tick(16);
  const tMid = lastFramePositions(env.ctx, 90);
  for (let i = 0; i < 25; i++) env.tick(16);
  const tLate = lastFramePositions(env.ctx, 90);
  assert.ok(meanY(tMid) > 300, 'by mid-flight the swarm must be below the origin');
  assert.ok(meanY(tLate) > meanY(tMid), 'the swarm must still be falling, not hanging');
}

/* ---------- 3. it ends, and it ends slower than it used to -------------- */

{
  const env = makeEnv();
  confetti.burst(env.host, { origin: { x: 200, y: 300 } });
  let guard = 0;
  while (env.pending() && guard++ < 1000) env.tick(1000 / 60);
  assert.ok(guard < 1000, 'burst must terminate');
  /* The old burst was capped at 1800ms. The complaint was that it was over
     too quickly, so a regression back under ~2.5s is a real regression. */
  assert.ok(env.nowMs() > 2500, `burst must last long enough to watch (ran ${env.nowMs()}ms)`);
  assert.strictEqual(env.body.children.length, 0, 'canvas must be removed when the burst ends');
}

/* ---------- 4. teardown contract --------------------------------------- */

{
  const env = makeEnv();
  const stop = confetti.burst(env.host, { origin: { x: 200, y: 300 } });
  env.tick(16);
  assert.strictEqual(env.body.children.length, 1, 'canvas is mounted while running');
  stop();
  assert.strictEqual(env.body.children.length, 0, 'stop() removes the canvas');
  assert.strictEqual(env.pending(), 0, 'stop() cancels the pending frame');
  stop();  /* idempotent — controller.js may tear down twice */
  assert.strictEqual(env.body.children.length, 0, 'stop() is safe to call twice');
}

/* ---------- 5. the no-op paths still hand back a callable --------------- */

for (const [name, opts] of [['reduced motion', { reducedMotion: true }], ['no canvas 2D', { noCanvas: true }]]) {
  const env = makeEnv(opts);
  const stop = confetti.burst(env.host);
  assert.strictEqual(typeof stop, 'function', `${name} must still return a canceller`);
  stop();
  assert.strictEqual(env.body.children.length, 0, `${name} must mount nothing`);
}
assert.strictEqual(typeof confetti.burst(null), 'function', 'no host must still return a canceller');

/* A skin that resolves no accent vars must still paint something. */
{
  const env = makeEnv({ noColors: true });
  confetti.burst(env.host);
  env.tick(16);
  assert.ok(env.ctx.calls.some(c => c[0] === 'fillRect'), 'missing accent vars must fall back, not blank out');
}

console.log('confetti: all assertions passed');
