'use strict';
/* Pure step machine over a session draft (see page-log.js startDraft /
   makeEntry) — no DOM, no obsidian import, so position advance/skip/resume
   rules are unit-tested without a browser. page-session.js (the guided view)
   is the only DOM caller; it owns rendering and side effects and leaves the
   actual navigation rules to this module.

   ONE DRAFT, TWO VIEWS: nothing here ever creates or mutates draft state
   itself — it only computes WHERE in the existing draft the guided view
   should be looking. Ticking a set from the log page overview and resuming
   guided mode must see the same world.

   A "position" is {entryIndex, setIndex} pointing at one set inside
   draft.entries[entryIndex].sets[setIndex]. Every function here returns a
   NEW position object (same no-mutate discipline as rep-counter.js) — never
   the one it was given. */

/* A set counts as ALREADY HANDLED for guided navigation when it's ticked
   done or the user has typed into it (touched) — looser than
   stats.setCounts, which additionally requires a figure to actually SAVE a
   set. Deliberately a SEPARATE rule: "resume past this" and "will this be
   saved" are different questions that happen to agree in the common case (a
   set the user cleared back to blank after touching it should still be
   treated as dealt-with in guided mode, even though finishSession won't
   save it). */
function isHandled(set) {
  return !!(set && (set.done || set.touched));
}

/* A SKIP IS REMEMBERED ON THE SET (`set.skipped`) FOR THE LIFE OF THE DRAFT.
   Skipping leaves the set untouched and unticked on purpose (it must not look
   logged), so isHandled can never see it - and leaving guided then re-entering
   landed back on exercise 1 set 1, as if nothing had been skipped. The mark is
   plain data on the set itself, so it follows the set if the log page adds or
   removes others (an index list would not). It is NOT a figure: buildRows and
   stats.setCounts never read it, so a saved note reads exactly as before.
   Navigation passes over a set that is handled OR skipped; done/typed still
   wins if the set is later filled in. */
function isSkipped(set) {
  return !!(set && set.skipped === true);
}
const isSettled = set => isHandled(set) || isSkipped(set);

function entryCount(draft) { return draft && draft.entries ? draft.entries.length : 0; }
function setCount(draft, entryIndex) {
  const entry = draft.entries[entryIndex];
  return entry ? entry.sets.length : 0;
}

/* Rolls a raw {entryIndex, setIndex} forward across exercise boundaries
   until it lands on a real set, or falls off the end (isDone position). */
function normalize(draft, pos) {
  let entryIndex = pos.entryIndex, setIndex = pos.setIndex;
  const n = entryCount(draft);
  while (entryIndex < n) {
    const len = setCount(draft, entryIndex);
    if (setIndex < len) return { entryIndex, setIndex };
    entryIndex++; setIndex = 0;
  }
  return { entryIndex: n, setIndex: 0 };
}

/* From `pos` (inclusive), roll forward to the next set that is NOT already
   handled. Shared by resume-mid-draft, advance and both skips — one rule for
   "what counts as the next actionable set". */
function nextUnhandled(draft, pos) {
  let p = normalize(draft, pos);
  const n = entryCount(draft);
  while (p.entryIndex < n) {
    const set = draft.entries[p.entryIndex].sets[p.setIndex];
    if (!isSettled(set)) return p;
    p = normalize(draft, { entryIndex: p.entryIndex, setIndex: p.setIndex + 1 });
  }
  return p; // isDone position
}

/* Where a guided session starts: the first not-yet-handled set, honouring
   anything the user already ticked or typed on the overview before
   switching into guided mode. */
function initialPosition(draft) {
  return nextUnhandled(draft, { entryIndex: 0, setIndex: 0 });
}

/* SKIP MEANS "NOT DONE", WHATEVER WAS TYPED INTO THE SET FIRST (audit 16 Nov
   2026, #2). A weight write sets `touched`, and touched plus any figure is what
   stats.setCounts calls worth saving - so a set whose weight was nudged and then
   skipped was saved (`8 x 62.5`) and counted ("3 sets done") although the user
   had said no to it. The rule lives HERE rather than in each reader: a skipped,
   unticked set goes back to being a plan PREFILL (touched false), so
   stats.setCounts, page-log.buildRows, progress() and the complete tile all stop
   counting it at once, with no second rule to drift. The figures stay in the
   boxes (dimmed as a prefill) and nothing is deleted; a figure typed or a tick
   made AFTER the skip sets touched / done again and wins, as it always did.

   A ticked set is never touched: a skip cannot un-do work the user ticked.
   Only the set the user is looking at when they press Skip is ever passed here,
   or (below) the rest of its exercise. */
function skipOne(set) {
  if (!set || set.done) return;
  set.skipped = true;
  set.touched = false;
  /* Back to a prefill means nothing in it was typed: the per-figure record goes
     with `touched`, or a figure typed before the skip would still be believed after
     the set is touched again by an unrelated one. */
  delete set.typed;
}

/* WHICH FIGURES THE USER TYPED, KEPT BESIDE `touched` (audit 16 Nov 2026, #5).
   `touched` is one flag for the whole set and keeps meaning "this set holds
   something the user did" (stats.setCounts, the skip rule above). It cannot say WHICH
   figure, and a record claim has to: typing the reps of `3 x 8 @ 60kg` says nothing
   about the 60, which is still the plan's prefill, and letting it claim a weight
   record paid XP for a lift nobody did.

   `set.typed` is {figureKey: true} for the figures the user edited (reps,
   weight_kg, seconds, ...). Plain data on the set like `skipped`, never read by
   buildRows or stats, so a saved note is unchanged. typedKinds turns it into the
   record KINDS applyCompletion's trust rule asks about. A set that is touched but has
   no record (marked by an older build, or by a path that sets only `touched`) keeps
   the old answer - everything counts as typed - rather than silently losing a claim
   the user earned. An untouched set has typed nothing, whatever the record says. */
const KIND_OF_FIGURE = { reps: 'reps', weight_kg: 'weight', seconds: 'seconds' };

function markTyped(set, key) {
  if (!set || !key) return;
  if (!set.typed || typeof set.typed !== 'object') set.typed = {};
  set.typed[key] = true;
}

function typedKinds(set) {
  if (!set || !set.touched) return [];
  if (!set.typed || typeof set.typed !== 'object') return ['reps', 'weight', 'seconds'];
  return Object.keys(KIND_OF_FIGURE).filter(k => set.typed[k] === true).map(k => KIND_OF_FIGURE[k]);
}

/* Mark the set at `pos` skipped. */
function markSkipped(draft, pos) {
  const cur = currentSet(draft, pos);
  if (cur) skipOne(cur.set);
}

/* Mark the rest of the exercise at `pos` (from this set on) skipped. The set on
   screen follows the rule above; a LATER set the user had already typed into on
   the log is one they never visited here, so it stays handled and saved exactly
   as before. */
function markExerciseSkipped(draft, pos) {
  const cur = currentSet(draft, pos);
  if (!cur) return;
  skipOne(cur.set);
  for (let i = cur.setIndex + 1; i < cur.entry.sets.length; i++) {
    if (!isHandled(cur.entry.sets[i])) cur.entry.sets[i].skipped = true;
  }
}

function isDone(draft, pos) {
  return !draft || normalize(draft, pos).entryIndex >= entryCount(draft);
}

/* {entry, set, entryIndex, setIndex} at `pos`, or null once isDone. */
function currentSet(draft, pos) {
  if (isDone(draft, pos)) return null;
  const p = normalize(draft, pos);
  const entry = draft.entries[p.entryIndex];
  return { entry, set: entry.sets[p.setIndex], entryIndex: p.entryIndex, setIndex: p.setIndex };
}

/* Move on from the set just completed — skips over anything already handled
   (the user may have ticked ahead on the overview mid-session). */
function advance(draft, pos) {
  return nextUnhandled(draft, { entryIndex: pos.entryIndex, setIndex: pos.setIndex + 1 });
}

/* Skip THIS set without marking it done — it stays untouched/unticked, so it
   still counts only as a plan-target prefill, same as leaving it alone on
   the overview (see stats.setCounts). */
function skipSet(draft, pos) {
  return nextUnhandled(draft, { entryIndex: pos.entryIndex, setIndex: pos.setIndex + 1 });
}

/* Skip the rest of the CURRENT exercise — jump to the first unhandled set of
   the next entry. An exercise whose every set is already handled gets
   skipped in the same pass, via nextUnhandled's own loop. */
function skipExercise(draft, pos) {
  return nextUnhandled(draft, { entryIndex: pos.entryIndex + 1, setIndex: 0 });
}

/* {done, total} across the WHOLE draft — the header progress bar and the
   completion screen's tally share this one count, so they can never
   disagree about how far along the session is. */
function progress(draft) {
  let done = 0, total = 0;
  for (const entry of (draft && draft.entries) || []) {
    for (const set of entry.sets) { total++; if (isHandled(set)) done++; }
  }
  return { done, total };
}

module.exports = { isHandled, isSkipped, isSettled, markTyped, typedKinds, markSkipped, markExerciseSkipped, initialPosition, isDone, currentSet, advance, skipSet, skipExercise, progress };
