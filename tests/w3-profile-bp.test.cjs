'use strict';
/* L1-12: the blood-pressure tile paired the newest systolic with the newest
   diastolic even when they came from different rows - a number nobody
   measured. It now shows the newest row that has BOTH.
   */
const assert = require('node:assert');
const T = require('./f3-stub');
const profile = require('../src/page-profile');

const render = body => {
  const ctx = {
    data: { profile: { fm: {}, body: '' }, body, bodyFile: null },
    settings: {}, state: {}, app: {}, nav() {}, notice() {}, reload() {}, openFile() {},
    io: { listPhotos: async () => [] },
  };
  return T.render(profile, ctx);
};
const tileOf = (root, label) => T.findAll(root, 'gv-tile').find(t => t.textContent.replace(/\s+/g, ' ').includes(label));
const tileText = (root, label) => { const t = tileOf(root, label); return t ? t.textContent.replace(/\s+/g, ' ').trim() : null; };

const failures = [];
const test = (name, fn) => { try { fn(); } catch (e) { failures.push(name); console.error(`FAIL ${name}: ${e.message.split('\n')[0]}`); } };

test('L1-12 systolic alone later does not pair with an older diastolic', () => {
  const root = render([
    { date: '2026-09-01', bp_systolic: '120', bp_diastolic: '80' },
    { date: '2026-10-01', bp_systolic: '150' },
  ]);
  const t = tileText(root, 'blood pressure');
  assert.ok(t && /120\/80/.test(t) && !/150/.test(t), `BP must be the newest row with BOTH readings, got: ${t}`);
});
test('L1-12 diastolic-only row does not pair', () => {
  const root = render([
    { date: '2026-09-01', bp_systolic: '120', bp_diastolic: '80' },
    { date: '2026-10-01', bp_diastolic: '95' },
  ]);
  const t = tileText(root, 'blood pressure');
  assert.ok(t && /120\/80/.test(t) && !/95/.test(t), `diastolic-only row must not pair: ${t}`);
});
test('L1-12 control: newest full pair wins, no pair -> no tile', () => {
  const root = render([
    { date: '2026-09-01', bp_systolic: '120', bp_diastolic: '80' },
    { date: '2026-10-01', bp_systolic: '118', bp_diastolic: '76' },
  ]);
  assert.ok(/118\/76/.test(tileText(root, 'blood pressure')), 'control: newest full pair');
  const none = render([{ date: '2026-09-01', bp_systolic: '120' }, { date: '2026-10-01', bp_diastolic: '80' }]);
  assert.strictEqual(tileOf(none, 'blood pressure'), undefined, 'no row has both -> no tile');
});

if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('w3 profile bp OK');
