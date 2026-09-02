# Gym Vault

Plan your training, log every set, and track goals and body stats — all as
plain notes in your own vault. No account, no server, works offline on
desktop and mobile.

- **Today** — what's on the plan today, week strip, streak, goal snapshot,
  one tap into a live workout-logging screen.
- **Guided sessions** — pick *reps* (one set at a time, you set the pace) or a
  *timed circuit* that runs the session on the clock for however long you
  have, with an optional warm-up, cool-down, shuffled order, "next up"
  transitions and a spoken countdown into each interval. Both write to the
  same session, so you can drop to the plain log screen and back without
  losing anything. Every plan and day also shows the equipment it needs.
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
- **History** — activity heatmap and every logged session, plus a Records
  page of every personal best.
- **Running** — the week's runs from your running plan, the long-run ladder,
  and a Running records page of its own: longest run, best pace over 1, 5,
  10, 15 and 21.1 km+, longest time on feet, biggest week, and every time
  the longest run moved. A pace is always one run's own time over its own
  distance.
- **Profile** — who's training, body stats log, weight trend, BMI, progress
  photos, and *Your voice*: record the count-in, the rep counts and the
  celebrations in your own voice.

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

**Train.** *Today* shows what's scheduled. Tap **Start** and choose how you
want to be guided:

- **Reps** — one set at a time, at your pace. Tap to count reps, hold to time
  a plank, tick it off and move on.
- **Timed circuit** — say how long you have and the app builds a circuit to
  fit it, looping the day's exercises and counting each one down. Warm-up,
  cool-down, shuffled order and between-exercise transitions are switches on
  the same screen, and it tells you up front how many rounds you'll get.

Either way the session is saved to `Gym/Workouts/` when you're done, and you
can switch to the plain log screen mid-session without losing a thing. Warm-up
and cool-down are guidance and are deliberately **not** logged — the plan note
stays the record of what the session actually was.

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

**Count yourself in.** Settings → *Count-back* → **My voice**, then *Open
the recorder* (or Profile → *Your voice*, or the command *Record your own
count-in*). The recorder walks you through the list — five, four, three,
two, one, Begin, each rep number to thirty, target reached, new record,
goal met — one clip at a time: say the word, hear it back, keep it or go
again. Anything you have not recorded is spoken by the device voice, per
word, so a gap is never silence. Exercise names in a timed circuit always
stay in the device voice.

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
- **The music button** in a guided session opens Spotify or Apple Music in a
  new window — only when you tap it, and only to the app or playlist you
  chose yourself. See *Music* below.

**Music.** Optional, off until you set it up. Settings → *Music app* adds a
button in guided sessions, and Settings → *Playlists* lets you save Spotify or
Apple Music share links to start from that button. Tapping it opens a link in
a new window — your music app if it's installed, that service's web player
otherwise. Nothing about your training is sent with it, no music service is
contacted unless you tap the button, and the plugin never reads what you are
playing. The share token Spotify appends to a copied link (`?si=…`) identifies
whoever shared it and is stripped before the link is saved.

**Clipboard.** The Export page's *Copy* button writes the export you are
looking at to the clipboard. The plugin never reads the clipboard.

**Microphone.** Used only while you are on the *Your voice* page and only
between your tap on *Record* and your tap on *Stop* (or a three-second cap);
the microphone is released the moment a take ends or you leave the page.
Each take is trimmed, levelled and written as a plain `.wav` file under
`Gym/Voice/` — never uploaded, never exported, and playable on every device
the vault syncs to. Delete them like any other file.

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
  Voice/<cue>.wav       # your own recordings: count-5 … count-1, go, rep-1 … rep-30,
                        # target, record, goal — the filename is the cue
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
