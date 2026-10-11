'use strict';
/* FRONT-VIEW RIGS for the Muscle Map: the bodyweight squat and the pull-up,
   seen from the front. Pure — no DOM, no obsidian import.

   The figure faces the camera: x across the screen, y down, z toward the
   viewer. Everything is solved for the figure's right-hand side of the
   screen and MIRRORED for the other, so the two sides can never disagree.

   THE SQUAT IS SOLVED IN 3D. Seen from the front, sitting down is mostly a
   movement TOWARD the camera: the hips go back, the knees come forward, the
   thighs swing level. Drawn flat, a thigh would keep its length as it bends,
   which is the giveaway of a fake. So the joints live in 3D (feet planted,
   pelvis down and back, knees solved by two-bone IK with a pole that sends
   them forward and a little out over the toes, torso leaning forward) and
   only then are flattened: the bones keep their length, their DRAWN length
   shrinks as they turn toward you.

   The pull-up moves in the frontal plane already (wide grip, elbows driving
   down and out), so it is solved flat.

   Proportions: px on the same stage as the side view, ~1.5px per cm. The
   female build is ~7% shorter, narrower in the shoulders and wider in the
   hips, with a narrow waist, slimmer arms and a bust; the male build is a V
   — broad shoulders over a narrower waist. */

const G = require('./motion-geom');

const FLOOR = G.FLOOR;
const ANKLE_Y = FLOOR - 8;

/* [s, a, b] half-widths across the front of each segment. */
const sym = rows => rows.map(([s, w]) => [s, w, w]);
const scaleRows = (rows, k) => rows.map(([s, a, b]) => [s, a * k, b * k]);
const FRONT = {
  male: {
    /* pelvis (hip-joint line) → base of the neck */
    /* the shoulder line slopes from the neck (the trapezius) into the
       shoulders; the arm sockets sit INSIDE the torso, so the deltoid rounds
       the shoulder off instead of perching on its corner */
    TORSO: sym([[-0.21, 3], [-0.18, 10.5], [-0.12, 18], [-0.04, 22], [0.08, 23.5], [0.3, 21], [0.5, 23], [0.72, 26.5], [0.84, 27], [0.9, 25.5], [0.95, 20.5], [0.99, 13.5], [1.02, 9.5], [1.06, 6]]),
    THIGH: sym([[-0.08, 10], [0, 13], [0.2, 12.5], [0.6, 10], [0.9, 8], [1, 7.5], [1.08, 4.5]]),
    SHIN: sym([[-0.06, 6], [0, 7.5], [0.25, 8.5], [0.6, 6.2], [0.95, 4.2], [1.05, 3]]),
    UPPER: sym([[-0.14, 5.5], [-0.04, 9], [0.15, 8.2], [0.5, 7], [0.85, 5.6], [1, 5], [1.08, 3]]),
    FORE: sym([[-0.06, 4.2], [0, 5.4], [0.25, 6.2], [0.6, 4.8], [0.95, 3.7], [1.04, 2.6]]),
    HAND: sym([[-0.1, 3.5], [0, 4.6], [0.5, 5.2], [1, 3.6], [1.1, 1.8]]),
    NECK: sym([[-0.1, 6], [0, 8.6], [1, 7.6], [1.1, 5]]),
    shoulderHalf: 22, hipHalf: 13, ankleHalf: 17,
    torso: 78, neckGap: 13, thigh: 63.5, shin: 63.5, UA: 48, FA: 42, hand: 15,
    fist: { w: 13, h: 11 },
    head: { rx: 11.4, ry: 16.4, jaw: 0.72, chin: 0.2 },
  },
  female: {
    TORSO: sym([[-0.21, 3], [-0.18, 12], [-0.12, 21], [-0.04, 25], [0.08, 27.5], [0.2, 25], [0.32, 19.5], [0.5, 20], [0.72, 22], [0.84, 22.5], [0.9, 21], [0.95, 16.8], [0.99, 11], [1.02, 7.6], [1.06, 5]]),
    THIGH: sym([[-0.08, 10.5], [0, 13.5], [0.2, 13], [0.6, 10], [0.9, 7.4], [1, 6.8], [1.08, 4.2]]),
    SHIN: scaleRows(sym([[-0.06, 6], [0, 7.5], [0.25, 8.5], [0.6, 6.2], [0.95, 4.2], [1.05, 3]]), 0.9),
    UPPER: scaleRows(sym([[-0.14, 5.5], [-0.04, 9], [0.15, 8.2], [0.5, 7], [0.85, 5.6], [1, 5], [1.08, 3]]), 0.8),
    FORE: scaleRows(sym([[-0.06, 4.2], [0, 5.4], [0.25, 6.2], [0.6, 4.8], [0.95, 3.7], [1.04, 2.6]]), 0.82),
    HAND: scaleRows(sym([[-0.1, 3.5], [0, 4.6], [0.5, 5.2], [1, 3.6], [1.1, 1.8]]), 0.85),
    NECK: scaleRows(sym([[-0.1, 6], [0, 8.5], [1, 7.5], [1.1, 5]]), 0.8),
    shoulderHalf: 18, hipHalf: 15, ankleHalf: 16,
    torso: 72.5, neckGap: 12, thigh: 59, shin: 59, UA: 44, FA: 38.5, hand: 13.5,
    fist: { w: 11.5, h: 10 },
    head: { rx: 10.6, ry: 15.2, jaw: 0.62, chin: 0.16 },
  },
};
const frontOf = key => FRONT[key] || FRONT.male;

/* ------------------------------------------------------------ 3D helpers */
const a3 = (p, q) => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const s3 = (p, q) => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const m3 = (p, k) => [p[0] * k, p[1] * k, p[2] * k];
const d3 = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const l3 = p => Math.hypot(p[0], p[1], p[2]);
const u3 = p => m3(p, 1 / l3(p));
const flat = p => [p[0], p[1]];

/* Two-bone IK in 3D: the middle joint between root and end, bent toward
   `pole`. */
function ik3(root, end, a, b, pole) {
  const d = s3(end, root), D = Math.min(l3(d), a + b - 1e-6), u = u3(d);
  const x = (a * a - b * b + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const pp = s3(pole, m3(u, d3(pole, u)));
  return a3(a3(root, m3(u, x)), m3(u3(pp), h));
}

/* Side "a" of a segment, fixed to the segment itself (never chosen by
   comparing with another direction, which flips when the two line up —
   the push-up's triceps once jumped that way). For the figure's right-hand
   limbs this is the outer side. */
const outerArm = (A, B) => { const d = G.sub(B, A); return [-d[1], d[0]]; };
const outerLeg = (A, B) => { const d = G.sub(B, A); return [d[1], -d[0]]; };

/* ------------------------------------------------------------ head, hands, feet */
/* The head from the front: a rounded crown, temples, cheekbones, then the
   jaw tapering to the chin — a skull, not an egg. Her jaw is softer and her
   chin smaller (F.head.jaw / chin). Ears sit from brow to nose height and
   are drawn BEHIND the head, so they tuck in instead of sticking on. */
function headFront(C, F, key) {
  const { rx, ry, jaw, chin } = F.head;
  const half = [[0, -1], [0.5, -0.95], [0.84, -0.72], [0.98, -0.36], [1.0, -0.04], [0.95, 0.22], [0.86, 0.44], [jaw, 0.7], [jaw * 0.62, 0.88], [chin, 0.99]];
  const P = ([x, y]) => [C[0] + x * rx, C[1] + y * ry];
  const right = half.map(P);
  const left = half.slice(1).reverse().map(([x, y]) => P([-x, y]));
  const skull = right.concat([P([0, 1.02])], left);
  const ex = C[0] + rx * 0.9;
  const ear = [[0, -0.15], [2.4, -0.17], [3.7, -0.07], [3.5, 0.1], [2.5, 0.25], [0.2, 0.3], [-2, 0.08]].map(([x, y]) => [ex + x, C[1] + y * ry]);
  const out = { skull, ear };
  /* Her bun sits at the back of the head; from the front only its top
     shows, just over the crown. */
  if (key === 'female') {
    const bun = [];
    for (let a = 0; a < 360; a += 30) { const t = a * Math.PI / 180; bun.push([C[0] + 1.5 + Math.cos(t) * 6.5, C[1] - ry * 0.94 + Math.sin(t) * 5]); }
    out.bun = bun;
  }
  return out;
}

/* A fist: a rounded block, knuckles across `axis` (unit), centred at c. */
function fistPts(c, w, h, axis) {
  const n = [-axis[1], axis[0]];
  const pts = [];
  for (let a = 0; a < 360; a += 24) {
    const t = a * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t);
    const x = Math.sign(ct) * Math.pow(Math.abs(ct), 0.55) * w / 2, y = Math.sign(st) * Math.pow(Math.abs(st), 0.55) * h / 2;
    pts.push(G.add(c, G.add(G.mul(axis, x), G.mul(n, y))));
  }
  return pts;
}

/* A foot from the front, flat on the floor: rounded, toes turned a little out. */
function footFront(ankle) {
  const [x, y] = ankle;
  return [[x - 5, y - 2.5], [x + 5, y - 2.5], [x + 7.5, y + 3.5], [x + 8.2, y + 6.6], [x + 6.6, y + 8.2], [x - 5, y + 8.2], [x - 6.8, y + 6.6], [x - 6.6, y + 3.5]];
}
/* A relaxed hanging foot (pull-up), seen from the front: the top of the
   foot, foreshortened, toes pointing down and a little forward. */
function footHanging(knee, ankle) {
  const u = G.unit(G.sub(ankle, knee)), n = [-u[1], u[0]];
  const at = (s, w) => G.add(ankle, G.add(G.mul(u, s), G.mul(n, w)));
  return [at(-2.5, -4.6), at(-2.5, 4.6), at(5, 5.6), at(11, 5.8), at(14.5, 3.8), at(15.5, 0), at(14.5, -3.8), at(11, -5.8), at(5, -5.6)];
}

/* ------------------------------------------------------------ muscles
   Same (s, w) language as the side view, for the RIGHT-hand instance; the
   left is its mirror image (mirror: false = a single central muscle, like
   the abs). For limbs side a (w > 0) is the outer side; for the torso, w > 0
   is the screen-right half. `col`: which side column its Detailed label
   sits in. */
const REGIONS_SQUAT = [
  { id: 'vl', group: 'quads', label: 'Outer quad', latin: 'vastus lateralis', seg: 'thigh', col: 'right',
    shape: [[0.12, 0.28], [0.18, 0.96], [0.45, 1.0], [0.75, 0.9], [0.88, 0.55], [0.8, 0.28], [0.5, 0.22]],
    fibres: { from: [[0.14, 0.32], [0.2, 0.92]], to: [[0.84, 0.32], [0.78, 0.84]], n: 6 }, lines: [], tendon: null },
  { id: 'rf', group: 'quads', label: 'Front quad', latin: 'rectus femoris', seg: 'thigh', col: 'right',
    shape: [[0.06, -0.16], [0.06, 0.16], [0.4, 0.18], [0.72, 0.14], [0.8, 0.0], [0.72, -0.14], [0.4, -0.18]],
    fibres: { from: [[0.08, -0.12], [0.08, 0.12]], to: [[0.76, -0.06], [0.76, 0.06]], n: 4 }, lines: [],
    tendon: [[0.8, 0], [0.9, 0], [0.98, 0]] },
  { id: 'vm', group: 'quads', label: 'Inner quad', latin: 'vastus medialis', seg: 'thigh', col: 'right',
    shape: [[0.56, -0.26], [0.7, -0.22], [0.9, -0.4], [0.94, -0.74], [0.82, -0.98], [0.64, -0.82]],
    fibres: { from: [[0.6, -0.3], [0.66, -0.84]], to: [[0.9, -0.36], [0.86, -0.92]], n: 5 }, lines: [], tendon: null },
  { id: 'add', group: 'glutes', label: 'Adductors', latin: 'adductor magnus', seg: 'thigh', col: 'left',
    shape: [[0.04, -0.3], [0.06, -0.96], [0.25, -1.0], [0.46, -0.86], [0.5, -0.42], [0.34, -0.32], [0.16, -0.25]],
    fibres: { from: [[0.06, -0.34], [0.08, -0.92]], to: [[0.46, -0.4], [0.44, -0.84]], n: 5 }, lines: [], tendon: null },
  { id: 'gmed', group: 'glutes', label: 'Side glute', latin: 'gluteus medius', seg: 'torso', col: 'left',
    shape: [[0.0, 0.82], [0.04, 1.0], [0.2, 1.0], [0.26, 0.88], [0.18, 0.76], [0.06, 0.74]],
    fibres: { from: [[0.02, 0.8], [0.06, 0.98]], to: [[0.22, 0.82], [0.22, 0.98]], n: 4 }, lines: [], tendon: null },
  { id: 'abs', group: 'core', label: 'Core', latin: 'rectus abdominis', seg: 'torso', col: 'left', mirror: false,
    shape: [[0.2, -0.3], [0.2, 0.3], [0.46, 0.33], [0.7, 0.3], [0.73, 0], [0.7, -0.3], [0.46, -0.33]],
    fibres: { from: [[0.22, -0.26], [0.22, 0.26]], to: [[0.7, -0.26], [0.7, 0.26]], n: 6 },
    lines: [[[0.21, 0], [0.46, 0], [0.72, 0]], [[0.36, -0.3], [0.36, 0], [0.36, 0.3]], [[0.48, -0.31], [0.48, 0], [0.48, 0.31]], [[0.6, -0.3], [0.6, 0], [0.6, 0.3]]],
    tendon: null },
  { id: 'obl', group: 'core', label: 'Obliques', latin: 'external oblique', seg: 'torso', col: 'left',
    shape: [[0.3, 0.42], [0.32, 0.96], [0.5, 1.0], [0.62, 0.92], [0.6, 0.48], [0.46, 0.4]],
    fibres: { from: [[0.32, 0.9], [0.56, 0.96]], to: [[0.3, 0.46], [0.54, 0.44]], n: 5 }, lines: [], tendon: null },
  { id: 'tib', group: 'calves', label: 'Shin', latin: 'tibialis anterior', seg: 'shin', col: 'left',
    shape: [[0.1, 0.05], [0.12, 0.72], [0.4, 0.82], [0.75, 0.6], [0.82, 0.2], [0.5, 0.02]],
    fibres: { from: [[0.12, 0.1], [0.14, 0.66]], to: [[0.78, 0.22], [0.74, 0.56]], n: 4 }, lines: [], tendon: [[0.8, 0.3], [0.9, 0.24], [0.99, 0.18]] },
  { id: 'calf', group: 'calves', label: 'Calves', latin: 'gastrocnemius', seg: 'shin', col: 'right',
    shape: [[0.06, -0.36], [0.1, -0.98], [0.3, -1.0], [0.48, -0.8], [0.45, -0.44], [0.25, -0.32]],
    fibres: { from: [[0.08, -0.4], [0.1, -0.94]], to: [[0.44, -0.46], [0.46, -0.78]], n: 4 }, lines: [], tendon: null },
];
const CONTEXT_SQUAT = [
  { id: 'pec', seg: 'torso', shape: [[0.74, 0.08], [0.74, 0.84], [0.84, 0.96], [0.9, 0.72], [0.9, 0.1], [0.83, 0.06]] },
  { id: 'trapc', seg: 'torso', shape: [[0.94, 0.3], [1.0, 0.36], [1.0, 0.72], [0.95, 0.9], [0.92, 0.62]] },
  { id: 'latc', seg: 'torso', shape: [[0.64, 0.82], [0.66, 1.0], [0.72, 1.0], [0.72, 0.84]] },
  { id: 'deltc', seg: 'upper', shape: [[-0.14, 0], [-0.1, 0.9], [0.1, 1.0], [0.34, 0.6], [0.38, 0], [0.34, -0.6], [0.1, -1.0], [-0.1, -0.9]] },
  { id: 'bicc', seg: 'upper', shape: [[0.44, -0.4], [0.44, 0.4], [0.66, 0.5], [0.88, 0.3], [0.9, -0.3], [0.66, -0.5]] },
  { id: 'forec', seg: 'fore', shape: [[0.06, -0.6], [0.06, 0.6], [0.35, 0.7], [0.6, 0.4], [0.62, -0.4], [0.35, -0.7]] },
];

const REGIONS_PULL = [
  { id: 'lats', group: 'back', label: 'Lats', latin: 'latissimus dorsi', seg: 'torso', col: 'right',
    shape: [[0.48, 0.84], [0.5, 1.0], [0.62, 1.0], [0.74, 1.0], [0.76, 0.86], [0.66, 0.8], [0.56, 0.8]],
    fibres: { from: [[0.5, 0.86], [0.5, 0.98]], to: [[0.74, 0.86], [0.74, 0.98]], n: 4 }, lines: [], tendon: null },
  { id: 'bic', group: 'biceps', label: 'Biceps', latin: 'biceps brachii', seg: 'upper', col: 'right',
    shape: [[0.38, -0.42], [0.4, 0.42], [0.62, 0.55], [0.86, 0.35], [0.9, -0.3], [0.64, -0.55]],
    fibres: { from: [[0.4, -0.36], [0.42, 0.36]], to: [[0.86, -0.24], [0.84, 0.3]], n: 5 }, lines: [],
    tendon: [[0.88, 0], [0.95, 0], [1.02, 0]] },
  { id: 'brach', group: 'forearms', label: 'Forearm', latin: 'brachioradialis', seg: 'fore', col: 'right',
    shape: [[0.04, 0.12], [0.06, 0.9], [0.3, 1.0], [0.55, 0.7], [0.58, 0.22], [0.3, 0.1]],
    fibres: { from: [[0.06, 0.18], [0.08, 0.84]], to: [[0.54, 0.26], [0.52, 0.66]], n: 4 }, lines: [], tendon: [[0.56, 0.4], [0.72, 0.36], [0.9, 0.3]] },
  { id: 'flex', group: 'forearms', label: 'Grip', latin: 'forearm flexors', seg: 'fore', col: 'left',
    shape: [[0.06, -0.04], [0.1, -0.9], [0.4, -0.96], [0.7, -0.6], [0.72, -0.1], [0.4, -0.02]],
    fibres: { from: [[0.08, -0.1], [0.1, -0.84]], to: [[0.68, -0.14], [0.66, -0.56]], n: 4 }, lines: [], tendon: null },
  { id: 'trap', group: 'back', label: 'Upper back', latin: 'trapezius', seg: 'torso', col: 'left',
    shape: [[0.94, 0.28], [1.0, 0.34], [1.0, 0.72], [0.95, 0.9], [0.92, 0.62]],
    fibres: { from: [[0.95, 0.32], [0.99, 0.38]], to: [[0.94, 0.86], [0.96, 0.7]], n: 3 }, lines: [], tendon: null },
  { id: 'delt', group: 'shoulders', label: 'Shoulders', latin: 'deltoid', seg: 'upper', col: 'left',
    shape: [[-0.14, 0], [-0.1, 0.9], [0.1, 1.0], [0.32, 0.6], [0.34, 0], [0.32, -0.6], [0.1, -1.0], [-0.1, -0.9]],
    fibres: { from: [[-0.1, -0.8], [-0.1, 0.8]], to: [[0.3, -0.2], [0.3, 0.2]], n: 6 }, lines: [], tendon: null },
  { id: 'abs', group: 'core', label: 'Core', latin: 'rectus abdominis', seg: 'torso', col: 'left', mirror: false,
    shape: REGIONS_SQUAT.find(r => r.id === 'abs').shape, fibres: REGIONS_SQUAT.find(r => r.id === 'abs').fibres,
    lines: REGIONS_SQUAT.find(r => r.id === 'abs').lines, tendon: null },
  { id: 'obl', group: 'core', label: 'Obliques', latin: 'external oblique', seg: 'torso', col: 'right',
    shape: [[0.2, 0.42], [0.22, 0.96], [0.36, 1.0], [0.45, 0.92], [0.44, 0.48], [0.34, 0.4]],
    fibres: { from: [[0.22, 0.9], [0.4, 0.96]], to: [[0.22, 0.46], [0.4, 0.44]], n: 4 }, lines: [], tendon: null },
];
const CONTEXT_PULL = [
  { id: 'pec', seg: 'torso', shape: [[0.78, 0.08], [0.78, 0.74], [0.86, 0.78], [0.9, 0.66], [0.9, 0.1], [0.84, 0.06]] },
  { id: 'gmedc', seg: 'torso', shape: [[0.0, 0.82], [0.04, 1.0], [0.16, 1.0], [0.18, 0.84], [0.06, 0.74]] },
  { id: 'quadc', seg: 'thigh', shape: [[0.1, -0.5], [0.12, 0.6], [0.4, 0.8], [0.8, 0.6], [0.88, 0.0], [0.8, -0.6], [0.4, -0.7]] },
  { id: 'tibc', seg: 'shin', shape: [[0.1, 0.05], [0.12, 0.7], [0.4, 0.8], [0.75, 0.6], [0.82, 0.2], [0.5, 0.02]] },
  { id: 'calfc', seg: 'shin', shape: [[0.06, -0.36], [0.1, -0.96], [0.3, -1.0], [0.48, -0.8], [0.45, -0.44], [0.25, -0.32]] },
];

/* ------------------------------------------------------------ the rigs */

/* Build the drawn parts from the right-hand joints, mirror the left. */
function assemble(m, F, key, J, extra) {
  const cx = m.geo.cx;
  const mir = p => [2 * cx - p[0], p[1]];
  const L = G.limbPts;
  const torsoRef = outerArm(J.pc, J.nb); // screen-right of the torso
  const segs = {
    torso: [J.pc, J.nb, F.TORSO, torsoRef],
    thigh: [J.hip, J.knee, F.THIGH, outerLeg(J.hip, J.knee)],
    shin: [J.knee, J.ankle, F.SHIN, outerLeg(J.knee, J.ankle)],
    upper: [J.S, J.E, F.UPPER, outerArm(J.S, J.E)],
    fore: [J.E, J.H, F.FORE, outerArm(J.E, J.H)],
  };
  const parts = {};
  const both = (k, pts) => { parts[k] = pts; parts[k + '_l'] = pts.map(mir).reverse(); };
  parts.torso = L(...segs.torso);
  parts.neck = L(G.add(J.nb, [0, 5]), G.add(J.C, [0, 6]), F.NECK, [1, 0]);
  both('thigh', L(...segs.thigh));
  both('shin', L(...segs.shin));
  both('foot', extra.foot);
  both('upper', L(...segs.upper));
  both('fore', L(...segs.fore));
  both('hand', extra.fist);
  const head = headFront(J.C, F, key);
  parts.skull = head.skull;
  both('ear', head.ear);
  if (head.bun) parts.bun = head.bun;
  if (key === 'female') {
    /* the bust: two soft curves on the chest, in the body's own colour */
    const at = G.segmentFrame(...segs.torso);
    const bust = [];
    for (let a = 0; a < 360; a += 30) { const t = a * Math.PI / 180; bust.push(at(0.76 + Math.cos(t) * 0.075, 0.42 + Math.sin(t) * 0.3)); }
    both('bust', bust);
  }

  const lines = {}, fibres = {}, tendons = {};
  const place = (r, isContext) => {
    const at = G.segmentFrame(...segs[r.seg]);
    const pts = r.shape.map(([s, w]) => at(s, w));
    const fib = isContext ? [] : fibreFamily(r.fibres).map(l => l.map(([s, w]) => at(s, w)));
    const ln = isContext ? [] : (r.lines || []).map(l => l.map(([s, w]) => at(s, w)));
    const tn = !isContext && r.tendon ? r.tendon.map(([s, w]) => at(s, w)) : null;
    parts[r.id] = pts; fibres[r.id] = fib; lines[r.id] = ln; tendons[r.id] = tn;
    if (r.mirror !== false) {
      const k = r.id + '_l';
      parts[k] = pts.map(mir); fibres[k] = fib.map(l => l.map(mir)); lines[k] = ln.map(l => l.map(mir)); tendons[k] = tn ? tn.map(mir) : null;
    }
  };
  m.regions.forEach(r => place(r, false));
  m.context.forEach(c => place(c, true));

  const joints = {};
  for (const [k, v] of Object.entries(J)) {
    joints[k] = flat(v);
    if (['S', 'E', 'H', 'hip', 'knee', 'ankle'].includes(k)) joints[k + '_l'] = mir(flat(v));
  }
  /* Draw order, back to front. Torso first; legs over the pelvis (in the
     squat the thighs come toward the camera); arms over everything. */
  const legs = [
    ['part', 'thigh', 'gv-mm-body'], ['part', 'thigh_l', 'gv-mm-body'], ['muscles', 'thigh'],
    ['part', 'shin', 'gv-mm-body'], ['part', 'shin_l', 'gv-mm-body'], ['muscles', 'shin'],
    ['part', 'foot', 'gv-mm-body'], ['part', 'foot_l', 'gv-mm-body'],
  ];
  /* The torso reaches down to the groin, so the tops of the thighs belong
     BEHIND it — that is what makes a leg start at the groin instead of the
     hip joint (drawn the other way the legs look far too long). Only the
     squat brings its thighs forward over the pelvis. */
  const order = [
    ...(extra.propsFirst ? [['prop', 0]] : []),
    ...(extra.legsBehind ? legs : []),
    ['part', 'torso', 'gv-mm-body'], ['muscles', 'torso'],
    ...(parts.bun ? [['part', 'bun', 'gv-mm-body']] : []),
    ['part', 'neck', 'gv-mm-body'], ['part', 'ear', 'gv-mm-body'], ['part', 'ear_l', 'gv-mm-body'], ['part', 'skull', 'gv-mm-body'],
    ...(extra.legsBehind ? [] : legs),
    ...(parts.bust ? [['part', 'bust', 'gv-mm-body gv-mm-bust'], ['part', 'bust_l', 'gv-mm-body gv-mm-bust']] : []),
    ['part', 'upper', 'gv-mm-body'], ['part', 'upper_l', 'gv-mm-body'], ['muscles', 'upper'],
    ['part', 'fore', 'gv-mm-body'], ['part', 'fore_l', 'gv-mm-body'], ['muscles', 'fore'],
    ['part', 'hand', 'gv-mm-body'], ['part', 'hand_l', 'gv-mm-body'],
  ];
  return { parts, lines, fibres, tendons, joints, order, props: extra.props || [] };
}

/* A muscle's fibres in (s, w): n strands from one attachment edge to the
   other, each bowed a little like a belly. (The same rule as the side
   view's, kept local so this file stands alone.) */
function fibreFamily(f) {
  if (!f) return [];
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const out = [];
  for (let i = 0; i < f.n; i++) {
    const t = (i + 0.5) / f.n;
    const a = lerp2(f.from[0], f.from[1], t), b = lerp2(f.to[0], f.to[1], t);
    const mid = lerp2(a, b, 0.5);
    out.push([a, [mid[0], mid[1] + (t - 0.5) * 0.18], b]);
  }
  return out;
}

/* THE SQUAT, in 3D — one model, drawn from the front here and from the
   side by motion-library (so the two views always show the same rep).
   depth 0 = standing tall, 1 = hips at knee height. Returns the right-hand
   joints in 3D. */
function squat3D(depth, key, cx) {
  const F = frontOf(key);
  const ankle = [cx + F.ankleHalf, ANKLE_Y, 0];
  const legLen = F.thigh + F.shin;
  const spread = F.ankleHalf - F.hipHalf;
  const standY = ANKLE_Y - Math.sqrt((legLen - 0.8) ** 2 - spread * spread);
  /* At the bottom the pelvis has dropped to about knee height and moved
     back behind the heels — the shape of a parallel squat. */
  const pc = [cx, standY + F.thigh * 1.12 * depth, -F.thigh * 0.47 * depth];
  const hip = [cx + F.hipHalf, pc[1], pc[2]];
  /* knees forward (toward the camera) and a little out, over the toes */
  const knee = ik3(hip, ankle, F.thigh, F.shin, [0.16, 0, 1]);
  const lean = depth * 38 * Math.PI / 180;
  const up = [0, -Math.cos(lean), Math.sin(lean)];
  const sc = a3(pc, m3(up, F.torso));
  const S = a3(sc, [F.shoulderHalf, 0, 0]);
  const nb = a3(pc, m3(up, F.torso + F.neckGap));
  const C = a3(nb, m3(up, F.head.ry - 1));
  /* The counterbalance: arms hang by the sides standing tall and rise
     straight forward to shoulder height as the hips sit back — the way most
     people squat without a weight, and the pose that reads from the side.
     A soft elbow, bending down. */
  const swing = depth * 84 * Math.PI / 180;
  const armDir = [0, Math.cos(swing), Math.sin(swing)];
  const H = a3(S, m3(armDir, F.UA + F.FA - 3));
  const E = ik3(S, H, F.UA, F.FA, [0.15, 1, -0.25]);
  return { pc, sc, nb, C, S, E, H, hip, knee, ankle, up, lean };
}

function squatRig(m, depth, key) {
  const F = frontOf(key);
  const J3 = squat3D(depth, key, m.geo.cx);
  const { H, ankle } = J3;
  delete J3.up; delete J3.lean;
  const out = assemble(m, F, key, J3, {
    foot: footFront(flat(ankle)),
    /* a loose fist on the end of the forearm. When the arm points straight
       at the camera its drawn direction vanishes, so fall back to "down". */
    fist: (() => {
      const d = G.sub(flat(H), flat(J3.E));
      const ax = G.len(d) > 2 ? G.unit(d) : [0, 1];
      return fistPts(G.add(flat(H), G.mul(ax, F.fist.h * 0.35)), F.fist.h, F.fist.w, ax);
    })(),
  });
  out.joints3 = J3;
  return out;
}

/* THE PULL-UP, flat in the frontal plane. depth 0 = dead hang, 1 = chin
   over the bar. */
function pullRig(m, depth, key) {
  const F = frontOf(key), cx = m.geo.cx, barY = m.geo.barY;
  const grip = F.shoulderHalf + 38; // a wide grip: hands well outside the shoulders
  const H = [cx + grip, barY + 1.5];
  const reach = F.UA + F.FA - 0.3; // a straight arm, not hyperextended
  const ox = grip - F.shoulderHalf;
  const hangY = H[1] + Math.sqrt(reach * reach - ox * ox);
  const sy = hangY + (barY + 6 - hangY) * depth;
  const S = [cx + F.shoulderHalf, sy];
  const E = G.midJoint(S, H, F.UA, F.FA, [1, 0.5]); // elbows out and down
  const pc = [cx, sy + F.torso];
  const nb = [cx, sy - F.neckGap];
  const C = [cx, nb[1] - (F.head.ry - 1)];
  const hip = [cx + F.hipHalf, pc[1]];
  /* legs hang long, knees soft, feet together and pointed */
  const kneeDir = G.unit([-3, F.thigh]), shinDir = G.unit([-2.5, F.shin]);
  const knee = G.add(hip, G.mul(kneeDir, F.thigh));
  const ankle = G.add(knee, G.mul(shinDir, F.shin));
  const J = { pc, sc: [cx, sy], nb, C, S, E, H, hip, knee, ankle };
  const L3 = Object.fromEntries(Object.entries(J).map(([k, v]) => [k, [v[0], v[1], 0]]));
  const out = assemble(m, F, key, L3, {
    foot: footHanging(knee, ankle),
    /* a fist wrapped over the bar, knuckles across it */
    fist: fistPts([H[0], barY - 0.6], F.fist.w, F.fist.h, [1, 0]),
    propsFirst: true,
    legsBehind: true,
    props: [{ kind: 'bar', a: [cx - grip - 26, barY], b: [cx + grip + 26, barY], r: 3.2 }],
  });
  return out;
}

module.exports = { FRONT, frontOf, REGIONS_SQUAT, CONTEXT_SQUAT, REGIONS_PULL, CONTEXT_PULL, squatRig, pullRig, squat3D, ik3 };
