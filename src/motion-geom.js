'use strict';
/* Geometry for the Muscle Map. Pure — no DOM, no obsidian import.

   A body here is a chain of SEGMENTS (hip→shoulder, shoulder→elbow, …), and
   every segment is drawn from a PROFILE: a list of [s, a, b] rows, where s
   runs 0→1 along the segment and a/b are half-widths on its two sides. That
   one idea gives every part of the figure — calf, quad, chest, delt — its
   shape, and the same profile gives each muscle its place: a muscle is drawn
   in its segment's own (s, w) frame — see segmentFrame. Outlines are closed point lists,
   smoothed into SVG paths with Catmull-Rom, so a dozen points read as a
   body rather than a polygon.

   Coordinates are px on a stage whose floor is at y = FLOOR; y grows down,
   as SVG's does. The renderer frames whatever it draws, so the absolute
   numbers only have to agree with each other. */

const FLOOR = 214;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const len = a => Math.hypot(a[0], a[1]);
const unit = a => mul(a, 1 / len(a));
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const lerpP = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const offsetPts = (pts, o) => pts.map(p => add(p, o));
const centroid = pts => mul(pts.reduce((s, p) => add(s, p), [0, 0]), 1 / pts.length);

/* The perpendicular of unit vector u that points the same way as ref. */
const perpToward = (u, ref) => { const p = [u[1], -u[0]]; return dot(p, ref) >= 0 ? p : mul(p, -1); };

/* Interior angle at joint J between J→A and J→B, in degrees. */
function angleAt(J, A, B) {
  const a = unit(sub(A, J)), b = unit(sub(B, J));
  return Math.acos(clamp(dot(a, b), -1, 1)) * 180 / Math.PI;
}

/* Where two circles cross — the upper of the two points (smaller y). Used to
   find a shoulder that is a fixed distance from both a pivot and a hand. */
function circlesUpper(P, R, Q, r) {
  const d = sub(Q, P), D = len(d);
  const a = (R * R - r * r + D * D) / (2 * D);
  const h = Math.sqrt(Math.max(0, R * R - a * a));
  const m = add(P, mul(d, a / D));
  const p1 = [m[0] + h * d[1] / D, m[1] - h * d[0] / D];
  const p2 = [m[0] - h * d[1] / D, m[1] + h * d[0] / D];
  return p1[1] < p2[1] ? p1 : p2;
}

/* Two-bone IK: the middle joint of a limb (elbow, knee) given its root, its
   end and the two bone lengths. Of the two solutions, the one further along
   `pref` wins — that is how an elbow is told to bend back, not forward. */
function midJoint(root, end, a, b, pref) {
  const D = len(sub(end, root));
  const al = Math.acos(clamp((a * a + D * D - b * b) / (2 * a * D), -1, 1));
  const base = Math.atan2(end[1] - root[1], end[0] - root[0]);
  const j1 = [root[0] + a * Math.cos(base + al), root[1] + a * Math.sin(base + al)];
  const j2 = [root[0] + a * Math.cos(base - al), root[1] + a * Math.sin(base - al)];
  return dot(sub(j1, root), pref) > dot(sub(j2, root), pref) ? j1 : j2;
}

/* Half-width of a profile at s, on side k (1 = a, 2 = b), linearly
   interpolated between rows and held flat past either end. */
function wAt(spec, s, k) {
  if (s <= spec[0][0]) return spec[0][k];
  for (let i = 1; i < spec.length; i++) {
    if (s <= spec[i][0]) {
      const f = (s - spec[i - 1][0]) / (spec[i][0] - spec[i - 1][0]);
      return spec[i - 1][k] + (spec[i][k] - spec[i - 1][k]) * f;
    }
  }
  return spec[spec.length - 1][k];
}

/* The s values to sample between s0 and s1: every profile row in range plus
   enough in-between points that a long segment still curves smoothly. */
function sSamples(spec, s0, s1) {
  const raw = [...new Set([s0, s1, ...spec.map(r => r[0])])].filter(s => s >= s0 && s <= s1).sort((x, y) => x - y);
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    out.push(raw[i]);
    if (i < raw.length - 1) {
      const g = raw[i + 1] - raw[i], n = Math.floor(g / 0.16);
      for (let j = 1; j <= n; j++) out.push(raw[i] + g * j / (n + 1));
    }
  }
  return out;
}

/* Closed outline of a segment A→B with profile `spec`; side a faces `ref`.
   s0/s1 cut a slice (clothing, the visible part of a limb); grow fattens it. */
function limbPts(A, B, spec, ref, s0, s1, grow) {
  const lo = s0 === undefined ? -9 : s0, hi = s1 === undefined ? 9 : s1, g = grow || 0;
  const ax = sub(B, A), L = len(ax), u = unit(ax), p = perpToward(u, ref);
  const ss = sSamples(spec, Math.max(lo, spec[0][0]), Math.min(hi, spec[spec.length - 1][0]));
  const at = (s, w, sg) => add(add(A, mul(u, s * L)), mul(p, sg * w));
  return ss.map(s => at(s, wAt(spec, s, 1) + g, 1))
    .concat(ss.slice().reverse().map(s => at(s, wAt(spec, s, 2) + g, -1)));
}

/* A segment's own coordinate frame: returns (s, w) → point, where s runs
   along A→B and w across it (+1 = the side-a surface, -1 = side b, scaled
   by the profile's half-width at s). Muscles are drawn in this frame so
   they ride their limb. */
function segmentFrame(A, B, spec, ref) {
  const ax = sub(B, A), L = len(ax), u = unit(ax), p = perpToward(u, ref);
  /* |w| is capped at the surface: a muscle may sit ON the limb's edge but
     never stick out past its silhouette. */
  return (s, w) => { const c = clamp(w, -1, 1); return add(add(A, mul(u, s * L)), mul(p, c * wAt(spec, s, c >= 0 ? 1 : 2))); };
}

const f1 = p => p[0].toFixed(1) + ' ' + p[1].toFixed(1);

/* Closed Catmull-Rom spline through every point, as an SVG path. */
function smooth(P) {
  const n = P.length;
  let d = 'M' + f1(P[0]);
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    d += 'C' + f1(add(p1, mul(sub(p2, p0), 1 / 6))) + ' ' + f1(sub(p2, mul(sub(p3, p1), 1 / 6))) + ' ' + f1(p2);
  }
  return d + 'Z';
}

/* Open fibre strokes: each line is [start, control, end] → a quadratic. */
function strokes(lines) {
  return lines.map(([a, c, b]) => 'M' + f1(a) + 'Q' + f1(c) + ' ' + f1(b)).join('');
}

/* A tapered cord along a quadratic a→c→b, w0 thick at a, w1 at b, as a
   closed outline (a tendon narrowing to its attachment). */
function taperPts(a, c, b, w0, w1) {
  const L = [], R = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const pt = add(add(mul(a, (1 - t) * (1 - t)), mul(c, 2 * t * (1 - t))), mul(b, t * t));
    const d = unit(add(mul(sub(c, a), 2 * (1 - t)), mul(sub(b, c), 2 * t)));
    const w = w0 + (w1 - w0) * t;
    L.push(add(pt, mul([-d[1], d[0]], w))); R.unshift(sub(pt, mul([-d[1], d[0]], w)));
  }
  return L.concat(R);
}

/* Ease in and out of a phase. */
const ease = x => 0.5 - Math.cos(Math.PI * x) / 2;

/* Bounding box of many point lists, as [minX, minY, maxX, maxY]. */
function bounds(lists) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const pts of lists) for (const p of pts) {
    if (p[0] < x0) x0 = p[0]; if (p[1] < y0) y0 = p[1];
    if (p[0] > x1) x1 = p[0]; if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

module.exports = {
  FLOOR, sub, add, mul, len, unit, dot, lerpP, clamp, offsetPts, centroid, perpToward, angleAt,
  circlesUpper, midJoint, wAt, sSamples, limbPts, segmentFrame, smooth, strokes, taperPts, ease, bounds,
};
