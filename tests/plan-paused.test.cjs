'use strict';
/* PAUSE A PLAN THAT RUNS ALONGSIDE THE ACTIVE ONE (0.13.1).

   Ruan: "showing grease the groove but I only want lunch time circuit, why
   showing two. I can't unselect alongside plans, why are they there and why can
   I not manage them." A plan with `parallel: true` runs alongside the active
   plan; one with `fallback: true` fills any weekday the active plan leaves
   empty. Both were ALWAYS on. On a Sunday his active plan has no day, so
   Today's hero was Grease the Groove — the "two" he saw.

   `paused: true` in the plan note's frontmatter switches one off.

   CONTRACT (written before the code)
     isPaused(plan)                       plan-parse.js, pure
         true  only for a parallel or fallback plan whose fm.paused is true
         false for no key, `paused: false`, null, and an ORDINARY plan (a stray
               key there must not un-badge the plan Today runs)
     parallelPlansOf(plans, {includePaused})  controller.js, pure
     fallbackPlansOf(plans, {includePaused})  paused skipped unless asked;
                                              order and membership otherwise
                                              exactly the old filters
     runPlanOf(plans, isRunExercise)      chosen from EVERY parallel plan, so a
                                          paused running plan still owns the
                                          Running page's ladder
     io.setPaused(planRec, paused)        data.js, async -> true | false(gone)
         paused: writes `paused: true`; resume: REMOVES the key. Only the
         frontmatter line changes; every other key, key order and the body are
         the file's own. Stamped in _ownWrites. No-op when already so.
     planRole(p) for a paused plan is ''  (ordering), badgeWord(p) is 'paused'
     plan detail: a parallel / fallback plan has a role=switch row; ordinary
         and active plans do not.

   Everything drives the REAL modules. */
const assert = require('node:assert');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const { makeDocument, fire, flat, byTag, hasClass, obsidianStub: domStub } = require('./plans-dom-stub');
const fake = require('./gym-fake-vault');

global.document = makeDocument();
/* ONE obsidian stub for the whole file: data.js tests `instanceof TFile`, so the
   page modules and the fake vault must share the same class. */
const stub = { ...domStub, ...fake.obsidianStub };
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));
const planParse = require('../src/plan-parse');
const controller = require('../src/controller');
const plansPage = require('../src/page-plans');
const exportMod = require('../src/export');
Module._load = origLoad;

const { isPaused } = planParse;
const { parallelPlansOf, fallbackPlansOf, runPlanOf, resolveDaysOn } = controller;
const { planRole, orderPlans, badgeWord } = plansPage;
const { makeIo } = fake.loadSrc('data.js');
const { parseFrontmatter } = fake.loadSrc('markdown.js');

const { check, run } = fake.makeRunner();

/* ---- fixtures (synthetic; shaped like the real vault) -------------------- */
const plan = (name, fm, days) => ({
  name, file: { path: `Gym/Plans/${name}.md` }, fm: { ...fm },
  model: { intro: [], days: (days || []).map(d => ({ name: d.name, weekday: d.weekday, notes: [], items: d.items || [], parts: [] })) },
});
const LUNCH = plan('Lunch Circuit', { active: true }, [{ name: 'Circuit', weekday: 'mon' }, { name: 'Circuit', weekday: 'wed' }]);
const GTG = plan('Grease the Groove', { parallel: true, active: false }, [{ name: 'Grease', weekday: 'sun' }, { name: 'Grease', weekday: 'wed' }]);
const TRAIL = plan('Trail Base', { parallel: true }, [{ name: 'Long Run', weekday: 'sat', items: [{ exercise: 'Trail Run', sets: 1, target: '10 km' }] }]);
TRAIL.fm.ladder = [5, 7, 10]; TRAIL.fm.start_date = '2026-09-01';
const REST = plan('Rest & Recovery', { parallel: true, fallback: true }, [{ name: 'Rest', weekday: 'any' }]);
const withPaused = (p, on = true) => { const c = plan(p.name, p.fm, []); c.model = p.model; if (on) c.fm.paused = true; return c; };
const names = list => list.map(p => p.name);

/* ---- isPaused ------------------------------------------------------------ */
check('isPaused: a parallel plan with paused: true', () => assert.strictEqual(isPaused(withPaused(GTG)), true));
check('isPaused: a fallback plan, and the string "true" a YAML parser can hand back', () => {
  const r = plan('R', { fallback: true, paused: 'true' }, []);
  assert.strictEqual(isPaused(r), true);
});
check('isPaused: no key -> not paused (every existing note behaves as before)', () => {
  for (const p of [LUNCH, GTG, TRAIL, REST]) assert.strictEqual(isPaused(p), false, p.name);
});
check('isPaused: paused: false, and an empty value, are not paused', () => {
  assert.strictEqual(isPaused(plan('x', { parallel: true, paused: false })), false);
  assert.strictEqual(isPaused(plan('x', { parallel: true, paused: '' })), false);
});
check('isPaused: null / no fm do not throw', () => {
  assert.strictEqual(isPaused(null), false);
  assert.strictEqual(isPaused({}), false);
});
check('isPaused: a stray paused: true on an ORDINARY plan means nothing', () => {
  assert.strictEqual(isPaused(plan('Strength', { paused: true, active: true })), false);
});

/* ---- parallelPlansOf / fallbackPlansOf ---------------------------------- */
const ALL = [LUNCH, GTG, TRAIL, REST];
check('parallelPlansOf: nothing paused -> exactly the old filter, same order', () => {
  const old = ALL.filter(p => String(p.fm.parallel) === 'true' && String(p.fm.fallback) !== 'true');
  assert.deepStrictEqual(names(parallelPlansOf(ALL)), names(old));
  assert.deepStrictEqual(names(parallelPlansOf(ALL)), ['Grease the Groove', 'Trail Base']);
});
check('fallbackPlansOf: nothing paused -> exactly the old filter', () => {
  assert.deepStrictEqual(names(fallbackPlansOf(ALL)), ['Rest & Recovery']);
});
check('parallelPlansOf: a paused parallel plan is excluded, the rest keep their order', () => {
  assert.deepStrictEqual(names(parallelPlansOf([LUNCH, withPaused(GTG), TRAIL, REST])), ['Trail Base']);
});
check('parallelPlansOf: includePaused brings it back', () => {
  assert.deepStrictEqual(names(parallelPlansOf([LUNCH, withPaused(GTG), TRAIL, REST], { includePaused: true })), ['Grease the Groove', 'Trail Base']);
});
check('fallbackPlansOf: a paused fallback plan is excluded; includePaused brings it back', () => {
  const plans = [LUNCH, GTG, withPaused(REST)];
  assert.deepStrictEqual(names(fallbackPlansOf(plans)), []);
  assert.deepStrictEqual(names(fallbackPlansOf(plans, { includePaused: true })), ['Rest & Recovery']);
});
check('a paused fallback+parallel plan is not mistaken for a parallel one', () => {
  assert.deepStrictEqual(names(parallelPlansOf([withPaused(REST)], { includePaused: true })), []);
});

/* ---- resolveDaysOn: what Today is built from ---------------------------- */
check("Ruan's Sunday: Lunch Circuit has no Sunday; Grease the Groove paused -> it is NOT today's hero", () => {
  const live = resolveDaysOn('sun', LUNCH, parallelPlansOf([LUNCH, GTG, TRAIL, REST]), fallbackPlansOf([LUNCH, GTG, TRAIL, REST]));
  assert.deepStrictEqual(live.map(x => x.plan.name), ['Grease the Groove'], 'unpaused: the "two" he sees');
  const plans = [LUNCH, withPaused(GTG), TRAIL, REST];
  const got = resolveDaysOn('sun', LUNCH, parallelPlansOf(plans), fallbackPlansOf(plans));
  assert.deepStrictEqual(got.map(x => x.plan.name), ['Rest & Recovery'], 'paused: nothing alongside, the live fallback fills the day');
});
check('a paused parallel plan adds no day on a day the active plan also trains', () => {
  const plans = [LUNCH, withPaused(GTG)];
  const got = resolveDaysOn('wed', LUNCH, parallelPlansOf(plans), fallbackPlansOf(plans));
  assert.deepStrictEqual(got.map(x => x.plan.name), ['Lunch Circuit']);
});
check('a paused FALLBACK plan fills no day (its `any` day included)', () => {
  const plans = [LUNCH, GTG, TRAIL, withPaused(REST)];
  for (const wd of ['tue', 'thu', 'fri', 'sat']) {
    const got = resolveDaysOn(wd, LUNCH, parallelPlansOf(plans), fallbackPlansOf(plans));
    assert.ok(!got.some(x => x.plan.name === 'Rest & Recovery'), `${wd} must not be filled by a paused fallback plan`);
  }
  assert.deepStrictEqual(resolveDaysOn('tue', LUNCH, parallelPlansOf(plans), fallbackPlansOf(plans)), []);
});
check('every alongside plan paused: Today is the active plan alone, on every weekday', () => {
  const plans = [LUNCH, withPaused(GTG), withPaused(TRAIL), withPaused(REST)];
  for (const wd of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
    const got = resolveDaysOn(wd, LUNCH, parallelPlansOf(plans), fallbackPlansOf(plans));
    assert.ok(got.every(x => x.plan === LUNCH), `${wd}: ${got.map(x => x.plan.name)}`);
  }
});

/* ---- runPlanOf: the Running page must survive pausing its plan ---------- */
const isRun = n => /run/i.test(n || '');
check('runPlanOf: nothing paused -> the plan with a run exercise', () => {
  assert.strictEqual(runPlanOf([LUNCH, GTG, TRAIL, REST], isRun), TRAIL);
});
check('runPlanOf: the running plan PAUSED is still the running plan, ladder intact', () => {
  const t = withPaused(TRAIL);
  const got = runPlanOf([LUNCH, GTG, t, REST], isRun);
  assert.strictEqual(got, t, 'pausing Trail Base must not blank the Running page');
  assert.deepStrictEqual(got.fm.ladder, [5, 7, 10]);
  assert.strictEqual(got.fm.start_date, '2026-09-01');
  assert.ok(!parallelPlansOf([LUNCH, GTG, t, REST]).includes(t), '...while Today no longer merges it');
});
check('runPlanOf: a live non-running parallel plan does not displace a paused running plan', () => {
  const t = withPaused(TRAIL);
  assert.strictEqual(runPlanOf([GTG, t], isRun), t);
});
check('runPlanOf: no run exercise anywhere -> the first parallel plan (old behaviour); none -> null', () => {
  assert.strictEqual(runPlanOf([LUNCH, GTG], () => false), GTG);
  assert.strictEqual(runPlanOf([LUNCH], isRun), null);
  assert.strictEqual(runPlanOf([], isRun), null);
});

/* ---- the wiring in mountApp (a closure: pinned in source, as the other
        controller guards do; the runtime harness drives the real thing) ---- */
check('controller wiring: ctx.parallelPlans / fallbackPlans / runPlan read the helpers; runPlan is NOT filtered', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'controller.js'), 'utf8');
  assert.match(src, /ctx\.parallelPlans = \(\) => \(ctx\.data \? parallelPlansOf\(ctx\.data\.plans\) : \[\]\)/);
  assert.match(src, /ctx\.fallbackPlans = \(\) => \(ctx\.data \? fallbackPlansOf\(ctx\.data\.plans\) : \[\]\)/);
  assert.match(src, /ctx\.runPlan = \(\) => \(ctx\.data \? runPlanOf\(ctx\.data\.plans, isRunExercise\) : null\)/);
  assert.match(src, /ctx\.daysOn = weekday => resolveDaysOn\(weekday, ctx\.activePlan\(\), ctx\.parallelPlans\(\), ctx\.fallbackPlans\(\)\)/);
  assert.ok(!/ctx\.runPlan[^;]*ctx\.parallelPlans\(\)/.test(src.replace(/\n/g, ' ')), 'runPlan must not read the filtered list');
});

/* ---- io.setPaused: the write ------------------------------------------- */
const RUN_NOTE = [
  '---',
  'parallel: true',
  'active: false',
  'ladder:',
  '  - 5',
  '  - 7',
  'start_date: 2026-09-01',
  'trail_note: keep this line exactly',
  '---',
  '',
  'Intro prose with a [[Wikilink]] and *emphasis*.',
  '',
  '## Long Run (sat)',
  '',
  'Walk the climbs.',
  '',
  '- Trail Run | 1 x 10 km',
  '',
].join('\n');
const PATH = 'Gym/Plans/Trail Base.md';
async function rig(text = RUN_NOTE) {
  const v = fake.makeVault([[PATH, text]]);
  const pl = fake.makePlugin(v);
  const io = makeIo(pl);
  const data = await io.loadAll();
  return { v, pl, io, data, rec: data.plans.find(p => p.name === 'Trail Base') };
}
const fmLines = t => t.split('\n');

check('setPaused(true): the note gains ONE frontmatter line and nothing else changes', async () => {
  const { v, io, rec } = await rig();
  assert.strictEqual(await io.setPaused(rec, true), true);
  const after = v._disk.get(PATH);
  assert.strictEqual(after.replace('paused: true\n', ''), RUN_NOTE, 'removing the one line must give back the original bytes');
  assert.strictEqual(fmLines(after).length, fmLines(RUN_NOTE).length + 1);
  assert.strictEqual(String(parseFrontmatter(after).fm.paused), 'true');
});
check('setPaused(true): other keys, their order, the block list, the comment-ish line and the body are untouched', async () => {
  const { v, io, rec } = await rig();
  await io.setPaused(rec, true);
  const after = v._disk.get(PATH);
  assert.ok(after.includes('ladder:\n  - 5\n  - 7\n'), 'the block list stays a block list');
  assert.ok(after.includes('trail_note: keep this line exactly'));
  assert.ok(after.endsWith(RUN_NOTE.slice(RUN_NOTE.indexOf('Intro prose'))), 'the body is the file\'s own, byte for byte');
});
check('setPaused(false): the key is REMOVED, restoring a never-paused note byte for byte', async () => {
  const { v, io, rec } = await rig();
  await io.setPaused(rec, true);
  assert.strictEqual(await io.setPaused(rec, false), true);
  assert.strictEqual(v._disk.get(PATH), RUN_NOTE);
  assert.ok(!/paused/.test(v._disk.get(PATH)), 'no `paused: false` is left behind');
});
check('setPaused(false) on a note that says paused: false removes that line too', async () => {
  const { v, io, rec } = await rig(RUN_NOTE.replace('active: false\n', 'active: false\npaused: false\n'));
  await io.setPaused(rec, false);
  assert.ok(!/paused/.test(v._disk.get(PATH)));
});
check('setPaused is idempotent: pausing a paused note, or resuming a never-paused one, changes no byte', async () => {
  const { v, io, rec } = await rig();
  await io.setPaused(rec, false);                       // never paused, resuming
  assert.strictEqual(v._disk.get(PATH), RUN_NOTE);
  await io.setPaused(rec, true);
  const once = v._disk.get(PATH);
  await io.setPaused(rec, true);                        // already paused
  assert.strictEqual(v._disk.get(PATH), once, 'a second pause must not add a second key or move anything');
  assert.strictEqual(once.split('paused').length, 2);
});
check('setPaused on a hand-written note with NO blank line after the frontmatter: the seam\'s own join adds that one blank line (as Make active does), and the body is otherwise byte-identical', async () => {
  const tight = RUN_NOTE.replace('---\n\nIntro', '---\nIntro');
  const { v, io, rec } = await rig(tight);
  await io.setPaused(rec, true);
  assert.strictEqual(v._disk.get(PATH).replace('paused: true\n', ''), RUN_NOTE);
});
check('setPaused registers the path in _ownWrites so the watcher does not bounce it', async () => {
  const { pl, io, rec } = await rig();
  assert.ok(!pl._ownWrites || !pl._ownWrites.has(PATH));
  await io.setPaused(rec, true);
  assert.ok(pl._ownWrites && pl._ownWrites.has(PATH), 'write not stamped');
  assert.ok(Date.now() - pl._ownWrites.get(PATH) < 1500);
});
check('setPaused updates the record, so the next savePlan is not mistaken for an outside edit', async () => {
  const { io, rec, v } = await rig();
  await io.setPaused(rec, true);
  assert.strictEqual(String(rec.fm.paused), 'true');
  assert.strictEqual(isPaused(rec), true);
  rec.model.intro = ['Edited after pausing.'];
  assert.strictEqual(await io.savePlan(rec), true, 'savePlan refused: it saw the pause write as an outside edit');
  assert.ok(/paused: true/.test(v._disk.get(PATH)), 'a later plan save keeps the pause');
  await io.setPaused(rec, false);
  assert.strictEqual(isPaused(rec), false);
  assert.ok(!('paused' in rec.fm));
});
check('setPaused patches the note\'s CURRENT text: an outside edit made since the load survives', async () => {
  const { v, io, rec } = await rig();
  v.externalWrite(PATH, RUN_NOTE.replace('trail_note: keep this line exactly', 'trail_note: edited on the phone'));
  await io.setPaused(rec, true);
  assert.ok(v._disk.get(PATH).includes('trail_note: edited on the phone'));
});
check('setPaused on a note deleted outside the app: false, and it does not resurrect it', async () => {
  const { v, io, rec } = await rig();
  v.externalTrash(PATH);
  assert.strictEqual(await io.setPaused(rec, true), false);
  assert.strictEqual(v.getFileByPath(PATH), null);
});

/* ---- the plan detail page ---------------------------------------------- */
const click = n => fire(n, 'click', { target: { closest: () => null } });
const flush = () => new Promise(r => setImmediate(r));
function detail(plans, open, io) {
  const calls = { reload: 0, setPaused: [] };
  const ctx = {
    data: { plans, exercises: [] }, app: {}, state: { params: { plan: open.name } },
    io: io || { setPaused: async (p, on) => { calls.setPaused.push([p.name, on]); return true; }, setActivePlan: async () => {}, savePlan: async () => true },
    nav: () => {}, rerender: () => {}, reload: () => { calls.reload++; }, notice: () => {}, openFile: () => {}, startGuided: () => {},
    activePlan: () => LUNCH,
    mainPlans: () => plans.filter(p => String(p.fm.parallel) !== 'true' && String(p.fm.fallback) !== 'true'),
    backTo: f => f, back: () => {},
  };
  const root = global.document.createElement('div');
  plansPage.render(ctx, root);
  return { root, ctx, calls };
}
const switchOf = root => flat(root).find(n => n.attrs && n.attrs.role === 'switch');

check('detail: a parallel plan shows ONE switch, ON, named for what it does', () => {
  const { root } = detail([LUNCH, GTG], GTG);
  const sw = switchOf(root);
  assert.ok(sw, 'no switch on a parallel plan');
  assert.strictEqual(sw.attrs['aria-checked'], 'true');
  assert.strictEqual(sw.attrs['aria-label'], 'Show on Today');
  assert.ok(/On Today/.test(sw.textContent) && /Runs alongside your active plan/.test(sw.textContent), sw.textContent);
  assert.strictEqual(flat(root).filter(n => n.attrs && n.attrs.role === 'switch').length, 1);
});
check('detail: the old static line is gone', () => {
  const { root } = detail([LUNCH, GTG], GTG);
  assert.ok(!flat(root).some(n => n.tag === 'span' && n.textContent === 'Runs alongside the active plan'));
});
check('detail: a paused plan shows the switch OFF and says Paused', () => {
  const g = withPaused(GTG);
  const { root } = detail([LUNCH, g], g);
  const sw = switchOf(root);
  assert.strictEqual(sw.attrs['aria-checked'], 'false');
  assert.ok(/Paused/.test(sw.textContent) && /not added to Today/.test(sw.textContent), sw.textContent);
});
check('detail: a fallback plan gets the same switch, with its own wording', () => {
  const { root } = detail([LUNCH, REST], REST);
  assert.ok(/Fills any weekday/.test(switchOf(root).textContent));
  const r = withPaused(REST);
  assert.ok(/will not fill your empty days/.test(switchOf(detail([LUNCH, r], r).root).textContent));
});
check('detail: the ACTIVE plan and an ORDINARY plan have no switch, and keep their buttons', () => {
  const other = plan('Pull Day', {}, []);
  const a = detail([LUNCH, other], LUNCH);
  assert.ok(!switchOf(a.root));
  assert.ok(flat(a.root).some(n => n.tag === 'span' && n.textContent === 'active'));
  const o = detail([LUNCH, other], other);
  assert.ok(!switchOf(o.root));
  assert.ok(byTag(o.root, 'button').some(b => b.textContent.includes('Make active')));
});
check('detail: tapping the ON switch pauses (setPaused(plan, true)) and reloads', async () => {
  const { root, calls } = detail([LUNCH, GTG], GTG);
  click(switchOf(root));
  await flush();
  assert.deepStrictEqual(calls.setPaused, [['Grease the Groove', true]]);
  assert.strictEqual(calls.reload, 1);
});
check('detail: tapping the OFF switch resumes (setPaused(plan, false))', async () => {
  const g = withPaused(GTG);
  const { root, calls } = detail([LUNCH, g], g);
  click(switchOf(root));
  await flush();
  assert.deepStrictEqual(calls.setPaused, [['Grease the Groove', false]]);
});
check('detail, end to end through the REAL io: the tap writes exactly the frontmatter change', async () => {
  const { v, io, data, rec } = await rig();
  const { root, ctx } = detail(data.plans, rec, io);
  click(switchOf(root));
  await flush(); await flush();
  assert.strictEqual(v._disk.get(PATH).replace('paused: true\n', ''), RUN_NOTE);
  assert.strictEqual(isPaused(rec), true);
});

/* ---- the plans list ----------------------------------------------------- */
check('list: a paused plan has role "" and the badge word "paused"; live ones are unchanged', () => {
  const g = withPaused(GTG), r = withPaused(REST);
  assert.strictEqual(planRole(g, LUNCH), '');
  assert.strictEqual(planRole(r, LUNCH), '');
  assert.strictEqual(badgeWord(g, LUNCH), 'paused');
  assert.strictEqual(badgeWord(r, LUNCH), 'paused');
  assert.strictEqual(planRole(GTG, LUNCH), 'alongside');
  assert.strictEqual(badgeWord(GTG, LUNCH), 'alongside');
  assert.strictEqual(badgeWord(REST, LUNCH), 'fills gaps');
  assert.strictEqual(badgeWord(LUNCH, LUNCH), 'active');
  assert.strictEqual(badgeWord(plan('Pull', {}), LUNCH), '');
});
check('list: a paused plan sorts with the ordinary plans, in its original place', () => {
  const pull = plan('Pull Day', {}), push = plan('Push Day', {});
  const g = withPaused(GTG);
  assert.deepStrictEqual(names(orderPlans([pull, g, LUNCH, TRAIL, push, REST], LUNCH)),
    ['Lunch Circuit', 'Trail Base', 'Rest & Recovery', 'Pull Day', 'Grease the Groove', 'Push Day']);
});
check('list: the card carries the "paused" badge and says paused in its aria-label', () => {
  const g = withPaused(GTG);
  const ctx = detail([LUNCH, g, TRAIL], LUNCH).ctx;
  ctx.state.params = {};
  const root = global.document.createElement('div');
  plansPage.render(ctx, root);
  const cards = flat(root).filter(n => hasClass(n, 'gv-plan-card'));
  const card = cards.find(c => /Grease the Groove/.test(c.attrs['aria-label']));
  assert.strictEqual(card.attrs['aria-label'], 'Open Grease the Groove, paused');
  assert.deepStrictEqual(flat(card).filter(n => hasClass(n, 'gv-badge')).map(n => n.textContent), ['paused']);
  const live = cards.find(c => /Trail Base/.test(c.attrs['aria-label']));
  assert.strictEqual(live.attrs['aria-label'], 'Open Trail Base, alongside');
});

/* ---- the export --------------------------------------------------------- */
check('export: a paused plan says so in the markdown heading and the JSON; a live one is unchanged', () => {
  const day = [{ weekday: 'sun', name: 'Grease', items: [{ exercise: 'Pull-ups', sets: 5, target: 'submax' }] }];
  const mk = (name, fm) => ({ name, fm, model: { intro: [], days: day } });
  const data = {
    profile: { fm: {}, body: '' }, body: [], exercises: [], goals: [], workouts: [],
    plans: [mk('Live One', { parallel: true }), mk('Paused One', { parallel: true, paused: true }), mk('Main', { active: true })],
  };
  const md = exportMod.buildSummary(data, { today: '2026-10-11', days: 0 });
  assert.ok(md.includes('### Live One (runs alongside)'), 'a live plan keeps its tag');
  assert.ok(md.includes('### Paused One (runs alongside, paused)'), 'a paused plan says so');
  assert.ok(md.includes('### Main (active)'));
  const js = JSON.parse(exportMod.buildJson(data, { today: '2026-10-11', days: 0 }));
  assert.strictEqual(js.plans[1].paused, true);
  assert.ok(!('paused' in js.plans[0]) && !('paused' in js.plans[2]), 'the JSON of an unpaused plan has no new key');
});

run('plan paused');
