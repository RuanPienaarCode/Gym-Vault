'use strict';
/* Structural guards for the progress-photo feature.

   The suite renders no DOM, so these check the seams that a runtime test
   caught once and would not catch again on a machine without a browser. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* GUARD 1: a photo must never be left INVISIBLE by a fade that didn't run.

   Rendering is throttled while a pane is hidden, and Obsidian hides panes
   whenever you switch tabs. The viewer sets opacity 0 then transitions to 1;
   if that transition never ticks, the photo stays at 0 and the page looks
   empty. Verified live: with document.visibilityState 'hidden', the computed
   opacity sat at 0 indefinitely until a setTimeout backstop was added.
   requestAnimationFrame is NOT a valid backstop — it does not run at all
   while hidden, which is exactly the case that breaks. */
{
  const code = strip(read('photo-viewer.js'));
  assert.ok(/setTimeout\(/.test(code),
    'photo-viewer must keep a setTimeout backstop that forces the fade\'s end state — ' +
    'a hidden pane never ticks the transition and the photo stays invisible.');
  assert.ok(!/requestAnimationFrame/.test(code),
    'photo-viewer must not depend on requestAnimationFrame: it does not run while the pane ' +
    'is hidden, which is the very case that leaves the photo at opacity 0.');
  assert.ok(/prefers-reduced-motion/.test(read('photo-viewer.js')),
    'the cross-dissolve must be skippable under prefers-reduced-motion');
}

/* GUARD 2: the camera must be released.

   A WebView that keeps a MediaStream open leaves the phone's camera active
   and draining after the modal is gone. */
{
  const code = strip(read('photo-capture.js'));
  assert.ok(/getTracks\(\)/.test(code) && /\.stop\(\)/.test(code),
    'photo-capture must stop every MediaStream track');
  assert.ok(/onClose\(\)\s*\{[\s\S]*?stopStream\(\)/.test(code),
    'photo-capture must release the camera in onClose(), not only on the shutter — ' +
    'Escape and backdrop dismissal bypass the shutter entirely.');
  assert.ok(/liveCameraAvailable/.test(code) && /catch\s*\(/.test(code),
    'photo-capture must feature-detect getUserMedia AND handle its rejection — ' +
    'Obsidian\'s iOS WebView can expose the API and still refuse the permission.');
}

/* GUARD 3: body photos must never reach an export.

   The exporters walk `data`, so photos are deliberately NOT loaded into it.
   This is the same class of leak as the profile spread fixed in 0.3.0, and
   the consequence here is worse. */
{
  const exportCode = strip(read('export.js'));
  for (const forbidden of ['photo', 'Photo', 'Progress Photos']) {
    assert.ok(!exportCode.includes(forbidden),
      `export.js must not reference '${forbidden}' — progress photos are body images and ` +
      'must never be carried into an export in any format.');
  }
  const dataCode = strip(read('data.js'));
  const loadAll = dataCode.match(/async function loadAll\(\)[\s\S]*?\n  \}/);
  assert.ok(loadAll, 'loadAll not found in data.js — renamed?');
  assert.ok(!/listPhotos|photoSrc|Progress Photos/.test(loadAll[0]),
    'loadAll must not pull photos into `data` — the exporters walk `data`, and a body photo ' +
    'must not be one refactor away from an export.');
}

/* GUARD 4: pose keys are folder names on the user's disk.

   Renaming or reordering one orphans every photo already filed under it. */
{
  const { POSES } = require('../src/progress-photos');
  assert.deepStrictEqual(POSES.map(p => p.key), ['standing', 'flexing', 'side', 'back'],
    'pose keys are FOLDER NAMES on disk — changing one orphans the user\'s existing photos. ' +
    'Add new poses at the end; never rename or reorder.');
}

/* GUARD 5: photos are written with createBinary and read via the host's own
   resource path. A file:// URL does not resolve inside the app's WebView, and
   reading bytes into a blob: URL would hold every thumbnail in memory. */
{
  const code = strip(read('data.js'));
  assert.ok(/createBinary\(path, data\)/.test(code), 'savePhoto must write bytes with createBinary');
  assert.ok(/getResourcePath/.test(code), 'photoSrc must use the host resource path, not file:// or blob:');
}

console.log('photo guards OK (fade cannot strand a photo invisible, camera released, photos never exported)');
