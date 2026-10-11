'use strict';
/* THE MUSCLE MAP'S PUSH-UP: the motion, its muscles, and the settings behind
   it (docs/muscle-map-pushups-plan.html, tests 1–7).

   The animation replaces two stock photos as the way the app shows HOW to do
   a push-up, so the figure is held to what a coach would check, not just to
   "it draws something":

     - it is matched to the right exercise and to nothing else,
     - every limb keeps its length all the way through the rep (a forearm
       that stretches is a figure nobody trusts),
     - hands and toes stay planted — a push-up does not slide,
     - it actually reaches depth and lockout,
     - the muscles that light up follow the exercise note's `muscles:` field,
     - every muscle it can draw has a name and a real outline on both bodies.

   All of it is pure (no DOM), so it is tested directly. */
const assert = require('node:assert');

const geom = require('../src/motion-geom');
const body = require('../src/motion-body');
const lib = require('../src/motion-library');
const { DEFAULT_SETTINGS, MUSCLE_GROUPS } = require('../src/constants');

const ex = (name, fm, text) => ({ name, fm: fm || {}, body: text || '' });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const BODIES = ['male', 'female'];

/* ---- 1. matched to Push-ups and nothing else ---- */
{
  assert.ok(lib.motionFor(ex('Push-ups')), '"Push-ups" has the motion');
  assert.ok(lib.motionFor(ex('push-ups ')), 'name match ignores case and stray spaces');
  assert.ok(lib.motionFor(ex('My press-up', { motion: 'push-up' })), 'frontmatter motion: push-up opts any note in');
  assert.strictEqual(lib.motionFor(ex('Goblet Squat')), null, 'no motion yet → photos stay');
  assert.strictEqual(lib.motionFor(ex('Close-grip Push-ups')), null, 'the push-up family is a follow-up, not this build');
  assert.strictEqual(lib.motionFor(ex('Squat', { motion: 'no-such-motion' })), null, 'an unknown motion id is ignored, never thrown');
  assert.strictEqual(lib.motionFor(null), null, 'a missing exercise is not an error');
  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    assert.strictEqual(lib.motionFor(ex('Squat', { motion: k })), null, `motion: ${k} must not find Object.prototype`);
  }
  console.log('ok   1. motionFor matches Push-ups only');
}

const m = lib.motionFor(ex('Push-ups'));
const loop = lib.loopSeconds(m);
assert.ok(loop > 2 && loop < 8, `a rep loop is a few seconds long (got ${loop})`);
const frames = (bodyKey) => Array.from({ length: 60 }, (_, i) => lib.poseAt(m, (i / 60) * loop, bodyKey));

/* ---- 2. every limb keeps its length ---- */
for (const b of BODIES) {
  const fs = frames(b);
  const j0 = fs[0].joints;
  const L = {
    upper: dist(j0.S, j0.E), fore: dist(j0.E, j0.H), farUpper: dist(j0.fS, j0.fE), farFore: dist(j0.fE, j0.fH),
    thigh: dist(j0.hip, j0.knee), shin: dist(j0.knee, j0.ankle), body: dist(j0.ankle, j0.S),
  };
  assert.ok(Math.abs(L.upper - body.BODIES[b].UPPER_ARM) < 0.5, `${b}: upper arm is this body's upper arm`);
  assert.ok(Math.abs(L.fore - body.BODIES[b].FOREARM) < 0.5, `${b}: forearm is this body's forearm`);
  for (const f of fs) {
    const j = f.joints;
    const now = {
      upper: dist(j.S, j.E), fore: dist(j.E, j.H), farUpper: dist(j.fS, j.fE), farFore: dist(j.fE, j.fH),
      thigh: dist(j.hip, j.knee), shin: dist(j.knee, j.ankle), body: dist(j.ankle, j.S),
    };
    for (const k of Object.keys(L)) {
      assert.ok(Number.isFinite(now[k]), `${b}: ${k} is a real number`);
      assert.ok(Math.abs(now[k] - L[k]) < 0.5, `${b}: ${k} stretched from ${L[k].toFixed(2)} to ${now[k].toFixed(2)} at ${f.phase}`);
    }
  }
  console.log(`ok   2. ${b}: limbs keep their length over 60 frames`);
}

/* ---- 3. hands and toes stay planted ---- */
for (const b of BODIES) {
  const fs = frames(b);
  const first = fs[0].joints;
  for (const f of fs) {
    for (const k of ['H', 'fH', 'ankle', 'toe']) {
      assert.ok(dist(f.joints[k], first[k]) < 0.5, `${b}: ${k} drifted ${dist(f.joints[k], first[k]).toFixed(2)}px at ${f.phase}`);
    }
  }
  console.log(`ok   3. ${b}: hands and toes stay planted`);
}

/* ---- 4. it reaches depth and lockout ---- */
for (const b of BODIES) {
  const bottom = lib.poseAtDepth(m, 1, b);
  const chestLow = Math.max(...bottom.parts.torso.map(p => p[1]));
  const gap = geom.FLOOR - chestLow;
  assert.ok(gap >= 0, `${b}: the chest never goes through the floor (gap ${gap.toFixed(1)})`);
  assert.ok(gap <= 18, `${b}: at the bottom the chest is within a fist of the floor (gap ${gap.toFixed(1)}px)`);
  const top = lib.poseAtDepth(m, 0, b);
  const elbow = geom.angleAt(top.joints.E, top.joints.S, top.joints.H);
  assert.ok(elbow >= 165, `${b}: at the top the elbows are near lockout (${elbow.toFixed(1)}°)`);
  const ankleEnd = lib.poseAtDepth(m, 1, b).joints;
  assert.ok(ankleEnd.H[1] > ankleEnd.S[1], `${b}: shoulders stay above the hands`);
  console.log(`ok   4. ${b}: depth ${gap.toFixed(1)}px, lockout ${elbow.toFixed(1)}°`);
}

/* ---- muscles ride their limb smoothly — they never jump sides ----
   A muscle is placed on one side of its segment. If that side is picked by
   a direction that can turn edge-on mid-rep (the arm sweeping back past the
   body's own axis), the triceps flips to the front of the arm for a frame
   and back again: a visible jump. Sampled finely, no muscle may move more
   than a few px between neighbouring frames. */
for (const b of BODIES) {
  const N = 400;
  let prev = null;
  const worst = {};
  for (let i = 0; i <= N; i++) {
    const p = lib.poseAt(m, (i / N) * loop, b);
    const now = Object.fromEntries(lib.REGIONS.map(r => [r.id, geom.centroid(p.parts[r.id])]));
    if (prev) for (const r of lib.REGIONS) worst[r.id] = Math.max(worst[r.id] || 0, dist(now[r.id], prev[r.id]));
    prev = now;
  }
  for (const [id, d] of Object.entries(worst)) assert.ok(d < 2, `${b}: ${id} jumped ${d.toFixed(1)}px between frames`);
  console.log(`ok   ${b}: no muscle jumps (worst ${Math.max(...Object.values(worst)).toFixed(2)}px/frame)`);
}

/* ---- no doubled muscles: each patch of skin belongs to one muscle ----
   In a side view the muscles sit side by side, like a map; two shapes
   stacked on the same spot read as one muscle drawn twice (the front delt
   once hung over the chest in a "bow tie", the obliques ran as a second
   band beside the abs). Overlap is measured by sampling a grid: no pair may
   share more than 8% of the smaller one's area, at the top, middle or
   bottom of the rep. */
{
  const inside = (pt, poly) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  /* every drawn muscle counts — the coloured ones and the neutral context */
  const ALL = lib.REGIONS.concat(lib.CONTEXT);
  for (const b of BODIES) for (const depth of [0, 0.5, 1]) {
    const p = lib.poseAtDepth(m, depth, b);
    const all = Object.values(p.parts).flat();
    const xs = all.map(q => q[0]), ys = all.map(q => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cells = {};
    for (const r of ALL) cells[r.id] = new Set();
    /* Only what you can SEE counts. The renderer draws the near arm over
       the body, and the forearm over the upper arm, so a muscle is hidden
       wherever a limb drawn after its own segment covers it — that is one
       limb in front of another, not a muscle drawn twice. */
    const COVERED_BY = { torso: ['upper', 'fore', 'hand'], thigh: ['upper', 'fore', 'hand'], shin: ['upper', 'fore', 'hand'], upper: ['fore', 'hand'], fore: ['hand'] };
    for (let x = x0; x <= x1; x += 0.5) for (let y = y0; y <= y1; y += 0.5) {
      const pt = [x, y];
      for (const r of ALL) {
        if (COVERED_BY[r.seg].some(k => inside(pt, p.parts[k]))) continue;
        if (inside(pt, p.parts[r.id])) cells[r.id].add(`${x},${y}`);
      }
    }
    const ids = ALL.map(r => r.id);
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const A = cells[ids[i]], B = cells[ids[j]];
      let both = 0; for (const k of A) if (B.has(k)) both++;
      const share = both / Math.max(1, Math.min(A.size, B.size));
      assert.ok(share <= 0.08, `${b}@${depth}: ${ids[i]} and ${ids[j]} overlap ${(share * 100).toFixed(0)}% — a doubled muscle`);
    }
  }
  console.log('ok   no two muscles are drawn on the same spot');
}

/* The rep goes down, holds, comes up, resets — in that order. */
{
  const seen = [];
  for (let s = 0; s < loop; s += loop / 200) {
    const p = lib.poseAt(m, s, 'male').phase;
    if (seen[seen.length - 1] !== p) seen.push(p);
  }
  assert.deepStrictEqual(seen, ['down', 'hold', 'up', 'top'], 'one rep is down → hold → up → top');
  assert.ok(lib.poseAt(m, loop * 0.5, 'male').load > lib.poseAt(m, loop - 0.05, 'male').load,
    'load is higher mid-rep than at the reset');
  assert.strictEqual(lib.poseAt(m, loop + 0.01, 'male').rep, 1, 'the rep counter advances each loop');
}

/* ---- 5. which muscles light up follows the note ---- */
{
  const sorted = r => ({ prime: r.prime.slice().sort(), hold: r.hold.slice().sort() });
  const r = sorted(lib.muscleRoles(m, ex('Push-ups', { muscles: ['chest', 'triceps', 'core'] })));
  assert.deepStrictEqual(r.prime, ['delt', 'pec', 'tri'], 'chest + triceps from the note, front delt always');
  assert.deepStrictEqual(r.hold, ['abs', 'forearm', 'glute', 'obl', 'quad', 'serr', 'trap'],
    '"core" is listed but in a push-up its job is holding');

  const onlyTri = sorted(lib.muscleRoles(m, ex('Push-ups', { muscles: ['triceps'] })));
  assert.ok(onlyTri.prime.includes('tri') && !onlyTri.prime.includes('pec'), 'editing the note changes what works');
  assert.ok(onlyTri.hold.includes('pec'), 'a muscle the note leaves out still shows — as holding, not vanished');

  const str = sorted(lib.muscleRoles(m, ex('Push-ups', { muscles: 'chest' })));
  assert.ok(str.prime.includes('pec'), 'a single muscle written as a string still counts');

  const none = sorted(lib.muscleRoles(m, ex('Push-ups', {})));
  assert.deepStrictEqual(none.prime, ['delt', 'pec', 'tri'], 'no muscles in the note → the motion\'s own prime movers');

  const odd = sorted(lib.muscleRoles(m, ex('Push-ups', { muscles: ['back', 'Chest'] })));
  assert.ok(odd.prime.includes('pec'), 'case is ignored');
  const all = odd.prime.concat(odd.hold);
  assert.strictEqual(new Set(all).size, all.length, 'no region is both working and holding');
  assert.strictEqual(all.length, lib.REGIONS.length, 'every region has exactly one role');
  console.log('ok   5. muscle roles follow the note');
}

/* ---- 6. every region is named and drawable on both bodies ---- */
{
  assert.strictEqual(lib.REGIONS.length, 10, 'ten muscles: the six from the design plus four new');
  for (const r of lib.REGIONS) {
    assert.ok(r.label && r.latin, `${r.id}: has a plain name and a Latin name`);
    assert.ok(MUSCLE_GROUPS.includes(r.group), `${r.id}: its group "${r.group}" is one of MUSCLE_GROUPS`);
  }
  /* A region id must never shadow a body part: they share one parts map,
     and the forearm muscle once silently replaced the forearm itself. */
  const bodyParts = Object.keys(lib.poseAtDepth(m, 0, 'male').parts).filter(k => !lib.REGIONS.concat(lib.CONTEXT).some(r => r.id === k));
  for (const k of ['torso', 'thigh', 'shin', 'upper', 'fore', 'hand', 'neck', 'foot', 'skull', 'ear']) {
    assert.ok(bodyParts.includes(k), `body part ${k} survives next to the muscle regions`);
  }
  const region = lib.REGIONS.concat(lib.CONTEXT).map(r => r.id);
  assert.ok(!region.some(id => ['torso', 'thigh', 'shin', 'upper', 'fore', 'hand', 'neck', 'foot', 'skull', 'ear',
    'farUpper', 'farFore', 'farHand', 'farThigh', 'farShin', 'farFoot'].includes(id)), 'no region id is a body part name');
  for (const b of BODIES) {
    for (const depth of [0, 0.5, 1]) {
      const p = lib.poseAtDepth(m, depth, b);
      for (const r of lib.REGIONS) {
        const pts = p.parts[r.id];
        assert.ok(Array.isArray(pts) && pts.length >= 6, `${b}@${depth}: ${r.id} has an outline`);
        assert.ok(pts.every(q => Number.isFinite(q[0]) && Number.isFinite(q[1])), `${b}@${depth}: ${r.id} has no NaN`);
        assert.ok(/^M[-\d.]+ [-\d.]+(C[-\d. ]+)+Z$/.test(geom.smooth(pts)), `${b}@${depth}: ${r.id} becomes a closed path`);
      }
      for (const k of ['torso', 'thigh', 'shin', 'upper', 'fore', 'hand', 'skull', 'ear']) {
        assert.ok(p.parts[k] && p.parts[k].length >= 4, `${b}@${depth}: body part ${k} is drawn`);
      }
    }
  }
  /* The two bodies are genuinely different builds, not one body twice:
     she is shorter with shorter, slimmer arms; he has the V (chest and upper
     back deeper than the waist); she has the hourglass (hips and glutes
     wider than the waist) and a bun. */
  const M = body.BODIES.male, F = body.BODIES.female;
  const wid = (spec, s) => geom.wAt(spec, s, 1) + geom.wAt(spec, s, 2);
  assert.ok(F.scale < M.scale, 'she is shorter');
  assert.ok(F.UPPER_ARM < M.UPPER_ARM && F.FOREARM < M.FOREARM, 'with shorter arms');
  assert.ok(geom.wAt(F.UPPER, 0.45, 1) < geom.wAt(M.UPPER, 0.45, 1) * 0.8, 'and slimmer ones');
  assert.ok(wid(M.TORSO, 0.8) / wid(M.TORSO, 0.4) > 1.4, 'his chest is far deeper than his waist (the V)');
  assert.ok(wid(F.TORSO, 0.08) / wid(F.TORSO, 0.42) > 1.6, 'her hips are far wider than her waist (the hourglass)');
  assert.ok(wid(F.TORSO, 0.08) > wid(M.TORSO, 0.06), 'her hips are fuller than his');
  assert.ok(wid(M.TORSO, 0.8) > wid(F.TORSO, 0.8) - 1 && geom.wAt(M.TORSO, 0.8, 1) > geom.wAt(F.TORSO, 0.8, 1), 'his upper back is thicker');
  assert.ok(lib.poseAtDepth(m, 0, 'female').parts.bun, 'she has a bun');
  assert.ok(!lib.poseAtDepth(m, 0, 'male').parts.bun, 'he does not');
  const span = b => { const j = lib.poseAtDepth(m, 0, b).joints; return dist(j.ankle, j.S); };
  assert.ok(span('female') < span('male') * 0.95, 'and the whole figure is shorter, not just narrower');
  console.log('ok   6. ten regions, named and drawable on both bodies');
}

/* ---- 7. settings: flat keys with safe fallbacks ---- */
{
  assert.strictEqual(DEFAULT_SETTINGS.exerciseVisual, 'basic');
  assert.strictEqual(DEFAULT_SETTINGS.exerciseBody, 'male');
  const old = Object.assign({}, DEFAULT_SETTINGS, { gymFolder: 'Gym' }); // a settings file saved before this feature
  assert.deepStrictEqual(lib.visualPrefs(old), { detail: 'basic', body: 'male' });
  assert.deepStrictEqual(lib.visualPrefs({ exerciseVisual: 'detailed', exerciseBody: 'female' }), { detail: 'detailed', body: 'female' });
  assert.deepStrictEqual(lib.visualPrefs({ exerciseVisual: 'loud', exerciseBody: 7 }), { detail: 'basic', body: 'male' },
    'a hand-edited or corrupt value falls back, never breaks the page');
  assert.deepStrictEqual(lib.visualPrefs(undefined), { detail: 'basic', body: 'male' });
  console.log('ok   7. settings default to basic + male and normalise bad values');
}

/* ---- the note's numbered steps feed the Detailed caption ---- */
{
  const text = '1. Hands under the shoulders, body one straight line.\n2. Lower until the **chest** nearly touches.\n3. Press up to lockout.\n\n**Cue:** elevate hands if tough.';
  assert.deepStrictEqual(lib.noteSteps(text), [
    'Hands under the shoulders, body one straight line.',
    'Lower until the chest nearly touches.',
    'Press up to lockout.',
  ]);
  assert.deepStrictEqual(lib.noteSteps(''), []);
  assert.deepStrictEqual(lib.noteSteps(undefined), []);
  assert.deepStrictEqual(lib.noteSteps('Just a paragraph, no steps.'), []);
  console.log('ok   steps come from the note\'s numbered lines');
}

/* ---- the loop's depth, without building a pose: what pausing and stepping stand on ---- */
{
  for (const id of Object.keys(lib.MOTIONS)) {
    const mo = lib.MOTIONS[id], total = lib.loopSeconds(mo);
    for (let t = 0; t < total * 2.5; t += 0.137) {
      const ph = lib.phaseAt(mo, t);
      assert.ok(Math.abs(ph.depth - lib.poseAt(mo, t, 'male').depth) < 1e-9, `${id}: depthAt and poseAt agree at ${t.toFixed(2)}s`);
      assert.strictEqual(ph.rep, lib.poseAt(mo, t, 'male').rep, `${id}: and on which rep it is`);
    }
    for (const d of [1, 0.5, 0]) {
      const t = lib.timeAtDepth(mo, d);
      assert.ok(t >= 0 && t < total, `${id}: timeAtDepth(${d}) is inside the loop`);
      assert.ok(Math.abs(lib.depthAt(mo, t) - d) < 0.01, `${id}: the figure is ${d} deep at the time it names (${lib.depthAt(mo, t).toFixed(3)})`);
    }
    assert.ok(lib.timeAtDepth(mo, 0.5) < lib.timeAtDepth(mo, 1), `${id}: halfway comes before the hardest point, on the way in`);
    assert.strictEqual(lib.loadOf(0), 0.3);
    assert.strictEqual(lib.loadOf(1), 1);
  }
  console.log('ok   depthAt / timeAtDepth: one function under poseAt, so a paused figure resumes from the pose it shows');
}

console.log('muscle map motion OK');
