'use strict';
/* What you have to fetch before you start. Pure — no DOM, no obsidian
   import.

   Every exercise note has carried an `equipment` frontmatter value since the
   first release (`bar`, `kettlebell`, `dumbbells`, `bodyweight`…) and nothing
   ever showed it. These helpers turn a day's — or a whole plan's — exercise
   list into the short distinct list a human reads before walking out to the
   garage.

   `bodyweight` is deliberately NOT equipment. A day of nothing but bodyweight
   work reads "No equipment", and a day that mixes them names only the things
   you actually have to carry — listing "Bodyweight" beside "Kettlebell" tells
   you nothing you can act on.

   Values are FREE TEXT: a hand-written note can say `equipment: sandbag` and
   the app has no business calling that invalid. Known keys get a considered
   label; anything else is title-cased and shown as-is. */

const { sameName } = require('./stats');

const BODYWEIGHT = 'bodyweight';

/* Labels for the values the shared library actually uses. A key missing here
   is not an error — see labelFor(). */
const EQUIPMENT_LABELS = {
  bar: 'Pull-up bar',
  bodyweight: 'Bodyweight',
  dumbbells: 'Dumbbells',
  kettlebell: 'Kettlebell',
  box: 'Box or step',
  band: 'Resistance band',
  bench: 'Bench',
  none: 'No equipment',
};

/* Title-case an unknown value so `sandbag` reads as "Sandbag" rather than
   being dropped — the note's author knows what they meant. */
function labelFor(key) {
  const k = String(key || '').trim();
  if (!k) return '';
  if (EQUIPMENT_LABELS[k.toLowerCase()]) return EQUIPMENT_LABELS[k.toLowerCase()];
  return k.charAt(0).toUpperCase() + k.slice(1);
}

/* ONE NOTE CAN NAME SEVERAL THINGS. The exercise form's own placeholder says
   `bar, dumbbells, bodyweight`, and a YAML list stringifies to
   `bar,kettlebell` — but this used to lowercase the WHOLE field as one key.
   So a note reading `equipment: bar, kettlebell` produced a single chip
   labelled "Bar, kettlebell", the `bar` facet the plans filter offers never
   matched it, and `bodyweight, band` was neither dropped as bodyweight nor
   revealed as a band. Muscles have always been comma-split; equipment was
   not, while being invited to look identical.

   SPLIT ON COMMAS ONLY. Values are free text — `treadmill or road` and
   `sandbag` are things a note may legitimately say — so a token keeps its
   spaces and is title-cased if it is not a known key. This is a splitter,
   not a vocabulary. */
function equipmentTokens(value) {
  const parts = Array.isArray(value) ? value : String(value == null ? '' : value).split(',');
  const out = [];
  for (const part of parts) {
    const k = String(part == null ? '' : part).trim().toLowerCase();
    /* Per TOKEN, not per field: "bodyweight, band" needs the band. */
    if (!k || k === BODYWEIGHT || k === 'none') continue;
    out.push(k);
  }
  return out;
}

/* Distinct equipment keys needed by `names`, in first-appearance order (the
   order the session will actually reach them, which is the order you'd lay
   them out). Bodyweight is dropped; an exercise the vault doesn't define is
   skipped rather than guessed at. */
function equipmentKeys(exercises, names) {
  const out = [];
  const seen = new Set();
  for (const name of names || []) {
    const ex = (exercises || []).find(e => sameName(e.name, name));
    if (!ex) continue;
    for (const key of equipmentTokens(ex.fm && ex.fm.equipment)) {
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/* [{key, label}] — what a chip row renders. Empty means bodyweight only. */
function equipmentFor(exercises, names) {
  return equipmentKeys(exercises, names).map(key => ({ key, label: labelFor(key) }));
}

/* One line for compact surfaces (a plan card's meta row). Always says
   something: an empty list is the useful answer "No equipment", not a blank. */
function equipmentSummary(exercises, names) {
  const items = equipmentFor(exercises, names);
  return items.length ? items.map(i => i.label).join(' · ') : EQUIPMENT_LABELS.none;
}

/* Every exercise named across a plan's days, in order, ready for the helpers
   above — a plan card needs the whole plan, a day card needs one day. */
function planExerciseNames(plan) {
  const names = [];
  for (const day of ((plan && plan.model && plan.model.days) || [])) {
    for (const item of (day.items || [])) names.push(item.exercise);
  }
  return names;
}

module.exports = { EQUIPMENT_LABELS, labelFor, equipmentTokens, equipmentKeys, equipmentFor, equipmentSummary, planExerciseNames };
