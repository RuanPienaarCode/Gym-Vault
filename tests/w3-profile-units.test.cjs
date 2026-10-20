'use strict';
/* L4-15: cholesterol and glucose tiles dropped the mmol/L the body log stores
   them in. */
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

test('L4-15 cholesterol and glucose keep their unit', () => {
  const root = render([{ date: '2026-10-01', cholesterol: '4.8', glucose: '5.2' }]);
  const c = tileText(root, 'cholesterol'), g = tileText(root, 'glucose');
  assert.ok(c && /4\.8 mmol\/L/.test(c), `cholesterol keeps its unit: ${c}`);
  assert.ok(g && /5\.2 mmol\/L/.test(g), `glucose keeps its unit: ${g}`);
});
if (failures.length) { console.error(`${failures.length} failed`); process.exit(1); }
console.log('w3 profile units OK');
