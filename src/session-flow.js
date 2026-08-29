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
    if (!isHandled(set)) return p;
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

module.exports = { isHandled, initialPosition, isDone, currentSet, advance, skipSet, skipExercise, progress };
