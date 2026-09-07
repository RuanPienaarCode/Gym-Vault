'use strict';
/* THE TIMED FIGURE BOX SHOWED A PLAN PREFILL AS A LOGGED RESULT (0.11.2
   journey audit, finding #5). timedFigures rendered `value: set[key]` at
   full ink with no dimming, so a plan's "15" reps sat in the box reading as
   something already done — do exactly 15 and leave it alone, and history
   then shows nothing, because timedSetValues clears an untouched value on
   save. This pins the fix as SOURCE SHAPE (page-session.js cannot stand up a
   full render's DOM output cheaply here) plus the stylesheet rule it relies
   on, matched against the ACTUAL class name page-session.js uses so the two
   files cannot drift apart silently. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const src = strip(read('page-session.js'));
const css = strip(read('styles.css'));

/* ---------- 1. an untouched field is marked as a prefill ---------- */
{
  assert.match(src, /const prefilled = !set\.touched;/,
    'timedFigures must decide "is this an untouched prescription" BEFORE any field can flip touched');
  const classAttr = /class: `gv-timed-field\$\{prefilled \? ' ([\w-]+)' : ''\}`/.exec(src);
  assert.ok(classAttr, 'the field wrapper must carry a conditional prefill class driven by `prefilled`');
  const prefillClass = classAttr[1];

  /* And the class must actually be REMOVED once the user types, or a value
     typed to correct the prefill would still read as a suggestion. */
  assert.match(src, new RegExp(`wrap\\.classList\\.remove\\('${prefillClass}'\\)`),
    'typing into the field must drop the prefill class — a typed figure is a result, not a suggestion any more');

  /* ---------- 2. the stylesheet actually dims that exact class ---------- */
  const rule = new RegExp(`\\.gv-timed-field\\.${prefillClass}\\s+\\.gv-set-input\\s*\\{[^}]*opacity`);
  assert.match(css, rule,
    `styles.css must dim .gv-timed-field.${prefillClass} .gv-set-input, matching the class page-session.js actually applies`);
}

/* ---------- 3. a duration entry gets the seconds box too (finding #3's other
   half — it used to be excluded from timedFigures altogether) ---------- */
{
  assert.match(src, /if \(isWork && set\) \{\s*\n\s*body\.append\(timedFigures\(ctx, entry, set, iv\)\);/,
    'a duration work interval must reach timedFigures too, not just distance/reps/weighted entries');
  assert.match(src, /\} else if \(entry\.duration\) \{[\s\S]{0,200}field\('seconds', 'sec', 's', 'Seconds held'\)/,
    'timedFigures must offer an editable seconds box for a duration entry');
}

console.log('timed prefill OK (an untouched box reads as a suggestion, not a result, and duration entries get a correctable seconds box)');
