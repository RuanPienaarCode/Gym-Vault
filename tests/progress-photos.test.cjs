'use strict';
/* Progress photos derive everything from the files on disk — no index note.
   These pin that the derivation is total: a path either round-trips to a
   {pose, date} or is rejected, and nothing else in the vault is claimed. */
const assert = require('node:assert');
const {
  POSES, poseByKey, isPoseKey, photosRoot, poseFolder, photoPath,
  parsePhotoPath, photosForPose, beforeAfter, poseSummary,
} = require('../src/progress-photos');

const ROOT = 'Gym';

/* The poses the UI offers are a closed set with stable keys — the keys are
   FOLDER NAMES on the user's disk, so renaming one orphans their photos. */
{
  assert.deepStrictEqual(POSES.map(p => p.key), ['standing', 'flexing', 'side', 'back'],
    'pose keys are folder names on disk — renaming or reordering orphans existing photos');
  for (const p of POSES) {
    assert.ok(p.label && p.hint, `${p.key} needs a label and a hint`);
    assert.ok(Array.isArray(p.guide) && p.guide.length, `${p.key} needs a camera guide outline`);
    assert.ok(!/[\\/:*?"<>|]/.test(p.key), `${p.key} must be a legal folder name`);
  }
  assert.strictEqual(poseByKey('flexing').label, 'Flexing');
  assert.strictEqual(poseByKey('nope'), null);
  assert.ok(isPoseKey('standing') && !isPoseKey('standing '));
}

/* Paths are self-describing in Obsidian's own file explorer. */
{
  assert.strictEqual(photosRoot(ROOT), 'Gym/Progress Photos');
  assert.strictEqual(poseFolder(ROOT, 'flexing'), 'Gym/Progress Photos/flexing');
  assert.strictEqual(photoPath(ROOT, 'flexing', '2026-08-29', 'jpg'), 'Gym/Progress Photos/flexing/2026-08-29.jpg');
  assert.strictEqual(photoPath(ROOT, 'standing', '2026-08-29', 'PNG'), 'Gym/Progress Photos/standing/2026-08-29.png',
    'extension must be folded to lower case so one date cannot produce two files');
  assert.strictEqual(photoPath(ROOT, 'standing', '2026-08-29'), 'Gym/Progress Photos/standing/2026-08-29.jpg',
    'jpg is the default');
}

/* parsePhotoPath is the gate: anything it accepts, the viewer will show. */
{
  const ok = parsePhotoPath(ROOT, 'Gym/Progress Photos/standing/2026-08-29.jpg');
  assert.deepStrictEqual({ pose: ok.pose, date: ok.date, seq: ok.seq },
    { pose: 'standing', date: '2026-08-29', seq: 1 });

  // a same-day retake keeps its date and sorts after the first
  const retake = parsePhotoPath(ROOT, 'Gym/Progress Photos/standing/2026-08-29 2.jpg');
  assert.deepStrictEqual({ date: retake.date, seq: retake.seq }, { date: '2026-08-29', seq: 2 });

  for (const bad of [
    'Gym/Progress Photos/standing/notadate.jpg',        // no date
    'Gym/Progress Photos/standing/2026-08-29.txt',      // not an image
    'Gym/Progress Photos/dancing/2026-08-29.jpg',       // unknown pose
    'Gym/Progress Photos/2026-08-29.jpg',               // no pose folder
    'Gym/Progress Photos/standing/sub/2026-08-29.jpg',  // too deep
    'Gym/Exercises/Bench.md',                           // not ours at all
    'Progress Photos/standing/2026-08-29.jpg',          // outside the gym root
  ]) {
    assert.strictEqual(parsePhotoPath(ROOT, bad), null, `must reject: ${bad}`);
  }
  assert.strictEqual(parsePhotoPath(ROOT, null), null);
}

/* Ordering is what the morph plays through: oldest first, stable on ties. */
{
  const p = (pose, date, seq = 1) => ({ pose, date, seq, path: `${pose}/${date}` });
  const entries = [
    p('standing', '2026-03-01'),
    p('flexing', '2026-05-01'),
    p('standing', '2026-08-29', 2),
    p('standing', '2026-08-29', 1),
    p('standing', '2026-01-15'),
  ];
  const standing = photosForPose(entries, 'standing');
  assert.deepStrictEqual(standing.map(e => `${e.date}#${e.seq}`),
    ['2026-01-15#1', '2026-03-01#1', '2026-08-29#1', '2026-08-29#2'],
    'oldest first, same-day retakes in capture order');
  assert.strictEqual(photosForPose(entries, 'back').length, 0);

  // the input array must not be reordered under the caller
  assert.strictEqual(entries[0].date, '2026-03-01', 'photosForPose sorted the caller\'s array in place');
}

/* One photo is not a comparison. Showing it as both before AND after would
   imply a change that has not happened. */
{
  const p = (pose, date, seq = 1) => ({ pose, date, seq, path: `${pose}/${date}` });
  assert.strictEqual(beforeAfter([p('standing', '2026-01-15')], 'standing'), null,
    'a single photo must not render as a before/after pair');
  assert.strictEqual(beforeAfter([], 'standing'), null);

  const pair = beforeAfter([p('standing', '2026-08-29'), p('standing', '2026-01-15')], 'standing');
  assert.strictEqual(pair.before.date, '2026-01-15');
  assert.strictEqual(pair.after.date, '2026-08-29');
  assert.strictEqual(pair.count, 2);
}

/* The profile section lists every pose in a stable order, with counts. */
{
  const p = (pose, date) => ({ pose, date, seq: 1, path: `${pose}/${date}` });
  const summary = poseSummary([p('flexing', '2026-01-01'), p('flexing', '2026-06-01')]);
  assert.deepStrictEqual(summary.map(s => s.pose.key), POSES.map(x => x.key), 'stable pose order');
  const flexing = summary.find(s => s.pose.key === 'flexing');
  assert.strictEqual(flexing.count, 2);
  assert.strictEqual(flexing.latest.date, '2026-06-01');
  assert.strictEqual(summary.find(s => s.pose.key === 'back').latest, null);
}

console.log('progress photos OK (paths round-trip, foreign files rejected, order stable, one photo is not a pair)');
