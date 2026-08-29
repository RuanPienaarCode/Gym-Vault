'use strict';
/* Vault IO — every read and write of the Gym folder goes through here.

   Uses the Vault API only (works on desktop and iOS; no Node APIs anywhere in
   src/). Writes are stamped on plugin._lastWrite so the controller's vault
   watcher can tell our own writes from the user's edits and skip a pointless
   reload storm. Note BODIES the user may have edited are never rebuilt except
   where the body IS the plugin's own structure (plan day lists, the two flat
   tables) — and even then prose lines round-trip verbatim via plan-parse. */

const { normalizePath, TFile, TFolder, requestUrl } = require('obsidian');
const { parseFrontmatter, serializeFrontmatter, tableToObjects, buildMdTable, replaceFirstTable, tableHeaderLabels } = require('./markdown');
const { parsePlanBody, serializePlanBody } = require('./plan-parse');
const { BODY_COLUMNS, WORKOUT_COLUMNS } = require('./constants');
const { SEED_EXERCISES, SEED_PLAN, SEED_RUN_PLAN, SEED_REST_PLAN, SEED_GOALS, SEED_PROFILE, isSeedMediaUrl } = require('./seed');
const { photosRoot, poseFolder, photoPath, parsePhotoPath, IMAGE_EXT } = require('./progress-photos');

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
  };

  const stamp = () => { plugin._lastWrite = Date.now(); };

  async function ensureFolder(path) {
    if (v.getFolderByPath(path)) return;
    try { stamp(); await v.createFolder(path); }
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
    stamp();
    await v.create(path, content);
    return true;
  }

  /* Overwrite-or-create for files the plugin owns structurally. */
  async function writeFile(path, content) {
    const f = v.getFileByPath(path);
    stamp();
    if (f) await v.modify(f, content);
    else await v.create(path, content);
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
    const data = { profile: { fm: {}, body: '' }, body: [], exercises: [], plans: [], goals: [], workouts: [], present: false, unreadable: 0, unreadablePaths: [], duplicateExercises: [], rootExists: false };
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
      data.exercises.push({ name: f.basename, file: f, fm, body });
      data.present = true;
    }
    for (const f of await readNotesIn(paths.plans())) {
      const text = await read(f);
      if (text === null) continue;
      const { fm, body } = parseFrontmatter(text);
      data.plans.push({ name: f.basename, file: f, fm, model: parsePlanBody(body) });
      data.present = true;
    }
    for (const f of await readNotesIn(paths.goals())) {
      const text = await read(f);
      if (text === null) continue;
      const { fm, body } = parseFrontmatter(text);
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
    data.workouts.sort((a, b) => {
      const x = a.fm.date || '', y = b.fm.date || '';
      return x < y ? -1 : x > y ? 1 : 0;
    });
    return data;
  }

  /* ---- writes --------------------------------------------------------- */

  async function saveProfile(fm, body) {
    await ensureFolder(root());
    await writeFile(paths.profile(), serializeFrontmatter(fm) + '\n' + (body || ''));
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
    const fm = { type: ex.type, muscles: ex.muscles, equipment: ex.equipment, unit: ex.unit, image: ex.image, video: ex.video };
    return writeIfAbsent(path, serializeFrontmatter(fm) + '\n' + (ex.note ? ex.note + '\n' : ''));
  }

  async function saveExercise(exRec) {
    await writeFile(exRec.file.path, serializeFrontmatter(exRec.fm) + '\n' + (exRec.body || ''));
  }

  async function createGoal(goal) {
    await ensureFolder(paths.goals());
    const path = `${paths.goals()}/${safeName(goal.name)}.md`;
    return writeIfAbsent(path, serializeFrontmatter(goal.fm) + '\n' + (goal.note ? goal.note + '\n' : ''));
  }

  async function saveGoal(goalRec) {
    await writeFile(goalRec.file.path, serializeFrontmatter(goalRec.fm) + '\n' + (goalRec.body || ''));
  }

  async function createPlan(name, fm, body) {
    await ensureFolder(paths.plans());
    const path = `${paths.plans()}/${safeName(name)}.md`;
    return writeIfAbsent(path, serializeFrontmatter(fm || {}) + '\n' + (body || ''));
  }

  async function savePlan(planRec) {
    await writeFile(planRec.file.path, serializeFrontmatter(planRec.fm) + '\n' + serializePlanBody(planRec.model));
  }

  /* Exactly one plan active: activating one deactivates the rest, so
     "today's workout" is never ambiguous. */
  async function setActivePlan(plans, target) {
    for (const p of plans) {
      const want = p === target;
      const is = String(p.fm.active) === 'true';
      if (want === is) continue;
      p.fm.active = want;
      /* Patch the FRONTMATTER only. savePlan re-serializes the body from the
         parsed model, so flipping a flag used to rewrite every other plan's
         prose and list formatting too — a plan switch has no business
         touching a body the user wrote. */
      const text = await v.cachedRead(p.file);
      const { fm, body } = parseFrontmatter(text);
      fm.active = want;
      await writeFile(p.file.path, serializeFrontmatter(fm) + '\n' + body);
    }
  }

  async function saveWorkout(session) {
    await ensureFolder(paths.workouts());
    const base = safeName(`${session.date}${session.day ? ' ' + session.day : ''}`) || session.date;
    let path = `${paths.workouts()}/${base}.md`;
    // A second session the same day gets a numbered file, not an overwrite.
    for (let n = 2; v.getFileByPath(path); n++) path = `${paths.workouts()}/${base} ${n}.md`;
    const fm = { date: session.date, plan: session.plan, day: session.day, duration_min: session.duration_min };
    stamp();
    await v.create(path, serializeFrontmatter(fm) + '\n' + buildMdTable(WORKOUT_COLUMNS, session.rows) + '\n');
    return path;
  }

  /* An export is a normal vault note so it can be opened, synced and sent
     on through Obsidian's own share sheet. Never overwrites: a second
     export the same day gets a numbered name. */
  async function saveExport(text, kind, ext) {
    await ensureFolder(paths.exports());
    const { todayISO } = require('./dates');
    const base = `${todayISO()} gym ${kind}`;
    let path = `${paths.exports()}/${safeName(base)}.${ext}`;
    for (let n = 2; v.getFileByPath(path); n++) path = `${paths.exports()}/${safeName(base)} ${n}.${ext}`;
    stamp();
    await v.create(path, ext === 'md' ? text : '```' + (ext === 'json' ? 'json' : 'csv') + '\n' + text + '```\n');
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
      stamp();
      await v.create(planPath, serializeFrontmatter(nextFm) + '\n' + body);
      out.plan = planPath;
    }
    for (const name of entry.exercises || []) {
      const exPath = `${paths.exercises()}/${safeName(name)}.md`;
      if (v.getFileByPath(exPath)) { out.exercisesSkipped++; continue; }
      try {
        const res = await requestUrl({ url: `${repoBase()}/exercises/${encodeURIComponent(name)}.md`, throw: true });
        await ensureFolder(paths.exercises());
        stamp();
        await v.create(exPath, res.text);
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

     3. NOT STAMPED, unlike every other write here. loadAll() walks the
        in-memory folder tree, and Obsidian drops a deleted file from it a
        tick after the promise resolves — so a reload fired immediately can
        still list the note. Stamping made that stale entry permanent by
        suppressing the vault `delete` event that would have corrected it.
        Instead of racing, we WAIT below for the tree to catch up. */
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
    stamp();
    await v.createBinary(path, data);
    return path;
  }

  /* The src an <img> can actually load. Obsidian's own resource path is the
     only thing that works on mobile — a file:// URL does not resolve inside
     the app's WebView, and reading the bytes into a blob: URL would hold the
     whole photo in memory for every thumbnail on the page. */
  const photoSrc = file => v.getResourcePath(file);

  /* ---- first-run scaffold --------------------------------------------- */

  async function scaffold() {
    await ensureFolder(root());
    await ensureFolder(paths.exercises());
    await ensureFolder(paths.plans());
    await ensureFolder(paths.workouts());
    await ensureFolder(paths.goals());
    for (const ex of SEED_EXERCISES) await createExercise(ex);
    await createPlan(SEED_PLAN.name, SEED_PLAN.fm, SEED_PLAN.body);
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
    for (const seedEx of SEED_EXERCISES) {
      const path = `${paths.exercises()}/${safeName(seedEx.name)}.md`;
      const f = v.getFileByPath(path);
      if (!f) continue;
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
            stamp();
            await v.createBinary(localPath, res.arrayBuffer);
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
  };
}

module.exports = { makeIo, safeName };
