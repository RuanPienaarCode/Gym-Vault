'use strict';
/* START OPENS (issue #28): what every Start button does, and what sits one tap
   beside it. A lifter whose gym has someone on the next machine works from the
   log in any order; one who likes being led keeps Guided. ONE rule
   (constants.startModes) for the Today hero, the "Also today" card and every
   Plans day card, so no Start can go its own way again — before this, Plans
   and "Also today" only knew Guided, and the log was reached by starting a
   guided session and leaving it. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { startModes, START_OPENS, DEFAULT_SETTINGS } = require('../src/constants');

assert.strictEqual(DEFAULT_SETTINGS.startOpens, 'guided', 'nothing changes for anyone who never opens the setting');
assert.deepStrictEqual(START_OPENS.map(o => o[0]), ['guided', 'log']);
assert.deepStrictEqual(startModes({ startOpens: 'guided' }), { primary: 'guided', alt: 'log', altLabel: 'Log manually' });
assert.deepStrictEqual(startModes({ startOpens: 'log' }), { primary: 'log', alt: 'guided', altLabel: 'Guided' });
const GUIDED = { primary: 'guided', alt: 'log', altLabel: 'Log manually' };
assert.deepStrictEqual(startModes({ startOpens: 'nonsense' }), GUIDED, 'a hand-edited value falls back to Guided');
assert.deepStrictEqual(startModes({}), GUIDED, 'a missing key (settings saved by an older version) is Guided');
assert.deepStrictEqual(startModes(null), { primary: 'guided', alt: 'log', altLabel: 'Log manually' });

/* Every Start button goes through ctx.start / ctx.startAlt: no page calls
   startGuided directly for a plan day any more. */
const src = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
for (const f of ['page-dashboard.js', 'page-plans.js']) {
  assert.ok(!/ctx\.startGuided\(/.test(src(f)), `${f} starts through ctx.start, never startGuided directly`);
  assert.ok(/ctx\.startAlt\(/.test(src(f)), `${f} offers the other way one tap away`);
}
assert.ok(/ctx\.start = /.test(src('controller.js')) && /ctx\.startAlt = /.test(src('controller.js')));
assert.ok(/startOpens/.test(src('settings-tab.js')), 'the setting is in the tab');
console.log('start-opens OK');
