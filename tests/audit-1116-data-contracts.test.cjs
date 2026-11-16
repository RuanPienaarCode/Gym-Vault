'use strict';
/* Audit 16 Nov 2026, lane DATA — the two cross-lane contracts.

   K1  `kind: challenge`. A weekly-challenge go is saved through the same
       data.saveWorkout as a session, and the only thing that tells the two
       apart on read is a `kind:` line in the note. saveWorkout writes
       `kind: <session.kind>` when session.kind is a non-empty string and
       NOTHING otherwise (every existing session note is byte-identical to
       what it was), and the loader leaves fm.kind readable.

   K3  library plans (finding 14). installPlan writes `active: false` so a
       download never takes over Today, but a plan with `parallel: true` or
       `fallback: true` IGNORES `active` — only `paused: true` takes it off
       Today (plan-parse.isPaused). So a parallel/fallback download landed on
       Today at once while Browse says it "arrives switched off". Such a plan
       now also arrives `paused: true`; an ordinary plan does not get a stray
       `paused` key. */
const assert = require('node:assert');
const { obsidianStub, loadSrc, makeVault, makePlugin, makeRunner } = require('./gym-fake-vault');

let served = {};
obsidianStub.requestUrl = async req => {
  const key = Object.keys(served).find(k => req.url.endsWith(k));
  if (!key) throw new Error('404 ' + req.url);
  return { text: served[key] };
};
const { makeIo } = loadSrc('data.js');
const { isPaused } = loadSrc('plan-parse.js');
const { check, run } = makeRunner();

const REPO = 'https://raw.githubusercontent.com/x/y/main';
const mk = () => {
  const v = makeVault([]);
  return { v, io: makeIo(makePlugin(v, { planRepo: REPO })) };
};
const session = extra => ({
  date: '2026-11-16', plan: 'Base', day: 'Push', duration_min: 30,
  rows: [{ exercise: 'Bench', set: 1, reps: 5, weight_kg: 60 }],
  ...extra,
});
const noteAt = (v, p) => v._disk.get(p);

/* ---------------------------------------------------------------- K1 */

check('K1 a session with kind "challenge" writes `kind: challenge` into the frontmatter', async () => {
  const { v, io } = mk();
  const p = await io.saveWorkout(session({ plan: '', day: 'Weekly challenge', kind: 'challenge' }));
  const text = noteAt(v, p);
  assert.match(text, /^---\n[\s\S]*?\nkind: challenge\n[\s\S]*?---\n/, `no kind line:\n${text}`);
  /* Placed after `day`, before `duration_min`, so the existing lines keep their order. */
  assert.ok(text.indexOf('day:') < text.indexOf('kind:') && text.indexOf('kind:') < text.indexOf('duration_min:'),
    `kind is not between day and duration_min:\n${text}`);
});

check('K1 the loader leaves fm.kind readable on the loaded workout', async () => {
  const { v, io } = mk();
  await io.saveWorkout(session({ plan: '', day: 'Weekly challenge', kind: 'challenge' }));
  const data = await io.loadAll();
  assert.strictEqual(data.workouts.length, 1);
  assert.strictEqual(data.workouts[0].fm.kind, 'challenge');
});

check('K1 no kind (or an empty / non-string one) leaves the note byte-identical to today\'s', async () => {
  const baseline = await (async () => {
    const { v, io } = mk();
    return noteAt(v, await io.saveWorkout(session()));
  })();
  assert.ok(!/kind/.test(baseline), `a plain session grew a kind line:\n${baseline}`);
  assert.strictEqual(baseline,
    '---\ndate: 2026-11-16\nplan: Base\nday: Push\nduration_min: 30\n---\n' + baseline.split('---\n')[2],
    `frontmatter is no longer the original four lines:\n${baseline}`);
  for (const kind of ['', '   ', undefined, null, 7, true, {}]) {
    const { v, io } = mk();
    const text = noteAt(v, await io.saveWorkout(session({ kind })));
    assert.strictEqual(text, baseline, `kind=${JSON.stringify(kind)} changed the note:\n${text}`);
  }
});

/* ---------------------------------------------------------------- K3 */

const planText = fmLines => `---\n${fmLines.join('\n')}\n---\n## Mon (mon)\n\n- Run | 1 x 30 min\n`;
const install = async (fmLines, name = 'Lib Plan') => {
  served = { [`plans/${name}.md`]: planText(fmLines) };
  const { v, io } = mk();
  const out = await io.installPlan({ name, file: `plans/${name}.md`, exercises: [] });
  const text = noteAt(v, out.plan);
  const data = await io.loadAll();
  return { text, plan: data.plans.find(p => p.name === name) };
};

check('K3 a downloaded `parallel: true` plan arrives paused, so Today does not run it', async () => {
  const { text, plan } = await install(['type: plan', 'parallel: true', 'active: true']);
  assert.match(text, /^active: false$/m, `active not forced off:\n${text}`);
  assert.match(text, /^paused: true$/m, `no paused line:\n${text}`);
  assert.strictEqual(isPaused(plan), true, 'plan-parse.isPaused says the downloaded plan is live');
});

check('K3 a downloaded `fallback: true` plan arrives paused', async () => {
  const { text, plan } = await install(['type: plan', 'fallback: true']);
  assert.match(text, /^paused: true$/m, `no paused line:\n${text}`);
  assert.strictEqual(isPaused(plan), true);
});

check('K3 a plan that says `paused: false` is still switched off on arrival', async () => {
  const { plan } = await install(['type: plan', 'parallel: true', 'paused: false']);
  assert.strictEqual(isPaused(plan), true);
});

check('K3 the flag is read the way the rest of the code reads it (String(x) === "true")', async () => {
  /* A quoted "true" is still true to controller.js; a `no` is not. */
  const quoted = await install(['type: plan', 'parallel: "true"']);
  assert.strictEqual(isPaused(quoted.plan), true, 'quoted "true" parallel plan slipped through');
  const off = await install(['type: plan', 'parallel: false', 'fallback: no']);
  assert.ok(!/paused/.test(off.text), `a plan that is neither got a paused key:\n${off.text}`);
});

check('K3 an ordinary plan is written exactly as before: active false, no paused key', async () => {
  const { text } = await install(['type: plan', 'active: true']);
  assert.match(text, /^active: false$/m);
  assert.ok(!/paused/.test(text), `ordinary plan got a paused key:\n${text}`);
});

run('audit-1116-data-contracts');
