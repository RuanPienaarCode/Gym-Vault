'use strict';
/* A COUNT MEETS ITS NOUN IN ONE PLACE.

   "LAST . 1 SETS" on Today's Last session tile was `${n} sets` written by hand: right for every count but one.
   stats.countLabel(n, 'set') is the one place that decides, and this pins both halves: the function is right
   (tests/stats.test.cjs), and nothing in src/ prints a template count straight in front of the word "sets"
   without going through it, so the next call site cannot bring the bug back.

   GV_SRC_DIR points the scan at a deliberately broken copy of src/ (mutation testing). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = process.env.GV_SRC_DIR || path.join(__dirname, '..', 'src');
const offenders = [];
let scanned = 0;
for (const f of fs.readdirSync(SRC).filter(f => f.endsWith('.js'))) {
  const lines = fs.readFileSync(path.join(SRC, f), 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\/?\*)/.test(line)) return; // a comment line
    scanned++;
    /* `${anything} sets` inside a template literal: a count straight in front of the plural noun. */
    if (/\$\{[^}]*\}\s+sets\b/.test(line)) offenders.push(`src/${f}:${i + 1}  ${line.trim()}`);
  });
}
assert.ok(scanned > 5000, `the scan read almost nothing (${scanned} lines)`);
assert.deepStrictEqual(offenders, [], 'a count printed in front of "sets" by hand reads "1 sets"; use stats.countLabel(n, \'set\'):\n' + offenders.join('\n'));

/* The setup dial's unit word follows its number, and the completion tile's label follows its numeral. */
{
  const setup = fs.readFileSync(path.join(SRC, 'page-session-setup.js'), 'utf8');
  assert.ok(/unitEl\.textContent = n === 1 \? 'set' : 'sets'/.test(setup), 'the sets dial says "set" at one');
  const session = fs.readFileSync(path.join(SRC, 'page-session.js'), 'utf8');
  assert.ok(/String\(doneSets\), doneSets === 1 \? 'set done' : 'sets done'/.test(session), 'the completion tile says "set done" at one');
}

/* Today's session tiles print their figure on its own, so the noun under it follows that number too (countNoun). */
{
  const { countNoun } = require('../src/stats');
  assert.strictEqual(countNoun(1, 'session'), 'session', 'countNoun: one is singular');
  assert.strictEqual(countNoun(0, 'session'), 'sessions', 'countNoun: zero is plural');
  assert.strictEqual(countNoun(14, 'session'), 'sessions', 'countNoun: many is plural');
  const dash = fs.readFileSync(path.join(SRC, 'page-dashboard.js'), 'utf8');
  assert.ok(!/'sessions this week'|'sessions all time'/.test(dash), 'Today tiles: no hard-coded plural "sessions" under a figure that can be 1');
  assert.ok(/countNoun\(thisWeek, 'session'\)/.test(dash), 'the sessions-this-week tile labels its own figure');
}

console.log(`count labels OK (${scanned} source lines scanned: no hand-written "<n> sets"; the dial and the completion tile follow their number)`);
