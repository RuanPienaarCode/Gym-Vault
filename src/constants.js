'use strict';
/* Shared constants. Pure — no DOM, no obsidian import. */

const VIEW_TYPE = 'gym-vault-view';

const DEFAULT_SETTINGS = {
  gymFolder: 'Gym',
  weekStart: 'mon',      // 'mon' | 'sun'
  openOnStartup: false,
  onboarded: false,
};

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
  VIEW_TYPE, DEFAULT_SETTINGS, WEEKDAYS, WEEKDAY_LABELS,
  BODY_COLUMNS, WORKOUT_COLUMNS, EXERCISE_TYPES, GOAL_METRICS, MUSCLE_GROUPS,
};
