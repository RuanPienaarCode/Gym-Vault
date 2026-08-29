'use strict';
/* Invariants of the vault IO layer that are only visible in the source.

   These are source tripwires, not behaviour tests: they encode decisions that
   look like oversights and get "tidied up" by the next person reading the
   file, this author included. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'data.js'), 'utf8');

/* TRIPWIRE: `trash()` must NOT stamp plugin._lastWrite.

   Every other write stamps, so the controller's vault watcher can skip the
   echo of our own change instead of reloading twice. Deletion is the
   exception. `v.trash()` resolves once the file is off disk, but Obsidian
   drops it from the in-memory folder tree that loadAll() walks a tick later —
   so a reload fired immediately after can still list the note just deleted.

   Stamping made that stale entry PERMANENT: the vault's own `delete` event,
   the thing that would have triggered a corrective reload once the tree had
   settled, was suppressed as "our own write". Deleted plans, exercises, goals
   and workouts stayed on screen until an unrelated file event shook them
   loose. Leaving trash() unstamped costs one extra reload and makes a delete
   actually disappear. */
{
  const fn = src.match(/async function trash\([^)]*\)\s*\{[^}]*\}/);
  assert.ok(fn, 'trash() not found in data.js — has it been renamed?');
  assert.ok(
    !/\bstamp\(\)/.test(fn[0]),
    'trash() must not stamp _lastWrite: stamping suppresses the vault delete event that ' +
    'corrects the stale list, and deleted notes stay on screen. See the comment above trash().',
  );
}

/* The guard above is only meaningful while the watcher still suppresses
   stamped writes — if that mechanism goes away, this test is checking
   nothing. Fail loudly rather than passing vacuously. */
{
  const ctrl = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
  assert.match(
    ctrl, /_lastWrite/,
    'controller no longer references _lastWrite — the trash() tripwire above now guards nothing. ' +
    'Re-derive the invariant before deleting it.',
  );
}

/* Writes that are NOT deletions must still stamp, or every save triggers a
   reload storm through the watcher. */
assert.ok(
  /const stamp = \(\) => \{ plugin\._lastWrite = Date\.now\(\); \};/.test(src),
  'the stamp() helper is gone — writes will no longer be distinguishable from user edits',
);

console.log('vault io OK (trash unstamped so deletes refresh; writes still stamped)');
