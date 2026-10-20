'use strict';
/* Keeping the session in progress on THIS DEVICE (0.12.1, audit L3-01).

   The live session is ctx.state.logDraft, and until now it existed only in
   memory: iOS evicting Obsidian while it sat in the background (the session's
   own Music button sends you to Spotify, so does a phone call), closing the
   Gym tab, a plugin update or quitting lost every finished set, because
   nothing touches the vault until Finish. The vault is still not written
   early — a half-finished session note is the thing page-log.js's header
   promises never to leave behind — so this is a separate, device-local copy.

   NOT the vault and NOT data.json: data.json syncs, and another device saving
   its own settings would overwrite a session that only ever happened on this
   one. app.saveLocalStorage / loadLocalStorage (Obsidian 1.8.7+, already
   scoped to the vault) are used when they exist; minAppVersion is 1.8.0, so
   everything below also works on window.localStorage keyed by the vault id.
   Every access is try/catch'd — storage can be missing, full or blocked, and
   a workout must never fail because its safety copy did.

   WHAT IS KEPT IS A WHITELIST OF PLAIN DATA, never the live object. The draft
   also carries things that mean nothing after a relaunch or would do harm:
   `timed` (a schedule the guided clock walks), `finishing` (a double-tap
   latch — restored, it would swallow the Finish tap for ever) and whatever a
   later change hangs on it. A session comes back as a LOG draft: the sets
   already ticked or typed, and the Today card to resume it. Guided mode is
   one tap from there, rebuilt fresh by ctx.enterGuided(). */

const { setCounts } = require('./stats');

/* Under Obsidian's own API the stored key becomes `<appId>-gym-app-draft`. */
const STORE_KEY = 'gym-app-draft';
const STORE_VERSION = 1;

/* A gap this long between the last write and the restore is not part of the
   workout. Finish logs duration_min from startedAt, so a session killed at the
   gym and reopened the next morning would otherwise bank a fifteen-hour
   workout. Past this gap the clock resumes from where it stopped; under it
   (a phone call, a song in Spotify, a locked screen) the time away is simply
   time the session took. */
const STALE_GAP_MS = 3 * 60 * 60 * 1000;

const SET_FIELDS = ['reps', 'weight_kg', 'seconds', 'distance_km', 'minutes'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const finite = n => typeof n === 'number' && Number.isFinite(n);
const str = v => (typeof v === 'string' ? v : '');
/* A figure is a string the user typed or a number the plan prefilled. Anything
   else (an object, NaN, a function) is not a figure and becomes blank. */
const scalar = v => (typeof v === 'string' || finite(v) ? v : '');

function plainSet(set) {
  const out = {};
  for (const k of SET_FIELDS) if (Object.prototype.hasOwnProperty.call(set, k)) out[k] = scalar(set[k]);
  out.done = set.done === true;
  out.touched = set.touched === true;
  /* A set skipped in guided mode: re-entry resumes past it (session-flow). Only a
     real true is kept, and only when set, so an old draft reads exactly as before. */
  if (set.skipped === true) out.skipped = true;
  return out;
}

function plainEntry(entry) {
  if (!entry || typeof entry !== 'object' || typeof entry.exercise !== 'string' || !entry.exercise.trim()) return null;
  if (!Array.isArray(entry.sets)) return null;
  const sets = entry.sets.filter(s => s && typeof s === 'object').map(plainSet);
  if (!sets.length) return null;
  return {
    exercise: entry.exercise, target: str(entry.target),
    duration: entry.duration === true, weighted: entry.weighted === true, distance: entry.distance === true,
    sets,
  };
}

const hasLoggedWork = entries => entries.some(e => e.sets.some(setCounts));

/* WHAT THE LIVE SESSION HOLDS BESIDES SETS (fix wave F2: audit C-05 + R2-04).
   page-session.js keeps one plain-data block on the draft, `draft.live`:

     records   the personal bests broken so far (sess.records) — rewards-flow
               reads them off the session to celebrate and PAY them, so a best
               earned before iOS evicted the app must come back with the draft;
     goalCount / metGoals   the goals met so far, so a restored session does not
               announce the same goal a second time;
     paused    a PAUSED clock that has to survive a relaunch: a hold's banked
               seconds ('hold') or a rest's remaining time ('rest'). A paused
               circuit ('timed') is deliberately not here — its schedule is not
               kept, so there is nothing to put it back on.

   Whitelisted field by field, like the sets: it is read back from whatever the
   device holds. Anything malformed is dropped, never repaired by guessing. */
const nonNeg = n => (finite(n) && n >= 0 ? n : 0);
const idStr = v => (typeof v === 'string' && v ? v : null);

function plainRecord(r) {
  if (!r || typeof r !== 'object') return null;
  const key = idStr(r.key), exercise = idStr(r.exercise), kind = idStr(r.kind);
  if (!key || !exercise || !kind) return null;
  const fig = v => (typeof v === 'string' || finite(v) ? v : null);
  const val = fig(r.val);
  if (val === null) return null;
  return { key, exercise, kind, val, prev: fig(r.prev) };
}

function plainPaused(p) {
  if (!p || typeof p !== 'object') return null;
  if (p.kind === 'hold') {
    const key = idStr(p.key);
    if (!key) return null;
    return {
      kind: 'hold', key, bankedSeconds: nonNeg(p.bankedSeconds), targetHit: p.targetHit === true, away: p.away === true,
      lastAnnounced: finite(p.lastAnnounced) ? p.lastAnnounced : -1,
      lastLiveAnnounced: finite(p.lastLiveAnnounced) ? p.lastLiveAnnounced : -1,
    };
  }
  if (p.kind === 'rest') {
    const next = idStr(p.next);
    if (!next) return null;
    return { kind: 'rest', next, bankedSeconds: nonNeg(p.bankedSeconds), callouts: (Array.isArray(p.callouts) ? p.callouts : []).filter(c => typeof c === 'string') };
  }
  return null;
}

function plainLive(live) {
  if (!live || typeof live !== 'object') return null;
  const records = (Array.isArray(live.records) ? live.records : []).map(plainRecord).filter(Boolean);
  const metGoals = (Array.isArray(live.metGoals) ? live.metGoals : []).filter(g => typeof g === 'string');
  const goalCount = Number.isInteger(live.goalCount) && live.goalCount > 0 ? live.goalCount : 0;
  const paused = plainPaused(live.paused);
  if (!records.length && !metGoals.length && !goalCount && !paused) return null;
  return { records, goalCount, metGoals, paused };
}

/* A paused hold with seconds on it is work in progress even though no set is
   ticked yet: a plank paused at 40 s on set 1 is the whole session so far. */
const hasPausedWork = live => !!(live && live.paused && live.paused.kind === 'hold' && live.paused.bankedSeconds > 0);

/* The draft as plain JSON, or null when there is nothing worth keeping — no
   set ticked and no figure typed. A session you had only just started comes
   back as nothing to lose, and offering it would leave a card on Today that
   nobody asked for. `now` is injectable for the guards. */
function snapshotDraft(draft, now) {
  if (!draft || typeof draft !== 'object' || !Array.isArray(draft.entries)) return null;
  const entries = draft.entries.map(plainEntry).filter(Boolean);
  const live = plainLive(draft.live);
  if (!hasLoggedWork(entries) && !hasPausedWork(live)) return null;
  const out = { date: str(draft.date), plan: str(draft.plan), day: str(draft.day), startedAt: finite(draft.startedAt) ? draft.startedAt : Date.now(), entries };
  if (live) out.live = live;
  return { v: STORE_VERSION, savedAt: finite(now) ? now : Date.now(), draft: out };
}

/* A stored value back into a draft the log page can render, or null when it is
   anything else: wrong version (a newer or older build's), wrong shape, an
   unreadable date, nothing logged. Never throws — it is fed whatever the
   device holds. */
function restoreDraft(raw, now) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== STORE_VERSION) return null;
  const d = raw.draft;
  if (!d || typeof d !== 'object' || !Array.isArray(d.entries)) return null;
  /* The date names the note Finish writes. A draft that cannot say which day
     it was is not one to save under a guess. */
  if (typeof d.date !== 'string' || !ISO_DATE.test(d.date)) return null;
  const entries = d.entries.map(plainEntry).filter(Boolean);
  const live = plainLive(d.live);
  if (!hasLoggedWork(entries) && !hasPausedWork(live)) return null;
  const t = finite(now) ? now : Date.now();
  let startedAt = finite(d.startedAt) ? d.startedAt : t;
  if (finite(raw.savedAt) && t - raw.savedAt > STALE_GAP_MS) startedAt += t - raw.savedAt;
  if (startedAt > t) startedAt = t; // a clock that moved backwards must not make elapsed negative
  const out = { date: d.date, plan: str(d.plan), day: str(d.day), startedAt, entries };
  if (live) out.live = live;
  return out;
}

/* What happened to a save, as the shell needs to tell the user. */
const KEPT = 'kept';   // on the device, will be offered back
const EMPTY = 'empty'; // nothing logged yet — nothing to keep, nothing lost
const LOST = 'lost';   // there was work and the device would not take it

function makeDraftStore(app) {
  const hasHost = () => !!app && typeof app.saveLocalStorage === 'function' && typeof app.loadLocalStorage === 'function';
  /* Scope for the fallback only — Obsidian's own pair already prefixes the
     vault id. Two vaults on one device must never be offered each other's
     session. */
  const scope = () => String((app && app.appId)
    || (app && app.vault && typeof app.vault.getName === 'function' && app.vault.getName()) || '');
  const webKey = () => `${scope()}-${STORE_KEY}`;
  const webStorage = () => {
    try { return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null; }
    catch (e) { return null; }
  };

  function read() {
    try {
      if (hasHost()) return app.loadLocalStorage(STORE_KEY);
      const ls = webStorage();
      const text = ls ? ls.getItem(webKey()) : null;
      return text ? JSON.parse(text) : null;
    } catch (e) { return null; }
  }

  /* null removes. Obsidian's own wrapper swallows its errors, so a full disk
     looks like success from here — the caller reads it back to be sure. */
  function write(snapshot) {
    try {
      if (hasHost()) { app.saveLocalStorage(STORE_KEY, snapshot); return true; }
      const ls = webStorage();
      if (!ls) return false;
      if (snapshot) ls.setItem(webKey(), JSON.stringify(snapshot)); else ls.removeItem(webKey());
      return true;
    } catch (e) { return false; }
  }

  return {
    /* KEPT | EMPTY | LOST. An empty draft also CLEARS what was stored: this
       controller holds a draft with nothing in it, so an older stored one is
       not what it is showing. */
    save(draft, now) {
      const snap = snapshotDraft(draft, now);
      if (!snap) { write(null); return EMPTY; }
      if (!write(snap)) return LOST;
      /* The whole value, not just its stamp: two saves in one millisecond
         share a savedAt, and a failed second one must not read as kept. */
      return JSON.stringify(read()) === JSON.stringify(snap) ? KEPT : LOST;
    },
    clear() { return write(null); },
    load(now) { return restoreDraft(read(), now); },
  };
}

module.exports = { makeDraftStore, snapshotDraft, restoreDraft, STORE_KEY, STORE_VERSION, STALE_GAP_MS, KEPT, EMPTY, LOST };
