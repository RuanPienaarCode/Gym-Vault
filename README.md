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
  synced) or an https URL. Starter images are from
  [free-exercise-db](https://github.com/yuhonas/free-exercise-db)
  (public domain / Unlicense) and [wger.de](https://wger.de) (CC-BY-SA 4.0);
  see *Third-party material* below. Tap any image — on the exercise page or the
  thumbnail on the live set — to open it full screen: the frames large, an
  animation you can pause, and previous/next (or swipe). Settings →
  *Animate exercise images* (on by default) controls whether the start/finish
  frames play by themselves; off keeps them still and you can still step
  through them. Reduced motion always starts paused. Push-ups, the bodyweight
  squat and pull-ups also have an animated *muscle map* — see *Muscle map*
  below.
- **Plans** — weekly training plans as readable notes (`## Day (mon)` +
  `- Exercise | 4 x 8-12 @ 20kg`); one plan is *active* and drives the
  dashboard. The full format is under *Plan format* below.
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

**Open it.** Click the dumbbell in the left ribbon, or run **Open gym** from
the command palette (it appears as *Gym Vault: Open gym*).

**Set up.** On first run the app offers **Create my gym**. It writes an
*example* gym for you to edit or replace, all as notes under your Gym folder:

- a starter library of about 70 exercises (with demonstration images and some
  videos linked from the web — see *Privacy and network use*);
- the **Get Over The Bar** plan, a four-day pull-up and muscle-up programme.
  It is set as your active plan unless you already have a plan that drives
  Today, in which case yours stays in charge;
- a running plan, **Trail Base — Road to 15km**, with a 12-week long-run ladder
  starting from the Monday of the current week, and a **Rest & Recovery** plan
  that fills any weekday the others leave empty;
- ten goals (pull-ups, dips, muscle-ups, box jumps, a plank, pistol squats, a
  dead hang, two trail-run distances and workouts per week);
- a `Profile.md` with empty fields and a `Body Log.md` table.

Nothing you already have is overwritten, and you can re-run it any time from
Settings → *Starter files*. Delete anything you do not want; the plugin works
from whatever notes are there.

**Train.** *Today* shows what's scheduled. Tap **Start** and choose how you
want to be guided:

- **Reps** — one set at a time, at your pace. Tap to count reps, hold to time
  a plank, tick it off and move on.
- **Timed circuit** — say how long you have and the app builds a circuit to
  fit it, looping the day's exercises and counting each one down. Warm-up,
  cool-down, shuffled order and between-exercise transitions are switches on
  the same screen, and it tells you up front how many rounds you'll get.

On a phone, the **movement** button (the activity icon, under *Counter
settings* in a guided session) lets the sensor count reps for you, with taps
still working. The choice is remembered per exercise, in that exercise's note
as `motion_counting: true` (turning it off removes the line), so the next time
that exercise comes up, in any plan, counting starts on. The sensitivity you
pick is kept the same way, as `motion_sensitivity`. On iPhone the first grant
still comes from your tap on the button; if a remembered start can't begin
without one, the button stays off and says so.

**Count-back and sound.** Settings → *Count-back* chooses how a rep, a
countdown or a new record is announced: *Voice* (counted out loud), *My voice*
(your own recordings, below), *Beeps*, *Vibration* (Android only — iOS does not
allow it) or *Silent* (the count is still on screen).

**Pausing.** The hold timer, the rest countdown and the timed circuit's
interval each have a pause button; a pause freezes the clock exactly, and what
the screen stopped on is what the workout saves. Separately, a plan that runs
alongside your active plan or fills its empty days has a *Show on Today*
switch on its page: switch it off to pause that plan (it is kept, and writes
`paused: true` into its note) without deleting anything.

Either way the session is saved to `Gym/Workouts/` when you're done, and you
can switch to the plain log screen mid-session without losing a thing. Warm-up
and cool-down are guidance and are deliberately **not** logged — the plan note
stays the record of what the session actually was.

**Make it yours.** Everything is a note you can edit by hand. A plan is just
`## Day name (mon)` headings with `- Exercise | 4 x 8-12` lines underneath, so
the app and the editor always agree (see *Plan format*).

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

**Worth turning on.** Settings → *Download images for offline* (the *Download
images* button), so the exercise library works with no connection. There's
also an accent colour and four visual styles (Apex is the default; Lock In, a
black-and-one-hot-accent skin designed around the Blaze accent, Floor and
Editorial are also there).

## Plan format

A plan is a note in `Gym/Plans/`. The structure lives in the note body, so the
file reads naturally in Obsidian and the app and the editor always agree. An
invented example:

```
---
active: true
---
Four days a week. Anything written here, above the first day, is kept.

## Pull day (mon)

Rest about 90 seconds between hard sets.

- Pull-ups | 5 x submax
- Inverted Rows | 3 x 8-12 @ 20kg
Keep the elbows tucked on this one.
- Dead Hang | 2 x 30-45s
- Bench Press | 4 x 65% max

## Easy day (sat)

- Recovery Walk | 1 x 20 min easy
```

- **A day** is a `##` heading ending in a weekday in brackets: `(mon)` to
  `(sun)`. `(any)` is a wildcard that fills whatever weekday nothing else
  claims; it is meant for a *fallback* plan (below). A `##` heading with no
  weekday is not a day, so it folds into the day above it, and the Exercises
  page names it in a warning so a missing weekday doesn't go unnoticed.
- **An exercise line** is `- Name | sets x target`. The name should match an
  exercise note in `Gym/Exercises/`. The sets count is optional: `- Push-ups |
  12` means the default of 3 sets of 12. A bare `- Push-ups` is fine too.
  `* `, `+ ` and numbered (`1.` / `1)`) bullets also work, as long as the line
  has its `| prescription` (`1. Rows | 3 x 10`); without one, a starred or
  numbered line is read as a note, so a coach's numbered list stays prose.
  Hand-written shapes such as `3X8` and `4 sets of 10` are understood too.
- **Weight** is `@ 20kg` anywhere in the target (kilograms).
- **Time**: a target such as `30-45s`, `60 sec` or `2 min` makes a timed set.
  For a range the first number is used, and the unit is read (`2 min` is 120
  seconds).
- **Distance**: an exercise whose note has `unit: km` is logged by distance and
  time; its target (`1 x 5 km`) is shown as you wrote it.
- **Free text and percentages**: `submax` or `65% max` are kept and shown as
  written. They are notes to yourself, so the set counter counts without a
  target for them. A rep count at a load, such as `8 @ 75%`, is still eight
  reps.
- **Prose** between lines, under a day or above the first one, is kept exactly
  where you wrote it. An *indented* bullet is your own annotation on the line
  above, not an exercise.
- **Frontmatter**: `active: true` makes it the plan Today follows (*Make
  active* in the app clears the flag on your other plans). `paused: true`
  takes a plan that runs alongside, or fills gaps, off Today without deleting
  it; on any other plan it means nothing.

**A running plan** is an ordinary plan with three differences. It sets
`parallel: true`, so its days are added to Today alongside your active plan
instead of replacing it; its exercises have `unit: km`; and its frontmatter
carries the long-run ladder that the Running page reads:

```
---
parallel: true
ladder: [4, 5, 6, 5, 7, 8]   # kilometres for the weekend long run, week by week
start_date: 2026-01-05       # the Monday that week 1 begins
---
## Long Run (sat)

- Long Trail Run | 1 x per the ladder
```

A plan with `fallback: true` (the starter *Rest & Recovery*) does not compete
with the others: it fills any weekday they leave empty.

## Muscle map

Push-ups, the bodyweight squat (a side and a front view) and pull-ups have an
animated *muscle map* in place of their photos: the body moves through a rep and
the muscles doing the work heat up with the load. You see it on the exercise
page, on the live set, and in the full-screen viewer, where a **Muscle map /
Photos** button switches between the map and the photos.

- Settings → **Exercise visual**: *Basic* shows the working muscles;
  *Detailed* adds their names, the load and the steps from the note. The same
  switch is on the map itself.
- Settings → **Muscle map body**: which body is drawn, male or female.
- Settings → **Animate exercise images**: off keeps the map and the photo
  frames still (you can still step through them). Reduced motion always starts
  paused.
- **Opting in.** Those three exercises get a map by name. Any other exercise
  note can opt in with `motion:` in its frontmatter, set to `push-up`, `squat`
  or `pull-up`. A `motion:` value the app does not know gives no map.
- **Which muscles work.** The map lights the muscles from the note's `muscles:`
  that this movement uses as prime movers (`chest, triceps`, or a list). If none
  of them match, it shows the movement's own prime movers.

## Privacy and network use

Your training data never leaves your vault. There is no account, no
telemetry and no server of ours.

The plugin makes network requests, or lets the app load remote files, for these
reasons only, and to these hosts:

- **raw.githubusercontent.com**, for the plan library. *Plans → Browse* reads
  the library index, the plans you pick and the exercise notes they need from
  the repository set under Settings → *Plan library*. The default is
  `RuanPienaarCode/gym_plans`; point it at your own repository, or any https
  host that serves the same files, to change that (plain http is refused). Some starter exercise images
  also come from this host (the free-exercise-db project).
- **wger.de**, for some starter exercises' demonstration photos and videos
  (CC-BY-SA, credited in the exercise notes).
- **Anything else** an exercise note's `image:` / `video:` points to, if you
  or a downloaded plan set one.

Opening a starter exercise loads its online images and, if you play it, its
video. That is an ordinary web request, so the host sees your IP address and the
file you asked for. To stop that, use Settings → *Download images for offline*
(the *Download images* button): it fetches every remote image once, stores it
in `Gym/Attachments/` and points the notes at the local copies, so nothing is
fetched for images afterwards. Videos keep streaming because they are large.

The music button opens Spotify or Apple Music in a new window only when you tap
it, and the plugin does not itself send any request to either. The link you
chose is simply opened by your device. See *Music* below.

**Music.** Optional, off until you set it up. Settings → *Music app* adds a
button in guided sessions, and Settings → *Playlists* lets you save Spotify or
Apple Music share links to start from that button. Tapping it opens a link in
a new window — your music app if it's installed, that service's web player
otherwise. Nothing about your training is sent with it, no music service is
contacted unless you tap the button, and the plugin never reads what you are
playing. The share token Spotify appends to a copied link (`?si=…`) identifies
whoever shared it and is stripped from a link when you add it (a link saved
by an earlier version keeps it until you remove it and add it again).

**A session in progress.** Until you finish or discard it, the sets you have
logged are kept in Obsidian's local storage on that device only — not in your
vault and not synced — so closing the Gym tab, an app update or the phone
closing Obsidian in the background does not lose them; Today offers the
session back. Finishing writes it to your vault as a workout note and clears
the stored copy; discarding clears it too.

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
                        # (optional: image, video, motion, motion_counting,
                        #  motion_sensitivity)
                        # subfolders are read too, but the NAME must be unique:
                        # plans and goals refer to exercises by name
  Plans/<name>.md       # day sections + exercise lines (see above)
  Goals/<name>.md       # frontmatter: metric, exercise, target, deadline
  Workouts/<date> <day>.md  # frontmatter + a table of logged sets
  Attachments/<exercise>/   # exercise images saved by "Download images for offline"
  Exports/              # exports you save from the Export page (.md, .csv, .json)
  Progress Photos/<pose>/<date>.jpg   # the folder IS the record — no index note
  Voice/<cue>.wav       # your own recordings: count-5 … count-1, go, rep-1 … rep-30,
                        # target, record, goal — the filename is the cue
  Rewards.md            # the XP ledger: one table row per award, append-only
```

**Rewards (XP, levels, weekly quest, medals).** Finishing a session earns XP,
and XP builds levels, a weekly quest and medals. XP is counted forward from the
day the feature arrived — past workouts earn nothing. Every award is one line in
`Gym/Rewards.md` (`date | kind | key | xp | note`); your total and level are
simply the sum of those lines, and the weekly quest and the medals are worked
out from your plans and logged history, never stored. Each award has a stable
key, so paying the same one twice does nothing: a double tap on Finish, a retry,
or the same session finishing on two synced devices cannot pay twice. Lines are
only ever appended, so two devices merge by adding lines, and a hand-edited or
broken line is skipped without losing the others. Today shows your level, an
"From +N XP" chip (bonuses for a PB, a streak week or the quest pay on top) and the weekly quest; Session complete an XP card and any
medal unlocked; Records the medals; Profile your level and rank ladder. The
*Rewards* setting (on by default) turns it all off: nothing is awarded, shown
or written.

## Development

```
./build.sh            # bundle src/ → main.js, gate, test
./scripts/deploy.sh   # copy artifacts into the vault + sha256 proof
```

Both root `main.js` and root `styles.css` are **build output** — edit `src/`.
The bundle targets `safari15`: the real engine floor on Obsidian mobile. No
Node APIs, no `innerHTML`, no lookbehind regex literals anywhere in `src/`
(tests enforce this).

Where the rewards code lives: `src/rewards.js` holds the rules and
`src/rewards-ledger.js` the file format; vault reads and writes are
`io.readRewards` / `io.appendRewards` in `src/data.js`. `src/rewards-view.js`
is the words and figures (pure), `src/rewards-flow.js` the per-render ledger
cache, Session complete's preview and the one place awards are written (after
`page-log.finishSession` has saved the note, never throwing and never holding
the finish up), and `src/rewards-ui.js` the markup, which each skin draws in its
own register. Award keys look like `session:<workout file>`,
`week-streak:<week>` and `quest:<week>`.

## Third-party material

- **Fonts.** *Anton* (Vernon Adams) and *Barlow Condensed* (the Barlow Project
  Authors) are embedded in the stylesheet, under the SIL Open Font License 1.1.
- **Exercise images.** The starter exercises link demonstration images from
  [free-exercise-db](https://github.com/yuhonas/free-exercise-db), released
  under the Unlicense (public domain).
- **Exercise photos and videos.** Some starter exercises link media from
  [wger.de](https://wger.de), licensed CC-BY-SA 4.0. The exercise notes that
  use it credit the authors.

The full licence text for both fonts, and the attributions, are in
[NOTICE](NOTICE).

## License

AGPL-3.0-only.
