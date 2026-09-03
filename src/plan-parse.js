'use strict';
/* Plan notes: parse and serialize. Pure — no DOM, no obsidian import.

   A plan's structure lives in its BODY so the note reads naturally in
   Obsidian and stays hand-editable:

     intro prose…

     ## A · Pull Priority (mon)

     Rest ~90s between hard sets.

     - Pull-ups | 5 x submax
     - Inverted Rows | 3 x 8-12 @ 20kg
     - Dead Hang | 2 x 30-45s

   Grammar, kept deliberately loose because real prescriptions are text
   ("submax", "65% max", "8/leg"):

     day heading   ## <name> (<weekday>)     weekday ∈ mon..sun
     item          - <exercise> | <sets> x <target>
                   - <exercise> | <free text>
                   - <exercise>
     weight        an optional `@ <n>kg` anywhere in the target

   Prose lines inside a day are kept verbatim (day.notes) and written back in
   place — the serializer must never eat a hand-written coaching cue. */

const { WEEKDAYS } = require('./constants');
const { splitBarePipes, escMd, unescMd } = require('./markdown');

/* `any` is a wildcard weekday: only meaningful in a fallback plan, where
   the day fills whatever weekday nothing else has claimed. */
const DAY_HEADING = /^##\s+(.+?)\s*\((mon|tue|wed|thu|fri|sat|sun|any)\)\s*$/i;

/* `5 x submax` → {sets: 5, target: 'submax'}; plain text → {sets: null}. */
function parsePrescription(text) {
  const t = (text || '').trim();
  const m = t.match(/^(\d+)\s*[x×]\s*(.+)$/);
  if (m) return { sets: +m[1], target: m[2].trim() };
  return { sets: null, target: t };
}

/* Optional `@ 60kg` (or `@ 60 kg`) inside a target string. */
function targetWeight(target) {
  const m = (target || '').match(/@\s*([\d.]+)\s*kg/i);
  return m ? +m[1] : null;
}

/* First plain number in the target — the reps the log screen prefills.
   "8-12" → 8, "30-45s" → 30, "submax" → null. */
function targetFirstNumber(target) {
  const m = (target || '').replace(/@\s*[\d.]+\s*kg/i, '').match(/(\d+(?:\.\d+)?)/);
  return m ? +m[1] : null;
}

/* Does the target read as a duration? ("30-45s", "60 sec", "2 min") */
function targetIsDuration(target) {
  return /\d\s*(s\b|sec|min)/i.test(target || '');
}

/* THE DURATION, IN SECONDS — the unit is written down, so read it.

   targetIsDuration has always recognised "min", but every caller then took
   targetFirstNumber as a count of SECONDS. So the seed's Easy Run,
   `1 x 30 min easy`, scheduled a 30-second interval and logged the run as
   0.5 min; `2 min` scheduled 5 seconds, because the floor clamp was the only
   thing left doing any work. Three callers had the same hole — the timed
   schedule, the fill meter's target, and the manual log's prefill — which is
   this codebase's recurring shape: one question answered in three places by
   rules that disagree. It is answered here now.

   A RANGE takes its first number ("30-45s" is 30, "20-30 min" is 20), which
   is what every caller already did and what the shortest honest reading of a
   range is. Returns null when the target names no duration at all, so a rep
   count is never mistaken for a clock. */
function targetDurationSeconds(target) {
  const m = (target || '').match(/(\d+(?:\.\d+)?)\s*(?:[-\u2013]\s*\d+(?:\.\d+)?\s*)?(s|secs?|seconds?|min|mins?|minutes?)\b/i);
  if (!m) return null;
  const n = +m[1];
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(/^m/i.test(m[2]) ? n * 60 : n);
}

/* A day keeps its lines as ORDERED `parts` ({kind:'note',line} |
   {kind:'item',item}) so a coaching cue written BETWEEN two exercise lines
   stays exactly where the author put it across saves — the earlier
   notes-then-items model silently hoisted such prose above the whole list.
   `day.items` and `day.notes` remain as derived views (same item objects by
   identity) because every page reads them. */
function parsePlanBody(body) {
  const intro = [];
  const days = [];
  let day = null;
  /* Inside a ``` fence everything is an EXAMPLE the author is showing, not
     plan structure. Without this, a fenced `## Fake (tue)` created a real
     day and swallowed the exercises written below the fence. */
  let fenced = false;
  for (const line of (body || '').split(/\r?\n/)) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) {
      fenced = !fenced;
      if (day) { day.parts.push({ kind: 'note', line }); day.notes.push(line); }
      else intro.push(line);
      continue;
    }
    const h = fenced ? null : line.match(DAY_HEADING);
    if (h) {
      day = { name: h[1].trim(), weekday: h[2].toLowerCase(), parts: [], notes: [], items: [] };
      days.push(day);
      continue;
    }
    /* An INDENTED bullet is the user's own annotation hanging off the line
       above — `  - grip: overhand`, a superset's members — not an exercise.
       Testing the trimmed line made indentation invisible, so those became
       first-class items: they showed up in the day's exercise list, were
       logged as exercises, inflated the set count, and the write-back
       flattened the author's nesting on disk. Match the RAW line. */
    if (day && !fenced && /^- /.test(line)) {
      const cells = splitBarePipes(line.slice(2)).map(c => c.trim());
      /* Everything after the FIRST pipe is the prescription — rejoining
         keeps a hand-written `- A | B | C` intact instead of dropping C. */
      const { sets, target } = parsePrescription(cells.slice(1).join(' | '));
      const item = { exercise: unescMd(cells[0] || ''), sets, target };
      day.parts.push({ kind: 'item', item });
      day.items.push(item);
      continue;
    }
    if (day) {
      if (t !== '' || day.parts.length) day.parts.push({ kind: 'note', line });
      if (t !== '' || day.notes.length) day.notes.push(line);
    } else intro.push(line);
  }
  // Trim trailing blanks per day so serialization stays a fixpoint.
  for (const d of days) {
    while (d.parts.length && d.parts[d.parts.length - 1].kind === 'note' && d.parts[d.parts.length - 1].line.trim() === '') d.parts.pop();
    while (d.notes.length && d.notes[d.notes.length - 1].trim() === '') d.notes.pop();
  }
  while (intro.length && intro[intro.length - 1].trim() === '') intro.pop();
  return { intro, days };
}

/* Structural edits go through these so parts and items never drift. */
function addItem(day, item) {
  if (!day.parts) day.parts = [];
  day.parts.push({ kind: 'item', item });
  day.items.push(item);
}
function removeItemAt(day, idx) {
  const [item] = day.items.splice(idx, 1);
  if (day.parts && item) {
    const pi = day.parts.findIndex(p => p.kind === 'item' && p.item === item);
    if (pi >= 0) day.parts.splice(pi, 1);
  }
}

/* Move an item up (-1) or down (+1) in the day's order. Returns the item's
   new index, or the old one when it could not move.

   IT SWAPS THE ITEMS, NOT THE LINES. `parts` interleaves items with the
   author's own prose — a warm-up note, a cue, a blank line — and that prose
   is positional commentary about the day, not a caption bolted to the
   exercise below it. Swapping the two `item` references leaves every note
   exactly where it was written and every other line untouched, so
   serialization changes precisely two lines. Moving the PART instead would
   drag an exercise across a note and quietly rewrite what that note appears
   to be about. */
function moveItem(day, idx, delta) {
  const items = (day && day.items) || [];
  const to = idx + delta;
  if (idx < 0 || idx >= items.length || to < 0 || to >= items.length) return idx;

  const a = items[idx], b = items[to];
  items[idx] = b;
  items[to] = a;

  if (day.parts) {
    const pa = day.parts.findIndex(p => p.kind === 'item' && p.item === a);
    const pb = day.parts.findIndex(p => p.kind === 'item' && p.item === b);
    if (pa >= 0 && pb >= 0) { day.parts[pa].item = b; day.parts[pb].item = a; }
  }
  return to;
}

/* Change what a line PRESCRIBES — sets, and the target string ("12", "45s",
   "5 @ 60kg"). Never the exercise NAME: plans, goals and every logged row
   reference an exercise by name, so renaming one here would silently orphan
   its history. Renaming is a different, larger operation and does not belong
   on an edit toggle.

   Mutates the item in place, which is what `parts` is already holding a
   reference to — so the serializer picks it up with no second bookkeeping
   step to forget. */
function updateItem(day, idx, patch) {
  const item = (day && day.items) ? day.items[idx] : null;
  if (!item) return null;
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'sets')) {
    const n = parseInt(patch.sets, 10);
    /* null means "no count given", which itemSets() reads as the default of
       3 — a distinct and meaningful state from an explicit 3, because the
       line stays written as `- Push-ups | 12` rather than `3 x 12`. */
    item.sets = Number.isFinite(n) && n > 0 ? n : null;
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'target')) {
    item.target = String(patch.target == null ? '' : patch.target).trim();
  }
  return item;
}

/* A day whose NAME says rest/recovery is not a session to attack — the
   dashboard renders it calmly and its items are suggestions, not a
   prescription. Named-based so it needs no schema change and a
   hand-written plan gets it for free. */
const isRestDay = day => /\brest\b|\brecovery\b/i.test((day && day.name) || '');

/* Prescribed set count with the ONE default — page-log prefill and the
   dashboard's sets-total must never disagree on what "no count" means. */
const itemSets = it => it.sets || 3;

function serializeItem(it) {
  const rhs = it.sets != null ? `${it.sets} x ${it.target || ''}`.trim() : (it.target || '');
  return rhs ? `- ${escMd(it.exercise)} | ${rhs}` : `- ${escMd(it.exercise)}`;
}

function serializePlanBody(model) {
  const out = [];
  if (model.intro && model.intro.length) { out.push(...model.intro, ''); }
  for (const d of model.days) {
    const wd = d.weekday === 'any' || WEEKDAYS.includes(d.weekday) ? d.weekday : 'mon';
    out.push(`## ${d.name} (${wd})`, '');
    const parts = d.parts || [
      ...(d.notes || []).map(line => ({ kind: 'note', line })),
      ...((d.notes && d.notes.length) ? [{ kind: 'note', line: '' }] : []),
      ...(d.items || []).map(item => ({ kind: 'item', item })),
    ];
    for (const p of parts) out.push(p.kind === 'item' ? serializeItem(p.item) : p.line);
    out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

module.exports = {
  parsePlanBody, serializePlanBody, parsePrescription, addItem, removeItemAt, moveItem, updateItem, itemSets, isRestDay,
  targetWeight, targetFirstNumber, targetIsDuration, targetDurationSeconds,
};
