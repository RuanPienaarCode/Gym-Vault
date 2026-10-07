'use strict';
/* Vault IO — every read and write of the Gym folder goes through here.

   Uses the Vault API only (works on desktop and iOS; no Node APIs anywhere in
   src/). Writes are recorded per PATH in plugin._ownWrites (and stamped on
   plugin._lastWrite) so the controller's vault watcher can tell our own
   writes from the user's edits and skip a pointless reload storm without also
   swallowing a real edit to a DIFFERENT note. Note BODIES the user may have
   edited are never rebuilt except where the body IS the plugin's own structure
   (plan day lists, the two flat tables) — and even then prose lines
   round-trip verbatim via plan-parse. A save is applied to the file's CURRENT
   text (vault.process), never to the copy loaded at the last reload. */

const { normalizePath, TFile, TFolder, requestUrl, Notice } = require('obsidian');
const { parseFrontmatter, serializeFrontmatter, tableToObjects, buildMdTable, replaceFirstTable, tableHeaderLabels } = require('./markdown');
const { parsePlanBody, serializePlanBody } = require('./plan-parse');
const { BODY_COLUMNS, WORKOUT_COLUMNS } = require('./constants');
const { SEED_EXERCISES, SEED_PLAN, SEED_RUN_PLAN, SEED_REST_PLAN, SEED_GOALS, SEED_PROFILE, isSeedMediaUrl } = require('./seed');
const { photosRoot, poseFolder, photoPath, parsePhotoPath, IMAGE_EXT } = require('./progress-photos');
const { clipFileName, keyFromFileName } = require('./voice-pack');
const { workoutDate, sameName } = require('./stats');

/* Windows/OSX-illegal filename characters, folded to '-' so an exercise or
   plan named from user input always lands on disk. */
/* Cap at 200 chars: the filesystem limit is 255 BYTES, and a longer name
   made v.create throw a raw adapter error at the user. The '-' fallback
   keeps an all-punctuation name from producing `Gym/Exercises/.md`, an
   invisible dotfile. */
const safeName = s => {
  const cleaned = (s || '').toString().replace(/[\\/:*?"<>|#^\[\]]/g, '-').replace(/\s+/g, ' ').trim();
  return cleaned.slice(0, 200).trim() || '-';
};

/* ---- what the app last knew about a note ---------------------------------

   A save must change what the APP changed and nothing else: the file may have
   been edited elsewhere since the last reload (another device over iCloud, an
   editor pane), and writing the loaded copy back erases that. So loadAll()
   records, on each frontmatter object, the values it parsed (and the body, or
   for a plan the whole text). A save compares the record against that baseline
   to find the keys the app touched, and applies only those to the file's
   current text.

   The baseline rides on the fm object under a Symbol, the way markdown.js's
   layout does: spread (`{ ...ex.fm, type }`, which every Edit form does)
   copies enumerable symbols, so it survives the record's fm being replaced;
   Object.entries / JSON.stringify never see it. */
const FM_BASE = Symbol.for('gv.fmBase');

/* "Empty" is what serializeFrontmatter drops, so an absent key, '' and [] are
   one state; scalars compare as text ('60' from a file equals 60 from a form). */
const isBlank = x => x === null || x === undefined || x === '' || (Array.isArray(x) && x.length === 0);
const comparable = x => (isBlank(x) ? '' : Array.isArray(x) ? JSON.stringify(x.map(String)) : String(x));

function rememberLoaded(fm, body, text) {
  const vals = {};
  for (const k of Object.keys(fm)) vals[k] = Array.isArray(fm[k]) ? fm[k].slice() : fm[k];
  Object.defineProperty(fm, FM_BASE, { value: { vals, body, text }, enumerable: true, writable: true, configurable: true });
}

/* The current file's frontmatter with only the app's changes laid over it. A
   key the app changed wins over an outside edit of that same key (the user
   just did it on purpose); every other key — and the file's own key order and
   unmodelled lines — is the file's. With no baseline (a record the app built
   itself) every non-empty key is the app's. */
function mergeFrontmatter(currentFm, fm) {
  const base = (fm && fm[FM_BASE]) || null;
  const before = base ? base.vals : {};
  const next = { ...currentFm };
  const keys = new Set([...Object.keys(before), ...Object.keys(fm)]);
  for (const k of keys) {
    if (comparable(before[k]) === comparable(fm[k])) continue;
    if (isBlank(fm[k])) delete next[k]; else next[k] = fm[k];
  }
  return next;
}

/* Exercises a plan line or an exercise goal names that have no exercise note —
   what renaming a note in Obsidian leaves behind. Compared with sameName, the
   one name rule. Returns [{ name, plans: [plan names], goals: [goal names] }],
   in the order first met. */
function findMissingExercises(data) {
  const found = [];
  const note = (raw, kind, owner) => {
    const name = String(raw === null || raw === undefined ? '' : raw).trim();
    if (!name || data.exercises.some(e => sameName(e.name, name))) return;
    let entry = found.find(m => sameName(m.name, name));
    if (!entry) { entry = { name, plans: [], goals: [] }; found.push(entry); }
    if (entry[kind].indexOf(owner) < 0) entry[kind].push(owner);
  };
  for (const p of data.plans) for (const d of p.model.days) for (const it of d.items) note(it.exercise, 'plans', p.name);
  /* Only goals that MEASURE an exercise (the rule stats.goalIssue uses): a
     leftover `exercise:` on a workouts-per-week goal is read by nothing. */
  for (const g of data.goals) if (/^exercise-/.test(g.fm.metric || '')) note(g.fm.exercise, 'goals', g.name);
  return found;
}

function makeIo(plugin) {
  const app = plugin.app;
  const v = app.vault;

  const root = () => normalizePath(plugin.settings.gymFolder || 'Gym');
  const paths = {
    root,
    exercises: () => `${root()}/Exercises`,
    plans: () => `${root()}/Plans`,
    workouts: () => `${root()}/Workouts`,
    goals: () => `${root()}/Goals`,
    profile: () => `${root()}/Profile.md`,
    bodyLog: () => `${root()}/Body Log.md`,
    attachments: () => `${root()}/Attachments`,
    exports: () => `${root()}/Exports`,
    voice: () => `${root()}/Voice`,
  };

  /* Record a write of `path`. The watcher (controller.js) skips a vault event
     only for a path that has an own-write within the last 1.5 s, so an outside
     edit to some OTHER note in that window is no longer dropped. _lastWrite
     stays for the watcher's fallback when no per-path map exists. */
  const stamp = path => {
    const now = Date.now();
    plugin._lastWrite = now;
    if (!path) return;
    const own = plugin._ownWrites || (plugin._ownWrites = new Map());
    own.set(path, now);
    if (own.size > 200) for (const [k, t] of own) if (now - t > 10000) own.delete(k);
  };

  /* Stamp before the write (the vault event can fire before its promise
     resolves) AND after it (a slow iCloud write must not outlive the window). */
  const tracked = async (path, write) => {
    stamp(path);
    const out = await write();
    stamp(path);
    return out;
  };

  /* One save at a time per path. A save compares the file's current text with
     what the app last knew, and records what it wrote as the new baseline —
     two overlapping saves of one note would see each other's write as an
     outside edit. The tail never rejects, so one failed save does not wedge
     the queue. */
  const queues = new Map();
  function exclusive(path, work) {
    const run = (queues.get(path) || Promise.resolve()).then(work);
    const tail = run.catch(() => {});
    queues.set(path, tail);
    tail.then(() => { if (queues.get(path) === tail) queues.delete(path); });
    return run;
  }

  const tell = msg => {
    try { new Notice(`Gym: ${msg}`, 8000); } catch (e) { /* no host Notice (headless tests) */ }
  };

  /* Apply `change(currentText)` to the file's CURRENT text on disk
     (vault.process), never to a copy read earlier. `change` returns the new
     text, or null to leave the file alone. Never creates: a note deleted
     outside the app resolves { gone: true } instead of coming back from the
     dead (a path that vanishes between the lookup and the write rejects out of
     process() and is read the same way). */
  async function applyToFile(path, change) {
    const f = path ? v.getFileByPath(path) : null;
    if (!f) return { gone: true };
    let text = null;
    try {
      await tracked(path, () => v.process(f, current => {
        text = change(current);
        return text === null ? current : text;
      }));
    } catch (e) {
      if (!v.getFileByPath(path)) return { gone: true };
      throw e;
    }
    return { gone: false, text };
  }

  async function ensureFolder(path) {
    if (v.getFolderByPath(path)) return;
    try { stamp(path); await v.createFolder(path); }
    catch (e) { if (!v.getFolderByPath(path)) throw e; } // swallow create races
  }

  async function writeIfAbsent(path, content) {
    if (v.getFileByPath(path)) return false;
    /* macOS and iOS are case-INsensitive: `bench press.md` and
       `Bench Press.md` are one file on disk, but getFileByPath is an exact
       -key map lookup and misses the clash. Without this, adding an exercise
       whose name differs only in case from a hand-written note replaced that
       note's body with a bare stub, and the "already exists" warning never
       fired. Compare against the folder's children, folded. */
    const slash = path.lastIndexOf('/');
    const dir = slash > 0 ? v.getFolderByPath(path.slice(0, slash)) : null;
    if (dir && (dir.children || []).some(c => (c.path || '').toLowerCase() === path.toLowerCase())) return false;
    await tracked(path, () => v.create(path, content));
    return true;
  }

  /* Overwrite-or-create for files the plugin owns structurally. */
  async function writeFile(path, content) {
    const f = v.getFileByPath(path);
    await tracked(path, () => (f ? v.modify(f, content) : v.create(path, content)));
  }

  async function readNotesIn(folderPath) {
    const folder = v.getFolderByPath(folderPath);
    if (!folder) return [];
    const out = [];
    const walk = f => {
      for (const child of f.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === 'md') out.push(child);
      }
    };
    walk(folder);
    out.sort((a, b) => a.basename.localeCompare(b.basename));
    return out;
  }

  /* ---- load everything ------------------------------------------------ */

  async function loadAll() {
    const data = { profile: { fm: {}, body: '' }, body: [], exercises: [], plans: [], goals: [], workouts: [], present: false, unreadable: 0, unreadablePaths: [], duplicateExercises: [], missingExercises: [], rootExists: false };
    /* Mid-index (a fresh device, a big iCloud sync) an individual read can
       fail while the rest are fine. Skipping the file that failed and
       counting it beats losing the entire load to one bad read. */
    const read = async f => {
      try { return await v.cachedRead(f); }
      /* Record WHICH file failed, not just how many: "3 files could not be
         read" gives the user nothing to act on. */
      catch (e) { data.unreadable++; data.unreadablePaths.push(f.path); return null; }
    };
    data.rootExists = !!v.getFolderByPath(root());

    const profileFile = v.getFileByPath(paths.profile());
    if (profileFile) {
      const text = await read(profileFile);
      if (text !== null) {
        const { fm, body } = parseFrontmatter(text);
        rememberLoaded(fm, body);
        data.profile = { fm, body, file: profileFile };
        data.present = true;
      }
    }

    const bodyFile = v.getFileByPath(paths.bodyLog());
    if (bodyFile) {
      const text = await read(bodyFile);
      if (text !== null) {
        const { body } = parseFrontmatter(text);
        data.body = tableToObjects(body, BODY_COLUMNS).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        data.bodyFile = bodyFile;
        data.present = true;
      }
    }

    for (const f of await readNotesIn(paths.exercises())) {
      const text = await read(f);
      if (text === null) continue;
      const { fm, body } = parseFrontmatter(text);
      /* Identity is the BASENAME, but readNotesIn walks subfolders, so
         Exercises/Push/Bench.md and Exercises/Pull/Bench.md are two records
         called "Bench". Lookups use .find(), so the second is unreachable
         from the detail page and refreshSeedMedia only ever patches the
         first. Restructuring identity to the full path ripples through every
         page and is deliberately NOT done mid-release — but the clash must
         not stay silent, so record it and let the UI say so. */
      if (data.exercises.some(e => e.name === f.basename)) data.duplicateExercises.push(f.path);
      rememberLoaded(fm, body);
      data.exercises.push({ name: f.basename, file: f, fm, body });
      data.present = true;
    }
    for (const f of await readNotesIn(paths.plans())) {
      const text = await read(f);
      if (text === null) continue;
      const { fm, body } = parseFrontmatter(text);
      /* A plan's body is regenerated from the model on save, so its baseline
         is the WHOLE text: savePlan refuses if the note is no longer that. */
      rememberLoaded(fm, undefined, text);
      data.plans.push({ name: f.basename, file: f, fm, model: parsePlanBody(body) });
      data.present = true;
    }
    for (const f of await readNotesIn(paths.goals())) {
      const text = await read(f);
      if (text === null) continue;
      const { fm, body } = parseFrontmatter(text);
      rememberLoaded(fm, body);
      data.goals.push({ name: f.basename, file: f, fm, body });
      data.present = true;
    }
    for (const f of await readNotesIn(paths.workouts())) {
      const text = await read(f);
      if (text === null) continue;
      const { fm, body } = parseFrontmatter(text);
      data.workouts.push({ name: f.basename, file: f, fm, rows: tableToObjects(body, WORKOUT_COLUMNS) });
      data.present = true;
    }
    /* Return 0 on equality: returning 1 makes the comparator
       non-antisymmetric, and two sessions logged on the SAME day (which
       saveWorkout explicitly supports) then get an unstable order. */
    /* Sorted by workoutDate(), the one rule for a session's day — not by the
       raw frontmatter string. A sloppy `date: 2026-8-6` sorted AFTER
       `2026-09-01` lexically and so became the last workout in the array,
       which is what the dashboard's "last session" tile reads — a note Today
       refuses to recognise at all. Unreadable dates sort last, so they never
       displace a real one. */
    data.workouts.sort((a, b) => {
      const x = workoutDate(a) || '', y = workoutDate(b) || '';
      return x < y ? -1 : x > y ? 1 : 0;
    });
    /* Plans and goals name exercises; a renamed or deleted note leaves the
       name pointing at nothing. Said out loud on the Exercises page. */
    data.missingExercises = findMissingExercises(data);
    return data;
  }

  /* ---- writes --------------------------------------------------------- */

  /* The three NOTE writers below (profile, exercise, goal) and savePlan share
     one rule: the change is applied to the file's current text inside
     vault.process(), so an edit made elsewhere since the last reload survives.
     Each returns true when it wrote, and false when it deliberately did not —
     in which case the user has already been told why (a Notice), because
     several callers only log a failure and a phone has no console. */
  async function saveProfile(fm, body) {
    await ensureFolder(root());
    const path = paths.profile();
    const base = fm[FM_BASE] || null;
    if (!v.getFileByPath(path)) {
      /* No note and none was loaded: this save CREATES the profile (first
         run). A profile that WAS loaded and is gone now is not ours to
         resurrect. */
      if (base) { tell('your profile note was deleted or moved outside the app — nothing was saved.'); return false; }
      await tracked(path, () => v.create(path, serializeFrontmatter(fm) + '\n' + (body || '')));
      return true;
    }
    return exclusive(path, async () => {
      const res = await applyToFile(path, current => {
        const cur = parseFrontmatter(current);
        /* The body the caller hands back is the one it loaded; only a body
           it actually changed replaces the file's own. */
        const nextBody = base && body !== undefined && body !== base.body ? (body || '') : cur.body;
        return serializeFrontmatter(mergeFrontmatter(cur.fm, fm)) + '\n' + nextBody;
      });
      if (res.gone) { tell('your profile note was deleted or moved outside the app — nothing was saved.'); return false; }
      rememberLoaded(fm, body);
      return true;
    });
  }

  async function appendBodyRow(row) {
    await ensureFolder(root());
    const path = paths.bodyLog();
    const f = v.getFileByPath(path);
    /* The form sends EVERY column, unmeasured ones as '' — drop those
       before the merge or an evening resting-HR entry blanks the morning's
       weight (empty must mean "not remeasured", never "erase"). Copy first:
       `row` is the open modal's live values object, and deleting keys out of
       it under the caller is a landmine for anyone who reads it after the
       await. */
    row = Object.fromEntries(Object.entries(row).filter(([, v]) => String(v ?? '').trim() !== ''));

    if (!f) { await writeFile(path, buildMdTable(BODY_COLUMNS, [row]) + '\n'); return; }

    /* This file may be one the USER writes in. Rebuilding it as
       `frontmatter + one table` deleted their headings, prose, whole
       sections and any column our schema doesn't know — so we now touch
       only the lines of our own table, and refuse outright if the first
       table isn't ours rather than overwriting something we can't read. */
    const text = await v.cachedRead(f);
    const header = tableHeaderLabels(text);
    if (header && !BODY_COLUMNS.every((c, i) => i >= header.length || header[i] === c.label)) {
      throw new Error(`Body Log: the first table in "${path}" isn't the measurement log — its columns don't match. Nothing was written. Move your own table below the log table.`);
    }
    const extraLabels = header ? header.slice(BODY_COLUMNS.length) : [];
    const rows = tableToObjects(text, BODY_COLUMNS);
    // One row per date: logging twice on a day updates in place.
    const i = rows.findIndex(r => r.date === row.date);
    if (i >= 0) rows[i] = { ...rows[i], ...row };
    else rows.push(row);
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const table = buildMdTable(BODY_COLUMNS, rows, extraLabels);
    const next = replaceFirstTable(text, table);
    await writeFile(path, next !== null ? next : text.replace(/\n*$/, '\n\n') + table + '\n');
  }

  async function createExercise(ex) {
    await ensureFolder(paths.exercises());
    const path = `${paths.exercises()}/${safeName(ex.name)}.md`;
    const fm = { type: ex.type, muscles: ex.muscles, equipment: ex.equipment, unit: ex.unit, motion_sensitivity: ex.motion_sensitivity, image: ex.image, video: ex.video };
    return writeIfAbsent(path, serializeFrontmatter(fm) + '\n' + (ex.note ? ex.note + '\n' : ''));
  }

  /* Exercise and goal notes: patch the keys the app changed, keep the file's
     current body (the app never edits it) — see mergeFrontmatter. */
  async function saveNote(rec) {
    const path = rec.file && rec.file.path;
    return exclusive(path, async () => {
      const res = await applyToFile(path, current => {
        const cur = parseFrontmatter(current);
        const base = rec.fm[FM_BASE] || null;
        const nextBody = base && rec.body !== undefined && rec.body !== base.body ? (rec.body || '') : cur.body;
        return serializeFrontmatter(mergeFrontmatter(cur.fm, rec.fm)) + '\n' + nextBody;
      });
      if (res.gone) { tell(`"${rec.name}" was deleted or moved outside the app — nothing was saved.`); return false; }
      rememberLoaded(rec.fm, rec.body);
      return true;
    });
  }

  const saveExercise = exRec => saveNote(exRec);

  async function createGoal(goal) {
    await ensureFolder(paths.goals());
    const path = `${paths.goals()}/${safeName(goal.name)}.md`;
    return writeIfAbsent(path, serializeFrontmatter(goal.fm) + '\n' + (goal.note ? goal.note + '\n' : ''));
  }

  const saveGoal = goalRec => saveNote(goalRec);

  async function createPlan(name, fm, body) {
    await ensureFolder(paths.plans());
    const path = `${paths.plans()}/${safeName(name)}.md`;
    return writeIfAbsent(path, serializeFrontmatter(fm || {}) + '\n' + (body || ''));
  }

  /* A plan's body is rebuilt from its model, so it cannot be patched key by
     key: if the note is no longer the text this record was loaded from (or
     last wrote), something else edited it, and rebuilding would erase that.
     Leave the file alone, say so, and let the caller reload. */
  async function savePlan(planRec) {
    const path = planRec.file && planRec.file.path;
    return exclusive(path, async () => {
      const base = planRec.fm[FM_BASE] || null;
      let outside = false;
      const res = await applyToFile(path, current => {
        if (base && typeof base.text === 'string' && current !== base.text) { outside = true; return null; }
        return serializeFrontmatter(planRec.fm) + '\n' + serializePlanBody(planRec.model);
      });
      if (res.gone) { tell(`"${planRec.name}" was deleted or moved outside the app — nothing was saved.`); return false; }
      if (outside) { tell(`"${planRec.name}" changed outside the app — reloaded. Make your edit again.`); return false; }
      rememberLoaded(planRec.fm, undefined, res.text);
      return true;
    });
  }

  /* Exactly one plan active: activating one deactivates the rest, so
     "today's workout" is never ambiguous. */
  async function setActivePlan(plans, target) {
    for (const p of plans) {
      const want = p === target;
      const is = String(p.fm.active) === 'true';
      if (want === is) continue;
      /* Patch the FRONTMATTER only. savePlan re-serializes the body from the
         parsed model, so flipping a flag used to rewrite every other plan's
         prose and list formatting too — a plan switch has no business
         touching a body the user wrote. Applied to the file's current text,
         like every save here, and the new text becomes the record's baseline
         so a later savePlan does not mistake this write for an outside edit. */
      await exclusive(p.file.path, async () => {
        const res = await applyToFile(p.file.path, current => {
          const { fm, body } = parseFrontmatter(current);
          fm.active = want;
          return serializeFrontmatter(fm) + '\n' + body;
        });
        if (res.gone) { tell(`"${p.name}" was deleted or moved outside the app — nothing was saved.`); return; }
        p.fm.active = want;
        rememberLoaded(p.fm, undefined, res.text);
      });
    }
  }

  async function saveWorkout(session) {
    await ensureFolder(paths.workouts());
    const base = safeName(`${session.date}${session.day ? ' ' + session.day : ''}`) || session.date;
    let path = `${paths.workouts()}/${base}.md`;
    // A second session the same day gets a numbered file, not an overwrite.
    for (let n = 2; v.getFileByPath(path); n++) path = `${paths.workouts()}/${base} ${n}.md`;
    const fm = { date: session.date, plan: session.plan, day: session.day, duration_min: session.duration_min };
    await tracked(path, () => v.create(path, serializeFrontmatter(fm) + '\n' + buildMdTable(WORKOUT_COLUMNS, session.rows) + '\n'));
    return path;
  }

  /* An export is saved as a REAL file of its own kind: the markdown summary
     is a note, a CSV is a .csv and a JSON is a .json, each holding exactly
     the text the page previewed (a markdown fence inside a .csv or .json
     meant nothing could read it). Never overwrites: a second export the same
     day gets a numbered name. */
  async function saveExport(text, kind, ext) {
    await ensureFolder(paths.exports());
    const { todayISO } = require('./dates');
    const base = `${todayISO()} gym ${kind}`;
    let path = `${paths.exports()}/${safeName(base)}.${ext}`;
    for (let n = 2; v.getFileByPath(path); n++) path = `${paths.exports()}/${safeName(base)} ${n}.${ext}`;
    await tracked(path, () => v.create(path, text));
    return path;
  }

  /* ---- plan library ---------------------------------------------------
     Downloads are plain files fetched over https and written into the
     vault; nothing is executed and nothing is sent anywhere. */

  const repoBase = () => (plugin.settings.planRepo || '').replace(/\/+$/, '');

  async function fetchPlanIndex() {
    /* An empty base would build "/plans.json", which iOS rejects with the
       unhelpful "unsupported URL". Say what is actually wrong instead. */
    const base = repoBase();
    if (!/^https?:\/\//i.test(base)) {
      throw new Error('no plan library URL is set — add one in Settings');
    }
    const res = await requestUrl({ url: `${base}/plans.json`, throw: true });
    const index = JSON.parse(res.text);
    if (!index || !Array.isArray(index.plans)) throw new Error('that URL did not return a plan index');
    return index;
  }

  /* Installs the plan note plus any exercise it names that the vault does
     not already have. Never overwrites: an existing plan or exercise of the
     same name is left exactly as it is and reported as skipped. */
  async function installPlan(entry) {
    const out = { plan: null, planSkipped: false, exercisesAdded: 0, exercisesSkipped: 0, failed: [] };
    await ensureFolder(paths.plans());
    const planPath = `${paths.plans()}/${safeName(entry.name)}.md`;
    if (v.getFileByPath(planPath)) {
      out.planSkipped = true;
      out.plan = planPath;
    } else {
      const res = await requestUrl({ url: `${repoBase()}/${entry.file}`, throw: true });
      /* A downloaded plan never arrives active — it would silently take over
         the dashboard from whatever the user is actually running. */
      const { fm, body } = parseFrontmatter(res.text);
      const nextFm = { ...fm, active: false };
      delete nextFm.name;                       // the filename carries the name
      await tracked(planPath, () => v.create(planPath, serializeFrontmatter(nextFm) + '\n' + body));
      out.plan = planPath;
    }
    for (const name of entry.exercises || []) {
      const exPath = `${paths.exercises()}/${safeName(name)}.md`;
      if (v.getFileByPath(exPath)) { out.exercisesSkipped++; continue; }
      try {
        const res = await requestUrl({ url: `${repoBase()}/exercises/${encodeURIComponent(name)}.md`, throw: true });
        await ensureFolder(paths.exercises());
        await tracked(exPath, () => v.create(exPath, res.text));
        out.exercisesAdded++;
      } catch (e) {
        /* A missing exercise definition is survivable — the plan still works,
           it just has no how-to behind that line. Say which ones, though. */
        out.failed.push(name);
      }
    }
    return out;
  }

  /* Delete a note.

     Three things here are deliberate, and each of them was a way for a
     delete to do NOTHING while looking like it had worked.

     1. Re-resolve the path. The caller hands us the TFile it captured when
        the page rendered, which may be several reloads old. `vault.trash()`
        opens with `if (!file) return` — a stale or missing file is a SILENT
        no-op, indistinguishable from success. Resolving by path and throwing
        turns that into something the user can see.

     2. fileManager.trashFile, not vault.trash(file, true). The latter
        hardcodes the system trash and only falls back to the vault-local
        .trash if the adapter returns false — it ignores the user's own
        "Deleted files" setting entirely, and the system trash is not a thing
        on iOS. trashFile reads that setting and does what the user asked
        for. vault.trash stays as the fallback for older API surfaces.

     3. NOT STAMPED, unlike every other write here — neither _lastWrite nor a
        path in _ownWrites, since the watcher skips events for both.
        loadAll() walks the in-memory folder tree, and Obsidian drops a
        deleted file from it a tick after the promise resolves — so a reload
        fired immediately can still list the note. Stamping made that stale
        entry permanent by suppressing the vault `delete` event that would
        have corrected it. Instead of racing, we WAIT below for the tree to
        catch up; the delete event stays as the backstop if that times out. */
  async function trash(file) {
    const path = file && file.path;
    const target = path ? v.getAbstractFileByPath(path) : null;
    if (!target) throw new Error(`"${path || 'that note'}" is not in the vault any more`);
    /* Captured BEFORE the delete: Obsidian nulls a deleted file's .parent,
       and this is the array loadAll() actually reads. */
    const parent = target.parent;
    if (app.fileManager && typeof app.fileManager.trashFile === 'function') {
      await app.fileManager.trashFile(target);
    } else {
      await v.trash(target, true);
    }
    /* gone() returns false on timeout. Discarding it made a 2s timeout
       indistinguishable from success, and the caller then reloaded into a
       tree that still held the note — the exact failure this function
       exists to prevent. */
    if (!await gone(path, parent)) {
      throw new Error(`"${path}" was deleted but the vault is still catching up. Reopen the page in a moment.`);
    }
  }

  /* Resolve once the vault has actually dropped the path, so the caller's
     reload cannot read a tree that still contains it.

     CHECK BOTH STRUCTURES. The path map and the parent's `children` array are
     not updated in lockstep, and they are read by different code: `gone()`
     used to poll only the map, while loadAll() walks `children` (see
     readNotesIn). The map cleared first, this returned immediately, and the
     reload that followed still walked a children array holding the deleted
     note — so the list came back with the plan still on it. Waiting on the
     map alone is waiting on the wrong thing.

     Bounded: if it somehow never settles we return false rather than hanging
     the delete, and the vault's own delete event remains as the backstop. */
  async function gone(path, parent, timeoutMs = 2000) {
    const present = () => !!v.getAbstractFileByPath(path)
      || !!(parent && parent.children && parent.children.some(c => c && c.path === path));
    const started = Date.now();
    while (present()) {
      if (Date.now() - started > timeoutMs) return false;
      await new Promise(r => window.setTimeout(r, 25));
    }
    return true;
  }

  /* ---- progress photos ------------------------------------------------ */

  /* Photos are BINARY and live outside the markdown model entirely: the
     folder names the pose, the filename carries the date, and that is the
     only record. See progress-photos.js for why there is no index note.

     Deliberately NOT part of loadAll(): loadAll reads every note on every
     reload, and photos are needed by exactly one page. Keeping them out means
     the dashboard never pays for them — and, more importantly, means they
     cannot end up inside `data`, which is what the exporters walk. A body
     photo must never be one refactor away from an export. */
  async function listPhotos() {
    const folder = v.getFolderByPath(photosRoot(root()));
    if (!folder) return [];
    const out = [];
    const walk = f => {
      for (const child of f.children || []) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile) {
          const parsed = parsePhotoPath(root(), child.path);
          if (parsed) out.push({ ...parsed, file: child });
        }
      }
    };
    walk(folder);
    return out;
  }

  /* Write one photo. A second photo on the same date gets ` 2`, ` 3`… rather
     than overwriting — a retake you meant to keep must not silently replace
     the one you were comparing against. */
  async function savePhoto(pose, dateISO, data, ext) {
    await ensureFolder(photosRoot(root()));
    await ensureFolder(poseFolder(root(), pose));
    let path = photoPath(root(), pose, dateISO, ext);
    const base = path.replace(/\.[^.]+$/, '');
    const suffix = path.slice(base.length);
    for (let n = 2; v.getFileByPath(path); n++) path = `${base} ${n}${suffix}`;
    await tracked(path, () => v.createBinary(path, data));
    return path;
  }

  /* The src an <img> can actually load. Obsidian's own resource path is the
     only thing that works on mobile — a file:// URL does not resolve inside
     the app's WebView, and reading the bytes into a blob: URL would hold the
     whole photo in memory for every thumbnail on the page. */
  const photoSrc = file => v.getResourcePath(file);

  /* ---- the user's own voice ------------------------------------------- */

  /* Voice clips are BINARY (WAV) and, like photos, live outside the
     markdown model: the filename IS the key (voice-pack.js), so there is no
     index note to drift. Not part of loadAll() for the same reasons photos
     are not — every reload reads every note, and a clip is only needed once
     a session speaks. Files whose name is not a known clip key are ignored,
     never played. Top level only: a subfolder here is somebody's, not ours. */
  async function listVoiceClips() {
    const folder = v.getFolderByPath(paths.voice());
    if (!folder) return [];
    const out = [];
    for (const child of folder.children || []) {
      if (!(child instanceof TFile)) continue;
      const key = keyFromFileName(child.name);
      if (key) out.push({ key, file: child });
    }
    return out;
  }

  /* Write one clip, replacing any previous take of the same cue — unlike a
     photo, a re-recorded "seven" is meant to replace the old "seven", not
     sit beside it. `data` is an ArrayBuffer of WAV bytes. */
  async function saveVoiceClip(key, data) {
    await ensureFolder(paths.voice());
    const path = `${paths.voice()}/${clipFileName(key)}`;
    const f = v.getFileByPath(path);
    await tracked(path, () => (f ? v.modifyBinary(f, data) : v.createBinary(path, data)));
    return path;
  }

  /* Bytes of one clip, for decoding. */
  const readVoiceClip = file => v.readBinary(file);

  /* ---- first-run scaffold --------------------------------------------- */

  /* Does the vault already have a plan that drives Today? One flagged active,
     or any main (non-parallel, non-fallback) plan — Today falls back to the
     first of those when none is flagged (controller.js isImplicitActive). A
     note that cannot be read counts as yes: when unsure, do not take over. */
  async function vaultHasTodaysPlan() {
    for (const f of await readNotesIn(paths.plans())) {
      let fm;
      try { fm = parseFrontmatter(await v.cachedRead(f)).fm; } catch (e) { return true; }
      if (String(fm.active) === 'true') return true;
      if (String(fm.parallel) !== 'true' && String(fm.fallback) !== 'true') return true;
    }
    return false;
  }

  async function scaffold() {
    await ensureFolder(root());
    await ensureFolder(paths.exercises());
    await ensureFolder(paths.plans());
    await ensureFolder(paths.workouts());
    await ensureFolder(paths.goals());
    for (const ex of SEED_EXERCISES) await createExercise(ex);
    /* The starter plan arrives ACTIVE only when nothing else could drive
       Today. Re-running setup used to re-create a deleted starter flagged
       active beside the user's own plan, and Today switched to it. (An
       existing starter is never touched: createPlan is write-if-absent.) */
    const starterActive = !(await vaultHasTodaysPlan());
    await createPlan(SEED_PLAN.name, { ...SEED_PLAN.fm, active: starterActive }, SEED_PLAN.body);
    /* The running plan starts its ladder from the Monday of the current
       week, so week 1 is the week you set the plugin up. */
    const { todayISO, startOfWeek } = require('./dates');
    await createPlan(SEED_RUN_PLAN.name,
      { ...SEED_RUN_PLAN.fm, start_date: startOfWeek(todayISO(), 'mon') },
      SEED_RUN_PLAN.body);
    await createPlan(SEED_REST_PLAN.name, SEED_REST_PLAN.fm, SEED_REST_PLAN.body);
    for (const g of SEED_GOALS) await createGoal(g);
    await writeIfAbsent(paths.profile(), serializeFrontmatter(SEED_PROFILE.fm) + '\n' + SEED_PROFILE.body);
    await writeIfAbsent(paths.bodyLog(), buildMdTable(BODY_COLUMNS, []) + '\n');
  }

  /* Upgrade the media frontmatter of SEED exercise notes in place — when a
     later plugin version ships better images/videos, this is how existing
     vaults get them. Strictly gated: a note's image/video is only replaced
     when it is empty or every entry still points at a known seed source
     (free-exercise-db / wger.de) — anything the user set themselves is
     untouched, and note BODIES are never rebuilt (attribution lines are
     appended, once, when wger media arrives). Returns the patch count. */
  async function refreshSeedMedia() {
    const listOfMedia = v => Array.isArray(v) ? v : v ? [v] : [];
    const replaceable = v => { const l = listOfMedia(v); return !l.length || l.every(isSeedMediaUrl); };
    const sameList = (a, b) => JSON.stringify(listOfMedia(a)) === JSON.stringify(listOfMedia(b));
    let patched = 0;
    /* Match by BASENAME across the whole tree, not by a constructed
       top-level path: readNotesIn walks subfolders, so a user who filed
       their exercises under Push/ and Pull/ got no media refresh at all. */
    const notes = await readNotesIn(paths.exercises());
    for (const seedEx of SEED_EXERCISES) {
      const wanted = safeName(seedEx.name).toLowerCase();
      for (const f of notes.filter(n => n.basename.toLowerCase() === wanted)) {
        const path = f.path;
        const { fm, body } = parseFrontmatter(await v.cachedRead(f));
        let changed = false;
        const next = { ...fm };
        if (seedEx.image && replaceable(fm.image) && !sameList(fm.image, seedEx.image)) { next.image = seedEx.image; changed = true; }
        if (seedEx.video && replaceable(fm.video) && (fm.video || '') !== seedEx.video) { next.video = seedEx.video; changed = true; }
        if (!changed) continue;
        /* Append each attribution/caveat line at most ONCE — gate on the
           line itself, not a proxy string, or a note that already carries a
           "Photos show…" caveat gains a duplicate on the next media change. */
        let nextBody = body;
        for (const line of (seedEx.note || '').split('\n')) {
          if ((line.indexOf('wger.de') >= 0 || /^(Photos|Media) show/.test(line)) && nextBody.indexOf(line) < 0) {
            nextBody = nextBody.replace(/\s*$/, '') + '\n\n' + line + '\n';
          }
        }
        await writeFile(path, serializeFrontmatter(next) + '\n' + nextBody);
        patched++;
      }
    }
    return patched;
  }

  /* Localize remote exercise images: download each https image into
     Gym/Attachments/<exercise>/<i>.<ext> and re-point the note's image list
     at the vault files, so the library works fully offline (and syncs to
     every device with the vault). Videos are deliberately left streaming —
     they are tens of MB each and would ride iCloud sync to every device.
     Idempotent: an already-local list is skipped, an existing file is
     reused, and a failed download leaves that entry as the remote URL so a
     later run can retry. Returns {saved, patched, failed}. */
  async function downloadMedia() {
    const isRemote = u => /^https:\/\//i.test((u || '').toString());
    const extOf = u => {
      const m = (u || '').match(/\.(jpe?g|png|webp|gif)(\?|#|$)/i);
      return m ? m[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
    };
    /* A short, stable, filename-safe digest of the source URL. Plain FNV-1a
       — no crypto (not on the iOS WebView's sync API surface) and none
       needed: this only has to be collision-resistant across one exercise's
       handful of images. */
    const urlKey = u => {
      let h = 0x811c9dc5;
      const str = (u || '').toString();
      for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
      }
      return h.toString(36);
    };
    const out = { saved: 0, patched: 0, failed: 0 };
    for (const f of await readNotesIn(paths.exercises())) {
      const { fm, body } = parseFrontmatter(await v.cachedRead(f));
      const images = Array.isArray(fm.image) ? fm.image : fm.image ? [fm.image] : [];
      if (!images.some(isRemote)) continue;
      const dir = `${paths.attachments()}/${safeName(f.basename)}`;
      const next = [];
      let changed = false;
      for (let i = 0; i < images.length; i++) {
        const u = images[i];
        if (!isRemote(u)) { next.push(u); continue; }
        /* Key the cached file on the URL, not the list POSITION. With an
           index key, replacing image B with a new URL reused the file
           already sitting at that index — so the note was re-pointed at the
           OLD picture and the user's chosen image was discarded. */
        const localPath = `${dir}/${urlKey(u)}.${extOf(u)}`;
        if (!v.getFileByPath(localPath)) {
          try {
            const res = await requestUrl({ url: u, throw: true });
            await ensureFolder(paths.attachments());
            await ensureFolder(dir);
            await tracked(localPath, () => v.createBinary(localPath, res.arrayBuffer));
            out.saved++;
          } catch (e) {
            console.error('gym-vault download', u, e);
            out.failed++;
            next.push(u);   // keep the remote URL so a retry can pick it up
            continue;
          }
        }
        next.push(localPath);
        changed = true;
      }
      if (changed) {
        const nfm = { ...fm, image: next.length > 1 ? next : (next[0] || '') };
        await writeFile(f.path, serializeFrontmatter(nfm) + '\n' + body);
        out.patched++;
      }
    }
    return out;
  }

  return {
    paths, loadAll, scaffold, refreshSeedMedia, downloadMedia, saveExport, saveProfile, appendBodyRow,
    fetchPlanIndex, installPlan,
    createExercise, saveExercise, createGoal, saveGoal,
    createPlan, savePlan, setActivePlan, saveWorkout, trash, safeName,
    listPhotos, savePhoto, photoSrc,
    listVoiceClips, saveVoiceClip, readVoiceClip,
  };
}

module.exports = { makeIo, safeName, findMissingExercises };
