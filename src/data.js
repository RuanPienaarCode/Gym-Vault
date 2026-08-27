'use strict';
/* Vault IO — every read and write of the Gym folder goes through here.

   Uses the Vault API only (works on desktop and iOS; no Node APIs anywhere in
   src/). Writes are stamped on plugin._lastWrite so the controller's vault
   watcher can tell our own writes from the user's edits and skip a pointless
   reload storm. Note BODIES the user may have edited are never rebuilt except
   where the body IS the plugin's own structure (plan day lists, the two flat
   tables) — and even then prose lines round-trip verbatim via plan-parse. */

const { normalizePath, TFile, TFolder, requestUrl } = require('obsidian');
const { parseFrontmatter, serializeFrontmatter, tableToObjects, buildMdTable } = require('./markdown');
const { parsePlanBody, serializePlanBody } = require('./plan-parse');
const { BODY_COLUMNS, WORKOUT_COLUMNS } = require('./constants');
const { SEED_EXERCISES, SEED_PLAN, SEED_GOALS, SEED_PROFILE, isSeedMediaUrl } = require('./seed');

/* Windows/OSX-illegal filename characters, folded to '-' so an exercise or
   plan named from user input always lands on disk. */
const safeName = s => (s || '').toString().replace(/[\\/:*?"<>|#^\[\]]/g, '-').replace(/\s+/g, ' ').trim();

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
  };

  const stamp = () => { plugin._lastWrite = Date.now(); };

  async function ensureFolder(path) {
    if (v.getFolderByPath(path)) return;
    try { stamp(); await v.createFolder(path); }
    catch (e) { if (!v.getFolderByPath(path)) throw e; } // swallow create races
  }

  async function writeIfAbsent(path, content) {
    if (v.getFileByPath(path)) return false;
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
    const data = { profile: { fm: {}, body: '' }, body: [], exercises: [], plans: [], goals: [], workouts: [], present: false };

    const profileFile = v.getFileByPath(paths.profile());
    if (profileFile) {
      const { fm, body } = parseFrontmatter(await v.cachedRead(profileFile));
      data.profile = { fm, body, file: profileFile };
      data.present = true;
    }

    const bodyFile = v.getFileByPath(paths.bodyLog());
    if (bodyFile) {
      const { body } = parseFrontmatter(await v.cachedRead(bodyFile));
      data.body = tableToObjects(body, BODY_COLUMNS)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
      data.bodyFile = bodyFile;
      data.present = true;
    }

    for (const f of await readNotesIn(paths.exercises())) {
      const { fm, body } = parseFrontmatter(await v.cachedRead(f));
      data.exercises.push({ name: f.basename, file: f, fm, body });
      data.present = true;
    }
    for (const f of await readNotesIn(paths.plans())) {
      const { fm, body } = parseFrontmatter(await v.cachedRead(f));
      data.plans.push({ name: f.basename, file: f, fm, model: parsePlanBody(body) });
      data.present = true;
    }
    for (const f of await readNotesIn(paths.goals())) {
      const { fm, body } = parseFrontmatter(await v.cachedRead(f));
      data.goals.push({ name: f.basename, file: f, fm, body });
      data.present = true;
    }
    for (const f of await readNotesIn(paths.workouts())) {
      const { fm, body } = parseFrontmatter(await v.cachedRead(f));
      data.workouts.push({ name: f.basename, file: f, fm, rows: tableToObjects(body, WORKOUT_COLUMNS) });
      data.present = true;
    }
    data.workouts.sort((a, b) => ((a.fm.date || '') < (b.fm.date || '') ? -1 : 1));
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
    let rows = [];
    let head = '';
    if (f) {
      const { fm, body } = parseFrontmatter(await v.cachedRead(f));
      rows = tableToObjects(body, BODY_COLUMNS);
      head = Object.keys(fm).length ? serializeFrontmatter(fm) + '\n' : '';
    }
    // One row per date: logging twice on a day updates in place.
    const i = rows.findIndex(r => r.date === row.date);
    if (i >= 0) rows[i] = { ...rows[i], ...row };
    else rows.push(row);
    rows.sort((a, b) => (a.date < b.date ? -1 : 1));
    await writeFile(path, head + buildMdTable(BODY_COLUMNS, rows) + '\n');
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
      if (want !== is) { p.fm.active = want; await savePlan(p); }
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

  /* System trash, never a hard delete — recoverable by the user. */
  async function trash(file) { stamp(); await v.trash(file, true); }

  /* ---- first-run scaffold --------------------------------------------- */

  async function scaffold() {
    await ensureFolder(root());
    await ensureFolder(paths.exercises());
    await ensureFolder(paths.plans());
    await ensureFolder(paths.workouts());
    await ensureFolder(paths.goals());
    for (const ex of SEED_EXERCISES) await createExercise(ex);
    await createPlan(SEED_PLAN.name, SEED_PLAN.fm, SEED_PLAN.body);
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
      let nextBody = body;
      if (nextBody.indexOf('wger.de') < 0) {
        for (const line of (seedEx.note || '').split('\n')) {
          if (line.indexOf('wger.de') >= 0 || /^(Photos|Media) show/.test(line)) {
            nextBody = nextBody.replace(/\s*$/, '') + '\n\n' + line + '\n';
          }
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
        const localPath = `${dir}/${i}.${extOf(u)}`;
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
    paths, loadAll, scaffold, refreshSeedMedia, downloadMedia, saveProfile, appendBodyRow,
    createExercise, saveExercise, createGoal, saveGoal,
    createPlan, savePlan, setActivePlan, saveWorkout, trash, safeName,
  };
}

module.exports = { makeIo, safeName };
