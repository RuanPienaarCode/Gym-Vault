'use strict';
/* AN UPPERCASE (Mon) SURVIVES A SAVE (0.11.2 journey audit, finding L15).

   THE BUG THIS REPRODUCES. DAY_HEADING is case-insensitive on read (the /i
   flag), but parsePlanBody immediately lowercased whatever it matched —
   `weekday: h[2].toLowerCase()` — with nothing keeping the original text.
   serializePlanBody then always wrote the lowercase form back, so the very
   first save after opening a hand-written "## Push (Mon)" rewrote it to
   "## Push (mon)" in the user's own file, for a detail nothing downstream
   reads case-sensitively (every comparison already goes through the
   lowercase `weekday` key).

   THE FIX: the day model keeps the author's original casing alongside the
   canonical lowercase key, and the serializer uses it as long as it still
   names the same weekday. */
const assert = require('node:assert');
const { parsePlanBody, serializePlanBody } = require('../src/plan-parse');

/* ---------- 1. THE REPORTED CASE: uppercase survives a round trip ------- */
{
  const body = '## Push (Mon)\n\n- Bench Press | 5 x 5\n';
  const model = parsePlanBody(body);
  assert.strictEqual(model.days[0].weekday, 'mon', 'the canonical key stays lowercase — every comparison in the app keys off it');
  const out = serializePlanBody(model);
  assert.match(out, /## Push \(Mon\)/, 'the author\'s own casing must survive the save, not be silently rewritten to (mon)');
}

/* ---------- 2. shouty casing round-trips too ---------- */
{
  const model = parsePlanBody('## Legs (MON)\n');
  assert.match(serializePlanBody(model), /## Legs \(MON\)/);
}

/* ---------- 3. a plain lowercase file is unaffected — no new churn where
   there was none before ---------- */
{
  const model = parsePlanBody('## Legs (mon)\n');
  assert.match(serializePlanBody(model), /## Legs \(mon\)/);
}

/* ---------- 4. a day built by the app (openAddDay: no weekdayCase) still
   writes the canonical lowercase form ---------- */
{
  const model = { intro: [], days: [{ name: 'New Day', weekday: 'tue', parts: [], notes: [], items: [] }] };
  assert.match(serializePlanBody(model), /## New Day \(tue\)/);
}

/* ---------- 5. a stale casing that no longer matches the weekday falls
   back to canonical, rather than lying about which day it is ---------- */
{
  const model = { intro: [], days: [{ name: 'Moved', weekday: 'wed', weekdayCase: 'Mon', parts: [], notes: [], items: [] }] };
  assert.match(serializePlanBody(model), /## Moved \(wed\)/,
    'a weekdayCase that disagrees with the actual weekday must never be trusted');
}

console.log('plan weekday-case OK (an uppercase (Mon) is no longer silently lowercased on save)');
