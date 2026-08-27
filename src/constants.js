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
};

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
];

/* Exercise kinds and goal metrics — closed vocabularies the UI renders
   pickers from. */
const EXERCISE_TYPES = ['strength', 'cardio', 'mobility', 'skill'];
const GOAL_METRICS = [
  'exercise-reps',      // best reps in a single set of `exercise`
  'exercise-duration',  // best seconds in a single set of `exercise`
  'exercise-weight',    // heaviest weight lifted in any set of `exercise`
  'body-weight',        // latest Body Log weight
  'workouts-per-week',  // sessions logged in the current week
];

const MUSCLE_GROUPS = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'glutes', 'quads', 'hamstrings', 'calves', 'full body'];

module.exports = {
  VIEW_TYPE, DEFAULT_SETTINGS, WEEKDAYS, WEEKDAY_LABELS, SKINS, ACCENTS,
  BODY_COLUMNS, WORKOUT_COLUMNS, EXERCISE_TYPES, GOAL_METRICS, MUSCLE_GROUPS,
};
