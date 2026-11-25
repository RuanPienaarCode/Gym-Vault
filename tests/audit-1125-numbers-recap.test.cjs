'use strict';
/* Audit 25 Nov 2026, findings 47 + 48 — one reading of "what was this set".

   47: the exercise page's Recent list printed seconds before reps, so a timed
       circuit's saved 45 s interval hid the 15 and 10 reps that were typed.
       recap.rowSummary is now the one formatter; recentSessions uses it.
   48: the log card printed a "Longest 45s" hold for a rep exercise that has only
       ever been done in 45-second circuits, which Records and the exercise page
       refuse (stats.claimableKinds). */
const assert = require('node:assert');
const { t, done } = require('./audit-1125-numbers-t');
require('./f3-stub');
const R = require('../src/recap');
const Detail = require('../src/page-exercise-detail');

const row = (exercise, o) => Object.assign({ exercise, set: 1, reps: '', weight_kg: '', seconds: '', note: '', distance_km: '' }, o);
const wk = (date, rows, day) => ({ name: 'w', fm: { date, day: day || 'Circuit' }, rows });

t('finding 47', () => {
assert.strictEqual(typeof R.rowSummary, 'function', 'recap exports its one set formatter');
assert.strictEqual(R.rowSummary(row('Push-ups', { reps: '15', seconds: '45' })), '15', 'reps typed on a timed circuit read as reps, not the clock');
assert.strictEqual(R.rowSummary(row('Plank', { seconds: '45' })), '45s', 'a hold with only seconds still reads as time');
assert.strictEqual(R.rowSummary(row('Squat', { reps: '5', weight_kg: '60' })), '5 × 60 kg');
assert.strictEqual(R.rowSummary(row('Easy Run', { distance_km: '5', seconds: '1800' })), '5 km · 30:00', 'a run reads km and time');
assert.strictEqual(R.rowSummary(row('Easy Run', { distance_km: '5' })), '5 km');

const hist = [
  wk('2026-11-20', [row('Push-ups', { reps: '15', seconds: '45' }), row('Push-ups', { reps: '10', seconds: '45' })]),
  wk('2026-11-22', [row('Plank', { seconds: '45' })]),
  wk('2026-11-23', [row('Easy Run', { distance_km: '5', seconds: '1800' })]),
];
const pu = Detail.recentSessions(hist, 'Push-ups', 5);
assert.strictEqual(pu.length, 1);
assert.ok(/^15\b/.test(pu[0].summary) && /\b10\b/.test(pu[0].summary), `Recent must show the typed reps, got "${pu[0].summary}"`);
assert.ok(!/45/.test(pu[0].summary), `Recent must not show the circuit clock for a rep exercise, got "${pu[0].summary}"`);
assert.strictEqual(Detail.recentSessions(hist, 'Plank', 5)[0].summary, '45s');
assert.strictEqual(Detail.recentSessions(hist, 'Easy Run', 5)[0].summary, '5 km · 30:00');
});

t('finding 48', () => {
const circuitOnly = [wk('2026-11-20', [row('Push-ups', { seconds: '45' }), row('Push-ups', { seconds: '45' })])];
const rc = R.exerciseRecap(circuitOnly, 'Push-ups');
const labels = (kind, opts) => R.recapLines(rc, kind, opts).map(l => l.label);
assert.ok(!labels('reps').includes('Longest'), 'a rep exercise never prints a Longest hold');
assert.ok(!labels('distance').includes('Longest'));
assert.ok(labels('duration').includes('Longest'), 'a duration entry still prints Longest');
assert.ok(!labels(undefined, { exercise: { name: 'Push-ups', fm: { unit: 'reps' } } }).includes('Longest'), 'kind unknown + a rep exercise: no hold');
assert.ok(!labels(undefined, { exercise: { name: 'Push-ups', fm: {} } }).includes('Longest'), 'kind unknown + no unit claims reps/weight only: no hold');
assert.ok(!labels(undefined, { exercise: { name: 'Run', fm: { unit: 'km' } } }).includes('Longest'));
assert.ok(labels(undefined, { exercise: { name: 'Plank', fm: { unit: 'seconds' } } }).includes('Longest'), 'kind unknown + a hold exercise: Longest is allowed');
assert.ok(labels(undefined).includes('Longest'), 'no kind and no exercise: today\'s behaviour is kept');
/* the real draw path: a draft entry for a rep exercise */
const html = R.recapEl(circuitOnly, { exercise: 'Push-ups', sets: [{}] }, 'x');
assert.ok(!/Longest/.test(html ? html.textContent : ''), 'recapEl on a rep entry has no Longest line');
});

done('audit-1125 numbers recap');
