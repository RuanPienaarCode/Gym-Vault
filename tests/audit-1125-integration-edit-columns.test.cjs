'use strict';
/* Found by the acceptance audit of the 25 Nov 2026 fix wave: History -> Edit ->
   Save changes kept the headings of columns the user had added to a workout
   table by hand and BLANKED every value under them. The values ride on each
   loaded row as ROW_EXTRA; the edit draft dropped them. This goes through the
   real note reader, the real edit draft, the real row builder and the real
   writer - the path the screen takes - not a faked io.

   Also here: the log page's back-arrow sheet cleared the session in one tap
   (finding 23 was fixed on the guided screen only). */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { loadSrc, makeVault, makePlugin } = require('./gym-fake-vault');
const { ROW_EXTRA } = loadSrc('markdown.js');
const { makeIo } = loadSrc('data.js');
const pageLog = loadSrc('page-log.js');

const P = 'Gym/Workouts/2026-11-20 Pull day.md';
const NOTE = [
  '---', 'date: 2026-11-20', 'plan: P', 'day: Pull day', 'duration_min: 41', '---', '',
  '| Exercise | Set | Reps | Weight (kg) | Time (s) | Note | Distance (km) | RPE | Felt |',
  '|---|---|---|---|---|---|---|---|---|',
  '| Pull-ups | 1 | 6 |  |  |  |  | 8 | strong |',
  '| Pull-ups | 2 | 5 |  |  | grip went |  | 9 | heavy |',
  '| Plank | 1 |  |  | 60 |  |  |  | ok |',
  '',
].join('\n');

(async () => {
  const v = makeVault([[P, NOTE]]);
  const io = makeIo(makePlugin(v));
  const data = await io.loadAll();
  const w = data.workouts.find(x => x.file.path === P);
  assert.ok(w, 'the workout loaded');
  assert.deepStrictEqual(w.rows[0][ROW_EXTRA], ['8', 'strong'], 'the reader carries the extra cells (precondition)');

  const ctx = { data, state: {}, io };
  const draft = pageLog.editDraftFrom(ctx, w);
  /* The user changes one rep count, nothing else. */
  draft.entries[0].sets[1].reps = '9';
  const rows = pageLog.buildRows(draft);
  assert.deepStrictEqual(rows.map(r => r[ROW_EXTRA]), [['8', 'strong'], ['9', 'heavy'], ['', 'ok']],
    'every row handed to the writer still carries its hand-added columns');

  await io.updateWorkout(w.file, { date: draft.date, plan: draft.plan, day: draft.day, duration_min: draft.duration_min, rows });
  const after = await v.read(w.file);
  assert.match(after, /\| Pull-ups \| 2 \| 9 \|[^\n]*\| 9 \| heavy \|/, 'the edited row keeps RPE 9 and "heavy"');
  assert.match(after, /\| Pull-ups \| 1 \| 6 \|[^\n]*\| 8 \| strong \|/, 'the untouched row keeps RPE 8 and "strong"');
  assert.match(after, /\| Plank \| 1 \|[^\n]*\| ok \|/, 'a row with one blank extra cell keeps the other');
  assert.match(after, /grip went/, 'the row note is still there');

  /* ---- the log page's sheet asks before discarding ---- */
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'page-log.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/onDiscard:\s*\(\)\s*=>\s*\{\s*ctx\.state\.logDraft = null/.test(src), 'no Discard on the log page clears the session without asking');
  assert.match(src, /onDiscard:\s*askDiscard/, 'the End session sheet asks the same question as the Discard button');
  console.log('edit keeps hand-added columns; log Discard asks OK');
})().catch(e => { console.error(e); process.exit(1); });
