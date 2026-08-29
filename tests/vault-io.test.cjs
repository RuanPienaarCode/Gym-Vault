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

/* TRIPWIRE: trash() must WAIT for the vault tree to drop the path.

   Removing the stamp alone was not enough — it only meant a corrective
   reload eventually arrived. The list still showed the deleted plan for a
   noticeable beat because the reload fired immediately after the delete read
   a folder tree that had not caught up. trash() now blocks until the path is
   actually gone, so the caller's reload is right the first time. */
{
  const fn = src.match(/async function trash\([^)]*\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fn, 'trash() not found');
  assert.match(fn[0], /await gone\(/, 'trash() must await gone() so the reload cannot read a stale tree');
  assert.match(src, /async function gone\(/, 'the gone() helper is missing');
  /* and it must be bounded — an unbounded wait would hang the delete */
  const g = src.match(/async function gone\([^)]*\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(g && /timeout/i.test(g[0]), 'gone() must be time-bounded, not an unbounded spin');
}

/* TRIPWIRE: a failed modal action must reach the user, not just the console.
   On a phone console.error is invisible, so a delete that threw looked
   identical to one that did nothing. */
{
  const modals = fs.readFileSync(path.join(__dirname, '..', 'src', 'modals.js'), 'utf8');
  assert.ok(
    /new Notice\(/.test(modals),
    'modals.js must surface action failures with a Notice — console.error alone is invisible on mobile',
  );
  assert.ok(
    !/\.catch\(e => console\.error\(/.test(modals),
    'a modal action still swallows its error into console.error only; route it through failed()',
  );
}

/* TRIPWIRE: deleting from a DETAIL page must navigate away before it awaits.

   The plans detail view renders the very plan being deleted. Awaiting the
   delete and navigating afterwards left the user staring at that page for
   the whole operation — reported as "it stays on the plan and looks like
   nothing happened" — and stranded them there permanently if it threw. */
{
  const plans = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-plans.js'), 'utf8');
  const handler = plans.match(/onConfirm: async \(\) => \{[\s\S]*?\n        \},/);
  assert.ok(handler, 'plan delete onConfirm not found');
  const navAt = handler[0].indexOf("ctx.nav('plans')");
  const trashAt = handler[0].indexOf('ctx.io.trash');
  assert.ok(navAt !== -1 && trashAt !== -1, 'plan delete must both navigate and trash');
  assert.ok(
    navAt < trashAt,
    'the plan delete must call ctx.nav() BEFORE awaiting the delete, or the user sits on the ' +
    'detail page of a plan that is being removed and it reads as nothing happening.',
  );
  assert.match(
    handler[0], /finally\s*\{[\s\S]*?ctx\.reload\(\)/,
    'the reload must be in a finally, so the list is accurate even when the delete throws',
  );
}

/* The confirm dialogs must not promise the system trash: deletion follows the
   user's own "Deleted files" setting, and there is no system trash on iOS. */
for (const f of ['page-plans.js', 'page-exercises.js', 'page-goals.js', 'page-history.js']) {
  const body = fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
  assert.ok(
    !/system trash/.test(body),
    `${f}: the delete dialog still promises the "system trash" — deletion follows the user's ` +
    'own Deleted files setting, so that copy claims a behaviour the code does not have.',
  );
}

console.log('vault io OK (trash waits; detail-page delete navigates first; failures surface)');
