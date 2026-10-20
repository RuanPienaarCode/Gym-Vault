'use strict';
/* R2-11: the Today chip is a floor, not a ceiling.

   "Up to +190 XP" promised a maximum, but a personal best (+50 each), a streak week (+20)
   and the weekly quest (+120) all pay on top of the session + per-set XP the chip adds up.
   It now reads "From +190 XP", and the tooltip says the same thing. */
const assert = require('node:assert');
const R = require('../src/rewards');
const V = require('../src/rewards-view');
const F = require('./rewards-fixtures');
const { makeRunner } = require('./gym-fake-vault');

const { check, run } = makeRunner();
const day = F.day('Push', [['Bench Press', 4, '8-12'], ['Dips', 3, 'AMRAP'], ['Cable Fly', 2, '12']]);

check('X1 the chip label does not claim a maximum', () => {
  const chip = V.xpChipFor(day, {});
  assert.ok(!/\bup to\b/i.test(chip.label), `label: "${chip.label}"`);
  assert.strictEqual(chip.label, `From +${chip.xp} XP`);
});

check('X2 the tooltip agrees: a starting figure, the extras pay on top', () => {
  const chip = V.xpChipFor(day, {});
  assert.ok(!/\bup to\b/i.test(chip.title), `title: "${chip.title}"`);
  assert.ok(/^From /.test(chip.title) && /on top/.test(chip.title), chip.title);
});

check('X3 the figure itself is unchanged: XP.session + XP.set x planned sets', () => {
  assert.strictEqual(V.xpChipFor(day, {}).xp, R.XP.session + R.XP.set * 9);
});

run('f1-xp-chip-wording');
