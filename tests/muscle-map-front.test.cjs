'use strict';
/* THE FRONT-VIEW MOTIONS: the bodyweight squat and the pull-up, seen from
   the front — and the checks every motion owes, run over all three.

   A front view is where a fake would show: a squat drawn flat has thighs
   that stay the same length as they bend. So the squat is solved in 3D
   (feet planted, pelvis down and back, knees by IK) and only then
   flattened — its BONES keep their length in 3D while their drawn length
   shrinks as the thighs come toward the camera. These tests hold it to what
   a coach checks: depth, knees tracking out, the chin clearing the bar,
   and a body that is the same on both sides. */
const assert = require('node:assert');

const geom = require('../src/motion-geom');
const lib = require('../src/motion-library');

const ex = (name, fm) => ({ name, fm: fm || {}, body: '' });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], (a[2] || 0) - (b[2] || 0));
const BODIES = ['male', 'female'];
const inside = (pt, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/* ---- which exercise gets which ---- */
const squatSide = lib.motionFor(ex('Bodyweight Squat'));
const squat = lib.MOTIONS['squat-front'];
const pull = lib.motionFor(ex('Pull-ups'));
{
  assert.ok(squatSide && squatSide.id === 'squat' && squatSide.view === 'side', 'Bodyweight Squat opens on the side view');
  assert.deepStrictEqual(squatSide.views, ['squat', 'squat-front'], 'with the front view one switch away');
  assert.ok(squat && squat.view === 'front' && squat.views === squatSide.views || JSON.stringify(squat.views) === JSON.stringify(squatSide.views), 'the front squat knows its side twin');
  assert.ok(pull && pull.id === 'pull-up' && pull.view === 'front', 'Pull-ups is the front-view pull-up');
  assert.strictEqual(lib.motionFor(ex('pull-up')).id, 'pull-up');
  assert.strictEqual(lib.motionFor(ex('Goblet Squat')), null, 'loaded squats are a follow-up');
  assert.strictEqual(lib.motionFor(ex('Chin-ups')), null, 'chin-ups are a follow-up');
  assert.strictEqual(lib.motionFor(ex('Push-ups')).view, 'side', 'the push-up stays a side view');
  console.log('ok   squat and pull-up are matched by name');
}

const ALL = [lib.motionFor(ex('Push-ups')), squatSide, squat, pull];
const frames = (m, b, n = 80) => Array.from({ length: n }, (_, i) => lib.poseAt(m, (i / n) * lib.loopSeconds(m), b));

/* ---- squat: bones keep their 3D length; feet planted; depth; knees out ---- */
for (const b of BODIES) {
  const fs = frames(squat, b);
  const j0 = fs[0].joints3;
  const len3 = j => ({ thigh: dist(j.hip, j.knee), shin: dist(j.knee, j.ankle), upper: dist(j.S, j.E), fore: dist(j.E, j.H), torso: dist(j.pc, j.sc) });
  const L0 = len3(j0);
  let shortest = Infinity;
  for (const f of fs) {
    const L = len3(f.joints3);
    for (const k of Object.keys(L0)) assert.ok(Math.abs(L[k] - L0[k]) < 0.5, `${b}: squat ${k} changed length in 3D (${L0[k].toFixed(1)} → ${L[k].toFixed(1)})`);
    assert.ok(dist(f.joints.ankle, fs[0].joints.ankle) < 0.5 && dist(f.joints.ankle_l, fs[0].joints.ankle_l) < 0.5, `${b}: feet stay planted`);
    shortest = Math.min(shortest, dist(f.joints.hip, f.joints.knee));
  }
  assert.ok(shortest < L0.thigh * 0.8, `${b}: the thigh is drawn foreshortened as it comes toward the camera (${shortest.toFixed(1)} of ${L0.thigh.toFixed(1)})`);

  const bottom = lib.poseAtDepth(squat, 1, b).joints, top = lib.poseAtDepth(squat, 0, b).joints;
  assert.ok(bottom.hip[1] >= bottom.knee[1] - 6, `${b}: at the bottom the hips reach knee height (hip ${bottom.hip[1].toFixed(1)}, knee ${bottom.knee[1].toFixed(1)})`);
  assert.ok(geom.angleAt(top.knee, top.hip, top.ankle) >= 165, `${b}: standing tall at the top`);
  const cx = squat.geo.cx;
  assert.ok(bottom.knee[0] - cx >= bottom.ankle[0] - cx - 1, `${b}: knees track out over the toes, never caving in`);
  console.log(`ok   ${b}: squat — 3D lengths kept, feet planted, depth to knee height, knees out`);
}

/* ---- squat from the side: the SAME rep — hips back, knees over toes,
   torso lean, depth — and the glutes doing work you can see ---- */
for (const b of BODIES) {
  for (let i = 0; i <= 20; i++) {
    const d = i / 20;
    const side = lib.poseAtDepth(squatSide, d, b).joints3, front = lib.poseAtDepth(squat, d, b).joints3;
    for (const k of ['pc', 'hip', 'knee', 'ankle', 'S', 'E', 'H']) {
      assert.ok(dist(side[k], front[k]) < 1e-6, `${b}@${d}: side and front views draw the same 3D ${k}`);
    }
  }
  const fs = frames(squatSide, b);
  for (const f of fs) assert.ok(dist(f.joints.ankle, fs[0].joints.ankle) < 0.5, `${b}: side squat feet planted`);
  const bot = lib.poseAtDepth(squatSide, 1, b).joints, top = lib.poseAtDepth(squatSide, 0, b).joints;
  assert.ok(bot.hip[0] > bot.ankle[0] + 15, `${b}: from the side the hips travel back behind the heels`);
  assert.ok(bot.knee[0] < bot.ankle[0] - 15, `${b}: and the knees come forward over the toes`);
  assert.ok(bot.S[0] < top.S[0] - 8, `${b}: the torso leans forward`);
  assert.ok(Math.abs(bot.hip[1] - bot.knee[1]) < 8, `${b}: hips reach knee height`);
  const roles = lib.muscleRoles(squatSide, ex('Bodyweight Squat', { muscles: ['quads', 'glutes'] }));
  assert.deepStrictEqual(roles.prime.slice().sort(), ['glute', 'quad'], 'side view: quads and glutes work');
  assert.deepStrictEqual(roles.hold.slice().sort(), ['abs', 'calf', 'erect', 'hams', 'obl'], 'lower back, hamstrings, core and calves hold');
  console.log(`ok   ${b}: side squat — the same rep, hips back, knees forward, lean, depth`);
}

/* ---- pull-up: hands on the bar; chin clears it; elbows out; full hang ---- */
for (const b of BODIES) {
  const fs = frames(pull, b);
  const j0 = fs[0].joints;
  const L0 = { upper: dist(j0.S, j0.E), fore: dist(j0.E, j0.H), thigh: dist(j0.hip, j0.knee), shin: dist(j0.knee, j0.ankle) };
  for (const f of fs) {
    for (const k of Object.keys(L0)) {
      const now = { upper: dist(f.joints.S, f.joints.E), fore: dist(f.joints.E, f.joints.H), thigh: dist(f.joints.hip, f.joints.knee), shin: dist(f.joints.knee, f.joints.ankle) }[k];
      assert.ok(Math.abs(now - L0[k]) < 0.5, `${b}: pull-up ${k} changed length`);
    }
    assert.ok(dist(f.joints.H, j0.H) < 0.5 && dist(f.joints.H_l, j0.H_l) < 0.5, `${b}: hands stay on the bar`);
  }
  const top = lib.poseAtDepth(pull, 1, b), hang = lib.poseAtDepth(pull, 0, b);
  const chin = Math.max(...top.parts.skull.map(p => p[1]));
  assert.ok(chin < pull.geo.barY, `${b}: at the top the chin clears the bar (chin ${chin.toFixed(1)}, bar ${pull.geo.barY})`);
  assert.ok(geom.angleAt(hang.joints.E, hang.joints.S, hang.joints.H) >= 160, `${b}: a full hang at the bottom`);
  assert.ok(top.joints.E[0] > top.joints.S[0], `${b}: elbows drive down and OUT`);
  assert.ok(top.props.some(p => p.kind === 'bar'), 'there is a bar to hang from');
  console.log(`ok   ${b}: pull-up — hands on the bar, chin over it, full hang, elbows out`);
}

/* ---- both sides are the same body ---- */
for (const m of [squat, pull]) for (const b of BODIES) {
  const p = lib.poseAtDepth(m, 0.6, b), cx = m.geo.cx;
  const mir = q => [2 * cx - q[0], q[1]];
  for (const r of m.regions.filter(r => r.mirror !== false)) {
    const R = p.parts[r.id], Lf = p.parts[r.id + '_l'];
    assert.ok(R && Lf && R.length === Lf.length, `${m.id}/${b}: ${r.id} drawn on both sides`);
    R.forEach((q, i) => assert.ok(dist(mir(q), Lf[i]) < 0.01, `${m.id}/${b}: ${r.id} left is the mirror of right`));
  }
  for (const k of ['thigh', 'shin', 'upper', 'fore', 'hand', 'foot']) {
    assert.ok(p.parts[k] && p.parts[k + '_l'], `${m.id}/${b}: ${k} on both sides`);
  }
}
console.log('ok   front views are left/right symmetric');

/* ---- every motion: phases in order, roles, regions named, no jumps, no doubles ---- */
const ORDER = { 'push-up': ['down', 'hold', 'up', 'top'], squat: ['down', 'hold', 'up', 'top'], 'squat-front': ['down', 'hold', 'up', 'top'], 'pull-up': ['pull', 'hold', 'lower', 'hang'] };
for (const m of ALL) {
  const seen = [];
  for (let s = 0; s < lib.loopSeconds(m); s += lib.loopSeconds(m) / 300) {
    const ph = lib.poseAt(m, s, 'male').phase;
    if (seen[seen.length - 1] !== ph) seen.push(ph);
  }
  assert.deepStrictEqual(seen, ORDER[m.id], `${m.id}: phases run in order`);
  assert.ok(lib.poseAt(m, 0, 'male').load < 0.5, `${m.id}: load starts low`);
  for (const r of m.regions) {
    assert.ok(r.label && r.latin && r.group, `${m.id}: ${r.id} is named`);
  }
}
{
  const sorted = r => ({ prime: r.prime.slice().sort(), hold: r.hold.slice().sort() });
  const sq = sorted(lib.muscleRoles(squat, ex('Bodyweight Squat', { muscles: ['quads', 'glutes'] })));
  /* (the front view's roles; the side view's are checked above) */
  assert.deepStrictEqual(sq.prime, ['add', 'rf', 'vl', 'vm'], 'squat: the three quads and the adductors work');
  assert.deepStrictEqual(sq.hold, ['abs', 'calf', 'gmed', 'obl', 'tib'], 'squat: core, side glutes and lower legs hold');
  const pu = sorted(lib.muscleRoles(pull, ex('Pull-ups', { muscles: ['back', 'biceps', 'forearms'] })));
  assert.deepStrictEqual(pu.prime, ['bic', 'brach', 'flex', 'lats'], 'pull-up: lats, biceps and both forearm groups work');
  assert.deepStrictEqual(pu.hold, ['abs', 'delt', 'obl', 'trap'], 'pull-up: core, shoulders and traps hold');
  console.log('ok   phases in order; squat and pull-up roles follow their notes');
}

for (const m of ALL) for (const b of BODIES) {
  const N = 400, loop = lib.loopSeconds(m);
  let prev = null, worst = 0, who = '';
  for (let i = 0; i <= N; i++) {
    const p = lib.poseAt(m, (i / N) * loop, b);
    const now = {};
    for (const k of Object.keys(p.parts)) if (lib.isMuscle(m, k)) now[k] = geom.centroid(p.parts[k]);
    if (prev) for (const k of Object.keys(now)) { const d = dist(now[k], prev[k]); if (d > worst) { worst = d; who = k; } }
    prev = now;
  }
  assert.ok(worst < 2, `${m.id}/${b}: ${who} jumped ${worst.toFixed(1)}px between frames`);
}
console.log('ok   no muscle jumps in any motion');

/* No doubled muscles, in any motion, judged by the rig's own draw order: a
   muscle is hidden wherever a body part drawn AFTER its own limb covers it
   (a limb in front of another is not a muscle drawn twice). */
for (const m of ALL) for (const b of BODIES) for (const depth of [0, 0.5, 1]) {
  const p = lib.poseAtDepth(m, depth, b);
  const partIndex = {}, muscleIndex = {};
  p.order.forEach((o, i) => { if (o[0] === 'part') partIndex[o[1]] = i; if (o[0] === 'muscles') muscleIndex[o[1]] = i; });
  const muscleKeys = Object.keys(p.parts).filter(k => lib.isMuscle(m, k));
  /* a muscle is hidden by any body part drawn after its own muscle layer */
  const layerOf = k => muscleIndex[lib.segmentOf(m, k).replace(/_l$/, '')];
  const coverers = k => Object.keys(partIndex).filter(q => partIndex[q] > layerOf(k));
  const all = Object.values(p.parts).flat();
  const xs = all.map(q => q[0]), ys = all.map(q => q[1]);
  const cells = {};
  for (const k of muscleKeys) cells[k] = new Set();
  const cov = Object.fromEntries(muscleKeys.map(k => [k, coverers(k)]));
  for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.6) for (let y = Math.min(...ys); y <= Math.max(...ys); y += 0.6) {
    const pt = [x, y];
    for (const k of muscleKeys) {
      if (!inside(pt, p.parts[k])) continue;
      if (cov[k].some(q => inside(pt, p.parts[q]))) continue;
      cells[k].add(`${x},${y}`);
    }
  }
  for (let i = 0; i < muscleKeys.length; i++) for (let j = i + 1; j < muscleKeys.length; j++) {
    const A = cells[muscleKeys[i]], B = cells[muscleKeys[j]];
    let both = 0; for (const c of A) if (B.has(c)) both++;
    const share = both / Math.max(1, Math.min(A.size, B.size));
    assert.ok(share <= 0.08, `${m.id}/${b}@${depth}: ${muscleKeys[i]} and ${muscleKeys[j]} overlap ${(share * 100).toFixed(0)}%`);
  }
}
console.log('ok   no doubled muscles in any motion');

/* ---- the female and male front builds differ the way bodies do ---- */
for (const m of [squat, pull]) {
  const f = lib.poseAtDepth(m, 0, 'female').joints, mm = lib.poseAtDepth(m, 0, 'male').joints;
  const hipW = j => dist(j.hip, j.hip_l), shW = j => dist(j.S, j.S_l);
  assert.ok(shW(mm) / hipW(mm) > shW(f) / hipW(f) * 1.15, `${m.id}: his shoulders are broad for his hips; hers are narrow for her hips`);
  assert.ok(dist(f.pc, f.nb) < dist(mm.pc, mm.nb), `${m.id}: she is shorter`);
  assert.ok(lib.poseAtDepth(m, 0, 'female').parts.bust, `${m.id}: her front view has a bust`);
}
console.log('ok   male and female front builds differ');

console.log('muscle map front OK');
