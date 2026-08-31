'use strict';
/* Shared constants. Pure — no DOM, no obsidian import. */

const VIEW_TYPE = 'gym-vault-view';

const DEFAULT_SETTINGS = {
  gymFolder: 'Gym',
  weekStart: 'mon',      // 'mon' | 'sun'
  openOnStartup: false,
  onboarded: false,
  skin: 'floor',         // keys of SKINS
  accent: 'lime',        // keys of ACCENTS
  musicApp: 'none',      // keys of MUSIC_APPS — 'none' hides the guided-view button
  /* How the app counts back at you. Keys of SOUND_MODES. The per-session
     mute button is NOT this: mute means "silence right now", this means
     "when you do make a noise, make THIS one". */
  soundMode: 'voice',    // keys of SOUND_MODES
  /* A voiceURI from speechSynthesis.getVoices(). '' means the device
     default. Stored per-vault but resolved per-device: the voices on a
     phone are not the voices on a desktop, so a URI that isn't installed
     here falls back to the default rather than going silent. */
  voiceURI: '',
  /* Saved music links: [{name, url}]. The url is a share link the user
     pasted; music-link.js parses it at open time (never trusts a stored
     scheme) and settings-tab refuses anything it cannot parse. */
  playlists: [],
  /* Last-used guided-session setup, so a regular taps straight through the
     setup screen. FLAT KEYS ON PURPOSE: loadSettings() is a shallow
     Object.assign over DEFAULT_SETTINGS, so a nested `guide` object saved by
     an older version would replace the default wholesale and every key added
     later would arrive undefined. Flat keys each fall back on their own. */
  guideMode: 'reps',       // 'reps' (set-by-set, the original) | 'timed' (interval circuit)
  guideMinutes: 30,
  guideWarmup: false,
  guideCooldown: false,
  guideShuffle: false,
  guideTransitions: true,
  /* Raw base of a plan library repo (see RuanPienaarCode/gym_plans). Any
     repo with the same shape — plans.json + plans/ + exercises/ — works. */
  planRepo: 'https://raw.githubusercontent.com/RuanPienaarCode/gym_plans/main',
};

/* How a guided session is played — [key, name, description]. Keys are what
   `guideMode` stores. Two genuinely different sessions, not a display
   preference: see page-session-setup.js. */
const GUIDE_MODES = [
  ['reps', 'Reps', 'One set at a time. You decide when each one is done.'],
  ['timed', 'Timed circuit', 'The clock runs the session. Hands free, eyes up.'],
];

/* The duration dial's range and step, in minutes. */
const GUIDE_MINUTES = { min: 5, max: 90, step: 5 };

/* Selectable styles. Each key maps to a gv-skin-<key> class on the app root;
   the skin blocks live at the END of src/styles.css so they win ties. */
const SKINS = [
  ['floor', 'Editorial Floor — one lime flood per screen, hard edges where you act'],
  ['editorial', 'Editorial — magazine cover: huge type, hairlines, no floods'],
];

/* Accent palettes. Each key maps to a gv-accent-<key> class that re-points
   the --gv-lime* tokens; the color values live ONLY in styles.css (one
   declaration per palette — never restate a hex here). */
const ACCENTS = [
  ['lime', 'Lime'],
  ['volt', 'Volt (yellow)'],
  ['blaze', 'Blaze (orange)'],
  ['electric', 'Electric (cyan)'],
  ['punch', 'Punch (magenta)'],
];

/* Music-app shortcut shown in guided sessions. Keys (besides 'none') must
   match src/music-link.js's MUSIC_LINKS — that module owns the actual
   scheme/https URLs, this is just the settings-dropdown label list. */
const MUSIC_APPS = [
  ['none', 'None'],
  ['spotify', 'Spotify'],
  ['apple-music', 'Apple Music'],
];

/* How a rep count, a countdown or a record is announced — [key, name,
   description]. Keys are what `soundMode` stores.

   Every one of these is a real capability question on the device, not a
   preference the app can simply honour: speech needs speechSynthesis, beeps
   need WebAudio, vibration needs navigator.vibrate (which iOS WebKit does
   NOT implement — it is Android-only in practice). sound.js owns the
   probing and the fallback; this list is only the vocabulary. */
const SOUND_MODES = [
  ['voice', 'Voice', 'Counts each rep out loud, and says when you break a record.'],
  ['beep', 'Beeps', 'A short tone per rep instead of a voice. Works where speech does not.'],
  ['vibrate', 'Vibration', 'A buzz per rep, nothing audible. Android only — iOS does not allow it.'],
  ['silent', 'Silent', 'No sound at all. The count is still on screen, and still read by a screen reader.'],
];

/* Weekday keys in plan headings — `## Pull Priority (mon)`. Order is the
   canonical mon-first order; startOfWeek() in dates.js handles the sun-start
   setting, this array never reorders. */
const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_LABELS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

/* The one column declaration per flat table (learned the hard way in the
   budget plugin: two figures derived by different rules is the recurring bug
   shape, and reordered columns silently corrupt every reader). APPEND-ONLY —
   never reorder, never rename a key. `label` is what lands in the markdown
   header row; `key` is what the code uses. */
const BODY_COLUMNS = [
  { key: 'date',        label: 'Date' },
  { key: 'weight_kg',   label: 'Weight (kg)' },
  { key: 'body_fat_pct', label: 'Body fat %' },
  { key: 'chest_cm',    label: 'Chest (cm)' },
  { key: 'waist_cm',    label: 'Waist (cm)' },
  { key: 'hips_cm',     label: 'Hips (cm)' },
  { key: 'arm_cm',      label: 'Arm (cm)' },
  { key: 'thigh_cm',    label: 'Thigh (cm)' },
  { key: 'resting_hr',  label: 'Resting HR' },
  { key: 'note',        label: 'Note' },
  /* Clinical markers from a health check (the "health stats" half of this
     app). APPENDED after `note` on purpose: the mapping is POSITIONAL, so
     inserting them mid-list would silently re-read every existing row's
     note column as a blood-pressure reading. Ugly order, correct data. */
  { key: 'bp_systolic',  label: 'Systolic (mmHg)' },
  { key: 'bp_diastolic', label: 'Diastolic (mmHg)' },
  { key: 'cholesterol',  label: 'Cholesterol (mmol/L)' },
  { key: 'glucose',      label: 'Glucose (mmol/L)' },
];

const WORKOUT_COLUMNS = [
  { key: 'exercise',  label: 'Exercise' },
  { key: 'set',       label: 'Set' },
  { key: 'reps',      label: 'Reps' },
  { key: 'weight_kg', label: 'Weight (kg)' },
  { key: 'seconds',   label: 'Time (s)' },
  { key: 'note',      label: 'Note' },
  /* Running. Appended (positional mapping — see BODY_COLUMNS note). */
  { key: 'distance_km', label: 'Distance (km)' },
];

/* Exercise kinds and goal metrics — closed vocabularies the UI renders
   pickers from. */
const EXERCISE_TYPES = ['strength', 'cardio', 'mobility', 'skill'];
const GOAL_METRICS = [
  'exercise-reps',      // best reps in a single set of `exercise`
  'exercise-duration',  // best seconds in a single set of `exercise`
  'exercise-weight',    // heaviest weight lifted in any set of `exercise`
  'exercise-distance',  // longest single distance of `exercise` (km)
  'body-weight',        // latest Body Log weight
  'workouts-per-week',  // sessions logged in the current week
];

const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'glutes', 'quads', 'hamstrings', 'calves', 'full body'];

module.exports = {
  VIEW_TYPE, DEFAULT_SETTINGS, WEEKDAYS, WEEKDAY_LABELS, SKINS, ACCENTS, MUSIC_APPS, SOUND_MODES,
  GUIDE_MODES, GUIDE_MINUTES,
  BODY_COLUMNS, WORKOUT_COLUMNS, EXERCISE_TYPES, GOAL_METRICS, MUSCLE_GROUPS,
};
