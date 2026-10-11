'use strict';
/* THE MUSCLE MAP IN THE APP: the guided session, the exercise page and the
   full-screen viewer (docs/muscle-map-pushups-plan.html, test 8, and the
   0.14.0 integration: poster thumbnail, media viewer).

   The session page rebuilds its exercise card on EVERY set. The photo cross-fade
   survives that only because render() kills the previous interval before making
   a new one; an animation loop needs exactly the same discipline or every set
   leaves one more loop running against DOM nobody can see. So this drives the
   REAL session, the REAL exercise page and the REAL viewer with the renderer
   swapped for a recorder, and counts: every map mounted is stopped exactly once
   (by the next render, by leaving the page, or by closing the viewer).

   It also pins the scope: Push-ups gets the map; an exercise without a motion
   keeps its photos exactly as before; and what each place asks the renderer for
   (the thumbnail is the bare figure, the page the full one, the viewer the
   exclusive one). */
const assert = require('node:assert');
const Module = require('node:module');

/* The renderer is replaced BEFORE the harness installs its own loader, so
   the harness chains through this one. */
const mounts = [];
let failMount = false;
const stub = {
  canDraw: () => true,
  mountMuscleMap(host, opts) {
    if (failMount) throw new Error('synthetic: the map could not build');
    const rec = { opts, stops: 0, host };
    mounts.push(rec);
    const n = global.document.createElement('div');
    n.setAttribute('class', opts.mini ? 'gv-mm gv-mm-mini' : 'gv-mm');
    host.appendChild(n);
    const stop = () => { rec.stops++; };
    rec.played = []; rec.stepped = [];
    stop.setPlaying = on => rec.played.push(on);
    stop.isPlaying = () => !!opts.autoPlay;
    stop.step = d => rec.stepped.push(d);
    stop.setDetail = () => {};
    return stop;
  },
};
const prev = Module._load;
Module._load = function (req, ...rest) {
  if (req === './muscle-map') return stub;
  return prev.call(this, req, ...rest);
};
const H = require('./live-session-harness');

const IMAGES = ['https://example.invalid/0.jpg', 'https://example.invalid/1.jpg'];
const exercises = [
  H.ex('Push-ups', { muscles: ['chest', 'triceps', 'core'], image: IMAGES }),
  H.ex('Plank', { unit: 'seconds', image: IMAGES }),
  H.ex('Goblet Squat', { unit: 'kg' }),
];
exercises[0].body = '1. Hands under the shoulders.\n2. Lower.\n3. Press up.';

const results = [];
const check = async (name, fn) => {
  H.killProcess(); H.modals.length = 0; mounts.length = 0;
  H.win.matchMedia = () => ({ matches: false });
  try { await fn(); results.push([name, null]); } catch (e) { results.push([name, e]); }
};
const reduceMotion = () => { H.win.matchMedia = q => ({ matches: /reduce/.test(q) }); };

async function guided(planBody, settings, skin) {
  let saves = 0;
  const b = await H.boot({ exercises, planBody, settings: Object.assign({ skin: skin || 'apex' }, settings || {}), plugin: { saveSettings: async () => { saves++; } } });
  const plan = b.ctx.activePlan();
  b.ctx.startGuided(plan, plan.model.days[0]);
  H.click(H.page(b.ctx).querySelectorAll('button').find(x => /Start/.test(x.textContent)));
  H.advance(6000);
  return Object.assign(b, { saves: () => saves });
}
const thumb = b => H.page(b.ctx).querySelector('.gv-session-frame');
const viewers = () => H.modals.filter(m => m.constructor && m.constructor.name === 'MediaViewerModal');
const SKINS = ['apex', 'lockin', 'floor', 'editorial'];

(async () => {
  /* ================= THE LIVE SET ================= */
  for (const skin of SKINS) {
    await check(`W1. live set (${skin}): Push-ups shows the mini map in the photo frame, with what the settings say`, async () => {
      const b = await guided('## Day A (any)\n\n- Push-ups | 2 x 10\n- Plank | 2 x 30s\n', { exerciseBody: 'female', exerciseVisual: 'detailed' }, skin);
      assert.ok(mounts.length >= 1, 'the Push-ups card mounts a muscle map');
      const first = mounts[mounts.length - 1];
      assert.strictEqual(first.opts.motion.id, 'push-up');
      assert.strictEqual(first.opts.mini, skin === 'apex' || skin === 'lockin' ? 'thumb' : 'frame', 'the live frame gets the bare figure, not the page card: cropped for the 96x72 poster thumbnail, whole for the wide Floor/Editorial frame');
      assert.strictEqual(first.opts.body, 'female', 'the saved body is used');
      assert.strictEqual(first.opts.onEnlarge, undefined, 'the frame, not the map, takes the tap');
      assert.strictEqual(first.opts.autoPlay, true, 'it plays by default');
      assert.strictEqual(H.page(b.ctx).querySelectorAll('.gv-session-cycle-img').length, 0, 'no photo cross-fade underneath it');
      const t = thumb(b);
      assert.ok(t && t.classList.contains('gv-media-frame') && t.classList.contains('gv-session-frame'), 'it is the SAME frame the photos use, so the 72px poster slot and the Floor frame both apply');
      assert.strictEqual(t.getAttribute('role'), 'button');
      assert.strictEqual(t.getAttribute('aria-label'), 'Show Push-ups larger');
      assert.ok(t.querySelector('.gv-media-expand'), 'with the expand corner');
      assert.strictEqual(first.host, t, 'the map is drawn into that frame');
      b.ctx.nav('dashboard');
    });
  }

  await check('W2. every re-render stops the map it replaces, exactly once, on the same clock', async () => {
    const b = await guided('## Day A (any)\n\n- Push-ups | 2 x 10\n- Plank | 2 x 30s\n');
    const first = mounts[mounts.length - 1];
    const clockObj = first.opts.clock;
    assert.ok(clockObj && Number.isFinite(clockObj.t), 'the session hands the map a clock it keeps');
    for (let i = 0; i < 3; i++) {
      const n = mounts.length;
      b.ctx.rerender();
      assert.strictEqual(mounts.length, n + 1, 'a re-render mounts a fresh map');
      assert.strictEqual(mounts[n - 1].stops, 1, 'and stops the previous one exactly once');
      assert.strictEqual(mounts[n].stops, 0, 'the live one keeps running');
      assert.strictEqual(mounts[n].opts.clock, clockObj, 'and it continues on the same clock, not from the top');
    }
    b.ctx.nav('dashboard');
    assert.ok(mounts.every(r => r.stops === 1), `leaving the session stopped the last one too (${mounts.map(r => r.stops).join(',')})`);
  });

  await check('W3. an exercise with no motion keeps its photos', async () => {
    const p = await guided('## Day A (any)\n\n- Plank | 2 x 30s\n');
    assert.strictEqual(mounts.length, 0, 'Plank has no motion: no map');
    assert.ok(H.page(p.ctx).querySelectorAll('.gv-session-cycle-img').length >= 1, 'Plank keeps its photo cross-fade');
    p.ctx.nav('dashboard');
  });

  await check('W4. animateMedia off and reduced motion both ask for the still pose, by the ONE rule', async () => {
    let b = await guided('## Day A (any)\n\n- Push-ups | 2 x 10\n', { animateMedia: false });
    assert.strictEqual(mounts[mounts.length - 1].opts.autoPlay, false, 'Settings: Animate exercise images off -> still');
    b.ctx.nav('dashboard'); mounts.length = 0;
    reduceMotion();
    b = await guided('## Day A (any)\n\n- Push-ups | 2 x 10\n', { animateMedia: true });
    assert.strictEqual(mounts[mounts.length - 1].opts.autoPlay, false, 'reduced motion -> still (the setting is ON: only the media query can do it)');
    b.ctx.nav('dashboard'); mounts.length = 0;
    H.win.matchMedia = () => ({ matches: false });
    b = await guided('## Day A (any)\n\n- Push-ups | 2 x 10\n', { animateMedia: true });
    assert.strictEqual(mounts[mounts.length - 1].opts.autoPlay, true, 'and on otherwise');
    b.ctx.nav('dashboard');
  });

  await check('W5. tapping the thumbnail opens the viewer on the MAP, with the photos one tap away; it counts no rep', async () => {
    const b = await guided('## Day A (any)\n\n- Push-ups | 2 x 10\n');
    const t = thumb(b);
    const before = H.countText(b.ctx);
    H.advance(1500);
    mounts[mounts.length - 1].opts.clock.t = 1234;
    H.click(t);
    const vs = viewers();
    assert.strictEqual(vs.length, 1, 'one viewer opened');
    const v = vs[0];
    assert.strictEqual(v.mode, 'map', 'it opens on the map');
    const vm = mounts[mounts.length - 1];
    assert.strictEqual(vm.opts.exclusive, true, 'the viewer maps are exclusive (the thumbnail pauses under them)');
    assert.strictEqual(vm.opts.mini, undefined, 'and are the full map');
    assert.strictEqual(vm.opts.clock.t, 1234, 'on a copy of the thumbnail clock, so the rep is where it was');
    assert.notStrictEqual(vm.opts.clock, mounts[mounts.length - 2].opts.clock, 'a COPY: the viewer never advances the session clock');
    assert.strictEqual(v.frames.length, 2, 'the photos are available');
    assert.strictEqual(H.countText(b.ctx), before, 'opening it counted no rep');
    assert.strictEqual(vm.stops, 0);
    v.close();
    assert.strictEqual(vm.stops, 1, 'closing the viewer stops its map exactly once');
    v.close();
    assert.strictEqual(vm.stops, 1, 'and closing twice is harmless');
    b.ctx.nav('dashboard');
  });

  await check('W6. the viewer\'s Basic/Detailed switch is remembered (saved once, no re-render, no restart)', async () => {
    const b = await guided('## Day A (any)\n\n- Push-ups | 2 x 10\n', {});
    H.click(thumb(b));
    const saves0 = b.saves(), n = mounts.length;
    mounts[n - 1].opts.onDetail('detailed');
    await H.flush();
    assert.strictEqual(b.settings.exerciseVisual, 'detailed', 'the choice lands in settings');
    assert.strictEqual(b.saves(), saves0 + 1, 'and is saved, once');
    assert.strictEqual(mounts.length, n, 'nothing re-mounted');
    assert.strictEqual(mounts[n - 2].stops, 0, 'the thumbnail under it keeps its loop');
    viewers()[0].close();
    b.ctx.nav('dashboard');
  });

  await check('W7. a map that cannot build never costs the workout: photos instead, logged', async () => {
    failMount = true;
    const realError = console.error; const errors = []; console.error = (...a) => errors.push(a.join(' '));
    try {
      const f = await guided('## Day A (any)\n\n- Push-ups | 2 x 10\n');
      assert.ok(H.page(f.ctx).querySelector('.gv-session-exblock'), 'the session still renders');
      assert.ok(H.page(f.ctx).querySelectorAll('.gv-session-cycle-img').length >= 1, 'with the photos in place of the map');
      f.ctx.nav('exercise', { exercise: 'Push-ups' });
      assert.ok(H.page(f.ctx).querySelectorAll('.gv-media-img').length >= 1, 'the exercise page shows its photos too');
      assert.ok(errors.some(e => /muscle map/.test(e)), 'and the failure is logged, not swallowed');
    } finally { console.error = realError; failMount = false; }
  });

  /* ================= THE EXERCISE PAGE ================= */
  await check('P1. the exercise page: the full map replaces the photo row, with Photos one tap away', async () => {
    const d = await H.boot({ exercises, settings: { exerciseVisual: 'detailed' } });
    d.ctx.nav('exercise', { exercise: 'Push-ups' });
    assert.strictEqual(mounts.length, 1, 'the Push-ups page mounts a map');
    const m = mounts[0];
    assert.strictEqual(m.opts.slot, 'detail', 'in the detail slot, so a re-render replaces it');
    assert.strictEqual(m.opts.mini, undefined, 'the full map');
    assert.strictEqual(m.opts.detail, 'detailed', 'the saved view is used');
    assert.strictEqual(m.opts.body, 'male', 'the default body is male');
    assert.deepStrictEqual(m.opts.steps, ['Hands under the shoulders.', 'Lower.', 'Press up.'], 'the note\'s steps travel with it');
    assert.strictEqual(typeof m.opts.onEnlarge, 'function', 'a tap on it can open the viewer');
    const pg = H.page(d.ctx);
    assert.strictEqual(pg.querySelectorAll('.gv-media-img').length, 0, 'the photos are not shown up front');
    const photos = pg.querySelectorAll('button').find(x => /Photos/.test(x.textContent));
    assert.ok(photos, 'a Photos button keeps the originals one tap away');
    H.click(photos);
    const v = viewers()[0];
    assert.ok(v, 'Photos opens the viewer');
    assert.strictEqual(v.mode, 'photos', 'on the photos');
    assert.strictEqual(v.frames.length, 2);
    v.close();
    m.opts.onEnlarge();
    const v2 = viewers()[1];
    assert.strictEqual(v2.mode, 'map', 'a tap on the map opens the viewer on the map');
    v2.close();
    d.ctx.nav('dashboard');
  });

  await check('P2. the page map: one per render, stopped by a re-render, by another exercise, by leaving', async () => {
    const d = await H.boot({ exercises });
    d.ctx.nav('exercise', { exercise: 'Push-ups' });
    d.ctx.rerender();
    assert.strictEqual(mounts.length, 2, 'a re-render mounts a fresh map');
    assert.strictEqual(mounts[0].stops, 1, 'and stops the old one');
    d.ctx.nav('exercise', { exercise: 'Plank' });
    assert.strictEqual(mounts.length, 2, 'Plank\'s page mounts no map');
    assert.strictEqual(mounts[1].stops, 1, 'and moving to it stopped the Push-ups map');
    assert.ok(H.page(d.ctx).querySelectorAll('.gv-media-img').length >= 1, 'Plank shows its photos as before');
    d.ctx.nav('exercise', { exercise: 'Push-ups' });
    d.ctx.nav('dashboard');
    assert.ok(mounts.every(r => r.stops === 1), `every detail map stopped exactly once (${mounts.map(r => r.stops).join(',')})`);
  });

  await check('P3. the page map follows animateMedia and reduced motion, each on its own, and the Basic/Detailed switch is remembered', async () => {
    const off = await H.boot({ exercises, settings: { animateMedia: false } });
    off.ctx.nav('exercise', { exercise: 'Push-ups' });
    assert.strictEqual(mounts[0].opts.autoPlay, false, 'animateMedia off -> still');
    off.ctx.nav('dashboard'); mounts.length = 0;
    const on = await H.boot({ exercises, settings: { animateMedia: true } });
    on.ctx.nav('exercise', { exercise: 'Push-ups' });
    assert.strictEqual(mounts[0].opts.autoPlay, true, 'animateMedia on and no reduced motion -> plays');
    on.ctx.nav('dashboard'); mounts.length = 0;
    reduceMotion(); // the setting is ON here: only the media query can make it still
    const d = await H.boot({ exercises, settings: { animateMedia: true } });
    d.ctx.nav('exercise', { exercise: 'Push-ups' });
    assert.strictEqual(mounts[0].opts.autoPlay, false, 'reduced motion -> still, whatever the setting says');
    mounts[0].opts.onDetail('detailed');
    await H.flush();
    assert.strictEqual(d.settings.exerciseVisual, 'detailed');
    d.ctx.nav('dashboard');
  });

  await check('P4. an exercise with only a video keeps it reachable beside the map', async () => {
    const vid = H.ex('Push-ups', { muscles: ['chest'], video: 'https://example.invalid/clip.mp4' });
    const d = await H.boot({ exercises: [vid] });
    d.ctx.nav('exercise', { exercise: 'Push-ups' });
    const btn = H.page(d.ctx).querySelectorAll('button').find(x => /Video/.test(x.textContent));
    assert.ok(btn, 'a Video button');
    H.click(btn);
    assert.ok(H.page(d.ctx).querySelector('.gv-media-video'), 'it opens the player inline');
    assert.strictEqual(viewers().length, 0, 'not the (image) viewer');
    d.ctx.nav('dashboard');
  });

  let bad = 0;
  for (const [name, err] of results) {
    if (err) { bad++; console.error(`FAIL ${name}\n  ${err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n  ') : err}`); } else console.log(`ok   ${name}`);
  }
  if (bad) { console.error(`${bad} of ${results.length} wiring cases failed`); process.exit(1); }
  console.log(`muscle map wiring OK (${results.length} cases)`);
})().catch(e => { console.error(e); process.exit(1); });
