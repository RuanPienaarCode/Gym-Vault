# Gym Vault

An Obsidian plugin that keeps your training as plain markdown files in your
own vault — no account, no server, works on desktop and iOS/Android.

- **Today** — what's on the plan today, week strip, streak, goal snapshot,
  one tap into a live workout-logging screen.
- **Exercises** — searchable library with muscle-group filters and your best
  set per exercise. Each exercise opens a detail page: how-to steps (the note
  body, rendered as markdown), an image or video, your bests and recent sets.
  Media comes from `image:` / `video:` frontmatter — a vault path (offline,
  synced) or an https URL. Seed images are from
  [free-exercise-db](https://github.com/yuhonas/free-exercise-db)
  (public domain / Unlicense).
- **Plans** — weekly training plans as readable notes (`## Day (mon)` +
  `- Exercise | 4 x 8-12 @ 20kg`); one plan is *active* and drives the
  dashboard.
- **Goals** — targets measured from real logged data (best reps, best hold,
  heaviest weight, body weight, workouts per week).
- **History** — activity heatmap and every logged session.
- **Profile** — who's training, body stats log, weight trend, BMI.

## Data layout

Everything lives under one folder (default `Gym/`), all hand-editable:

```
Gym/
  Profile.md            # frontmatter: name, birth_year, height_cm, sex
  Body Log.md           # one markdown table, a row per measurement
                        # (plugin-owned: prose written around this table is
                        #  replaced on the next logged measurement)
  Exercises/<name>.md   # frontmatter: type, muscles, equipment, unit
  Plans/<name>.md       # day sections + exercise lines (see above)
  Goals/<name>.md       # frontmatter: metric, exercise, target, deadline
  Workouts/<date> <day>.md  # frontmatter + a table of logged sets
```

## Development

```
./build.sh            # bundle src/ → main.js, gate, test
./scripts/deploy.sh   # copy artifacts into the vault + sha256 proof
```

Both root `main.js` and root `styles.css` are **build output** — edit `src/`.
The bundle targets `safari15`: the real engine floor on Obsidian mobile. No
Node APIs, no `innerHTML`, no lookbehind regex literals anywhere in `src/`
(tests enforce this).

## License

AGPL-3.0-only.
