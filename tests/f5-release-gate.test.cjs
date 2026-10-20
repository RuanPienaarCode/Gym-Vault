'use strict';
/* S-10 / S-01: the release workflow's tag gate.

   It compared the tag with manifest.json and checked versions.json, but never
   package.json or package-lock.json, so a release could ship with the package
   files a version behind (the lockfile is what `npm ci` installs). And nothing
   stopped a tag on a commit that is not on main.

   This RUNS the workflow's own `run:` blocks with bash over throw-away
   fixtures, so it tests what CI will do, not what the YAML looks like. */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'release.yml'), 'utf8');

/* The `run: |` body of the step with this name. */
function stepRun(name) {
  const lines = yml.split('\n');
  const at = lines.findIndex(l => l.trim() === `- name: ${name}`);
  assert.ok(at >= 0, `release.yml has no step named "${name}"`);
  const run = lines.findIndex((l, i) => i > at && /^\s+run: \|\s*$/.test(l));
  assert.ok(run > at, `step "${name}" has no run block`);
  const indent = lines[run].match(/^\s*/)[0].length + 2;
  const out = [];
  for (let i = run + 1; i < lines.length && (lines[i].trim() === '' || lines[i].match(/^\s*/)[0].length >= indent); i++) out.push(lines[i].slice(indent));
  return out.join('\n');
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gv-release-'));
const put = (dir, f, o) => fs.writeFileSync(path.join(dir, f), typeof o === 'string' ? o : JSON.stringify(o, null, 2));
function fixture(over = {}) {
  const dir = tmp();
  const v = over.manifest || '9.9.9';
  put(dir, 'manifest.json', { id: 'x', version: v });
  put(dir, 'versions.json', { [v]: '1.8.0' });
  put(dir, 'package.json', { name: 'x', version: over.pkg || v });
  put(dir, 'package-lock.json', { name: 'x', version: over.lock || v, packages: { '': { name: 'x', version: over.lockRoot || over.lock || v } } });
  return dir;
}
const runStep = (name, dir, env) => spawnSync('bash', ['-e', '-c', stepRun(name)], { cwd: dir, env: { ...process.env, ...env }, encoding: 'utf8' });

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${String(e.message).split('\n').join('\n       ')}`); }
};

const TAG = 'Verify tag matches manifest version';
const tagEnv = { GITHUB_REF: 'refs/tags/9.9.9' };

check('S-10 matching tag, manifest, versions.json, package.json and lockfile pass', () => {
  const r = runStep(TAG, fixture(), tagEnv);
  assert.strictEqual(r.status, 0, `a consistent release was refused: ${r.stderr}`);
});
check('S-10 a package.json version behind manifest.json fails the gate', () => {
  const r = runStep(TAG, fixture({ pkg: '9.9.8' }), tagEnv);
  assert.notStrictEqual(r.status, 0, 'package.json 9.9.8 vs manifest 9.9.9 was let through');
  assert.ok(/package\.json/.test(r.stderr), `the failure should name package.json: ${r.stderr}`);
});
check('S-10 a package-lock.json version behind manifest.json fails the gate (both fields)', () => {
  const a = runStep(TAG, fixture({ lock: '9.9.8' }), tagEnv);
  assert.notStrictEqual(a.status, 0, 'package-lock.json top-level version 9.9.8 was let through');
  assert.ok(/package-lock\.json/.test(a.stderr), a.stderr);
  const b = runStep(TAG, fixture({ lockRoot: '9.9.8' }), tagEnv);
  assert.notStrictEqual(b.status, 0, 'package-lock.json packages[""].version 9.9.8 was let through');
});
check('S-10 the old checks still hold: tag mismatch and a missing versions.json entry fail', () => {
  assert.notStrictEqual(runStep(TAG, fixture(), { GITHUB_REF: 'refs/tags/v9.9.9' }).status, 0);
  const d = fixture(); put(d, 'versions.json', { '9.9.8': '1.8.0' });
  assert.notStrictEqual(runStep(TAG, d, tagEnv).status, 0);
});

/* ---- S-01: the tagged commit must be on main ---- */
const git = (cwd, ...a) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@x' } }).trim();
function repoWithOrigin(tagOnMain) {
  const origin = tmp(); git(origin, 'init', '-q', '--bare', '-b', 'main');
  const work = tmp();
  git(work, 'init', '-q', '-b', 'main'); git(work, 'remote', 'add', 'origin', origin);
  put(work, 'a', '1'); git(work, 'add', 'a'); git(work, 'commit', '-qm', 'one');
  git(work, 'push', '-q', 'origin', 'main');
  if (!tagOnMain) { git(work, 'checkout', '-q', '-b', 'side'); put(work, 'b', '2'); git(work, 'add', 'b'); git(work, 'commit', '-qm', 'side only'); }
  return { work, sha: git(work, 'rev-parse', 'HEAD') };
}
const MAIN = 'Verify the tagged commit is on main';

check('S-01 a tagged commit that is on main passes', () => {
  const { work, sha } = repoWithOrigin(true);
  const r = runStep(MAIN, work, { GITHUB_SHA: sha });
  assert.strictEqual(r.status, 0, `a release from main was refused: ${r.stderr}`);
});
check('S-01 a tagged commit that is NOT on main fails', () => {
  const { work, sha } = repoWithOrigin(false);
  const r = runStep(MAIN, work, { GITHUB_SHA: sha });
  assert.notStrictEqual(r.status, 0, 'a tag on a side-branch commit was let through');
});
check('S-01 the checkout fetches full history so the ancestor test is meaningful', () => {
  assert.ok(/fetch-depth:\s*0/.test(yml), 'actions/checkout must use fetch-depth: 0 (a depth-1 clone cannot answer "is this on main")');
});

if (failed) { console.log(`F5 release gate: ${failed} guard(s) FAILED`); process.exit(1); }
console.log('F5 release gate OK');
