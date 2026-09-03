'use strict';
/* THE READING REGISTER, on the pages that were wearing the acting one.

   Plan detail here (issue #11); Profile's half is added by the commit that
   fixes it, so that each commit's guards describe the code it ships.

   Editorial Floor divides every screen in two. READING surfaces are paper,
   1px hairlines, and the accent used only as a highlight. ACTING surfaces
   get exactly ONE lime flood, under the thumb. The 0.10.2 audit found two
   reading pages dressed as acting ones:

     Plan detail — coaching prose, day lists, equipment tags — gave every
     day card a solid Start. A six-day plan was six acting blocks with
     nothing for the eye to land on, and the day cards carried a 2px ink top
     border, which is acting weight on a reading card.

   Neither page lost an action. This is register, not function: every Start
   still starts, the measurement modal and the camera still open. What
   changed is which of them shouts.

   A `gv-btn` with no `gv-btn-ghost` beside it is the solid primary — that is
   the thing being counted here. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const read = f => fs.readFileSync(path.join(SRC, f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* Every `class:` value that names gv-btn, whether a literal or a template. */
const buttonClasses = src => [...src.matchAll(/class:\s*(`[^`]*`|'[^']*')/g)]
  .map(m => m[1].slice(1, -1))
  .filter(c => /\bgv-btn\b/.test(c));

/* Solid = says gv-btn and does NOT hand out a ghost/danger/small-ghost
   variant. A template that interpolates gv-btn-ghost counts as ghost-capable
   and is judged by the page's own logic, tested separately below. */
const isSolid = c => !/gv-btn-ghost|gv-btn-danger-ghost/.test(c);

/* ---- GUARD 1: plan detail has ONE acting Start, and it is conditional ---- */
{
  const src = strip(read('page-plans.js'));

  /* The Start on a day card must be able to render ghost. Before this it was
     a bare 'gv-btn gv-btn-small' on every day. */
  assert.match(src, /class: `gv-btn gv-btn-small\$\{isToday \? '' : ' gv-btn-ghost'\}`/,
    "the day-card Start must be ghost unless it is today's day — one flood per screen, not one per day");

  /* And the flood is chosen by TODAY, not by position — "the first day" or
     "the active plan's day 1" would put a flood on a page you opened in
     December to read. */
  assert.match(src, /const todayKey = weekdayKey\(todayISO\(\)\)/,
    'the one flood must be chosen by the real weekday');
  assert.match(src, /plan\.model\.days\.find\(d => d\.weekday === todayKey && !isRestDay\(d\)\)/,
    'a rest day is not the day to flood, and neither is a plan today is not on');
  assert.match(src, /\|\| null;/,
    'when today is not on this plan the answer must be nothing — Today already owns the primary CTA');

  /* Start must survive on EVERY day. This is a change of register, not of
     function: starting a specific day from the plan is a real action. */
  const starts = [...src.matchAll(/ctx\.startGuided\(plan, day\)/g)];
  assert.strictEqual(starts.length, 1,
    'exactly one Start handler, rendered once per day — dropping it from non-today days would remove a real action');
}

/* ---- GUARD 2: plan-detail day cards are a hairline, not acting weight ---- */
{
  const css = read('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = css.match(/\.gv-day-card\s*\{[^}]*\}/);
  assert.ok(rule, '.gv-day-card rule missing');
  assert.match(rule[0], /border-top:\s*1px solid/,
    'a 2px ink rule is the acting register\'s weight; a reading card gets a hairline');
  assert.ok(!/border-top:\s*2px solid var\(--gv-ink\)/.test(rule[0]),
    'the 2px ink top border is what made six day cards read as six things to do');
}

console.log('reading register OK (plan detail floods only today, and keeps every Start)');
