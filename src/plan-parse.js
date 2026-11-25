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
                   (also `* ` / `+ ` bullets and `1.` / `1)` numbered lines)
                   - <exercise> | <free text>
                   - <exercise>
     weight        an optional `@ <n>kg` anywhere in the target

   Prose lines inside a day are kept verbatim (day.notes) and written back in
   place — the serializer must never eat a hand-written coaching cue. */

const { WEEKDAYS } = require('./constants');
const { splitBarePipes, escMd, unescMd } = require('./markdown');

/* `any` is a wildcard weekday: only meaningful in a fallback plan, where
   the day fills whatever weekday nothing else has claimed. */
const DAY_HEADING = /^##\s+(.+?)\s*\((mon|tue|wed|thu|fri|sat|sun|any)\)\s*$/i;

/* `5 x submax` → {sets: 5, target: 'submax'}; plain text → {sets: null}.

   Hand-written shapes (L2-16, wave 2) are read as well: "3X8", "3 X 8",
   "4 sets of 10", "3 sets x 10", "3 sets × 10". The original lowercase
   `N x text` / `N × text` rule is tried FIRST and unchanged, so every line
   that parsed before parses identically; the new shapes only claim text that
   used to be taken whole as the target.

   A BARE COUNT ("5 x", "5 ×", "5 sets", "3 sets x") is {sets: N, target: ''}.
   serializeItem writes `N x` for a line whose Target was left empty (Add
   exercise makes Target optional, and Edit lets you clear it), and this used to
   read that back as {sets: null, target: "5 x"}: the Sets box came up empty, the
   session ran the default 3 sets, and the next Sets edit stacked a second count
   on the dangling one (`6 x 4 x`). Write and read are one fixpoint now. The
   only reading that changes is a hand-written target that is nothing BUT a
   count; a capital "5 X" is still a plain target, as "5 Xtreme" always was. */
function parsePrescription(text) {
  const t = (text || '').trim();
  const bare = t.match(/^(\d+)\s*(?:[x×]|[sS]ets?(?:\s*[xX×])?)$/);
  if (bare) return { sets: +bare[1], target: '' };
  const m = t.match(/^(\d+)\s*[x×]\s*(.+)$/);
  if (m) return { sets: +m[1], target: m[2].trim() };
  /* A capital X needs a number after it, so "5 Xtreme" stays a name. */
  const m2 = t.match(/^(\d+)\s*(?:sets?\s*(?:of\s+|[xX×]\s*)|X\s*(?=\d))(.+)$/i);
  if (m2) return { sets: +m2[1], target: m2[2].trim() };
  return { sets: null, target: t };
}

/* An exercise line starts with one of the list markers markdown allows:
   `- `, `* `, `+ `, or a number with `.` / `)` ("1. ", "2) "). Matched on the
   RAW line, so an indented marker stays the author's own annotation. A line
   of three or more `*` / `-` / `_` (a thematic break such as `* * *`) is a
   rule, never an exercise. A `- ` line is an exercise as it always was; the
   other markers also need a `| prescription`, because "1. Warm up 5 min" and
   "* keep elbows in" are a coach's notes and look exactly like "10. Squats" —
   reading prose as exercises would put junk on Today, missing a bare
   "10. Squats" only leaves it as text. */
const ITEM_LINE = /^(-|[*+]|\d+[.)]) /;
const THEMATIC_BREAK = /^([*_-])(?:\s*\1){2,}\s*$/;
const KEPT_MARKER = /^(?:[*+]|\d+[.)]) $/;

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

/* THE DURATION, IN SECONDS — the unit is written down, so read it.

   targetIsDuration has always recognised "min", but every caller then took
   targetFirstNumber as a count of SECONDS. So the seed's Easy Run,
   `1 x 30 min easy`, scheduled a 30-second interval and logged the run as
   0.5 min; `2 min` scheduled 5 seconds, because the floor clamp was the only
   thing left doing any work. Three callers had the same hole — the timed
   schedule, the fill meter's target, and the manual log's prefill — which is
   this codebase's recurring shape: one question answered in three places by
   rules that disagree. It is answered here now.

   A RANGE takes its first number ("30-45s" is 30, "20-30 min" is 20), which
   is what every caller already did and what the shortest honest reading of a
   range is. Returns null when the target names no duration at all, so a rep
   count is never mistaken for a clock. */
function targetDurationSeconds(target) {
  const m = (target || '').match(/(\d+(?:\.\d+)?)\s*(?:[-\u2013]\s*\d+(?:\.\d+)?\s*)?(s|secs?|seconds?|min|mins?|minutes?)\b/i);
  if (!m) return null;
  const n = +m[1];
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(/^m/i.test(m[2]) ? n * 60 : n);
}

/* A day keeps its lines as ORDERED `parts` ({kind:'note',line} |
   {kind:'item',item}) so a coaching cue written BETWEEN two exercise lines
   stays exactly where the author put it across saves — the earlier
   notes-then-items model silently hoisted such prose above the whole list.
   `day.items` and `day.notes` remain as derived views (same item objects by
   identity) because every page reads them. */
function parsePlanBody(body) {
  const intro = [];
  const days = [];
  /* `## Heading` lines that carry no (weekday) and so were folded into the
     day above. Recorded, NOT acted on: data.js turns this into a load-time
     warning (see the LEFT DELIBERATELY UNGUARDED note below). */
  const folded = [];
  let day = null;
  /* Inside a ``` fence everything is an EXAMPLE the author is showing, not
     plan structure. Without this, a fenced `## Fake (tue)` created a real
     day and swallowed the exercises written below the fence. */
  let fenced = false;
  for (const line of (body || '').split(/\r?\n/)) {
    const t = line.trim();
    if (/^(```|~~~)/.test(t)) {
      fenced = !fenced;
      if (day) { day.parts.push({ kind: 'note', line }); day.notes.push(line); }
      else intro.push(line);
      continue;
    }
    const h = fenced ? null : line.match(DAY_HEADING);
    if (h) {
      /* weekdayCase keeps the AUTHOR'S OWN CASING ("(Mon)", "(MON)") purely
         for writing the line back out — every comparison against a weekday
         still goes through the lowercase `weekday` below, which is what
         resolveDaysOn/WEEKDAYS/WEEKDAY_LABELS all key off (0.11.2 journey
         audit, finding L15). Without this, the very first save after a
         hand-written plan silently rewrote "(Mon)" to "(mon)" — a change
         the user never asked for, in their own file, for a detail nothing
         downstream reads case-sensitively anyway. */
      day = { name: h[1].trim(), weekday: h[2].toLowerCase(), weekdayCase: h[2], parts: [], notes: [], items: [] };
      days.push(day);
      continue;
    }
    /* LEFT DELIBERATELY UNGUARDED (0.11.2 journey audit, finding L13): a
       `## Heading` with no `(weekday)` does not match DAY_HEADING and falls
       straight through to the plain-note branch below, folding it — and
       every bullet after it — into whatever day came before. No file in the
       seed library or anywhere else this plugin writes is shaped that way
       (Add day always writes a real weekday), so this is a hand-edit hazard
       only, and it is a genuinely ambiguous one to fix blind: a `##` line
       with no weekday could equally be a typo for a new day OR a deliberate
       sub-heading commentary within the current one, and this is a pure
       parser with no UI to ask which. Guessing wrong either way is its own
       silent corruption, on top of the one being fixed. Left alone rather
       than gamed into a guess; a warning surfaced at load time (not a parse
       rule change) is the safer shape for this, if it is ever worth doing.

       That warning now exists: the heading is recorded in `folded` below
       (model.folded) and data.js loadAll() reports it as data.foldedHeadings. */
    if (day && !fenced && /^##\s+\S/.test(line)) folded.push({ heading: line.replace(/^##\s+/, '').trim(), day: day.name });
    /* An INDENTED bullet is the user's own annotation hanging off the line
       above — `  - grip: overhand`, a superset's members — not an exercise.
       Testing the trimmed line made indentation invisible, so those became
       first-class items: they showed up in the day's exercise list, were
       logged as exercises, inflated the set count, and the write-back
       flattened the author's nesting on disk. Match the RAW line. */
    const bullet = day && !fenced ? line.match(ITEM_LINE) : null;
    const cells = bullet ? splitBarePipes(line.slice(bullet[0].length)).map(c => c.trim()) : null;
    /* A line is an exercise only when it NAMES one. A `- - -` rule is a
       thematic break whatever its marker is (it used to be read as an exercise
       called "- -" because a `- ` marker skipped that test), and a bare `- `
       (or `- | 3 x 8`) names nothing: it was an exercise called "" that showed
       up in the day's list, the session and the set count. Both are prose now,
       kept verbatim and written back where they stood. */
    if (bullet && !THEMATIC_BREAK.test(line.trim()) && cells[0] !== '' && (bullet[1] === '-' || cells.length > 1)) {
      /* Everything after the FIRST pipe is the prescription — rejoining
         keeps a hand-written `- A | B | C` intact instead of dropping C. */
      const { sets, target } = parsePrescription(cells.slice(1).join(' | '));
      const item = { exercise: unescMd(cells[0] || ''), sets, target };
      /* Remember a marker other than `- ` so the first save writes the line
         back the way the author typed it. A `- ` item carries no key at all,
         so every existing item keeps exactly its old shape. */
      if (bullet[0] !== '- ') item.marker = bullet[0];
      day.parts.push({ kind: 'item', item });
      day.items.push(item);
      continue;
    }
    if (day) {
      if (t !== '' || day.parts.length) day.parts.push({ kind: 'note', line });
      if (t !== '' || day.notes.length) day.notes.push(line);
    } else intro.push(line);
  }
  // Trim trailing blanks per day so serialization stays a fixpoint.
  for (const d of days) {
    while (d.parts.length && d.parts[d.parts.length - 1].kind === 'note' && d.parts[d.parts.length - 1].line.trim() === '') d.parts.pop();
    while (d.notes.length && d.notes[d.notes.length - 1].trim() === '') d.notes.pop();
  }
  while (intro.length && intro[intro.length - 1].trim() === '') intro.pop();
  return { intro, days, folded };
}

/* Structural edits go through these so parts and items never drift. */
function addItem(day, item) {
  if (!day.parts) day.parts = [];
  day.parts.push({ kind: 'item', item });
  day.items.push(item);
}
function removeItemAt(day, idx) {
  const [item] = day.items.splice(idx, 1);
  if (day.parts && item) {
    const pi = day.parts.findIndex(p => p.kind === 'item' && p.item === item);
    if (pi >= 0) day.parts.splice(pi, 1);
  }
}

/* Move an item up (-1) or down (+1) in the day's order. Returns the item's
   new index, or the old one when it could not move.

   IT SWAPS THE ITEMS, NOT THE LINES. `parts` interleaves items with the
   author's own prose — a warm-up note, a cue, a blank line — and that prose
   is positional commentary about the day, not a caption bolted to the
   exercise below it. Swapping the two `item` references leaves every note
   exactly where it was written and every other line untouched, so
   serialization changes precisely two lines. Moving the PART instead would
   drag an exercise across a note and quietly rewrite what that note appears
   to be about. */
function moveItem(day, idx, delta) {
  const items = (day && day.items) || [];
  const to = idx + delta;
  if (idx < 0 || idx >= items.length || to < 0 || to >= items.length) return idx;

  const a = items[idx], b = items[to];
  items[idx] = b;
  items[to] = a;

  if (day.parts) {
    const pa = day.parts.findIndex(p => p.kind === 'item' && p.item === a);
    const pb = day.parts.findIndex(p => p.kind === 'item' && p.item === b);
    if (pa >= 0 && pb >= 0) { day.parts[pa].item = b; day.parts[pb].item = a; }
  }
  return to;
}

/* Change what a line PRESCRIBES — sets, and the target string ("12", "45s",
   "5 @ 60kg"). Never the exercise NAME: plans, goals and every logged row
   reference an exercise by name, so renaming one here would silently orphan
   its history. Renaming is a different, larger operation and does not belong
   on an edit toggle.

   Mutates the item in place, which is what `parts` is already holding a
   reference to — so the serializer picks it up with no second bookkeeping
   step to forget. */
function updateItem(day, idx, patch) {
  const item = (day && day.items) ? day.items[idx] : null;
  if (!item) return null;
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'sets')) {
    const n = parseInt(patch.sets, 10);
    /* null means "no count given", which itemSets() reads as the default of
       3 — a distinct and meaningful state from an explicit 3, because the
       line stays written as `- Push-ups | 12` rather than `3 x 12`. */
    item.sets = Number.isFinite(n) && n > 0 ? n : null;
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'target')) {
    item.target = String(patch.target == null ? '' : patch.target).trim();
  }
  return item;
}

/* A day whose NAME says rest/recovery is not a session to attack — the
   dashboard renders it calmly and its items are suggestions, not a
   prescription. Named-based so it needs no schema change and a
   hand-written plan gets it for free. */
const isRestDay = day => /\brest\b|\brecovery\b/i.test((day && day.name) || '');

/* Prescribed set count with the ONE default — page-log prefill and the
   dashboard's sets-total must never disagree on what "no count" means. */
const itemSets = it => it.sets || 3;

/* How a line's prescription is SHOWN: "5 × submax", "5 sets" when the Target is
   empty (never a dangling "5 × "), or just the target when no count was given.
   `sep` is the glyph between the two ("×" with spaces on the Plans page, a bare
   "×" in the export). Every surface that prints a prescription calls this. */
function rxLabel(it, sep) {
  if (it.sets == null) return it.target || '';
  if (it.target) return `${it.sets}${sep === undefined ? ' × ' : sep}${it.target}`;
  return `${it.sets} ${it.sets === 1 ? 'set' : 'sets'}`;
}

/* An empty target is written as a bare `N x`, which parsePrescription reads
   back as {sets: N, target: ''} — keep the two ends of that in step. */
function serializeItem(it) {
  const rhs = it.sets != null ? `${it.sets} x ${it.target || ''}`.trim() : (it.target || '');
  const lead = it.marker && KEPT_MARKER.test(it.marker) ? it.marker : '- ';
  return rhs ? `${lead}${escMd(it.exercise)} | ${rhs}` : `${lead}${escMd(it.exercise)}`;
}

function serializePlanBody(model) {
  const out = [];
  if (model.intro && model.intro.length) { out.push(...model.intro, ''); }
  for (const d of model.days) {
    const wd = d.weekday === 'any' || WEEKDAYS.includes(d.weekday) ? d.weekday : 'mon';
    /* Write back whatever CASE the author originally used, as long as it
       still names the same weekday — a day built in the app (openAddDay)
       or one whose weekday genuinely changed carries no weekdayCase (or a
       stale one) and falls through to the canonical lowercase, same as
       always. */
    const wdOut = d.weekdayCase && d.weekdayCase.toLowerCase() === wd ? d.weekdayCase : wd;
    out.push(`## ${d.name} (${wdOut})`, '');
    const parts = d.parts || [
      ...(d.notes || []).map(line => ({ kind: 'note', line })),
      ...((d.notes && d.notes.length) ? [{ kind: 'note', line: '' }] : []),
      ...(d.items || []).map(item => ({ kind: 'item', item })),
    ];
    for (const p of parts) out.push(p.kind === 'item' ? serializeItem(p.item) : p.line);
    out.push('');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

/* PAUSED (0.13.1). A plan that runs ALONGSIDE the active one (`parallel`) or
   fills the empty days (`fallback`) used to be always on, with no switch.
   `paused: true` in its frontmatter takes it out of Today: ctx.parallelPlans /
   ctx.fallbackPlans (controller.js) skip it, so Today, the week strip and
   "Also today" all drop its days.

   The rule lives HERE, once, and everything that asks "is this plan paused?"
   (controller, the Plans list and detail, the export) calls it.

   Only an alongside plan can be paused. A stray `paused: true` on an ordinary
   plan means nothing — an ordinary plan is switched with "Make active", and
   honouring the key there would let a leftover line quietly un-badge the plan
   Today runs. A note without the key is NOT paused: every existing note
   behaves exactly as before. `active` is deliberately not involved; every
   existing parallel plan has `active: false` or none. */
function isPaused(plan) {
  const fm = (plan && plan.fm) || {};
  return String(fm.paused) === 'true' && (String(fm.parallel) === 'true' || String(fm.fallback) === 'true');
}

/* A plan you have starred (`favourite: true` on the note). It moves the plan
   up the Plans list, and when two add-ons train on the same weekday the
   starred one leads Today (controller.resolveDaysOn, audit 25 Nov 2026 #37). */
function isFavourite(plan) {
  return String(((plan && plan.fm) || {}).favourite) === 'true';
}

/* THE PLAN TODAY RUNS, AND WHAT EACH PLAN IS DOING FOR YOU (finding #40).

   These lived in controller.js (ctx.activePlan) and page-plans.js (planRole),
   out of reach of export.js, which therefore labelled plans from the raw flags
   and disagreed with the Plans page: the plan Today runs with no `active: true`
   anywhere exported as "inactive", a fallback plan as "inactive", and the
   seeded Rest & Recovery (parallel AND fallback) as "runs alongside" while
   Plans badges it "fills gaps". They sit here, pure, so the page and the export
   read ONE rule.

   A MAIN plan is neither parallel (it runs ALONGSIDE the active one) nor
   fallback (it only fills a day nothing else claims). activePlanOf is the plan
   Today runs: the first main plan flagged `active`, else the first main plan
   (the "implicit" active plan controller.isImplicitActive describes).
   controller.js imports BOTH from here (ctx.mainPlans, ctx.activePlan), so the
   export can never label a different plan than Today follows. For an afternoon
   there were two copies, and this one still let a fallback plan lead. */
const mainPlansOf = plans => (plans || []).filter(p => String(p.fm.parallel) !== 'true' && String(p.fm.fallback) !== 'true');
/* `active: false` written on the note is a CHOICE (the plan page's Active
   switch, or a switch to another plan): such a plan is never picked
   implicitly. Only a plan whose note says nothing about `active` (one written
   by hand) may stand in when nothing is flagged — so switching the active plan
   off really leaves Today with no main plan, instead of quietly promoting the
   next one in the list. */
const saysInactive = p => String(p.fm.active) === 'false';
function activePlanOf(plans) {
  const main = mainPlansOf(plans);
  return main.find(p => String(p.fm.active) === 'true') || main.find(p => !saysInactive(p)) || null;
}

/* 'fallback' | 'parallel' | '' — what kind of ALONGSIDE plan it is, paused or
   not. Fallback wins over parallel (a plan flagged both fills gaps), the same
   precedence controller.js builds Today with. */
function alongsideKind(p) {
  if (String(p.fm.fallback) === 'true') return 'fallback';
  if (String(p.fm.parallel) === 'true') return 'parallel';
  return '';
}

/* The role decides ORDER and the badge. A PAUSED plan is in use by nothing, so
   its role is '' (see isPaused); `activePlan` is the plan Today runs. */
function planRole(p, activePlan) {
  const kind = alongsideKind(p);
  if (kind === 'fallback') return isPaused(p) ? '' : 'fills-gaps';
  if (kind === 'parallel') return isPaused(p) ? '' : 'alongside';
  return activePlan && p === activePlan ? 'active' : '';
}

/* WHAT A PLAN IS FOR, CHOSEN ON ITS PAGE: 'main' (an alternative for the
   plan Today runs), 'parallel' (its days are added beside the main plan's) or
   'fallback' (it fills a weekday nothing else claims). Until now the role was
   a frontmatter key you could only type by hand.

   withRole(fm, role) returns the frontmatter the note should carry, or null
   when it already says so. The on/off state carries across, in the role's own
   key: a main plan's `active` becomes an alongside plan's `paused` (active →
   on, anything else → paused), and a plan moved INTO main arrives
   `active: false` — becoming main never silently takes Today over from the
   plan you chose. Keys the new role does not read are removed, so a note
   never carries a flag that means nothing. Pure.

   withRole(fm, role, { on }) (audit 25 Nov 2026, #46): a boolean `on` decides
   the on/off of an ALONGSIDE result instead of the carried-across state. The
   case it exists for: the main plan Today follows with no `active` line at all
   (activePlanOf picks it implicitly) reads as "not active" above, so making it
   an Add-on used to arrive paused. The caller, which knows the plan is in use,
   passes { on: true }. A plan moved INTO main still arrives `active: false`
   whatever `on` says: switching a main plan on goes through setActivePlan,
   which switches the others off, and a bare `active: true` here would leave two
   plans claiming Today. Anything but a boolean is ignored. */
const PLAN_ROLES = ['main', 'parallel', 'fallback'];
function roleOf(fm) {
  return alongsideKind({ fm: fm || {} }) || 'main';
}
function withRole(fm, role, opts) {
  if (!PLAN_ROLES.includes(role)) throw new Error(`unknown plan role: ${role}`);
  const was = roleOf(fm);
  /* A plan flagged BOTH parallel and fallback reads as fallback; picking
     fallback still tidies the stray parallel key. */
  if (was === role && !(role === 'fallback' && String(fm.parallel) === 'true')) return null;
  const next = { ...fm };
  if (role === 'main') {
    delete next.parallel; delete next.fallback; delete next.paused;
    next.active = false;
    return next;
  }
  const forced = opts && typeof opts.on === 'boolean' ? opts.on : null;
  const on = forced !== null ? forced : was === 'main' ? String(fm.active) === 'true' : String(fm.paused) !== 'true';
  delete next.active;
  if (role === 'parallel') { next.parallel = true; delete next.fallback; }
  else { next.fallback = true; delete next.parallel; }
  if (on) delete next.paused; else next.paused = true;
  return next;
}

/* WHICH DAY A PLAN'S START OPENS, on a given weekday (24 Nov 2026, Ruan: "I
   want to do my lunch time plan in the week" — a Friday-only plan had no Start
   anywhere on a Tuesday). Today's own day if the plan has one, else its `any`
   day, else the next day it trains (wrapping round the week), else its first
   training day. Rest days are never picked. Returns { day, weekday, today }
   (`weekday` is the day it is written for, `today` true when that is today),
   or null for a plan with nothing to train. */
function startDayFor(plan, todayKey) {
  const days = ((plan && plan.model && plan.model.days) || []).filter(d => !isRestDay(d));
  if (!days.length) return null;
  const exact = days.find(d => d.weekday === todayKey);
  if (exact) return { day: exact, weekday: todayKey, today: true };
  const any = days.find(d => d.weekday === 'any');
  if (any) return { day: any, weekday: 'any', today: true };
  const start = WEEKDAYS.indexOf(todayKey);
  for (let i = 1; i <= 7 && start >= 0; i++) {
    const wk = WEEKDAYS[(start + i) % 7];
    const hit = days.find(d => d.weekday === wk);
    if (hit) return { day: hit, weekday: wk, today: false };
  }
  return { day: days[0], weekday: days[0].weekday, today: false };
}

module.exports = {
  PLAN_ROLES, roleOf, withRole,
  isPaused, isFavourite, mainPlansOf, activePlanOf, alongsideKind, planRole, rxLabel,
  parsePlanBody, serializePlanBody, parsePrescription, addItem, removeItemAt, moveItem, updateItem, itemSets, isRestDay,
  targetWeight, targetFirstNumber, targetIsDuration, targetDurationSeconds, startDayFor,
};
