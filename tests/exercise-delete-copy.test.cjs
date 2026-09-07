'use strict';
/* THE DELETE-EXERCISE CONFIRMATION MUST TELL THE WHOLE TRUTH (0.11.2
   journey audit, finding L14).

   THE BUG THIS REPRODUCES. "Logged history keeps its rows" was true but
   said nothing about plan lines: a plan references an exercise BY NAME
   (page-plans.js never renames on delete — there is no rename UI for any
   entity), so a line in a plan keeps naming a deleted exercise and still
   starts fine in a session. What silently changes is that the exercise can
   no longer be ADDED to a plan from the picker — openAddItem's dropdown is
   built from ctx.data.exercises, which the delete just removed it from. The
   old copy never said so. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const exercises = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-exercises.js'), 'utf8');
const plans = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-plans.js'), 'utf8');

/* ---------- 1. the confirmation names BOTH consequences ---------- */
{
  const m = exercises.match(/title: 'Delete exercise\?',[\s\S]*?message: `([^`]*)`,/);
  assert.ok(m, 'the delete-exercise confirmation must exist with this exact title');
  const message = m[1];

  assert.match(message, /Logged history keeps its rows/, 'the existing, true half must stay');
  assert.match(message, /plan/i, 'the message must now also say something about plans');
  assert.match(message, /dropdown/i,
    'the message must name the actual consequence: the exercise drops out of the Add-exercise picker');
  /* Not a paragraph — the house voice keeps this kind of confirmation to
     roughly a sentence and a half. */
  assert.ok(message.length < 260, `the copy should stay a sentence or two, not a paragraph (${message.length} chars)`);
}

/* ---------- 2. THE CLAIM IS TRUE: openAddItem really does build its
   options from the live exercise list, which is why deleting removes it -- */
{
  assert.match(plans, /const options = ctx\.data\.exercises\.map\(e => \[e\.name, e\.name\]\);/,
    "the Add-exercise dropdown's options must come from ctx.data.exercises — that is the fact the copy is describing");
}

console.log('exercise delete copy OK (the confirmation names both what survives and what quietly changes)');
