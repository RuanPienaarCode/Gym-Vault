'use strict';
/* The movements the Muscle Map can show, and which exercise gets which.
   Pure — no DOM, no obsidian import.

   ONE MOTION TODAY: the push-up. Every other exercise keeps its photos; the
   renderer is asked only when motionFor() returns something, so adding a
   movement later is a new entry here (and its rig), never a change to the
   pages that show it.

   A motion is DATA: a rig (how its joints are solved), the rig's geometry,
   the tempo of one rep as phases, and the role each muscle region plays —
   'prime' (moving the weight) or 'hold' (keeping the shape). The exercise
   note's `muscles:` field decides which prime movers light up as working;
   the note never has to know a region id. */

const G = require('./motion-geom');
const { UPPER_ARM, FOREARM, bodyOf, headOutline } = require('./motion-body');
const F = require('./motion-front');
/* (UPPER_ARM/FOREARM: the male lengths, which the motions' geo is written in.) */

/* ---------------------------------------------------------------- regions
   Each muscle is DRAWN, not generated: an outline in its segment's own
   coordinates, so it moves with the limb and keeps its anatomical shape —
   a fan for the chest, a cap for the shoulder, a horseshoe for the
   triceps, a strip of segments for the abs.

     [s, w]  s runs along the segment (0 at its root, 1 at its end);
             w runs across it, +1 on the side-a surface, -1 on side b, 0 on
             the axis (scaled by the profile's half-width at s).
   Torso/thigh side a is the back of the body (the up side of a plank);
   arm side a is the triceps side.

   Muscles sit SIDE BY SIDE like a map — no two share visible skin (the
   guard suite measures it), because two shapes on one spot read as one
   muscle drawn twice. What makes a shape read as MUSCLE rather than a
   patch (or a shell — a few lines fanning from one point is a seashell):
     fibres  a family of fine strands, from one attachment edge (`from`, a
             segment in s,w) to the other (`to`), n of them, clipped to the
             outline by the renderer;
     tendon  a pale tapered end where it attaches (a curve in s,w), or null;
     lines   anatomical landmarks drawn over the fibres — the abs' seams,
             the line between two heads of the quads.
   `row` is where its Detailed label sits: 'top' above the figure, 'bottom'
   below. `deep` muscles sit on the side wall behind a front one and are
   drawn a shade lighter. */
const REGIONS = [
  {
    id: 'obl', group: 'core', label: 'Obliques', latin: 'external oblique', seg: 'torso', row: 'bottom', deep: true,
    shape: [[0.56, -0.56], [0.53, -0.18], [0.46, 0.22], [0.34, 0.36], [0.2, 0.28], [0.13, -0.08], [0.15, -0.56], [0.36, -0.6]],
    lines: [],
    fibres: { from: [[0.52, 0.24], [0.18, 0.2]], to: [[0.46, -0.6], [0.13, -0.58]], n: 6 },
    tendon: null,
  },
  {
    id: 'serr', group: 'chest', label: 'Side of ribs', latin: 'serratus anterior', seg: 'torso', row: 'bottom', deep: true,
    /* the serrations: fingers reaching forward round the ribs */
    shape: [[0.84, 0.36], [0.8, 0.0], [0.775, -0.22], [0.75, -0.02], [0.725, -0.24], [0.7, -0.04], [0.675, -0.24], [0.65, -0.04], [0.63, 0.3], [0.74, 0.42]],
    lines: [],
    fibres: { from: [[0.83, 0.32], [0.63, 0.28]], to: [[0.775, -0.2], [0.645, -0.2]], n: 5 },
    tendon: null,
  },
  {
    id: 'abs', group: 'core', label: 'Core', latin: 'rectus abdominis', seg: 'torso', row: 'bottom',
    shape: [[0.57, -1.04], [0.56, -0.62], [0.36, -0.64], [0.16, -0.62], [0.12, -0.96], [0.22, -1.05], [0.4, -1.07]],
    lines: [[[0.25, -0.63], [0.25, -0.85], [0.25, -1.05]], [[0.35, -0.64], [0.35, -0.85], [0.35, -1.06]], [[0.46, -0.64], [0.46, -0.85], [0.46, -1.06]]],
    fibres: { from: [[0.14, -1.0], [0.16, -0.64]], to: [[0.57, -1.02], [0.56, -0.64]], n: 4 },
    tendon: null,
  },
  {
    id: 'pec', group: 'chest', label: 'Chest', latin: 'pectoralis major', seg: 'torso', row: 'bottom',
    shape: [[0.97, -0.32], [0.98, -0.7], [0.92, -1.04], [0.78, -1.08], [0.64, -1.06], [0.59, -0.92], [0.61, -0.68], [0.68, -0.48], [0.8, -0.36], [0.9, -0.3]],
    lines: [],
    fibres: { from: [[0.6, -0.97], [0.94, -1.02]], to: [[0.8, -0.44], [0.96, -0.34]], n: 8 },
    tendon: [[0.9, -0.35], [0.95, -0.33], [1.0, -0.31]],
  },
  {
    id: 'trap', group: 'back', label: 'Upper back', latin: 'trapezius', seg: 'torso', row: 'top',
    /* on the upper back, stopping short of the shoulder joint — at the
       bottom of the rep the upper arm swings back over the joint */
    shape: [[0.7, 0.86], [0.78, 1.04], [0.9, 1.07], [0.97, 0.94], [0.96, 0.64], [0.88, 0.52], [0.78, 0.58], [0.72, 0.72]],
    lines: [],
    fibres: { from: [[0.71, 0.98], [0.95, 1.04]], to: [[0.76, 0.62], [0.97, 0.64]], n: 6 },
    tendon: null,
  },
  {
    id: 'glute', group: 'glutes', label: 'Glutes', latin: 'gluteus maximus', seg: 'torso', row: 'top',
    shape: [[-0.1, 0.94], [0.0, 1.08], [0.14, 1.08], [0.24, 0.9], [0.25, 0.46], [0.14, 0.22], [-0.02, 0.26], [-0.12, 0.6]],
    lines: [],
    fibres: { from: [[-0.09, 0.62], [0.1, 0.26]], to: [[0.1, 1.06], [0.24, 0.7]], n: 7 },
    tendon: null,
  },
  {
    id: 'quad', group: 'quads', label: 'Quads', latin: 'quadriceps', seg: 'thigh', row: 'bottom',
    shape: [[0.06, -0.5], [0.1, -0.98], [0.3, -1.03], [0.6, -1.01], [0.86, -0.93], [0.95, -0.6], [0.9, -0.14], [0.6, -0.06], [0.3, -0.08], [0.1, -0.22]],
    lines: [[[0.12, -0.66], [0.5, -0.6], [0.88, -0.64]]],
    fibres: { from: [[0.08, -0.26], [0.08, -0.9]], to: [[0.9, -0.2], [0.9, -0.9]], n: 6 },
    tendon: [[0.92, -0.62], [0.97, -0.68], [1.03, -0.72]],
  },
  {
    id: 'forearm', group: 'forearms', label: 'Forearms', latin: 'wrist flexors', seg: 'fore', row: 'bottom',
    shape: [[0.05, 0.12], [0.1, 0.86], [0.3, 1.05], [0.55, 0.92], [0.76, 0.5], [0.78, 0.14], [0.4, 0.06]],
    lines: [],
    fibres: { from: [[0.06, 0.2], [0.08, 0.86]], to: [[0.76, 0.16], [0.74, 0.5]], n: 5 },
    tendon: [[0.72, 0.14], [0.82, 0.13], [0.94, 0.12]],
  },
  {
    id: 'tri', group: 'triceps', label: 'Triceps', latin: 'triceps brachii', seg: 'upper', row: 'top',
    /* a horseshoe down the back of the arm, starting below the delt */
    shape: [[0.44, 0.98], [0.62, 1.1], [0.82, 1.05], [0.96, 0.72], [0.98, 0.2], [0.86, 0.06], [0.7, 0.08], [0.55, 0.16], [0.45, 0.4]],
    lines: [],
    fibres: { from: [[0.46, 0.3], [0.5, 1.04]], to: [[0.95, 0.12], [0.94, 0.7]], n: 6 },
    tendon: [[0.94, 0.36], [0.99, 0.35], [1.04, 0.32]],
  },
  {
    id: 'delt', group: 'shoulders', label: 'Front delt', latin: 'anterior deltoid', seg: 'upper', row: 'top',
    /* the cap over the shoulder, narrowing to its insertion mid-arm */
    shape: [[-0.16, 0.1], [-0.12, 0.72], [-0.02, 1.06], [0.14, 1.06], [0.3, 0.7], [0.4, 0.1], [0.36, -0.5], [0.22, -1.04], [0.02, -1.1], [-0.12, -0.72]],
    lines: [],
    fibres: { from: [[-0.13, -0.82], [-0.13, 0.82]], to: [[0.3, -0.34], [0.33, 0.36]], n: 8 },
    tendon: [[0.36, 0.0], [0.41, 0.02], [0.47, 0.03]],
  },
];
/* CONTEXT — the muscles this movement doesn't use, drawn in a quiet
   neutral so the figure reads as a muscular body and the coloured ones read
   as muscles in it. Without them the coloured shapes floated on a smooth
   mannequin like shells. Same (s, w) frame; never labelled, never coloured,
   and — like the regions — no two share visible skin. */
const CONTEXT = [
  { id: 'hams', seg: 'thigh', shape: [[0.2, 0.12], [0.4, 0.06], [0.64, 0.06], [0.88, 0.16], [0.96, 0.5], [0.9, 0.92], [0.64, 1.01], [0.4, 1.03], [0.22, 0.9], [0.17, 0.5]] },
  { id: 'calf', seg: 'shin', shape: [[0.04, 0.12], [0.1, 0.88], [0.28, 1.05], [0.5, 0.92], [0.72, 0.52], [0.72, 0.16], [0.4, 0.08]] },
  { id: 'tib', seg: 'shin', shape: [[0.06, -0.14], [0.1, -0.9], [0.5, -0.98], [0.84, -0.82], [0.88, -0.3], [0.5, -0.1]] },
  { id: 'bicep', seg: 'upper', shape: [[0.46, -0.1], [0.5, -0.9], [0.7, -1.02], [0.9, -0.82], [0.96, -0.3], [0.82, -0.06], [0.62, -0.04]] },
  { id: 'ext', seg: 'fore', shape: [[0.05, -0.12], [0.1, -0.86], [0.3, -1.02], [0.55, -0.88], [0.76, -0.46], [0.78, -0.1], [0.4, -0.04]] },
  { id: 'lats', seg: 'torso', shape: [[0.36, 0.52], [0.4, 0.98], [0.54, 1.06], [0.66, 1.0], [0.68, 0.64], [0.62, 0.48], [0.48, 0.46]] },
  { id: 'erect', seg: 'torso', shape: [[0.27, 0.5], [0.28, 1.0], [0.33, 1.03], [0.34, 0.52]] },
];


/* The side-view squat reuses the side shapes (same body, same muscles —
   just standing). Copies, so its own label columns and roles never leak
   into the push-up's. */
const sideCopy = (list, id, extra) => Object.assign({}, list.find(r => r.id === id), extra);
const REGIONS_SQUAT_SIDE = [
  sideCopy(REGIONS, 'obl', { col: 'left' }),
  sideCopy(REGIONS, 'abs', { col: 'left' }),
  Object.assign({}, CONTEXT.find(c => c.id === 'erect'), {
    group: 'back', label: 'Lower back', latin: 'erector spinae', col: 'right', lines: [], tendon: null,
    fibres: { from: [[0.27, 0.6], [0.28, 0.96]], to: [[0.34, 0.6], [0.33, 0.98]], n: 3 },
  }),
  sideCopy(REGIONS, 'glute', { col: 'right' }),
  Object.assign({}, CONTEXT.find(c => c.id === 'hams'), {
    group: 'hamstrings', label: 'Hamstrings', latin: 'biceps femoris', col: 'right', lines: [], tendon: null,
    fibres: { from: [[0.2, 0.2], [0.22, 0.88]], to: [[0.9, 0.24], [0.88, 0.86]], n: 5 },
  }),
  sideCopy(REGIONS, 'quad', { col: 'left' }),
  Object.assign({}, CONTEXT.find(c => c.id === 'calf'), {
    group: 'calves', label: 'Calves', latin: 'gastrocnemius', col: 'right', lines: [], tendon: [[0.66, 0.36], [0.82, 0.34], [0.98, 0.3]],
    fibres: { from: [[0.08, 0.2], [0.12, 0.86]], to: [[0.68, 0.2], [0.64, 0.5]], n: 4 },
  }),
];
const CONTEXT_SQUAT_SIDE = ['tib', 'bicep', 'ext', 'lats'].map(id => CONTEXT.find(c => c.id === id))
  .concat(['pec', 'serr', 'trap', 'tri', 'delt', 'forearm'].map(id => {
    const r = REGIONS.find(x => x.id === id);
    return { id: r.id, seg: r.seg, shape: r.shape };
  }));

/* ---------------------------------------------------------------- motions */
const MOTIONS = {
  'push-up': {
    id: 'push-up',
    name: 'Push-up',
    rig: 'plank-press',
    /* P = ankle (the pivot), L = ankle→shoulder, hands on the floor at
       handY. rTop leaves the elbow ~170°, locked but not hyperextended; rBot is the
       shoulder-to-hand distance at the bottom — the chest a fist off the
       floor. Hand x is solved so the arms are vertical at the top. */
    geo: { P: [352, 203], L: 205, handY: 211, hipF: 0.62, kneeF: 0.31, rTop: UPPER_ARM + FOREARM - 0.3, rBot: 29 },
    /* [phase, seconds, from depth, to depth]: 2 s down, a beat at the
       bottom, 1.2 s up, a reset. Depth is where the effort is: 1 = hardest. */
    phases: [['down', 2, 0, 1], ['hold', 0.5, 1, 1], ['up', 1.2, 1, 0], ['top', 0.8, 0, 0]],
    view: 'side',
    regions: REGIONS,
    context: CONTEXT,
    prime: ['pec', 'delt', 'tri'],
    alwaysPrime: ['delt'],
    hold: ['abs', 'obl', 'serr', 'trap', 'forearm', 'glute', 'quad'],
  },
  /* Seen from the front (motion-front.js): solved in 3D and flattened, so
     the thighs shorten as they come toward the camera. depth 1 = hips at
     knee height. */
  /* The squat has two views of ONE 3D rep (motion-front squat3D): from the
     side, where the hips travelling back, the knees over the toes, the
     torso lean and the depth all read — and the glutes show; and from the
     front, where knees tracking out read. Side is the default. */
  squat: {
    id: 'squat',
    name: 'Squat',
    rig: 'squat-side',
    view: 'side',
    views: ['squat', 'squat-front'],
    geo: { cx: 210 },
    phases: [['down', 2, 0, 1], ['hold', 0.4, 1, 1], ['up', 1.2, 1, 0], ['top', 0.8, 0, 0]],
    regions: REGIONS_SQUAT_SIDE,
    context: CONTEXT_SQUAT_SIDE,
    prime: ['quad', 'glute'],
    alwaysPrime: [],
    hold: ['abs', 'obl', 'erect', 'hams', 'calf'],
  },
  'squat-front': {
    id: 'squat-front',
    name: 'Squat',
    rig: 'squat',
    view: 'front',
    views: ['squat', 'squat-front'],
    geo: { cx: 210 },
    phases: [['down', 2, 0, 1], ['hold', 0.4, 1, 1], ['up', 1.2, 1, 0], ['top', 0.8, 0, 0]],
    regions: F.REGIONS_SQUAT,
    context: F.CONTEXT_SQUAT,
    prime: ['vl', 'rf', 'vm', 'add'],
    alwaysPrime: [],
    hold: ['abs', 'obl', 'gmed', 'tib', 'calf'],
  },
  /* From the front, wide grip; depth 1 = chin over the bar. Hangs from the
     bar, so there is no floor. */
  'pull-up': {
    id: 'pull-up',
    name: 'Pull-up',
    rig: 'pull',
    view: 'front',
    floor: false,
    geo: { cx: 210, barY: 40 },
    phases: [['pull', 1.2, 0, 1], ['hold', 0.5, 1, 1], ['lower', 2, 1, 0], ['hang', 0.8, 0, 0]],
    regions: F.REGIONS_PULL,
    context: F.CONTEXT_PULL,
    prime: ['lats', 'bic', 'brach', 'flex'],
    alwaysPrime: [],
    hold: ['abs', 'obl', 'trap', 'delt'],
  },
};

/* A motion's geometry for one body. The geo above is written for the male
   figure; a body with another height and arm length gets the same movement
   rescaled — feet where they were, body length and depth by its scale, the
   lockout from its own arms — and its hands solved again so they sit under
   its own shoulders at the top. Cached per motion and body. */
function geoFor(m, bodyKey) {
  const B = bodyOf(bodyKey);
  const cache = m._geo || (m._geo = {});
  if (cache[bodyKey]) return cache[bodyKey];
  const g = m.geo;
  const out = Object.assign({}, g, {
    L: g.L * B.scale, rBot: g.rBot * B.scale,
    rTop: g.rTop - (UPPER_ARM + FOREARM) + (B.UPPER_ARM + B.FOREARM),
    UA: B.UPPER_ARM, FA: B.FOREARM,
  });
  const dy = out.P[1] - (out.handY - out.rTop);
  out.H = [out.P[0] - Math.sqrt(out.L * out.L - dy * dy), out.handY];
  cache[bodyKey] = out;
  return out;
}

/* Exercise names that mean a motion, in the shape normName() produces. */
const BY_NAME = {
  'push-ups': 'push-up', 'push-up': 'push-up',
  'bodyweight squat': 'squat', 'bodyweight squats': 'squat', 'air squat': 'squat', 'squat': 'squat', 'squats': 'squat',
  'pull-ups': 'pull-up', 'pull-up': 'pull-up', 'pullups': 'pull-up', 'pullup': 'pull-up',
};
const normName = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/* The motion for an exercise note, or null. `motion:` in the frontmatter
   wins (so any note can opt in); otherwise the name decides. */
function motionFor(ex) {
  if (!ex) return null;
  const fmId = ex.fm && ex.fm.motion !== undefined && ex.fm.motion !== null ? normName(ex.fm.motion) : '';
  /* Own keys only: `motion: constructor` must not find Object.prototype. */
  if (fmId) return Object.prototype.hasOwnProperty.call(MOTIONS, fmId) ? MOTIONS[fmId] : null;
  const id = BY_NAME[normName(ex.name)];
  return id ? MOTIONS[id] : null;
}

const loopSeconds = m => m.phases.reduce((s, p) => s + p[1], 0);

/* Every muscle a motion draws — the coloured regions and the neutral
   context — and which limb each one rides. A front-view muscle has a
   mirrored twin, `<id>_l`, on the other side. */
const baseId = k => (k.endsWith('_l') ? k.slice(0, -2) : k);
const muscleDef = (m, k) => m.regions.find(r => r.id === baseId(k)) || m.context.find(c => c.id === baseId(k)) || null;
const isMuscle = (m, k) => !!muscleDef(m, k);
function segmentOf(m, k) {
  const d = muscleDef(m, k);
  if (!d) return null;
  return k.endsWith('_l') && d.seg !== 'torso' ? d.seg + '_l' : d.seg;
}

/* ---------------------------------------------------------------- the rig */

/* A trainer-free foot: ankle → toe on the floor, heel up. */
function footPts(ankle, toe, soleDir) {
  const a = G.unit(G.sub(toe, ankle)), k = G.len(G.sub(toe, ankle)) / 18;
  const at = (x, y) => G.add(ankle, G.add(G.mul(a, x * k), G.mul(soleDir, y * k)));
  return [at(-3, -5.5), at(6, -5.5), at(13, -4), at(18, -0.5), at(17.5, 2.8), at(8, 5.4), at(-3, 7.6), at(-7.5, 4.2), at(-6.5, -1.5)];
}

/* The plank-press rig: the body is a straight line pivoting on the ankle;
   the shoulder is wherever that line meets a circle of radius r around the
   planted hand; r runs rTop → rBot as the rep goes down. Elbows solve by
   two-bone IK and bend back toward the feet. */
function plankPress(m, depth, bodyKey) {
  const g = geoFor(m, bodyKey), B = bodyOf(bodyKey);
  const r = g.rTop + (g.rBot - g.rTop) * depth;
  const S = G.circlesUpper(g.P, g.L, g.H, r);
  const u = G.unit(G.sub(S, g.P));
  const nc = [-u[1], u[0]], n = nc[1] < 0 ? nc : G.mul(nc, -1); // the up (back) side of the body
  const back = G.mul(u, -1);
  /* An arm's sides are fixed to the ARM, not to the body: rotating its own
     axis a quarter turn gives the triceps side every frame. Choosing the
     side by "whichever faces the feet" flipped it when the upper arm swept
     back past edge-on at the bottom of the rep — the triceps jumped to the
     front of the arm for a frame. */
  const armSide = (A, Bp) => { const d = G.sub(Bp, A); return [d[1], -d[0]]; };
  const hip = G.add(g.P, G.mul(u, g.L * g.hipF));
  const knee = G.add(g.P, G.mul(u, g.L * g.kneeF));
  const ankle = g.P;
  const toe = [g.P[0] - 10, g.P[1] + 10.4];
  const H = g.H;
  const E = G.midJoint(S, H, g.UA, g.FA, back);
  /* The far arm sits a touch behind and below; its hand a little ahead, so
     both arms read without either one stretching. */
  const fS = G.add(S, [-3, 0.6]); // a touch lower than the near shoulder, so its reach never exceeds the arm
  const fH = G.add(H, [-5, 0]);
  const fE = G.midJoint(fS, fH, g.UA, g.FA, back);
  const tip = [H[0] - 17, g.handY + 1.7], fTip = G.add(tip, [-5, 0]);
  const fo = [-3, -1.5]; // the far leg, offset behind the near one
  const soleA = G.unit(G.sub(toe, ankle));
  const sole = (() => { const c1 = [soleA[1], -soleA[0]], c2 = [-soleA[1], soleA[0]]; return (c1[0] - c1[1]) > (c2[0] - c2[1]) ? c1 : c2; })();
  const neckA = G.add(S, G.mul(u, 6)), neckB = G.add(S, G.mul(u, 19));
  const C = G.add(S, G.add(G.mul(u, B.headAhead), G.mul(n, 3)));

  const L = G.limbPts;
  const segs = {
    torso: [hip, S, B.TORSO, n], thigh: [hip, knee, B.THIGH, n], shin: [knee, ankle, B.SHIN, n],
    upper: [S, E, B.UPPER, armSide(S, E)], fore: [E, H, B.FORE, armSide(E, H)],
  };
  const parts = {
    farUpper: L(fS, fE, B.UPPER, armSide(fS, fE)), farFore: L(fE, fH, B.FORE, armSide(fE, fH)), farHand: L(fH, fTip, B.HAND, [0, -1]),
    farThigh: G.offsetPts(L(hip, knee, B.THIGH, n), fo), farShin: G.offsetPts(L(knee, ankle, B.SHIN, n), fo),
    farFoot: footPts(G.add(ankle, fo), G.add(toe, [-4, 0]), sole),
    neck: L(neckA, neckB, B.NECK, n),
    torso: L(hip, S, B.TORSO, n), thigh: L(hip, knee, B.THIGH, n), shin: L(knee, ankle, B.SHIN, n),
    foot: footPts(ankle, toe, sole),
    upper: L(S, E, B.UPPER, armSide(S, E)), fore: L(E, H, B.FORE, armSide(E, H)), hand: L(H, tip, B.HAND, [0, -1]),
  };
  Object.assign(parts, headOutline(C, u, n, bodyKey));
  /* Regions share the parts map with the body, so an id may never shadow a
     body part (the forearm muscle was once `fore` and silently replaced the
     forearm itself). The guard suite pins this. */
  const lines = {}, fibres = {}, tendons = {};
  for (const rg of REGIONS) {
    const [A, Bp, spec, ref] = segs[rg.seg];
    const at = G.segmentFrame(A, Bp, spec, ref);
    parts[rg.id] = rg.shape.map(([sv, w]) => at(sv, w));
    lines[rg.id] = rg.lines.map(l => l.map(([sv, w]) => at(sv, w)));
    fibres[rg.id] = fibreFamily(rg.fibres).map(l => l.map(([sv, w]) => at(sv, w)));
    tendons[rg.id] = rg.tendon ? rg.tendon.map(([sv, w]) => at(sv, w)) : null;
  }
  for (const cx of CONTEXT) {
    const [A, Bp, spec, ref] = segs[cx.seg];
    const at = G.segmentFrame(A, Bp, spec, ref);
    parts[cx.id] = cx.shape.map(([sv, w]) => at(sv, w));
  }
  /* Draw order, back to front: the far limbs, the body, its muscles, then
     the near arm a segment at a time — so a bent forearm covers the
     triceps behind it, as it does in life. */
  const order = [
    ...['farUpper', 'farFore', 'farHand', 'farShin', 'farThigh', 'farFoot'].map(k => ['part', k, 'gv-mm-far']),
    ...['neck', 'torso', 'shin', 'thigh', 'foot', 'bun', 'skull', 'ear'].filter(k => parts[k]).map(k => ['part', k, 'gv-mm-body']),
    ['muscles', 'torso'], ['muscles', 'thigh'], ['muscles', 'shin'],
    ['part', 'upper', 'gv-mm-body'], ['muscles', 'upper'],
    ['part', 'fore', 'gv-mm-body'], ['muscles', 'fore'],
    ['part', 'hand', 'gv-mm-body'],
  ];
  return { parts, lines, fibres, tendons, order, props: [], joints: { P: g.P, S, E, H, fS, fE, fH, hip, knee, ankle, toe, C } };
}

/* A muscle's fibres in (s, w): n strands from the `from` edge to the `to`
   edge, evenly spaced, each bowed slightly so the bundle swells like a
   muscle belly instead of running dead straight. */
function fibreFamily(f) {
  if (!f) return [];
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const out = [];
  for (let i = 0; i < f.n; i++) {
    const t = (i + 0.5) / f.n;
    const a = lerp2(f.from[0], f.from[1], t), b = lerp2(f.to[0], f.to[1], t);
    const mid = lerp2(a, b, 0.5), bow = (t - 0.5) * 0.18;
    out.push([a, [mid[0], mid[1] + bow], b]);
  }
  return out;
}

/* THE SQUAT FROM THE SIDE: motion-front's 3D rep, seen from the figure's
   side — screen x is the depth axis (forward = left, like the push-up's
   head), so the hips travel back and the knees come forward exactly as they
   do in the front view, because it is the same rep. Drawn with the side
   body: profiles, the profile head, near and far limbs. */
function squatSide(m, depth, bodyKey) {
  const B = bodyOf(bodyKey);
  const J3 = F.squat3D(depth, bodyKey, m.geo.cx);
  const cx = m.geo.cx;
  const P = p => [cx - p[2], p[1]];
  const pc = P(J3.pc), sc = P(J3.sc), S = P(J3.S), E = P(J3.E), H = P(J3.H);
  const hip = P(J3.hip), knee = P(J3.knee), ankle = P(J3.ankle);
  const toe = [ankle[0] - 16, G.FLOOR - 1.2];
  const up = G.unit(G.sub(sc, pc));
  const back = [-up[1], up[0]][0] > 0 ? [-up[1], up[0]] : [up[1], -up[0]];
  /* Sides fixed to each segment (never chosen by comparison, which flips —
     see the push-up's armSide): torso and legs side a = back of the body,
     arms side a = the triceps side. */
  const torsoSide = (A, Bp) => { const d = G.sub(Bp, A); return [-d[1], d[0]]; };
  const legSide = (A, Bp) => { const d = G.sub(Bp, A); return [d[1], -d[0]]; };
  const tip = G.add(H, G.mul(G.unit(G.sub(H, E)), 14)); // the hand carries on along the forearm
  const fo = [3, -1.5]; // far limbs: a touch behind
  const L = G.limbPts;
  const segs = {
    torso: [pc, sc, B.TORSO, torsoSide(pc, sc)],
    thigh: [hip, knee, B.THIGH, legSide(hip, knee)],
    shin: [knee, ankle, B.SHIN, legSide(knee, ankle)],
    upper: [S, E, B.UPPER, legSide(S, E)],
    fore: [E, H, B.FORE, legSide(E, H)],
  };
  const neckA = G.add(sc, G.mul(up, 6)), neckB = G.add(sc, G.mul(up, 19));
  const C = G.add(sc, G.add(G.mul(up, B.headAhead), G.mul(back, 3)));
  const sole = [0, 1];
  const off = pts => G.offsetPts(pts, fo);
  const parts = {
    farUpper: off(L(...segs.upper)), farFore: off(L(...segs.fore)), farHand: off(L(H, tip, B.HAND, [0, -1])),
    farThigh: off(L(...segs.thigh)), farShin: off(L(...segs.shin)), farFoot: off(footPts(ankle, toe, sole)),
    neck: L(neckA, neckB, B.NECK, back),
    torso: L(...segs.torso), thigh: L(...segs.thigh), shin: L(...segs.shin), foot: footPts(ankle, toe, sole),
    upper: L(...segs.upper), fore: L(...segs.fore), hand: L(H, tip, B.HAND, [0, -1]),
  };
  Object.assign(parts, headOutline(C, up, back, bodyKey, -6));
  const lines = {}, fibres = {}, tendons = {};
  const place = (r, isContext) => {
    const at = G.segmentFrame(...segs[r.seg]);
    parts[r.id] = r.shape.map(([sv, w]) => at(sv, w));
    lines[r.id] = isContext ? [] : (r.lines || []).map(l => l.map(([sv, w]) => at(sv, w)));
    fibres[r.id] = isContext ? [] : fibreFamily(r.fibres).map(l => l.map(([sv, w]) => at(sv, w)));
    tendons[r.id] = !isContext && r.tendon ? r.tendon.map(([sv, w]) => at(sv, w)) : null;
  };
  m.regions.forEach(r => place(r, false));
  m.context.forEach(c => place(c, true));
  /* At the bottom the near thigh comes forward ACROSS the belly, so the
     torso and its muscles go down first and the legs over them. */
  const order = [
    ...['farUpper', 'farFore', 'farHand', 'farShin', 'farThigh', 'farFoot'].map(k => ['part', k, 'gv-mm-far']),
    ...['neck', 'torso', 'bun', 'skull', 'ear'].filter(k => parts[k]).map(k => ['part', k, 'gv-mm-body']),
    ['muscles', 'torso'],
    /* and deep down the thigh rests on the calf: shin first, thigh over it */
    ['part', 'foot', 'gv-mm-body'], ['part', 'shin', 'gv-mm-body'], ['muscles', 'shin'],
    ['part', 'thigh', 'gv-mm-body'], ['muscles', 'thigh'],
    ['part', 'upper', 'gv-mm-body'], ['muscles', 'upper'],
    ['part', 'fore', 'gv-mm-body'], ['muscles', 'fore'],
    ['part', 'hand', 'gv-mm-body'],
  ];
  const joints = { pc, sc, S, E, H, hip, knee, ankle, toe, C };
  return { parts, lines, fibres, tendons, order, props: [], joints, joints3: J3 };
}

const RIGS = { 'plank-press': plankPress, squat: F.squatRig, 'squat-side': squatSide, pull: F.pullRig };

/* The figure at a depth: 0 = top of the rep, 1 = bottom. */
function poseAtDepth(m, depth, bodyKey) {
  const d = G.clamp(depth, 0, 1);
  return Object.assign(RIGS[m.rig](m, d, bodyKey), { depth: d });
}

/* Where the loop is `seconds` in: the phase, how far through it, how deep.
   Depth is where the effort is (1 = hardest). Pure, no pose built, so a caller
   that only needs the depth (the load bar, a pause) never pays for a rig. */
function phaseAt(m, seconds) {
  const total = loopSeconds(m);
  const rep = Math.floor(seconds / total);
  let x = ((seconds % total) + total) % total, i = 0;
  while (i < m.phases.length - 1 && x > m.phases[i][1]) { x -= m.phases[i][1]; i++; }
  const [phase, dur, from, to] = m.phases[i];
  const f = G.clamp(x / dur, 0, 1);
  return { phase, rep, depth: from + (to - from) * G.ease(f) };
}
const depthAt = (m, seconds) => phaseAt(m, seconds).depth;

/* The load that goes with a depth. Depth 1 is where each movement is hardest
   (the bottom of a push-up or squat, the top of a pull-up). */
const loadOf = depth => 0.3 + 0.7 * depth;

/* The figure `seconds` into the loop: which phase, how deep, how loaded,
   and which rep this is (so a caption can step once per rep). */
function poseAt(m, seconds, bodyKey) {
  const ph = phaseAt(m, seconds);
  return Object.assign(poseAtDepth(m, ph.depth, bodyKey), { phase: ph.phase, load: loadOf(ph.depth), rep: ph.rep });
}

/* The first moment in the loop at which the figure is `depth` deep on the way
   in, in seconds. How a paused figure that is stepped to a pose (the bottom,
   halfway, the top) resumes from THAT pose instead of jumping to wherever the
   clock had got to. Scans the loop finely rather than inverting the easing,
   so it cannot disagree with depthAt: the two are the same function. */
function timeAtDepth(m, depth) {
  const total = loopSeconds(m), step = 0.01;
  let best = 0, bestErr = Infinity;
  for (let t = 0; t <= total; t += step) {
    const err = Math.abs(depthAt(m, t) - depth);
    if (err < bestErr - 1e-9) { bestErr = err; best = t; }
  }
  return best;
}

/* ---------------------------------------------------------------- roles */
/* A hand-typed `muscles: quads, glutes` is ONE string to the frontmatter reader,
   so every entry is split on commas the way the Exercises page reads the field
   (page-exercises parseMuscles) and Obsidian's list form is read alike (C-08). */
const listOf = v => (Array.isArray(v) ? v : v === undefined || v === null || v === '' ? [] : [v])
  .reduce((all, x) => all.concat(String(x).split(',')), [])
  .map(x => x.trim().toLowerCase()).filter(Boolean);

/* Which regions are working and which are holding, for this exercise note.
   prime = the motion's prime movers whose group the note lists, plus the
   ones the motion always counts (a push-up always loads the front delt).
   A note with no muscles — or none that match one of the motion's prime
   movers ("legs", "quadriceps", a typo) — gets the motion's own prime
   movers, so a map is never left with nothing working. Everything
   else the motion draws is holding — a muscle the note leaves out still
   shows, it just isn't the one doing the work. Unknown groups are ignored. */
function muscleRoles(m, ex) {
  const named = new Set(listOf(ex && ex.fm ? ex.fm.muscles : []));
  const listed = m.prime.filter(id => named.has(m.regions.find(r => r.id === id).group));
  const prime = listed.length
    ? m.prime.filter(id => listed.includes(id) || m.alwaysPrime.includes(id))
    : m.prime.slice();
  const hold = m.regions.map(r => r.id).filter(id => !prime.includes(id) && (m.prime.includes(id) || m.hold.includes(id)));
  return { prime, hold };
}

/* The numbered steps in an exercise note's body ("1. Hands under…"), as
   plain text for the Detailed caption. Bold/italic markers are dropped. */
function noteSteps(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const mm = line.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
    if (mm) out.push(mm[1].replace(/[*_`]+/g, ''));
  }
  return out;
}

/* The two visual settings, normalised: a hand-edited or corrupt value must
   fall back, never break the page. */
function visualPrefs(settings) {
  const s = settings || {};
  return {
    detail: s.exerciseVisual === 'detailed' ? 'detailed' : 'basic',
    body: s.exerciseBody === 'female' ? 'female' : 'male',
  };
}

/* The Basic/Detailed switch on the visual, remembered. Saved in the
   background: the map has already switched itself, so a slow or failed save
   never makes the page wait or re-render. */
function rememberDetail(ctx, detail) {
  ctx.settings.exerciseVisual = detail === 'detailed' ? 'detailed' : 'basic';
  try {
    Promise.resolve(ctx.plugin && ctx.plugin.saveSettings ? ctx.plugin.saveSettings() : null)
      .catch(e => console.error('gym-vault save exercise visual', e));
  } catch (e) { console.error('gym-vault save exercise visual', e); }
}

module.exports = {
  REGIONS, CONTEXT, MOTIONS, motionFor, loopSeconds, poseAt, poseAtDepth, phaseAt, depthAt, loadOf, timeAtDepth, muscleRoles, noteSteps, visualPrefs, rememberDetail,
  isMuscle, segmentOf,
};
