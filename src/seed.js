'use strict';
/* First-run starter files. Pure data — no DOM, no obsidian import.

   Seeded from Ruan's real "Get Over The Bar" program (at-home strength,
   4 days/week, one hard goal — the muscle-up) rather than a generic library,
   so the plugin is useful the moment it's set up. Every file here is written
   with writeIfAbsent: a re-run never overwrites real data. */

/* Demonstration media, two open sources:
     - yuhonas/free-exercise-db (Unlicense — public domain): start/finish
       photo pairs. Only true movement matches; where the nearest match is a
       variant (parallel-bar dips, kettlebell pistol) the note body says so.
     - wger.de (CC-BY-SA 4.0): extra photos and the only open exercise
       VIDEOS around (by Goulart). Attribution lives in the note bodies and
       in NOTICE; the media streams from wger.de when online.
   URLs load when online and the detail page degrades quietly offline.
   isSeedMediaUrl() below is the refresh gate — keep it covering every host
   used here. */
const IMG = id => [0, 1].map(n => `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${id}/${n}.jpg`);
const WGER = p => `https://wger.de/media/${p}`;

/* True when a media URL is one the SEED wrote (vs. something the user set
   themselves) — the only values a starter-media refresh may overwrite. */
const isSeedMediaUrl = u => /^https:\/\/(raw\.githubusercontent\.com\/yuhonas\/free-exercise-db\/|wger\.de\/media\/)/.test((u || '').toString());

const SEED_EXERCISES = [
  { name: 'Pull-ups', type: 'strength', muscles: ['back', 'biceps', 'forearms'], equipment: 'bar', unit: 'reps',
    image: [...IMG('Pullups'), WGER('exercise-images/475/b0554016-16fd-4dbe-be47-a2a17d16ae0e.jpg')],
    video: WGER('exercise-video/475/83067ffe-ccb9-4e22-8507-5131b211ce74.MOV'),
    note: [
      '1. Grab the bar just outside shoulder width, palms away, arms fully extended.',
      '2. Pull the shoulder blades down first, then drive the elbows to your ribs until your chin clears the bar.',
      '3. Lower under control to a full hang every rep.',
      '',
      '**Cue:** stop 1–2 reps before failure every set — quality volume, not grinding. Half of the muscle-up.',
      '',
      'Photo 3: Imobard · video: Goulart — both via wger.de, CC-BY-SA 4.0.',
    ].join('\n') },
  { name: 'Explosive High Pull-ups', type: 'strength', muscles: ['back', 'biceps'], equipment: 'bar', unit: 'reps',
    note: [
      '1. Set up like a normal pull-up, but pull as FAST as you can.',
      '2. Aim chest — then belly — toward the bar; let the elbows drive down and back.',
      '3. Reset fully between reps; speed is the point, not reps.',
      '',
      '**Cue:** trains the "pop" that carries you over the bar in a muscle-up.',
    ].join('\n') },
  { name: 'Inverted Rows', type: 'strength', muscles: ['back', 'shoulders'], equipment: 'bar', unit: 'reps',
    image: IMG('Inverted_Row'),
    note: [
      '1. Set a bar around hip height; hang under it, heels on the floor, body straight as a plank.',
      '2. Pull your chest to the bar, squeezing the shoulder blades together.',
      '3. Lower slowly; don\'t let the hips sag. Walk feet further forward to make it harder.',
      '',
      '**Cue:** shoulder-health insurance — keep rows in even when time is tight.',
    ].join('\n') },
  { name: 'Straight-bar Dips', type: 'strength', muscles: ['chest', 'triceps', 'shoulders'], equipment: 'bar', unit: 'reps',
    image: IMG('Parallel_Bar_Dip'),
    video: WGER('exercise-video/194/d039ec90-474d-47a9-a3ad-bf0b00828c82.MP4'),
    note: [
      '1. Support yourself on top of a single straight bar, hands just outside your hips, arms locked.',
      '2. Lean slightly forward and bend the elbows until the bar reaches your lower chest / upper abs.',
      '3. Press back to a FULL lockout at the top.',
      '',
      '**Cue:** the other half of the muscle-up — the top-out is exactly this position.',
      '',
      'Media shows PARALLEL-BAR dips — same press pattern; on a straight bar both hands sit in front of you and the lean is stronger. Video: Goulart via wger.de, CC-BY-SA 4.0.',
    ].join('\n') },
  { name: 'Push-ups', type: 'strength', muscles: ['chest', 'triceps', 'core'], equipment: 'bodyweight', unit: 'reps',
    image: IMG('Pushups'),
    note: [
      '1. Hands under the shoulders, body one straight line from head to heels.',
      '2. Lower until the chest nearly touches the floor, elbows ~45° from the body.',
      '3. Press up to full lockout without the hips sagging or piking.',
      '',
      '**Cue:** elevate hands on the box if full push-ups are tough.',
    ].join('\n') },
  { name: 'Box Jumps', type: 'strength', muscles: ['quads', 'glutes', 'calves'], equipment: 'box', unit: 'reps',
    image: IMG('Front_Box_Jump'),
    note: [
      '1. Stand a short step from the box, feet hip width.',
      '2. Dip, swing the arms, and jump; land SOFT and quiet with both feet fully on the box.',
      '3. Stand tall on top — then STEP down every rep. Never jump down.',
      '',
      '**Cue:** landings over height, always. Jumping down repeatedly is the #1 injury risk.',
    ].join('\n') },
  { name: 'Dead Hang', type: 'skill', muscles: ['forearms', 'shoulders'], equipment: 'bar', unit: 'seconds',
    note: [
      '1. Grab the bar palms away, hands shoulder width.',
      '2. Hang with arms straight; let the shoulders decompress but keep them "plugged in" (not shrugged into your ears).',
      '3. Breathe. Time the hold.',
      '',
      '**Cue:** grip + shoulder decompression — prehab gold at 40.',
    ].join('\n') },
  { name: 'Plank', type: 'skill', muscles: ['core'], equipment: 'bodyweight', unit: 'seconds',
    image: IMG('Plank'),
    note: [
      '1. Forearms on the floor, elbows under shoulders, feet together.',
      '2. Squeeze glutes and brace the abs so the body is one rigid line.',
      '3. Hold. The set ends when the hips sag or pike — not when the timer says so.',
      '',
      '**Cue:** flat back, hips don\'t sag. Sub in side planks now and then.',
    ].join('\n') },
  { name: 'Romanian Deadlift', type: 'strength', muscles: ['hamstrings', 'glutes', 'back'], equipment: 'dumbbells', unit: 'kg',
    image: IMG('Romanian_Deadlift'),
    video: WGER('exercise-video/507/307e7276-a14d-4ea0-b579-f5b0dbc6f5af.MOV'),
    note: [
      '1. Stand tall holding dumbbells in front of the thighs, soft knees.',
      '2. Push the hips BACK, sliding the weights down the legs, chest proud, back flat.',
      '3. Feel the hamstrings load around mid-shin, then drive the hips forward to stand.',
      '',
      '**Cue:** two-leg first, progress to single-leg. The posterior-chain work your back and jumps need.',
      '',
      'Video: Goulart via wger.de, CC-BY-SA 4.0.',
    ].join('\n') },
  { name: 'Bulgarian Split Squat', type: 'strength', muscles: ['quads', 'glutes'], equipment: 'dumbbells', unit: 'kg',
    note: [
      '1. Rear foot up on the box behind you, front foot far enough forward that the knee tracks over the toes.',
      '2. Lower straight down until the front thigh is about parallel.',
      '3. Drive through the front heel to stand.',
      '',
      '**Cue:** add weight when 8 feels easy. Builds the single-leg strength that leads to the pistol.',
    ].join('\n') },
  { name: 'Pistol Squat Progression', type: 'skill', muscles: ['quads', 'glutes', 'core'], equipment: 'bodyweight', unit: 'reps',
    image: IMG('Kettlebell_Pistol_Squat'),
    note: [
      '1. Stand on one leg, the other held straight in front.',
      '2. Sit back and down as far as your current progression allows — to a box at first.',
      '3. Stand without touching the free leg down.',
      '',
      '**Progression:** sit to a box → lower surface → full pistol. Superset with split squats early on.',
      '',
      'Photos show the kettlebell version — the counterweight actually makes it EASIER; same pattern without it.',
    ].join('\n') },
  { name: 'Toes-to-bar Ladder', type: 'skill', muscles: ['core', 'forearms'], equipment: 'bar', unit: 'reps',
    image: IMG('Hanging_Leg_Raise'),
    note: [
      '1. Hang from the bar, shoulders engaged, body still.',
      '2. Work the first rung you can\'t cheat: knee raise → straight-leg raise → toes to the bar.',
      '3. Lower SLOWLY — no swinging, no kipping.',
      '',
      '**Cue:** builds the hollow-body tension a muscle-up needs. (Image shows the leg-raise rung.)',
    ].join('\n') },
  { name: 'L-sit / Dragon Flag', type: 'skill', muscles: ['core'], equipment: 'bodyweight', unit: 'seconds',
    note: [
      '1. L-sit: hands on the floor or two dumbbells, press down and lift both straight legs to horizontal. Hold.',
      '2. Dragon flag: lie back gripping a bench behind your head; lower the whole rigid body from vertical as slowly as possible.',
      '',
      '**Cue:** add only once toes-to-bar is solid. These are earned, not rushed.',
    ].join('\n') },
  { name: 'Muscle-ups', type: 'skill', muscles: ['back', 'chest', 'triceps', 'core'], equipment: 'bar', unit: 'reps',
    image: IMG('Muscle_Up'),
    note: [
      '1. False grip helps: wrists over the bar, not knuckles.',
      '2. Pull explosively high (chest to bar and past it) while leaning back, then drive the chest OVER the bar.',
      '3. The transition: elbows from below the bar to above it in one motion — then press out to a straight-bar dip lockout.',
      '',
      '**The mission.** Unlocks as skill work at 8–10 clean pull-ups AND 8–10 clean dips: band-assisted reps + slow negatives first.',
    ].join('\n') },
];

const SEED_PLAN = {
  name: 'Get Over The Bar',
  fm: { active: true },
  body: [
    'At-home strength, four days a week, ~30 minutes a session. One hard goal — the',
    'muscle-up — with rows for shoulder health, a full leg & core day, and mobility',
    'built into every warm-up.',
    '',
    'Warm-up before every session (~5 min, non-negotiable): shoulder rolls + big arm',
    'circles, 2×5 scapular pull-ups, a mobility minute (thoracic rotations, deep',
    'squat holds, wrist circles), 15 band pull-aparts, 10 easy box step-ups, 20s',
    'hollow hold. On jump days add 5 easy non-max jumps.',
    '',
    '## A · Pull Priority (mon)',
    '',
    'Strength for the muscle-up. Rest ~90s between hard sets; stop 1–2 reps before failure.',
    '',
    '- Pull-ups | 5 x submax',
    '- Explosive High Pull-ups | 4 x 3',
    '- Inverted Rows | 3 x 8-12',
    '- Straight-bar Dips | 3 x 5-8',
    '- Box Jumps | 4 x 8-10',
    '- Dead Hang | 2 x 30-45s',
    '',
    '## B · Push + Volume (wed)',
    '',
    'The other half of the muscle-up — dips lead today. Clean reps, leave 2 in the tank.',
    '',
    '- Straight-bar Dips | 5 x submax',
    '- Pull-ups | 4 x submax',
    '- Push-ups | 3 x 10-15',
    '- Inverted Rows | 3 x 8-12',
    '- Plank | 3 x 65% max',
    '',
    '## C · Legs, Hinge & Core (fri)',
    '',
    'Strength + skill, on its own track. Superset a leg move with a core move to stay inside 30 minutes.',
    '',
    '- Romanian Deadlift | 3 x 8-10',
    '- Bulgarian Split Squat | 3 x 8/leg',
    '- Pistol Squat Progression | 3 x 3-5/leg',
    '- Toes-to-bar Ladder | 4 x 6-10',
    '- L-sit / Dragon Flag | 3 x holds',
    '',
    '## A* · Pull Priority (sat)',
    '',
    'Repeat of Day A, slightly lighter if Monday was hard.',
    '',
    '- Pull-ups | 5 x submax',
    '- Explosive High Pull-ups | 4 x 3',
    '- Inverted Rows | 3 x 8-12',
    '- Straight-bar Dips | 3 x 5-8',
    '- Box Jumps | 4 x 8-10',
    '- Dead Hang | 2 x 30-45s',
  ].join('\n') + '\n',
};

const SEED_GOALS = [
  { name: '10 Pull-ups', fm: { metric: 'exercise-reps', exercise: 'Pull-ups', target: 10, direction: 'increase' },
    note: 'The first gateway — muscle-up skill work unlocks at 8–10 clean pull-ups (with the dip gateway).' },
  { name: '10 Straight-bar Dips', fm: { metric: 'exercise-reps', exercise: 'Straight-bar Dips', target: 10, direction: 'increase' },
    note: 'The other gateway. Hit both and Phase 2 (muscle-up skill work) opens.' },
  { name: '10 Muscle-ups', fm: { metric: 'exercise-reps', exercise: 'Muscle-ups', target: 10, direction: 'increase' },
    note: 'The mission. A year-plus goal — patience is the plan. First rep → ten reps, consistency beats intensity.' },
  { name: '50 Box Jumps', fm: { metric: 'exercise-reps', exercise: 'Box Jumps', target: 50, direction: 'increase' },
    note: 'Add 2–4 reps a week. Landings over height, always; step down every rep.' },
  { name: '6-minute Plank', fm: { metric: 'exercise-duration', exercise: 'Plank', target: 360, direction: 'increase' },
    note: 'Add 10–15s a week, test max monthly.' },
  { name: '5 Pistol Squats per Leg', fm: { metric: 'exercise-reps', exercise: 'Pistol Squat Progression', target: 5, direction: 'increase' },
    note: 'Shrink the assistance: lower box → no box. Gated mostly by ankle/hip mobility.' },
  { name: '45s Dead Hang', fm: { metric: 'exercise-duration', exercise: 'Dead Hang', target: 45, direction: 'increase' },
    note: 'Grip + shoulder prehab.' },
  { name: '4 Workouts a Week', fm: { metric: 'workouts-per-week', target: 4, direction: 'increase' },
    note: 'A, B, C and the Saturday repeat. Recovery is the real ceiling — if progress stalls, cut volume, don\'t add days.' },
];

const SEED_PROFILE = {
  fm: { name: '', birth_year: '', height_cm: '', sex: '' },
  body: [
    'Training context: an athlete's age and build — longer levers mean more range to travel, and',
    'tendons adapt slower than muscle, so explosive work ramps gradually.',
    '',
    'Watch-outs: your own injury history. Sharp joint pain',
    '(shoulder, elbow, wrist, knee) = stop that exercise. Muscle burn is fine;',
    'joint pain is a warning. Sleep and food are half the program.',
  ].join('\n') + '\n',
};

module.exports = { SEED_EXERCISES, SEED_PLAN, SEED_GOALS, SEED_PROFILE, isSeedMediaUrl };
