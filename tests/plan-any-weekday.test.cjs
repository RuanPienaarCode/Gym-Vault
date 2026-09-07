'use strict';
/* THE ADD-DAY DROPDOWN CAN AUTHOR THE WILDCARD WEEKDAY (0.11.2 journey
   audit, finding L12).

   THE BUG THIS REPRODUCES. plan-parse.js has always accepted `(any)` in a
   day heading, and controller.js's resolveDaysOn (the 0.11.1 fix that made
   an active plan's own `any` day fill whichever weekday it does not
   otherwise claim) made that wildcard genuinely meaningful — several plans
   in the shared library are shaped exactly that way. But the Add-day
   dropdown in page-plans.js only ever offered the seven real weekdays
   (WEEKDAYS), so nothing written FROM the app could ever reach that day
   shape; only a hand-edited or downloaded plan could.

   THE FIX: `any` is a real option, appended after the seven, labelled in
   the house voice rather than the raw parser token "(any)". */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { WEEKDAYS, WEEKDAY_LABELS } = require('../src/constants');
const { parsePlanBody } = require('../src/plan-parse');

/* ---------- 1. the label exists, and reads like the app, not the parser -- */
{
  assert.strictEqual(typeof WEEKDAY_LABELS.any, 'string', 'the wildcard weekday needs a real label to be offered at all');
  assert.notStrictEqual(WEEKDAY_LABELS.any, '(any)', 'the raw parser token is not house voice — it must say what the day DOES');
  assert.ok(/fill|gap|empty/i.test(WEEKDAY_LABELS.any),
    `the label should say what an "any" day actually does (fills whatever is otherwise empty), got: ${WEEKDAY_LABELS.any}`);
}

/* ---------- 2. the parser already round-trips it — proving the wildcard is
   real, not just a label with nothing behind it ---------- */
{
  const model = parsePlanBody('## Rest (any)\n\n- Walk | 20 min');
  assert.strictEqual(model.days.length, 1);
  assert.strictEqual(model.days[0].weekday, 'any', 'plan-parse.js must still read (any) as the wildcard weekday');
}

/* ---------- 3. THE DROPDOWN ITSELF OFFERS IT (source pin — a FormModal
   cannot be rendered in node, same reasoning as this suite's other
   source-pinned UI checks) ---------- */
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-plans.js'), 'utf8');
  assert.match(src, /options:\s*\[\.\.\.WEEKDAYS,\s*'any'\]\.map\(w => \[w, WEEKDAY_LABELS\[w\]\]\)/,
    'the Add-day weekday dropdown must offer the wildcard alongside the seven real weekdays');
  assert.ok(!/value:\s*'\(any\)'/.test(src) && !src.includes("'(any)'"),
    'the option must be labelled through WEEKDAY_LABELS, never the raw parser token');
}

console.log('plan any-weekday OK (the Add-day dropdown can author the wildcard weekday, in house voice)');
