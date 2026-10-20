'use strict';
/* L2-14 — downloaded images were stored as absolute vault paths
   (Gym/Attachments/...), so renaming or moving the Gym folder broke every one.
   They are now stored as a wikilink to the path inside the Attachments folder
   ([[Attachments/<exercise>/<file>]]). Obsidian resolves a link path by
   basename and then by path SUFFIX (case-insensitively), so the same value keeps
   resolving after the Gym folder is renamed. The reader (page-exercise-detail's
   resolveExerciseImages -> vaultFile) already understands wikilinks, and it is
   the only reader of fm.image. Existing absolute values are not migrated. */
const assert = require('node:assert');
const { obsidianStub, loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');
const { makeDocument } = require('./plans-dom-stub');
global.document = makeDocument();

obsidianStub.requestUrl = async () => ({ arrayBuffer: new ArrayBuffer(4) });
const { makeIo } = loadSrc('data.js');
const { resolveExerciseImages } = loadSrc('page-exercise-detail.js');
const { parseFrontmatter } = require('../src/markdown');
const { check, run } = makeRunner();

/* Obsidian 1.14.4 MetadataCache.getLinkpathDest, reduced to what a vault-relative
   link path needs: look the file up by basename, then keep those whose path ENDS
   WITH the link path, case-insensitively. */
const resolver = v => ({
  getFirstLinkpathDest(linkpath) {
    const want = linkpath.toLowerCase();
    const base = want.split('/').pop();
    const all = [...v._disk.keys()].map(p => v.getFileByPath(p)).filter(Boolean);
    return all.find(f => f.name.toLowerCase() === base && f.path.toLowerCase().endsWith(want)) || null;
  },
});

const setup = async () => {
  const v = makeVault([['Gym/Exercises/Sample Press.md', '---\nimage: https://img.example/a.jpg\n---\nbody\n']]);
  const io = makeIo(makePlugin(v));
  const out = await io.downloadMedia();
  assert.strictEqual(out.saved, 1, JSON.stringify(out));
  const { fm } = parseFrontmatter(v._disk.get('Gym/Exercises/Sample Press.md'));
  return { v, io, fm };
};

check('L2-14 a downloaded image is stored as a link relative to the Attachments folder, not an absolute Gym path', async () => {
  const { fm } = await setup();
  assert.ok(/^\[\[Attachments\/Sample Press\/[a-z0-9]+\.jpg\]\]$/.test(fm.image), `stored: ${JSON.stringify(fm.image)}`);
  assert.ok(!String(fm.image).includes('Gym/'), 'the Gym folder name must not be in the stored value');
});

check('L2-14 the stored value resolves to the downloaded file through the shared image reader', async () => {
  const { v, fm } = await setup();
  const ctx = { app: { vault: v, metadataCache: resolver(v) } };
  const frames = resolveExerciseImages(ctx, { fm, file: { path: 'Gym/Exercises/Sample Press.md' } });
  assert.strictEqual(frames.length, 1, 'the image did not resolve');
  assert.ok(/^app:\/\/local\/Gym\/Attachments\/Sample Press\//.test(frames[0].src), frames[0].src);
});

check('L2-14 ... and still resolves after the Gym folder is renamed', async () => {
  const { v, fm } = await setup();
  /* The vault index after the user renames Gym -> Fitness in Obsidian. */
  const moved = makeVault([]);
  for (const [p, data] of v._disk) moved.externalWrite(p.replace(/^Gym\//, 'Fitness/'), data);
  const ctx = { app: { vault: moved, metadataCache: resolver(moved) } };
  const frames = resolveExerciseImages(ctx, { fm, file: { path: 'Fitness/Exercises/Sample Press.md' } });
  assert.strictEqual(frames.length, 1, 'after the rename the image no longer resolves');
});

check('L2-14 a note that already holds an absolute local path is left exactly as it is', async () => {
  const v = makeVault([['Gym/Exercises/Old.md', '---\nimage: Gym/Attachments/Old/x.jpg\n---\n'], ['Gym/Attachments/Old/x.jpg', 'bin']]);
  const before = v._disk.get('Gym/Exercises/Old.md');
  const out = await makeIo(makePlugin(v)).downloadMedia();
  assert.deepStrictEqual(out, { saved: 0, patched: 0, failed: 0 });
  assert.strictEqual(v._disk.get('Gym/Exercises/Old.md'), before);
});

check('L2-14 running it again is a no-op (already local)', async () => {
  const { v, io } = await setup();
  const again = await io.downloadMedia();
  assert.deepStrictEqual(again, { saved: 0, patched: 0, failed: 0 });
});

run('w1-image-links');
