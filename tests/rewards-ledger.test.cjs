'use strict';
/* The rewards ledger format (src/rewards-ledger.js): one line per award,
   tolerant parse, idempotent by key, append-only text. Pure - no vault here;
   tests/rewards-vault.test.cjs drives the same functions through the real io.

   Named cases:
     1  format -> parse round trip (a pipe in the note survives)
     2  a missing, empty and null ledger parse to nothing, never throw
     3  a garbage line loses only itself; the others still count
     4  unknown kinds are kept and counted
     5  the same key twice is paid once (first line wins), duplicates counted
     6  header, separator, prose and headings are ignored
     7  frontmatter `started` is read; junk `started` is null
     8  CRLF files parse
     9  appendToText on a missing file builds frontmatter + header + rows
    10  appendToText never rewrites existing text (startsWith) and skips present keys
    11  appendToText repairs a missing trailing newline and a prose tail
    12  appendToText skips invalid entries and in-call repeats; nothing to add -> text unchanged
    13  a hand-made file keeps its own frontmatter (no `started` injected)
    14  negative xp (a hand-written adjustment) is summed as written */
const assert = require('node:assert');
const L = require('../src/rewards-ledger');
const { makeRunner } = require('./gym-fake-vault');

const { check, run } = makeRunner();
const e = (date, kind, key, xp, note) => ({ date, kind, key, xp, note: note || '' });

check('1 format -> parse round trip, a pipe in the note survives', () => {
  const entry = e('2026-10-12', 'pb', 'pb:Gym/Workouts/a.md#Pull-ups/reps', 50, 'New best | Pull-ups 14');
  const row = L.formatEntry(entry);
  assert.ok(row.startsWith('| 2026-10-12 | pb |'), row);
  assert.ok(!row.includes('\n'));
  const got = L.parseLedger(`${row}\n`).entries;
  assert.strictEqual(got.length, 1);
  assert.deepStrictEqual({ ...got[0], line: undefined }, { ...entry, line: undefined });
});

check('2 missing / empty / null ledger parse to nothing without throwing', () => {
  for (const t of [null, undefined, '', '\n\n', '---\ntype: rewards\n---\n']) {
    const p = L.parseLedger(t);
    assert.deepStrictEqual(p.entries, []);
    assert.strictEqual(p.keys.size, 0);
    assert.deepStrictEqual(p.bad, []);
    assert.strictEqual(p.started, null);
  }
});

check('3 a garbage line loses only itself', () => {
  const text = [
    L.formatEntry(e('2026-10-12', 'session', 'session:a', 100, 'ok')),
    '| not a date | session | session:b | 100 | x |',
    '| 2026-10-12 | session | | 100 | no key |',
    '| 2026-10-12 | session | session:c | lots | xp is words |',
    '| 2026-10-12 | session |',
    '| 2026-13-45 | session | session:d | 5 | impossible date |',
    L.formatEntry(e('2026-10-13', 'sets', 'sets:a', 70, '14 sets')),
  ].join('\n');
  const p = L.parseLedger(text);
  assert.deepStrictEqual(p.entries.map(x => x.key), ['session:a', 'sets:a']);
  assert.strictEqual(p.bad.length, 5, JSON.stringify(p.bad));
  assert.deepStrictEqual(p.bad.map(b => b.line), [2, 3, 4, 5, 6]);
});

check('4 unknown kinds are kept, summed and counted', () => {
  const p = L.parseLedger([
    L.formatEntry(e('2026-10-12', 'session', 'session:a', 100)),
    L.formatEntry(e('2026-10-12', 'bonus-weekend', 'bonus:1', 25, 'future kind')),
  ].join('\n'));
  assert.strictEqual(p.entries.length, 2);
  assert.strictEqual(p.unknown, 1);
  assert.strictEqual(p.entries[1].kind, 'bonus-weekend');
  assert.strictEqual(p.entries.reduce((n, x) => n + x.xp, 0), 125);
});

check('5 the same key twice is paid once; first line wins; duplicates counted', () => {
  const p = L.parseLedger([
    L.formatEntry(e('2026-10-12', 'session', 'session:a', 100, 'first')),
    L.formatEntry(e('2026-10-13', 'session', 'session:a', 100, 'second device')),
    L.formatEntry(e('2026-10-13', 'sets', 'sets:a', 70)),
  ].join('\n'));
  assert.strictEqual(p.entries.length, 2);
  assert.strictEqual(p.entries[0].note, 'first');
  assert.strictEqual(p.duplicates, 1);
  assert.strictEqual(L.hasKey(p, 'session:a'), true);
  assert.strictEqual(L.hasKey(p, 'session:zzz'), false);
  assert.deepStrictEqual(L.entriesOf([...p.entries, e('2026-10-14', 'sets', 'sets:a', 70)]).map(x => x.key), ['session:a', 'sets:a']);
  assert.deepStrictEqual(L.entriesOf(null), []);
});

check('6 header, separator, prose and headings are ignored (not "bad")', () => {
  const p = L.parseLedger([
    '# Rewards', '', 'Some words I typed here.', '',
    '| Date | Kind | Key | XP | Note |', '| --- | --- | --- | --- | --- |',
    L.formatEntry(e('2026-10-12', 'session', 'session:a', 100)),
    '', 'More prose after the table.',
  ].join('\n'));
  assert.strictEqual(p.entries.length, 1);
  assert.deepStrictEqual(p.bad, []);
});

check('7 frontmatter started is read; junk started is null', () => {
  assert.strictEqual(L.parseLedger('---\ntype: rewards\nstarted: 2026-10-12\n---\n').started, '2026-10-12');
  assert.strictEqual(L.parseLedger('---\ntype: rewards\nstarted: soon\n---\n').started, null);
});

check('8 CRLF files parse', () => {
  const text = ['---', 'type: rewards', '---', L.formatEntry(e('2026-10-12', 'session', 'session:a', 100)), L.formatEntry(e('2026-10-12', 'sets', 'sets:a', 5))].join('\r\n');
  assert.strictEqual(L.parseLedger(text).entries.length, 2);
});

check('9 appendToText on a missing file builds frontmatter + header + rows', () => {
  const r = L.appendToText(null, [e('2026-10-12', 'session', 'session:a', 100, 'Session finished')]);
  assert.strictEqual(r.appended.length, 1);
  assert.ok(r.text.startsWith('---\ntype: rewards\nstarted: 2026-10-12\n---\n'), r.text);
  assert.ok(/\| Date \| Kind \| Key \| XP \| Note \|\n\| --- \| --- \| --- \| --- \| --- \|\n\| 2026-10-12 \| session \|/.test(r.text), r.text);
  assert.ok(r.text.endsWith('\n'));
  const back = L.parseLedger(r.text);
  assert.strictEqual(back.started, '2026-10-12');
  assert.deepStrictEqual(back.entries.map(x => x.key), ['session:a']);
});

check('10 appendToText never rewrites existing text and skips present keys', () => {
  const first = L.appendToText(null, [e('2026-10-12', 'session', 'session:a', 100)]).text;
  const r = L.appendToText(first, [e('2026-10-12', 'session', 'session:a', 100), e('2026-10-12', 'sets', 'sets:a', 70)]);
  assert.ok(r.text.startsWith(first), 'existing text changed');
  assert.deepStrictEqual(r.appended.map(x => x.key), ['sets:a']);
  assert.deepStrictEqual(r.skipped, [{ key: 'session:a', why: 'present' }]);
  assert.strictEqual(r.text.slice(first.length).split('\n').filter(Boolean).length, 1, 'only ONE new line may be written');
});

check('11 appendToText repairs a missing trailing newline and a prose tail', () => {
  const noNl = '---\ntype: rewards\n---\n| Date | Kind | Key | XP | Note |\n| --- | --- | --- | --- | --- |\n| 2026-10-12 | session | session:a | 100 | x |';
  const a = L.appendToText(noNl, [e('2026-10-13', 'sets', 'sets:a', 5)]);
  assert.ok(a.text.startsWith(noNl));
  assert.deepStrictEqual(L.parseLedger(a.text).entries.map(x => x.key), ['session:a', 'sets:a']);
  const prose = `${noNl}\n\nMy notes about the week.\n`;
  const b = L.appendToText(prose, [e('2026-10-13', 'sets', 'sets:a', 5)]);
  assert.ok(b.text.startsWith(prose));
  assert.ok(b.text.slice(prose.length).includes('| Date | Kind | Key | XP | Note |'), 'a fresh table header must precede rows after prose');
  assert.deepStrictEqual(L.parseLedger(b.text).entries.map(x => x.key), ['session:a', 'sets:a']);
  assert.deepStrictEqual(L.parseLedger(b.text).bad, [], 'the repeated header must not read as a bad line');
});

check('12 invalid and repeated entries are skipped; nothing to add leaves text unchanged', () => {
  const base = L.appendToText(null, [e('2026-10-12', 'session', 'session:a', 100)]).text;
  const r = L.appendToText(base, [
    e('2026-10-12', 'sets', '', 5), e('nope', 'sets', 'sets:x', 5), e('2026-10-12', 'sets', 'sets:y', 5.5),
    e('2026-10-12', '', 'sets:z', 5), e('2026-10-12', 'sets', 'sets:ok', 5), e('2026-10-12', 'sets', 'sets:ok', 5),
  ]);
  assert.deepStrictEqual(r.appended.map(x => x.key), ['sets:ok']);
  assert.strictEqual(r.skipped.filter(s => s.why === 'invalid').length, 4);
  assert.strictEqual(r.skipped.filter(s => s.why === 'present').length, 1);
  assert.strictEqual(L.appendToText(base, []).text, base);
  assert.strictEqual(L.appendToText(base, [e('2026-10-12', 'session', 'session:a', 100)]).text, base);
  assert.strictEqual(L.appendToText(null, []).text, null);
});

check('13 a hand-made file keeps its own frontmatter (no started injected)', () => {
  const hand = '---\ntype: rewards\n---\n# Mine\n\n| Date | Kind | Key | XP | Note |\n| --- | --- | --- | --- | --- |\n';
  const r = L.appendToText(hand, [e('2026-10-12', 'session', 'session:a', 100)]);
  assert.ok(r.text.startsWith(hand));
  assert.ok(!/started/.test(r.text));
});

check('14 negative xp (a hand-written adjustment) is summed as written', () => {
  const p = L.parseLedger([L.formatEntry(e('2026-10-12', 'session', 'session:a', 100)), '| 2026-10-12 | session | adj:1 | -30 | oops |'].join('\n'));
  assert.strictEqual(p.entries.reduce((n, x) => n + x.xp, 0), 70);
});

check('15 existing text is kept byte for byte, whitespace included; a blank line after the table starts a fresh table', () => {
  const messy = '\n  \n---\ntype: rewards\n---\n| Date | Kind | Key | XP | Note |   \n| --- | --- | --- | --- | --- |\n| 2026-10-12 | session | session:a | 100 | x |  \n\n\n';
  const r = L.appendToText(messy, [e('2026-10-13', 'sets', 'sets:a', 5)]);
  assert.ok(r.text.startsWith(messy), 'leading/trailing whitespace of the existing file was changed');
  const tail = r.text.slice(messy.length);
  assert.ok(tail.startsWith('| Date | Kind |'), `rows after a blank line need their own header, got: ${JSON.stringify(tail)}`);
  assert.deepStrictEqual(L.parseLedger(r.text).entries.map(x => x.key), ['session:a', 'sets:a']);
  /* once appended the rows are contiguous: a second append adds no second header */
  const r2 = L.appendToText(r.text, [e('2026-10-14', 'sets', 'sets:b', 5)]);
  assert.strictEqual(r2.text.slice(r.text.length), L.formatEntry(e('2026-10-14', 'sets', 'sets:b', 5)) + '\n');
});

run('rewards-ledger');
