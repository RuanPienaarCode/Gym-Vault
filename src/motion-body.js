'use strict';
/* The two mannequin bodies the Muscle Map draws. Pure data plus one head
   builder — no DOM.

   Proportions follow standard anthropometric ratios for a ~263px figure
   (upper arm ≈ .186 of height, forearm ≈ .146, head ≈ .13), so a push-up
   looks like a person doing one rather than a diagram. Every profile is
   [s, a, b]: s along the segment, a = half-width on the side facing the
   segment's reference direction (the back of the body; the triceps side of
   an arm), b = the other side (chest, belly, quads; the biceps side).

   Female is its own shape, not the male one scaled: narrower shoulders and
   arms, a waist, wider hips and glutes, a bust on the front of the chest. */

const { add, mul, unit } = require('./motion-geom');

/* Male lengths; the female body sets its own (see BODIES). */
const UPPER_ARM = 48;
const FOREARM = 42;

const scaleSpec = (spec, k) => spec.map(([s, a, b]) => [s, a * k, b * k]);

/* Male: a V — deep chest and thick upper back over a narrower waist, flat
   glutes, big shoulder caps, a heavy neck and arms. */
const TORSO = [[-0.1, 7, 4], [-0.02, 12, 8], [0.06, 13.5, 9.5], [0.2, 12, 10], [0.38, 9.5, 10.3], [0.6, 11.8, 13], [0.8, 14, 16.5], [0.93, 13.5, 14], [1.04, 10.5, 8.5], [1.12, 4.5, 3]];
const THIGH = [[-0.08, 9, 8], [0, 12, 11], [0.15, 13, 12], [0.5, 11, 10.5], [0.85, 8.5, 8.5], [1, 7.5, 7.5], [1.08, 4, 4]];
const SHIN = [[-0.08, 5, 5], [0, 7.5, 7], [0.22, 9.5, 6.8], [0.5, 7.5, 5.5], [0.85, 4.8, 4.3], [1, 4.2, 4], [1.06, 2, 2]];
const UPPER = [[-0.14, 5.5, 5.5], [-0.04, 10.2, 10.2], [0.12, 10.6, 9.5], [0.45, 9, 7.4], [0.8, 6.4, 5.8], [1, 5.6, 5.4], [1.08, 3, 3]];
const FORE = [[-0.06, 4.3, 4.3], [0, 5.9, 5.6], [0.25, 7, 6.3], [0.6, 5.2, 4.7], [0.95, 3.8, 3.7], [1.04, 2.6, 2.6]];
const HAND = [[-0.1, 3, 3], [0, 3.8, 3.4], [0.35, 4.6, 2.8], [0.75, 3.4, 2.2], [1, 2.2, 1.5], [1.06, 1, 1]];
const NECK = [[-0.1, 3.4, 3.4], [0, 7.4, 7.4], [1, 6.4, 6.4], [1.1, 3.4, 3.4]];

/* Female: an hourglass — full, rounded glutes and wide hips, a narrow waist
   with the lower back's curve, a bust, slimmer upper back and shoulders. */
const TORSO_F = [[-0.1, 8, 4.5], [-0.02, 16, 9.5], [0.08, 18.5, 11], [0.2, 14.5, 10.4], [0.32, 8.4, 9], [0.42, 8.2, 8.4], [0.56, 9, 9.4], [0.66, 9.4, 13.8], [0.75, 9.6, 16.4], [0.84, 9.6, 12.6], [0.95, 9.2, 10], [1.04, 7, 6.4], [1.12, 3.2, 2.8]];
const THIGH_F = [[-0.08, 11, 10], [0, 15, 13], [0.15, 15.4, 13.2], [0.5, 11.6, 10.4], [0.85, 7.8, 7.6], [1, 6.8, 6.8], [1.08, 4, 4]];

/* scale: overall height relative to the male figure (ankle→shoulder and
   the rep's depth both follow it). The female figure is ~7% shorter, with
   shorter, slimmer arms — so her hands land in a different place and every
   motion is solved per body (motion-library geoFor). */
const BODIES = {
  male: { TORSO, THIGH, SHIN, UPPER, FORE, HAND, NECK, UPPER_ARM, FOREARM, scale: 1, headScale: 1.08, headAhead: 30 },
  female: {
    TORSO: TORSO_F, THIGH: THIGH_F, SHIN: scaleSpec(SHIN, 0.9), UPPER: scaleSpec(UPPER, 0.7),
    FORE: scaleSpec(FORE, 0.74), HAND: scaleSpec(HAND, 0.8), NECK: scaleSpec(NECK, 0.7),
    UPPER_ARM: 44, FOREARM: 38.5, scale: 0.93, headScale: 0.95, headAhead: 26,
  },
};
const bodyOf = key => BODIES[key] || BODIES.male;

/* The mannequin head in profile, in a face frame: x = the way the face
   points, y = toward the crown. Units are px at a ~30px head. The female
   head has a softer brow, a smaller nose and jaw. */
const SKULL = {
  male: [[0, 14.2], [6.6, 12.8], [10.4, 9.2], [11.9, 5.6], [12.5, 4.1], [11.6, 2.6], [12.4, 1.2], [14.2, -1], [15.6, -2.6],
    [14.6, -3.6], [13.1, -3.9], [13.4, -5.1], [12.8, -6.1], [13.2, -7], [12.5, -8.1], [11.8, -9.1], [12.3, -10.6], [11.3, -12.4],
    [8.6, -13.4], [3.8, -12.2], [-0.6, -9.6], [-4.6, -7.2], [-9.4, -5], [-12.8, -0.4], [-13.6, 4.4], [-11.4, 9.6], [-6, 13.4]],
  female: [[0, 13.8], [6.4, 12.4], [10, 9], [11.4, 5.6], [11.8, 4.2], [11.1, 2.8], [11.8, 1.4], [13.3, -0.8], [14.4, -2.2], [13.6, -3.2],
    [12.4, -3.5], [12.9, -4.6], [12.3, -5.4], [12.7, -6.4], [11.9, -7.5], [11.2, -8.4], [11.4, -9.8], [10.2, -11.4], [7.6, -12.3],
    [3.4, -11.3], [-0.4, -9], [-4.4, -6.8], [-9, -4.8], [-12.4, -0.4], [-13.2, 4.2], [-11, 9.4], [-5.8, 13]],
};
/* A low bun at the back of the female head, in the mannequin's own colour —
   the cue that reads as female even at card size. */
const BUN = [[-12.4, 0.4], [-11.2, 3.6], [-12.8, 6.4], [-16.2, 6.6], [-18.4, 3.8], [-17.8, 0.4], [-15.2, -1.2]];
const EAR = [[-2.4, 3.6], [-0.6, 2.8], [0.1, 0.4], [-0.4, -2.6], [-1.6, -4.4], [-3.4, -4.2], [-4.6, -1.8], [-4.8, 1.4], [-4, 3.2]];

/* The head at centre C, crown along U, back of the head along N. The face
   is tipped 12° toward the crown: in a push-up a neutral neck looks at the
   floor a little ahead of the hands. */
function headOutline(C, U, N, bodyKey, tiltDeg) {
  const key = BODIES[bodyKey] ? bodyKey : 'male';
  const k = BODIES[key].headScale;
  const a = (tiltDeg === undefined ? 12 : tiltDeg) * Math.PI / 180;
  const F = unit(add(mul(N, -Math.cos(a)), mul(U, Math.sin(a))));
  const Y = unit(add(mul(U, Math.cos(a)), mul(N, Math.sin(a))));
  const W = ([x, y]) => add(C, add(mul(F, x * k), mul(Y, y * k)));
  const out = { skull: SKULL[key].map(W), ear: EAR.map(W) };
  if (key === 'female') out.bun = BUN.map(W);
  return out;
}

module.exports = { UPPER_ARM, FOREARM, BODIES, bodyOf, headOutline, scaleSpec };
