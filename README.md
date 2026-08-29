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

## Installation

### From the Community Plugins browser

Settings → **Community plugins** → **Browse** → search for **Gym Vault** →
**Install**, then **Enable**.

### Manually

1. Download `main.js`, `manifest.json` and `styles.css` from the
   [latest release](https://github.com/RuanPienaarCode/Gym-Vault/releases/latest).
2. Put all three in `<your vault>/.obsidian/plugins/gym-app/`.
3. Reload Obsidian, then enable **Gym Vault** under Settings → Community plugins.

### Beta versions (BRAT)

Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, then
**Add beta plugin** and enter `RuanPienaarCode/Gym-Vault` — the owner/repo
form, not the full URL.

Requires Obsidian 1.8.0 or newer. Works on desktop and on iOS/Android.

## Usage

**Getting started.** Open the gym with the dumbbell icon in the left ribbon,
or run **Gym Vault: Open** from the command palette. On first run the plugin
offers to create starter files — a folder of example exercises, a training
plan, some goals and a profile note. Nothing you already have is overwritten;
you can re-run it any time from Settings → **Starter files**.

**A normal session.** *Today* shows what the active plan has scheduled. Tap
**Start** to open the logging screen, tick sets as you complete them, and
enter reps, weight, time or distance as appropriate. The session is written
to `Gym/Workouts/` as a markdown table when you finish.

**Making it yours.** Add exercises from the *Exercises* tab, or write the
notes by hand — the plugin reads whatever is in the folder. Plans are just
notes with `## Day name (mon)` headings and `- Exercise | 4 x 8-12` lines,
so you can edit them in the app or in the editor and both stay in sync.

**Plans from others.** *Plans → Browse* fetches shared plans from a public
plan library and installs them, along with any exercises they reference. Point
it at a different repository under Settings → **Plan library**.

**Settings worth knowing.** Choose an accent colour and one of two visual
styles; set which folder the plugin uses; and use **Download images for
offline** so the exercise library works with no connection.

## Privacy and network use

Your training data never leaves your vault. There is no account, no
telemetry and no server.

The plugin touches the network only when you ask it to, and only for these:

- **Download images for offline** (Settings) fetches the demonstration images
  referenced by exercise notes.
- **Plans → Browse** fetches shared plans from the public plan library you
  have configured.
- Exercise notes may reference a remote image or video URL, which your vault
  loads when you open that exercise. Use the offline download to stop that.

**Clipboard.** The Export page's *Copy* button writes the export you are
looking at to the clipboard. The plugin never reads the clipboard.

**Exports.** Blood pressure, cholesterol and glucose are treated as clinical
markers and are left out of every export format unless you explicitly switch
them on for that export.

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
