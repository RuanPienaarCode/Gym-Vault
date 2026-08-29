'use strict';
/* Export guarantees — the privacy ones above all: a training log shared
   with a coach must not carry a medical record unless explicitly asked. */
const assert = require('node:assert');
const { buildSummary, buildCsv, buildJson, isHealthKey, DEFAULTS } = require('../src/export');

const data = {
  profile: { fm: { name: 'Test', birth_year: 1990, height_cm: 175, sex: 'male' }, body: 'Watch-outs: none.' },
  body: [
    { date: '2026-02-10', weight_kg: '70.0', waist_cm: '76.0', bp_systolic: '118', bp_diastolic: '74', cholesterol: '3.92', glucose: '6.15' },
    { date: '2026-08-27', resting_hr: '61' },
  ],
  exercises: [
    { name: 'Pull-ups', fm: { type: 'strength', unit: 'reps' } },
    { name: 'Long Trail Run', fm: { type: 'cardio', unit: 'km' } },
  ],
  plans: [{ name: 'P', fm: { active: true }, model: { intro: [], days: [{ weekday: 'mon', name: 'A', items: [{ exercise: 'Pull-ups', sets: 5, target: 'submax' }] }] } }],
  goals: [{ name: '10 Pull-ups', fm: { metric: 'exercise-reps', exercise: 'Pull-ups', target: 10, direction: 'increase' } }],
  workouts: [
    { name: 'old', fm: { date: '2026-01-05', day: 'A' }, rows: [{ exercise: 'Pull-ups', set: '1', reps: '5' }] },
    { name: 'new', fm: { date: '2026-08-26', day: 'A' }, rows: [{ exercise: 'Pull-ups', set: '1', reps: '8' }] },
  ],
};
const today = '2026-08-28';

/* PRIVACY: the clinical VALUES must not appear in any format unless asked
   for. (The summary may still NAME the markers — it prints a line saying
   they were withheld, which is the opposite of a leak.) */
/* Synthetic values, deliberately distinctive so a substring collision with
   an unrelated number cannot make the leak check pass by accident. */
const CLINICAL_VALUES = ['118', '74', '3.92', '6.15'];
{
  assert.strictEqual(DEFAULTS.includeHealth, false, 'health markers must default to OFF');
  for (const build of [buildSummary, buildCsv, buildJson]) {
    const out = build(data, { today, days: 0 });
    for (const v of CLINICAL_VALUES) {
      assert.ok(!out.includes(v), `${build.name} leaked clinical value ${v} by default`);
    }
  }
  const withHealth = buildSummary(data, { today, days: 0, includeHealth: true });
  for (const v of CLINICAL_VALUES) {
    assert.ok(withHealth.includes(v), `opting in must include ${v}`);
  }
  const jsonHealth = JSON.parse(buildJson(data, { today, days: 0, includeHealth: true }));
  assert.strictEqual(jsonHealth.body[0].cholesterol, '3.92');
  const jsonDefault = JSON.parse(buildJson(data, { today, days: 0 }));
  assert.strictEqual(jsonDefault.body[0].cholesterol, undefined, 'json must drop the key, not just the value');
  assert.strictEqual(jsonDefault.body[0].weight_kg, '70.0', 'body measurements should still be there');
}

/* Turning body measurements off hides them entirely. */
{
  const out = buildSummary(data, { today, days: 0, includeBody: false });
  /* Assert the value the fixture actually holds — checking a number that is
     no longer in the data would pass whether or not the code leaks. */
  assert.ok(data.body[0].weight_kg === '70.0', 'fixture weight drifted from this assertion');
  assert.ok(!out.includes('70.0'), 'body weight leaked with includeBody off');
  const j = JSON.parse(buildJson(data, { today, days: 0, includeBody: false }));
  assert.strictEqual(j.body, undefined);
}

/* Range filtering applies to sessions. */
{
  const recent = buildSummary(data, { today, days: 30 });
  assert.ok(recent.includes('26 Aug'), 'recent session missing');
  assert.ok(!recent.includes('5 Jan'), 'a session outside the window was included');
  const all = buildSummary(data, { today, days: 0 });
  assert.ok(all.includes('5 Jan'), 'all-time export dropped an old session');
}

/* CSV is one row per set, with a header. */
{
  const csv = buildCsv(data, { today, days: 0 }).trim().split('\n');
  assert.ok(csv[0].startsWith('date,plan,day,exercise'));
  assert.strictEqual(csv.length, 3);       // header + 2 sets
}

/* JSON carries derived goal progress so a reader needn't recompute it. */
{
  const j = JSON.parse(buildJson(data, { today, days: 0 }));
  assert.strictEqual(j.goals[0].current, 8);
  assert.ok(Math.abs(j.goals[0].progress - 0.8) < 1e-9);
  assert.strictEqual(j.exercises[0].bests.reps, 8);
}


/* The privacy switches must gate the PROFILE too, in every format.

   THE BUG: buildSummary gated height_cm behind includeBody, but buildJson
   spread `...data.profile.fm` unconditionally. Any clinical key the user
   added to their profile note (hba1c, meds, a diagnosis) rode out in a JSON
   export they had explicitly told not to include health data. HEALTH_KEYS
   only filtered BODY_COLUMNS, so profile keys were unfilterable by design.

   The contract: the profile is a WHITELIST, not a spread. An unknown key is
   not exported, because we cannot know it is safe. */
{
  const data = {
    profile: { fm: { name: 'Ruan', birth_year: 1990, height_cm: 175, sex: 'male', hba1c: '5.4', meds: 'metformin' }, body: '' },
    workouts: [], exercises: [], goals: [], body: [], plans: [],
  };
  const locked = { today: '2026-08-29', includeBody: false, includeHealth: false, days: 90 };

  const j = JSON.parse(buildJson(data, locked));
  const asText = JSON.stringify(j.profile || {});
  assert.ok(!/hba1c/.test(asText), `unknown clinical key leaked into JSON: ${asText}`);
  assert.ok(!/metformin/.test(asText), `unknown clinical value leaked into JSON: ${asText}`);
  assert.ok(!/height_cm/.test(asText), `body measurement leaked with includeBody:false: ${asText}`);

  const csv = buildCsv(data, locked);
  assert.ok(!/hba1c|metformin/.test(csv), 'unknown clinical key leaked into CSV');

  // ...and with the switches ON, the modelled fields still come through.
  const open = { ...locked, includeBody: true, includeHealth: true };
  const j2 = JSON.parse(buildJson(data, open));
  assert.strictEqual(j2.profile.height_cm, 175, 'includeBody:true should still export height');
  assert.ok(!/metformin/.test(JSON.stringify(j2.profile)),
    'an unmodelled key must stay out even when the switches are on — whitelist, not spread');
}

assert.ok(isHealthKey('cholesterol') && !isHealthKey('weight_kg'));
console.log('export OK (health markers gated, ranges honoured)');
