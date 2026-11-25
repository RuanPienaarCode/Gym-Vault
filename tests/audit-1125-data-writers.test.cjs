'use strict';
/* Audit 25 Nov 2026, lane L1 "data" — the vault writers.

   #1  saveWorkout on a shared vault. A note another phone synced in can be on
       DISK before Obsidian's index lists it; the name check asked only the
       index, so create() said "File already exists." and every retry did the
       same. The save now moves on to the next numbered name and never
       overwrites the note that is there.
   #2  setActivePlan decided which notes to rewrite from MEMORY (p.fm.active).
       A plan made active on another phone was skipped as "already off" and
       two plans ended active. It now decides from each note's current text.
   #3  appendBodyRow was the one writer still doing read -> modify: two saves
       close together, or a row arriving from outside mid-save, lost a row.
   #39/#46 (io half) installPlan writes `source: <library id>`; add-on and
       backup installs carry `paused: true` and no meaningless `active` line;
       setPlanRole forwards an optional `{ on }` to plan-parse.withRole.
   Everything is synthetic. */
const assert = require('node:assert');
const { obsidianStub, loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

let served = {};
obsidianStub.requestUrl = async req => {
  const key = Object.keys(served).find(k => req.url.endsWith(k));
  if (!key) throw new Error('404 ' + req.url);
  return { text: served[key] };
};
const { makeIo } = loadSrc('data.js');
const { parseFrontmatter, tableToObjects } = loadSrc('markdown.js');
const planParse = loadSrc('plan-parse.js');
const { BODY_COLUMNS } = loadSrc('constants.js');
const { check, run } = makeRunner();

const fmOf = (v, p) => parseFrontmatter(v._disk.get(p)).fm;
const session = extra => ({
  date: '2026-11-25', plan: 'Lunch', day: 'Circuit', duration_min: 30,
  rows: [{ exercise: 'Push-ups', set: 1, reps: 12 }],
  ...extra,
});

/* ---------------------------------------------------------------- #1 */

const THEIRS = '---\ndate: 2026-11-25\nplan: Lunch\nday: Circuit\nduration_min: 25\n---\n\n| Exercise | Set |\n|---|---|\n| Squat | 1 |\n';

check('#1 a same-name note on disk but not in the index: the save lands on the next numbered name', async () => {
  const theirs = 'Gym/Workouts/2026-11-25 Circuit.md';
  const v = makeVault([], { unindexed: [[theirs, THEIRS]] });
  const io = makeIo(makePlugin(v));
  const p = await io.saveWorkout(session());
  assert.strictEqual(p, 'Gym/Workouts/2026-11-25 Circuit 2.md');
  assert.strictEqual(v._disk.get(theirs), THEIRS, 'the other phone\'s note was changed');
  assert.match(v._disk.get(p), /Push-ups/);
});

check('#1 a retry after the first save also succeeds (3rd name), and neither earlier note is touched', async () => {
  const theirs = 'Gym/Workouts/2026-11-25 Circuit.md';
  const theirs2 = 'Gym/Workouts/2026-11-25 Circuit 2.md';
  const v = makeVault([], { unindexed: [[theirs, THEIRS], [theirs2, THEIRS]] });
  const io = makeIo(makePlugin(v));
  const p = await io.saveWorkout(session());
  assert.strictEqual(p, 'Gym/Workouts/2026-11-25 Circuit 3.md');
  assert.strictEqual(v._disk.get(theirs), THEIRS);
  assert.strictEqual(v._disk.get(theirs2), THEIRS);
});

check('#1 the same holds with no adapter at all (only create() knows): moves on by the error', async () => {
  const theirs = 'Gym/Workouts/2026-11-25 Circuit.md';
  const v = makeVault([], { unindexed: [[theirs, THEIRS]], noAdapter: true });
  const io = makeIo(makePlugin(v));
  const p = await io.saveWorkout(session());
  assert.strictEqual(p, 'Gym/Workouts/2026-11-25 Circuit 2.md');
  assert.strictEqual(v._disk.get(theirs), THEIRS);
});

check('#1 any other create error still throws (not swallowed into a numbered retry)', async () => {
  const v = makeVault([]);
  const created = [];
  v.create = async p => { created.push(p); throw new Error('EACCES: permission denied'); };
  const io = makeIo(makePlugin(v));
  await assert.rejects(io.saveWorkout(session()), /EACCES/);
  assert.strictEqual(created.length, 1, `retried on a non-exists error: ${created.join(', ')}`);
});

check('#1 an ordinary first save is still `<date> <day>.md`', async () => {
  const v = makeVault([]);
  const io = makeIo(makePlugin(v));
  assert.strictEqual(await io.saveWorkout(session()), 'Gym/Workouts/2026-11-25 Circuit.md');
});

/* ---------------------------------------------------------------- #2 */

const BODY = '## A (mon)\n\n- Push-ups | 3 x 10\n';
const rig = async files => {
  const v = makeVault(files);
  const io = makeIo(makePlugin(v));
  const data = await io.loadAll();
  return { v, io, data, by: n => data.plans.find(p => p.name === n) };
};

check('#2 another phone made Y active since our load: making Z active leaves ONLY Z active on disk', async () => {
  const { v, io, data, by } = await rig([
    ['Gym/Plans/X.md', `---\nactive: true\n---\n${BODY}`],
    ['Gym/Plans/Y.md', `---\nactive: false\n---\n${BODY}`],
    ['Gym/Plans/Z.md', `---\nactive: false\n---\n${BODY}`],
  ]);
  v.externalWrite('Gym/Plans/X.md', `---\nactive: false\n---\n${BODY}`);
  v.externalWrite('Gym/Plans/Y.md', `---\nactive: true\n---\n${BODY}`);
  await io.setActivePlan(data.plans, by('Z'));
  const on = ['X', 'Y', 'Z'].filter(n => String(fmOf(v, `Gym/Plans/${n}.md`).active) === 'true');
  assert.deepStrictEqual(on, ['Z'], `active on disk after the switch: ${on.join(' + ')}`);
  const fresh = await io.loadAll();
  assert.strictEqual(planParse.activePlanOf(fresh.plans).name, 'Z', 'Today does not follow the pick');
});

check('#2 the target already active on disk (memory says off): it stays on, nothing else turns on', async () => {
  const { v, io, data, by } = await rig([
    ['Gym/Plans/A.md', `---\nactive: true\n---\n${BODY}`],
    ['Gym/Plans/B.md', `---\nactive: false\n---\n${BODY}`],
  ]);
  v.externalWrite('Gym/Plans/A.md', `---\nactive: false\n---\n${BODY}`);
  v.externalWrite('Gym/Plans/B.md', `---\nactive: true\n---\n${BODY}`);
  await io.setActivePlan(data.plans, by('B'));
  assert.strictEqual(String(fmOf(v, 'Gym/Plans/A.md').active), 'false');
  assert.strictEqual(String(fmOf(v, 'Gym/Plans/B.md').active), 'true');
});

check('#2 null target from stale memory: a plan switched on elsewhere is switched off too', async () => {
  const { v, io, data } = await rig([
    ['Gym/Plans/A.md', `---\nactive: false\n---\n${BODY}`],
    ['Gym/Plans/B.md', `---\nactive: false\n---\n${BODY}`],
  ]);
  v.externalWrite('Gym/Plans/B.md', `---\nactive: true\n---\n${BODY}`);
  await io.setActivePlan(data.plans, null);
  for (const n of ['A', 'B']) assert.strictEqual(String(fmOf(v, `Gym/Plans/${n}.md`).active), 'false', n);
  const fresh = await io.loadAll();
  assert.strictEqual(planParse.activePlanOf(fresh.plans), null);
});

check('#2 null target still stamps a key-less note `active: false`, body byte-identical', async () => {
  const { v, io, data } = await rig([['Gym/Plans/K.md', `---\nweeks: 4\n---\n${BODY}`]]);
  await io.setActivePlan(data.plans, null);
  const text = v._disk.get('Gym/Plans/K.md');
  assert.strictEqual(String(parseFrontmatter(text).fm.active), 'false');
  assert.strictEqual(String(parseFrontmatter(text).fm.weeks), '4');
  assert.ok(text.endsWith(BODY));
});

check('#2 a note that became an add-on elsewhere is left alone (no `active` line added)', async () => {
  const { v, io, data, by } = await rig([
    ['Gym/Plans/A.md', `---\nactive: false\n---\n${BODY}`],
    ['Gym/Plans/R.md', `---\nactive: true\n---\n${BODY}`],
  ]);
  const runsNow = `---\nparallel: true\n---\n${BODY}`;
  v.externalWrite('Gym/Plans/R.md', runsNow);
  await io.setActivePlan(data.plans, by('A'));
  assert.strictEqual(v._disk.get('Gym/Plans/R.md'), runsNow);
});

check('#2 nothing to change: no note is written', async () => {
  const { v, io, data, by } = await rig([
    ['Gym/Plans/A.md', `---\nactive: true\n---\n${BODY}`],
    ['Gym/Plans/B.md', `---\nactive: false\n---\n${BODY}`],
  ]);
  const before = v._log.length;
  await io.setActivePlan(data.plans, by('A'));
  const writes = v._log.slice(before).filter(e => e[0] !== 'process');
  assert.deepStrictEqual(writes, []);
  assert.strictEqual(v._disk.get('Gym/Plans/B.md'), `---\nactive: false\n---\n${BODY}`);
});

/* ---------------------------------------------------------------- #3 */

const LOG = `# My log\n\nIntro line.\n\n| Date | Weight (kg) |\n|---|---|\n| 2026-11-01 | 80 |\n\nTrailing prose.\n`;
const rowsOf = text => tableToObjects(text, BODY_COLUMNS).map(r => r.date);

check('#3 two overlapping saves on different days both land', async () => {
  const v = makeVault([['Gym/Body Log.md', LOG]], { delay: 5 });
  const io = makeIo(makePlugin(v));
  await Promise.all([
    io.appendBodyRow({ date: '2026-11-20', weight_kg: '79' }),
    io.appendBodyRow({ date: '2026-11-21', weight_kg: '78.5' }),
  ]);
  const text = v._disk.get('Gym/Body Log.md');
  assert.deepStrictEqual(rowsOf(text), ['2026-11-01', '2026-11-20', '2026-11-21'], text);
  assert.match(text, /Intro line\./); assert.match(text, /Trailing prose\./);
});

check('#3 a row arriving from another phone mid-save survives', async () => {
  const v = makeVault([['Gym/Body Log.md', LOG]], { delay: 5 });
  const theirs = LOG.replace('| 2026-11-01 | 80 |', '| 2026-11-01 | 80 |\n| 2026-11-10 | 79.5 |');
  /* The other phone's row lands ONCE, at the save's first touch of the note:
     just after a read (the old read -> modify window), or just before a
     process() runs (which then reads the disk as it is). */
  let arrived = false;
  const arrive = () => { if (!arrived) { arrived = true; v.externalWrite('Gym/Body Log.md', theirs); } };
  for (const name of ['cachedRead', 'read']) {
    const orig = v[name];
    v[name] = async (...a) => { const out = await orig(...a); arrive(); return out; };
  }
  const origProcess = v.process;
  v.process = async (...a) => { arrive(); return origProcess(...a); };
  const io = makeIo(makePlugin(v));
  await io.appendBodyRow({ date: '2026-11-20', weight_kg: '79' });
  const text = v._disk.get('Gym/Body Log.md');
  assert.deepStrictEqual(rowsOf(text), ['2026-11-01', '2026-11-10', '2026-11-20'], text);
});

check('#3 same day twice merges in place; empty columns never erase', async () => {
  const v = makeVault([['Gym/Body Log.md', LOG]]);
  const io = makeIo(makePlugin(v));
  await io.appendBodyRow({ date: '2026-11-01', weight_kg: '', resting_hr: '55' });
  const rows = tableToObjects(v._disk.get('Gym/Body Log.md'), BODY_COLUMNS);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].weight_kg, '80');
  assert.strictEqual(rows[0].resting_hr, '55');
});

check('#3 a first table that is not the log is still refused, file untouched', async () => {
  const mine = '| Food | kcal |\n|---|---|\n| Egg | 70 |\n';
  const v = makeVault([['Gym/Body Log.md', mine]]);
  const io = makeIo(makePlugin(v));
  await assert.rejects(io.appendBodyRow({ date: '2026-11-20', weight_kg: '79' }), /isn't the measurement log/);
  assert.strictEqual(v._disk.get('Gym/Body Log.md'), mine);
});

check('#3 no Body Log yet: it is created with the row; and saves run one at a time (no overlap)', async () => {
  const v = makeVault([], { delay: 3 });
  const io = makeIo(makePlugin(v));
  await Promise.all([
    io.appendBodyRow({ date: '2026-11-20', weight_kg: '79' }),
    io.appendBodyRow({ date: '2026-11-21', weight_kg: '78' }),
  ]);
  assert.deepStrictEqual(rowsOf(v._disk.get('Gym/Body Log.md')), ['2026-11-20', '2026-11-21']);
  assert.deepStrictEqual(v.overlaps, []);
});

/* ------------------------------------------------------- #39 / #46 io */

const REPO = 'https://raw.githubusercontent.com/x/y/main';
const install = async (fmLines, entryExtra = {}) => {
  const name = 'Lib Plan';
  served = { [`plans/${name}.md`]: `---\n${fmLines.join('\n')}\n---\n## Mon (mon)\n\n- Run | 1 x 30 min\n` };
  const v = makeVault([]);
  const io = makeIo(makePlugin(v, { planRepo: REPO }));
  const out = await io.installPlan({ name, file: `plans/${name}.md`, exercises: [], ...entryExtra });
  return { v, text: v._disk.get(out.plan), fm: fmOf(v, out.plan) };
};

check('#39 an installed plan carries `source: <library id>`', async () => {
  const { fm } = await install(['type: plan'], { id: 'full-body-simple-sinister' });
  assert.strictEqual(fm.source, 'full-body-simple-sinister');
});

check('#39 an entry with no id writes no source line', async () => {
  const { text } = await install(['type: plan']);
  assert.ok(!/^source:/m.test(text), text);
});

check('#46a an add-on install: paused, and no `active` line at all', async () => {
  const { text, fm } = await install(['type: plan', 'parallel: true', 'active: true'], { id: 'a' });
  assert.strictEqual(String(fm.paused), 'true');
  assert.ok(!('active' in fm), `add-on carries a meaningless active line:\n${text}`);
});

check('#46a a backup install: paused, and no `active` line', async () => {
  const { text, fm } = await install(['type: plan', 'fallback: true']);
  assert.strictEqual(String(fm.paused), 'true');
  assert.ok(!('active' in fm), text);
});

check('#46a a main-plan install still arrives `active: false`', async () => {
  const { fm } = await install(['type: plan', 'active: true']);
  assert.strictEqual(String(fm.active), 'false');
  assert.ok(!('paused' in fm));
});

check('#46b setPlanRole forwards the optional { on } to plan-parse.withRole', async () => {
  const { v, by } = await rig([['Gym/Plans/M.md', `---\nweeks: 4\n---\n${BODY}`]]);
  /* data.js destructures withRole when it loads, so load a FRESH data.js with
     the spy already in plan-parse's exports. */
  const seen = [];
  const ppMod = require.cache[require.resolve('../src/plan-parse.js')];
  const dataPath = require.resolve('../src/data.js');
  const orig = ppMod.exports.withRole;
  ppMod.exports.withRole = (fm, role, opts) => { seen.push([role, opts]); return orig(fm, role, opts); };
  delete require.cache[dataPath];
  let fresh;
  try { fresh = loadSrc('data.js'); }
  finally { ppMod.exports.withRole = orig; delete require.cache[dataPath]; }
  const io2 = fresh.makeIo(makePlugin(v));
  assert.strictEqual(await io2.setPlanRole(by('M'), 'parallel', { on: true }), true);
  assert.deepStrictEqual(seen, [['parallel', { on: true }]]);
  /* Two arguments still work exactly as before. */
  seen.length = 0;
  await io2.setPlanRole(by('M'), 'main');
  assert.deepStrictEqual(seen, [['main', undefined]]);
});

run('audit-1125-data-writers');
