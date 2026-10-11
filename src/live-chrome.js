'use strict';
/* THE LIVE SET'S POSTER CHROME (design fidelity, Apex + Lock In).

   Designs 10 (Apex) and 07 (Lock In) draw the live set the same way: an
   iconic top row (close, "Move 1 of 4"), the exercise name, a one-line sub,
   a rail of leaning pips for the sets, the counter, and a sheet underneath
   holding what comes next and one big "Tick set" slab. The other two skins
   (Floor, Editorial) keep the plain screen they always had.

   Pure: no DOM, no obsidian. page-session.js owns the pixels; this owns the
   words and the arithmetic, so each can be proved without a browser:

     isLockInSkin(skin)       which skins wear the poster chrome. The DOM is
                              built for them ONLY, so Floor and Editorial
                              render exactly the nodes they always did.
     tickCopy(skin)           the primary slab's label. "Tick set" in the two
                              poster skins; every other skin keeps "Done".
                              Keyed like page-dashboard.js's startCopy.
     moveLabel(i, n)          "Move 1 of 4"
     railLabel(i, n)          "Set 2 of 3"
     railPips(sets, i)        one of 'done' | 'cur' | 'todo' per set
     subLine(entry, i, fmt)   the plan's target, then what the set before
                              this one logged: "12 · set 1 was 9 reps"
     nextUp(draft, pos)       what Tick set leads to, from the SAME flow the
                              rest screen uses (advance), or null at the end

   NOTHING HERE INVENTS A FIGURE. Every number is a plan target or something
   the user already logged this session. */

const flow = require('./session-flow');

/* The two skins that wear the poster chrome. Mirrors page-dashboard.js's
   LOCK_IN_SKINS (Today's "Lock in" slab) and, like it, treats an unset skin
   as Apex, the default. */
const LOCK_IN_SKINS = Object.freeze(['apex', 'lockin']);
const isLockInSkin = skin => LOCK_IN_SKINS.indexOf(skin || 'apex') !== -1;

function tickCopy(skin) {
  return isLockInSkin(skin) ? { label: 'Tick set', poster: true } : { label: 'Done', poster: false };
}

const moveLabel = (entryIndex, total) => `Move ${entryIndex + 1} of ${total}`;
const railLabel = (setIndex, total) => `Set ${setIndex + 1} of ${total}`;

/* A pip per set. The one on screen is 'cur' whatever it holds; a set the user
   already ticked or typed into (session-flow's isHandled) is 'done'; a set
   skipped over is not handled, so it stays 'todo' and is not a lie. */
function railPips(sets, setIndex) {
  return (sets || []).map((s, i) => (i === setIndex ? 'cur' : flow.isHandled(s) ? 'done' : 'todo'));
}

/* What the nearest earlier handled set of this exercise logged, as the words
   the plan screens use: reps, or a time. '' when there is none. */
function lastSetNote(entry, setIndex, fmtSeconds) {
  const sets = (entry && entry.sets) || [];
  for (let i = Math.min(setIndex, sets.length) - 1; i >= 0; i--) {
    const s = sets[i];
    if (!flow.isHandled(s)) continue;
    const secs = String(s.seconds == null ? '' : s.seconds).trim();
    const reps = String(s.reps == null ? '' : s.reps).trim();
    if (entry.duration && secs !== '') return `set ${i + 1} was ${fmtSeconds ? fmtSeconds(secs) : secs + 's'}`;
    if (!entry.duration && reps !== '') return `set ${i + 1} was ${reps} ${reps === '1' ? 'rep' : 'reps'}`;
  }
  return '';
}

function subLine(entry, setIndex, fmtSeconds) {
  const target = String((entry && entry.target) || '').trim();
  /* A bare "12" or "8-12 @ 60kg" under a name reads as nothing; "Aim" says what it is. */
  const aim = /^\d/.test(target) ? `Aim ${target}` : target;
  return [aim, lastSetNote(entry, setIndex, fmtSeconds)].filter(Boolean).join(' · ');
}

/* The set the Tick slab leads to. `sameExercise` says whether the line should
   read "Set 3 of 3" (same movement) or "4 x 8-12" (a new one), and `last` is
   true when there is nothing after this set. */
function nextUp(draft, pos) {
  const cur = flow.currentSet(draft, pos);
  if (!cur) return null;
  const nextPos = flow.advance(draft, pos);
  const nxt = flow.currentSet(draft, nextPos);
  if (!nxt) return { last: true, name: '', detail: '', sameExercise: false };
  const sameExercise = nxt.entryIndex === cur.entryIndex;
  const n = nxt.entry.sets.length;
  const target = String(nxt.entry.target || '').trim();
  const newLine = target ? `${n} \u00d7 ${target}` : `${n} set${n === 1 ? '' : 's'}`;
  const detail = sameExercise ? railLabel(nxt.setIndex, n) : newLine;
  return { last: false, name: nxt.entry.exercise, detail, sameExercise };
}

module.exports = { LOCK_IN_SKINS, isLockInSkin, tickCopy, moveLabel, railLabel, railPips, lastSetNote, subLine, nextUp };
