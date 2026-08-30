# Gym Vault

Plan your training, log every set, and track goals and body stats — all as
plain notes in your own vault. No account, no server, works offline on
desktop and mobile.

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

**Open it.** Click the dumbbell in the left ribbon, or run **Gym Vault: Open**
from the command palette.

**Set up.** On first run it offers to create starter files — example
exercises, a training plan, goals and a profile note. Nothing you already have
is overwritten, and you can re-run it any time from Settings → *Starter files*.

**Train.** *Today* shows what's scheduled. Tap **Start**, tick each set as you
finish it, and enter reps, weight, time or distance. Your session is saved to
`Gym/Workouts/` when you're done.

**Make it yours.** Everything is a note you can edit by hand. A plan is just
`## Day name (mon)` headings with `- Exercise | 4 x 8-12` lines underneath, so
the app and the editor always agree.

**Get plans from others.** *Plans → Browse* installs shared plans and any
exercises they need. Point it somewhere else under Settings → *Plan library*.

**See the change.** *Profile → Progress photos* takes a photo in a fixed
pose — standing, flexing, side on or back — and lays your previous photo over
the camera so you can line yourself up the same way each time. Drag the slider
to compare any two dates, or press play for a slow dissolve through all of
them. The photos are ordinary `.jpg` files in your vault.

**Worth turning on.** Settings → *Download images for offline*, so the
exercise library works with no connection. There's also an accent colour and
a second visual style.

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
them on for that export. The profile is exported as a fixed whitelist — a key
you added to your profile note yourself is never exported, because the plugin
cannot know it is safe to share.

**Camera and progress photos.** The camera is used only while the photo
screen is open, and the stream is released the moment you leave it. Photos are
written straight into your vault as ordinary `.jpg` files under
`Gym/Progress Photos/` and are never uploaded, never sent anywhere, and never
included in any export in any format — not even with every switch turned on.
Delete them like any other file. If your vault syncs, they sync with it, the
same as every other note; if that is not what you want, exclude that folder in
your sync settings.

## Data layout

Everything lives under one folder (default `Gym/`), all hand-editable:

```
Gym/
  Profile.md            # frontmatter: name, birth_year, height_cm, sex
  Body Log.md           # one markdown table, a row per measurement
                        # (only the table's lines are rewritten — headings and
                        #  prose you write around it are left alone)
  Exercises/<name>.md   # frontmatter: type, muscles, equipment, unit
                        # subfolders are read too, but the NAME must be unique:
                        # plans and goals refer to exercises by name
  Plans/<name>.md       # day sections + exercise lines (see above)
  Goals/<name>.md       # frontmatter: metric, exercise, target, deadline
  Workouts/<date> <day>.md  # frontmatter + a table of logged sets
  Progress Photos/<pose>/<date>.jpg   # the folder IS the record — no index note
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
