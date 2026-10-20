'use strict';
/* S-03: the starter content ships to every new vault, so no string in it may
   speak about one person's age, history or old plans ("recovery is the ceiling
   at 40", "the old Sat A*"). Every text the seed can write is walked here -
   exercise notes, the three plans, the goals and the profile prompts. */
const assert = require('node:assert');
const seed = require('../src/seed');

const strings = [];
const walk = (v, path) => {
  if (typeof v === 'string') { if (!/^https?:\/\//.test(v)) strings.push([path, v]); }
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], `${path}.${k}`);
};
for (const k of ['SEED_EXERCISES', 'SEED_PLAN', 'SEED_RUN_PLAN', 'SEED_REST_PLAN', 'SEED_GOALS', 'SEED_PROFILE']) walk(seed[k], k);
assert.ok(strings.length > 100, 'the walk must actually reach the seed text');

/* Each rule: a pattern, and why it is one person's story. Joined lines are
   collapsed first so a phrase wrapped across two source lines still matches. */
const RULES = [
  [/\b(?:at|aged?|age of|turning)\s+[2-9]\d\b(?!\s*(?:s\b|sec|min|kg|%|°|degree|reps|km|cm|m\b))/i, 'a specific age'],
  [/\b\d{2}\s*(?:yrs?|years?)[ -]old\b/i, 'a specific age'],
  [/\bold\s+(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b/i, 'an "old <weekday>" plan'],
  [/\b(?:Sat|Saturday)\s+(?:A\b|repeat\b)/, 'the old Saturday session'],
  [/\boff sick\b|\b(?:rebuilding after|coming back from) illness\b/i, 'the author\'s illness'],
  [/\bPhase \d\b/, 'a phase of a programme that is not in the starter'],
];

const failures = [];
for (const [path, text] of strings) {
  const flat = text.replace(/\s*\n\s*/g, ' ');
  for (const [re, why] of RULES) {
    const m = re.exec(flat);
    if (m) failures.push(`${path}: "${m[0]}" - ${why}`);
  }
}
/* Negative control on the rules themselves: they must catch the original
   sentences, or a passing run proves nothing. */
const SAMPLES = ['recovery is the ceiling at 40', '(the old\nSat A*)', 'prehab gold at 40.', 'the Saturday repeat', 'while you are rebuilding after illness', 'Phase 2 (muscle-up skill work) opens'];
for (const s of SAMPLES) {
  const flat = s.replace(/\s*\n\s*/g, ' ');
  assert.ok(RULES.some(([re]) => re.test(flat)), `the guard must recognise: ${s}`);
}
if (failures.length) { console.error(`FAIL seed generic: ${failures.length} author-specific phrase(s)\n  ` + failures.join('\n  ')); process.exit(1); }
console.log('w3 seed generic OK');
