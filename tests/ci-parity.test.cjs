'use strict';
/* CI must run the SAME gate as a local ./build.sh (issue #10).

   Until this workflow existed the guard suite ran on a tag and nowhere else,
   so a bad commit on main was invisible until you were already cutting a
   release. The fix is only worth as much as its fidelity: a CI job that runs
   four of build.sh's five steps is a job that says "green" while the missing
   step is exactly the one that would have caught you.

   So the two are pinned to each other here. If build.sh grows a step, this
   fails until ci.yml grows it too — which is the only way "CI is red" and
   "build.sh is red" stay the same sentence. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

const ci = read('.github/workflows/ci.yml');
const sh = read('build.sh');
/* The comments in both files NAME the release-only steps in order to say
   they are excluded, so the "nothing release-only leaked in" check below has
   to read what RUNS, not what is explained. */
const uncommented = s => s.replace(/(^|\s)#.*$/gm, '$1');
const ciRuns = uncommented(ci);

/* ---- the five steps, in both places ---- */
{
  const steps = [
    [/npm ci/, 'npm ci — installs exactly the lockfile, which is what makes the artifact diff meaningful'],
    [/npm run build/, 'npm run build'],
    [/node --check main\.js/, 'node --check main.js — the bundle must at least parse'],
    [/npm test/, 'npm test — the guard suite'],
  ];
  for (const [re, what] of steps) {
    assert.match(ci, re, `ci.yml is missing: ${what}`);
    assert.match(sh, re, `build.sh is missing: ${what} — if it moved, move it in ci.yml too`);
  }

  /* The fifth is CI-only: locally your working tree IS the source of truth,
     but a pushed commit whose main.js does not match its src/ describes one
     plugin and ships another. */
  for (const artifact of ['main.js', 'styles.css']) {
    assert.match(ci, new RegExp(`git diff --exit-code -- ${artifact.replace('.', '\\.')}`),
      `ci.yml must verify the committed ${artifact} matches src/ — it is build output, not a source file`);
  }
}

/* ---- it runs where a regression should be caught, not only at the tag ---- */
{
  const on = ciRuns.slice(ciRuns.indexOf('\non:'), ciRuns.indexOf('permissions:'));
  assert.match(on, /pull_request/, 'CI must run on pull requests');
  assert.match(on, /push:[\s\S]*branches:[\s\S]*main/, 'CI must run on pushes to main');
  assert.ok(!/tags:/.test(on),
    'the tag belongs to release.yml — duplicating it here would run the release gate twice and the pre-tag gate never');
}

/* ---- read-only, and nothing release-only leaked in ---- */
{
  assert.match(ci, /permissions:\s*\n\s*contents: read/,
    'this workflow publishes nothing, so it must not be able to');
  for (const [re, what] of [
    [/attest-build-provenance/, 'attestations'],
    [/gh release create/, 'release creation'],
    [/id-token: write/, 'provenance token'],
  ]) {
    assert.ok(!re.test(ciRuns), `${what} belongs to release.yml only — this is the pre-tag gate`);
  }
}

/* ---- every action is SHA-pinned, and to the same commit release.yml uses -- */
{
  const release = read('.github/workflows/release.yml');
  const uses = s => [...s.matchAll(/uses:\s*(\S+)/g)].map(m => m[1]);

  const pinned = uses(ci);
  assert.ok(pinned.length >= 2, 'expected checkout and setup-node in ci.yml');
  for (const u of pinned) {
    assert.match(u, /@[0-9a-f]{40}$/,
      `${u} is not SHA-pinned — a moving tag is an unreviewed change to what runs on every push`);
  }

  /* Shared actions must be the SAME sha in both files, or the two workflows
     quietly stop checking out the same way. */
  const byName = s => new Map(uses(s).map(u => [u.split('@')[0], u.split('@')[1]]));
  const a = byName(ci), b = byName(release);
  for (const [name, sha] of a) {
    if (!b.has(name)) continue;
    assert.strictEqual(sha, b.get(name),
      `${name} is pinned to a different commit in ci.yml and release.yml — pin both or neither`);
  }
}

console.log('ci parity OK (the pre-tag gate runs build.sh\'s steps, on PRs and main, read-only, SHA-pinned to release.yml)');
