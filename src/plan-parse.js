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

const DAY_HEADING = /^##\s+(.+?)\s*\((mon|tue|wed|thu|fri|sat|sun)\)\s*$/i;

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

function parsePlanBody(body) {
  const intro = [];
  const days = [];
  let day = null;
  for (const line of (body || '').split(/\r?\n/)) {
    const h = line.match(DAY_HEADING);
    if (h) {
      day = { name: h[1].trim(), weekday: h[2].toLowerCase(), notes: [], items: [] };
      days.push(day);
      continue;
    }
    const t = line.trim();
    if (day && t.startsWith('- ')) {
      const cells = splitBarePipes(t.slice(2)).map(c => c.trim());
      const { sets, target } = parsePrescription(cells[1] || '');
      day.items.push({ exercise: unescMd(cells[0] || ''), sets, target, raw: t });
      continue;
    }
    if (day) { if (t !== '' || day.notes.length) day.notes.push(line); }
    else intro.push(line);
  }
  // Trim trailing blank note lines per day so serialization stays stable.
  for (const d of days) while (d.notes.length && d.notes[d.notes.length - 1].trim() === '') d.notes.pop();
  while (intro.length && intro[intro.length - 1].trim() === '') intro.pop();
  return { intro, days };
}

function serializeItem(it) {
  const rhs = it.sets != null ? `${it.sets} x ${it.target || ''}`.trim() : (it.target || '');
  return rhs ? `- ${escMd(it.exercise)} | ${rhs}` : `- ${escMd(it.exercise)}`;
}

function serializePlanBody(model) {
  const out = [];
  if (model.intro && model.intro.length) { out.push(...model.intro, ''); }
  for (const d of model.days) {
    out.push(`## ${d.name} (${WEEKDAYS.includes(d.weekday) ? d.weekday : 'mon'})`, '');
    if (d.notes && d.notes.length) { out.push(...d.notes, ''); }
    for (const it of d.items) out.push(serializeItem(it));
    out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

module.exports = {
  parsePlanBody, serializePlanBody, parsePrescription,
  targetWeight, targetFirstNumber, targetIsDuration,
};
