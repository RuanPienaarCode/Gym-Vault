'use strict';
/* Audit 16 Nov 2026, lane DATA — the Body Log's "latest" row, and `|` in a
   Body Log cell.

   LATEST. data.js sorted the Body Log with a raw string compare, and every
   reader takes the LAST row as "latest" (the Profile weight / BMI / waist
   tiles, the export). Raw strings put a hand-typed `2026-8-6` after
   `2026-11-01` ('8' > '1'), so an old figure was shown as the current one.
   The order is now by the parsed date — stats.workoutDate, the one rule for
   "the date of this note" (dates.fromISO -> toISO) — and a row whose date
   cannot be read sorts FIRST, so it is never the latest (the same place
   compareWorkouts puts an unreadable workout; the Profile list is newest
   first, so there it falls to the bottom).
   The same comparator orders the rows appendBodyRow writes back, so the file
   and the screen agree.

   PIPE. A `|` in a note cell must not break the table: written escaped,
   read back unescaped, symmetric. */
const assert = require('node:assert');
const T = require('./f3-stub');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');
const profile = require('../src/page-profile');

const { makeIo } = loadSrc('data.js');
const { check, run } = makeRunner();

const { BODY_COLUMNS } = require('../src/constants');
const header = `| ${BODY_COLUMNS.map(c => c.label).join(' | ')} |\n|${BODY_COLUMNS.map(() => '---').join('|')}|\n`;
const rowOf = (date, weight, note) => `| ${BODY_COLUMNS.map(c => (c.key === 'date' ? date : c.key === 'weight_kg' ? (weight || '') : c.key === 'note' ? (note || '') : '')).join(' | ')} |\n`;
const bodyLog = rows => header + rows.map(r => rowOf(...r)).join('');
const io = text => { const v = makeVault([['Gym/Body Log.md', text]]); return { v, io: makeIo(makePlugin(v)) }; };

check('Body Log: a hand-typed 2026-8-6 does not outrank 2026-11-01', async () => {
  /* raw order puts '2026-8-6' last; the real latest is 2026-11-01 */
  const { io: i } = io(bodyLog([['2026-09-15', '84'], ['2026-8-6', '99'], ['2026-11-01', '81']]));
  const data = await i.loadAll();
  assert.strictEqual(data.body[data.body.length - 1].date, '2026-11-01', `latest row is ${data.body[data.body.length - 1].date}: ${data.body.map(r => r.date).join(', ')}`);
});

check('Body Log: a row whose date cannot be read is never the latest, whatever the file order', async () => {
  for (const order of [[['soon', '99'], ['2026-09-15', '84']], [['2026-09-15', '84'], ['soon', '99']], [['', '70'], ['2026-01-02', '84'], ['n/a', '71']]]) {
    const { io: i } = io(bodyLog(order));
    const data = await i.loadAll();
    const last = data.body[data.body.length - 1];
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(last.date), `an unreadable date is the latest: ${data.body.map(r => JSON.stringify(r.date)).join(', ')}`);
  }
});

check('Body Log: a date with a time of day is read like the workouts (2026-10-02T08:00 sits on 2 Oct)', async () => {
  const { io: i } = io(bodyLog([['2026-10-02T08:00', '82'], ['2026-10-01', '83'], ['2026-10-03', '81']]));
  const data = await i.loadAll();
  assert.deepStrictEqual(data.body.map(r => r.date), ['2026-10-01', '2026-10-02T08:00', '2026-10-03']);
});

check('Body Log: rows already in order, and same-day rows, keep the file order (stable)', async () => {
  const { io: i } = io(bodyLog([['2026-10-01', '80', 'first'], ['2026-10-01', '81', 'second'], ['2026-10-02', '82']]));
  const data = await i.loadAll();
  assert.deepStrictEqual(data.body.map(r => r.note || r.weight_kg), ['first', 'second', '82']);
});

check('Body Log: the Profile weight tile shows the genuinely latest weight', async () => {
  const { io: i } = io(bodyLog([['2026-09-15', '84'], ['2026-8-6', '99'], ['2026-11-01', '81']]));
  const data = await i.loadAll();
  const ctx = { data, settings: {}, state: {}, app: {}, nav() {}, notice() {}, reload() {}, openFile() {}, io: { listPhotos: async () => [] } };
  const root = T.render(profile, ctx);
  const tile = T.findAll(root, 'gv-tile').find(t => t.textContent.replace(/\s+/g, ' ').includes('weight'));
  const text = tile.textContent.replace(/\s+/g, ' ');
  assert.ok(/81/.test(text) && !/99/.test(text), `weight tile: ${text}`);
});

check('Body Log: appendBodyRow writes the rows back in the same order the loader shows', async () => {
  const { v, io: i } = io(bodyLog([['2026-09-15', '84'], ['2026-8-6', '99'], ['2026-11-01', '81']]));
  await i.appendBodyRow({ date: '2026-10-10', weight_kg: '82' });
  const data = await i.loadAll();
  const onDisk = (v._disk.get('Gym/Body Log.md').match(/^\| (\S+) /gm) || []).map(l => l.slice(2).trim()).filter(d => d !== 'Date' && !/^-+$/.test(d));
  assert.deepStrictEqual(onDisk, data.body.map(r => r.date), `file order ${onDisk} vs screen order ${data.body.map(r => r.date)}`);
  assert.strictEqual(data.body[data.body.length - 1].date, '2026-11-01');
});

check('PIPE: a note with | survives a write and a read, and the table keeps its shape', async () => {
  const { v, io: i } = io(bodyLog([['2026-09-15', '84']]));
  const note = 'felt ok | tired | pizza \\| night';
  await i.appendBodyRow({ date: '2026-10-10', weight_kg: '82', note });
  const text = v._disk.get('Gym/Body Log.md');
  const cols = BODY_COLUMNS.length;
  for (const line of text.split('\n').filter(l => l.startsWith('|'))) {
    const cells = line.replace(/\\\|/g, '').split('|').length - 2;
    assert.strictEqual(cells, cols, `a row grew a column: ${line}`);
  }
  const data = await i.loadAll();
  assert.strictEqual(data.body.find(r => r.date === '2026-10-10').note, note);
  /* and a second save of another day leaves that note exactly as it was */
  await i.appendBodyRow({ date: '2026-10-11', weight_kg: '81' });
  assert.strictEqual((await i.loadAll()).body.find(r => r.date === '2026-10-10').note, note);
});

run('audit-1116-data-body-latest');
