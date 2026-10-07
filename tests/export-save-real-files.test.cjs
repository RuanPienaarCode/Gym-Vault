'use strict';
/* L2-03 — "Save to vault" on the Export page must write a REAL file.

   saveExport() wrapped a CSV or JSON export in a markdown code fence
   (```csv … ```) and saved it under a .csv / .json name, so the file could
   not be opened by anything that reads CSV or JSON: JSON.parse threw on the
   first character, and the first CSV "row" was the fence. Ruan's decision:
   raw CSV under .csv, raw JSON under .json; the markdown summary stays a
   fence-free .md note. The page copy that said "open that note and share it"
   is now true for each format (a .csv/.json is not a note). */
const assert = require('node:assert');
const { makeDocument, flat } = require('./plans-dom-stub');
const { loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

/* The shared stub's textContent is read-only; page-export assigns it on the
   preview <pre>, so give every node a setter that falls back to the getter. */
const stubDoc = makeDocument();
global.document = {
  ...stubDoc,
  createElement: tag => {
    const n = stubDoc.createElement(tag);
    const read = Object.getOwnPropertyDescriptor(n, 'textContent').get;
    let override = null;
    Object.defineProperty(n, 'textContent', { get: () => (override !== null ? override : read.call(n)), set: t => { override = String(t); } });
    return n;
  },
};
const { makeIo } = loadSrc('data.js');
const { buildSummary, buildCsv, buildJson } = loadSrc('export.js');
const pageExport = loadSrc('page-export.js');

/* Synthetic log: a note with a comma, a quote and a pipe, because those are
   what break a naive CSV/JSON writer. */
const data = {
  profile: { fm: { name: 'Test' }, body: '' },
  body: [],
  exercises: [{ name: 'Pull-ups', fm: { type: 'strength', unit: 'reps' } }],
  plans: [], goals: [],
  workouts: [
    { name: 'a', fm: { date: '2026-08-26', day: 'A', plan: 'P' }, rows: [{ exercise: 'Pull-ups', set: '1', reps: '8', note: 'felt "good", easy | light' }] },
    { name: 'b', fm: { date: '2026-08-27', day: 'A', plan: 'P' }, rows: [{ exercise: 'Pull-ups', set: '1', reps: '9' }] },
  ],
};
const opts = { today: '2026-08-28', days: 0, includeBody: true, includeHealth: false };

/* A strict-enough CSV reader for one assertion: RFC 4180 quoting. */
function parseCsv(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

const { check, run } = makeRunner();
const save = async (text, kind, ext) => {
  const v = makeVault([]);
  const path = await makeIo(makePlugin(v)).saveExport(text, kind, ext);
  return { path, saved: v._disk.get(path) };
};

check('L2-03 a saved .json export parses as JSON and equals what the page built', async () => {
  const text = buildJson(data, opts);
  const { path, saved } = await save(text, 'json', 'json');
  assert.ok(/\.json$/.test(path), `saved under ${path}`);
  let parsed;
  try { parsed = JSON.parse(saved); }
  catch (e) { assert.fail(`${path} is not JSON (${e.message.split('\n')[0]}); it starts ${JSON.stringify(saved.slice(0, 20))}`); }
  assert.deepStrictEqual(parsed, JSON.parse(text));
});

check('L2-03 a saved .csv export is raw CSV: first line is the header, rows parse, no fence', async () => {
  const text = buildCsv(data, opts);
  const { path, saved } = await save(text, 'csv', 'csv');
  assert.ok(/\.csv$/.test(path), `saved under ${path}`);
  const firstLine = saved.split('\n')[0];
  assert.ok(!/^```/.test(firstLine), `first line of ${path} is ${JSON.stringify(firstLine)} — a markdown fence, not the CSV header`);
  assert.strictEqual(firstLine, text.split('\n')[0], 'first line must be the header the page previewed');
  assert.ok(!/```/.test(saved), 'a markdown fence is still inside the CSV file');
  const rows = parseCsv(saved);
  const width = rows[0].length;
  assert.ok(rows.length >= 3, `expected a header and two logged sets, parsed ${rows.length} row(s)`);
  assert.ok(rows.every(r => r.length === width), `ragged CSV: row widths ${JSON.stringify(rows.map(r => r.length))}`);
  assert.ok(rows.some(r => r.includes('felt "good", easy | light')), 'the quoted comma/quote note must survive the round trip');
});

check('L2-03 the markdown summary is still a plain .md note, byte-for-byte what the page built', async () => {
  const text = buildSummary(data, opts);
  const { path, saved } = await save(text, 'summary', 'md');
  assert.ok(/\.md$/.test(path), `saved under ${path}`);
  assert.strictEqual(saved, text);
});

check('L2-03 a second export the same day is numbered, never overwritten, and each file holds its own raw text', async () => {
  const v = makeVault([]);
  const io = makeIo(makePlugin(v));
  const a = await io.saveExport('x\n', 'csv', 'csv');
  const b = await io.saveExport('y\n', 'csv', 'csv');
  assert.notStrictEqual(a, b);
  assert.strictEqual(v._disk.get(a), 'x\n');
  assert.strictEqual(v._disk.get(b), 'y\n');
});

/* The page copy: what it tells you to do must be true for the file it saved. */
const noteFor = format => {
  const ctx = {
    data, settings: { weekStart: 'mon' }, state: { exportUi: { format, days: 0, includeBody: true, includeHealth: false } },
    io: {}, notice() {}, rerender() {}, reload() {},
  };
  const root = document.createElement('div');
  pageExport.render(ctx, root);
  const p = flat(root).find(n => n.tag === 'p' && /gv-export-note/.test(String(n.className)));
  assert.ok(p, `no export note rendered for ${format}`);
  return p.textContent;
};

check('L2-03 page copy: a markdown summary is a note you can open and share', () => {
  const t = noteFor('summary');
  assert.ok(/Gym\/Exports/.test(t) && /note/i.test(t), `summary copy: "${t}"`);
});

check('L2-03 page copy: a CSV/JSON export is NOT called a note, and says where to share it from', () => {
  for (const [format, ext] of [['csv', '.csv'], ['json', '.json']]) {
    const t = noteFor(format);
    assert.ok(!/open that note/i.test(t), `${format} copy still tells you to open "that note": "${t}"`);
    assert.ok(t.includes(ext) || t.toLowerCase().includes(format), `${format} copy does not say what was saved: "${t}"`);
    assert.ok(/Files app|Finder/.test(t), `${format} copy does not say where to find it to share it: "${t}"`);
  }
});

run('export save real files');
