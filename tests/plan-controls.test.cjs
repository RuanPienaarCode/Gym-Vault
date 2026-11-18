'use strict';
/* MANAGE PLANS BY HAND (18 Nov 2026).
   Ruan: "user needs to control plans better — active them, deactive them, set
   ones to be alongside, set ones to fill the gaps — manually as a user on the
   plan tab or in the specific plan page." A main plan could be made active but
   never switched off, and a plan's role (main / alongside / fills gaps) was a
   frontmatter key you could only type by hand.

   CONTRACT (written before the code)
     activePlanOf(plans)          the flagged main plan; else the first main
                                  plan whose note does NOT say `active: false`;
                                  else null. `active: false` is a choice.
     isImplicitActive(main)       true only when activePlanOf picked an
                                  unflagged plan
     io.setActivePlan(main, null) switches every main plan OFF, stamping
                                  `active: false` even on a key-less note
     withRole(fm, role)           pure, role ∈ main | parallel | fallback;
                                  null when already so; on/off carries across
                                  (main active ⇄ alongside unpaused); a plan
                                  moved INTO main arrives `active: false`
     io.setPlanRole(plan, role)   frontmatter only; body byte-identical
     Plans list card              role <select> + role="switch" Active toggle;
                                  neither opens the plan
     plan page                    role picker (radiogroup) + Active switch for
                                  EVERY plan; main plan writes via
                                  setActivePlan(ctx.mainPlans(), plan|null)
   Everything drives the REAL modules. */

const assert = require('node:assert');
const Module = require('node:module');
const { makeDocument, fire, flat, byTag, hasClass, obsidianStub: domStub } = require('./plans-dom-stub');
const fake = require('./gym-fake-vault');

global.document = makeDocument();
const stub = { ...domStub, ...fake.obsidianStub };
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));
const P = require('../src/plan-parse');
const controller = require('../src/controller');
const plansPage = require('../src/page-plans');
Module._load = origLoad;
const { makeIo } = fake.loadSrc('data.js');
const { parseFrontmatter } = fake.loadSrc('markdown.js');
const { check, run } = fake.makeRunner();

const plan = (name, fm, days) => ({
  name, file: { path: `Gym/Plans/${name}.md` }, fm: { ...fm },
  model: { intro: [], days: (days || []).map(d => ({ name: d.name, weekday: d.weekday, notes: [], items: [], parts: [] })) },
});
const isMain = p => String(p.fm.parallel) !== 'true' && String(p.fm.fallback) !== 'true';

/* ---- the active rule ---------------------------------------------------- */
check('activePlanOf: the flagged plan wins', () => {
  const a = plan('A', { active: false }), b = plan('B', { active: true });
  assert.strictEqual(P.activePlanOf([a, b]), b);
});
check('activePlanOf: every main plan says active: false -> NO plan (switching off is real)', () => {
  const a = plan('A', { active: false }), b = plan('B', { active: 'false' });
  assert.strictEqual(P.activePlanOf([a, b]), null);
  assert.strictEqual(controller.isImplicitActive([a, b]), false);
});
check('activePlanOf: a hand-written note with no active key still stands in, past explicit-off ones', () => {
  const off = plan('Off', { active: false }), bare = plan('Bare', {});
  assert.strictEqual(P.activePlanOf([off, bare]), bare);
  assert.strictEqual(controller.isImplicitActive([off, bare]), true);
});

/* ---- withRole ----------------------------------------------------------- */
check('withRole: the active main plan -> alongside is ON, carries no active key', () => {
  assert.deepStrictEqual(P.withRole({ active: true, x: 1 }, 'parallel'), { x: 1, parallel: true });
});
check('withRole: an inactive main plan -> fills gaps arrives paused', () => {
  assert.deepStrictEqual(P.withRole({ active: false }, 'fallback'), { fallback: true, paused: true });
  assert.deepStrictEqual(P.withRole({}, 'fallback'), { fallback: true, paused: true });
});
check('withRole: alongside -> main arrives active: false and drops parallel/paused', () => {
  assert.deepStrictEqual(P.withRole({ parallel: true, paused: true, y: 2 }, 'main'), { y: 2, active: false });
  assert.deepStrictEqual(P.withRole({ parallel: true }, 'main'), { active: false });
});
check('withRole: alongside -> fills gaps keeps its on/off state', () => {
  assert.deepStrictEqual(P.withRole({ parallel: true, paused: true }, 'fallback'), { fallback: true, paused: true });
  assert.deepStrictEqual(P.withRole({ parallel: true }, 'fallback'), { fallback: true });
});
check('withRole: already that role -> null; a parallel+fallback note picking fallback tidies the stray key', () => {
  assert.strictEqual(P.withRole({ parallel: true }, 'parallel'), null);
  assert.strictEqual(P.withRole({ active: true }, 'main'), null);
  assert.deepStrictEqual(P.withRole({ parallel: true, fallback: true }, 'fallback'), { fallback: true });
});
check('withRole: an unknown role throws rather than writing nonsense', () => {
  assert.throws(() => P.withRole({}, 'sometimes'));
});

/* ---- the writes, against the fake vault --------------------------------- */
const BODY = '\nIntro line.\n\n## Monday — Push\n- Push-ups | 3 x 10\n';
async function rig(files) {
  const v = fake.makeVault(files);
  const io = makeIo(fake.makePlugin(v));
  const data = await io.loadAll();
  return { v, io, data, by: n => data.plans.find(p => p.name === n) };
}
check('setActivePlan(main, null): every main plan is stamped active: false, key-less ones too', async () => {
  const { v, io, data } = await rig([
    ['Gym/Plans/A.md', `---\nactive: true\n---\n${BODY}`],
    ['Gym/Plans/B.md', `---\nweeks: 4\n---\n${BODY}`],
  ]);
  await io.setActivePlan(data.plans.filter(isMain), null);
  for (const n of ['A', 'B']) {
    assert.strictEqual(String(parseFrontmatter(v._disk.get(`Gym/Plans/${n}.md`)).fm.active), 'false', n);
  }
  assert.ok(v._disk.get('Gym/Plans/B.md').endsWith(BODY), 'the body is the file\'s own');
  assert.strictEqual(P.activePlanOf(data.plans), null, 'and the records agree: nothing runs');
});
check('setPlanRole: frontmatter only, body byte-identical, record updated', async () => {
  const { v, io, by } = await rig([['Gym/Plans/A.md', `---\nactive: true\nweeks: 4\n---\n${BODY}`]]);
  const a = by('A');
  assert.strictEqual(await io.setPlanRole(a, 'parallel'), true);
  const text = v._disk.get('Gym/Plans/A.md');
  const fm = parseFrontmatter(text).fm;
  assert.strictEqual(String(fm.parallel), 'true');
  assert.ok(!('active' in fm) && !('paused' in fm));
  assert.strictEqual(String(fm.weeks), '4');
  assert.ok(text.endsWith(BODY));
  assert.strictEqual(String(a.fm.parallel), 'true');
  assert.strictEqual(P.isPaused(a), false);
});
check('setPlanRole: no-op when already that role (nothing written)', async () => {
  const src = `---\nparallel: true\n---\n${BODY}`;
  const { v, io, by } = await rig([['Gym/Plans/R.md', src]]);
  assert.strictEqual(await io.setPlanRole(by('R'), 'parallel'), true);
  assert.strictEqual(v._disk.get('Gym/Plans/R.md'), src);
});

/* ---- the UI ------------------------------------------------------------- */
const MAIN_ON = plan('Lunch Circuit', { active: true }, [{ name: 'Circuit', weekday: 'mon' }]);
const MAIN_OFF = plan('Pull Day', { active: false }, [{ name: 'Pull', weekday: 'tue' }]);
const ALONG = plan('Grease the Groove', { parallel: true }, [{ name: 'Grease', weekday: 'wed' }]);
const GAPS = plan('Rest & Recovery', { fallback: true, paused: true }, [{ name: 'Rest', weekday: 'any' }]);
const ALL = [MAIN_ON, MAIN_OFF, ALONG, GAPS];

function makeCtx(params) {
  const calls = { active: [], paused: [], role: [], nav: [], reload: 0 };
  const ctx = {
    data: { plans: ALL, exercises: [] }, app: {}, state: { params: params || {} },
    io: {
      setActivePlan: async (list, target) => { calls.active.push([list.map(p => p.name), target && target.name]); },
      setPaused: async (p, on) => { calls.paused.push([p.name, on]); return true; },
      setPlanRole: async (p, r) => { calls.role.push([p.name, r]); return true; },
      setFavourite: async () => true, savePlan: async () => true,
    },
    nav: (...a) => calls.nav.push(a), rerender: () => {}, reload: () => { calls.reload++; }, notice: () => {},
    openFile: () => {}, startGuided: () => {}, backTo: f => f, back: () => {},
    activePlan: () => P.activePlanOf(ALL), mainPlans: () => ALL.filter(isMain),
  };
  const root = global.document.createElement('div');
  plansPage.render(ctx, root);
  return { root, calls };
}
const flush = () => new Promise(r => setImmediate(r));
const stopEvt = () => ({ target: { closest: () => null }, stopPropagation() { this.stopped = true; } });
const cardOf = (root, name) => flat(root).find(n => hasClass(n, 'gv-plan-card') && new RegExp(`^Open ${name}`).test(n.attrs['aria-label']));
const switchIn = n => flat(n).find(x => x.attrs && x.attrs.role === 'switch');
const selectIn = n => flat(n).find(x => x.tag === 'select');

check('list: every card has a role dropdown showing its role, and an Active switch showing its state', () => {
  const { root } = makeCtx();
  const want = { 'Lunch Circuit': ['main', 'true'], 'Pull Day': ['main', 'false'], 'Grease the Groove': ['parallel', 'true'], 'Rest & Recovery': ['fallback', 'false'] };
  for (const [name, [role, on]] of Object.entries(want)) {
    const card = cardOf(root, name);
    assert.ok(card, name);
    assert.strictEqual(selectIn(card).value, role, `${name} role`);
    assert.strictEqual(switchIn(card).attrs['aria-checked'], on, `${name} on`);
  }
});
check('list: the switch activates / deactivates a main plan via setActivePlan(ctx.mainPlans(), …) and never opens the plan', async () => {
  const { root, calls } = makeCtx();
  const e1 = stopEvt(); fire(switchIn(cardOf(root, 'Pull Day')), 'click', e1);
  const e2 = stopEvt(); fire(switchIn(cardOf(root, 'Lunch Circuit')), 'click', e2);
  await flush();
  assert.deepStrictEqual(calls.active, [[['Lunch Circuit', 'Pull Day'], 'Pull Day'], [['Lunch Circuit', 'Pull Day'], null]]);
  assert.ok(e1.stopped && e2.stopped, 'the tap must stop at the switch');
  assert.strictEqual(calls.nav.length, 0);
});
check('list: the switch pauses / resumes an alongside or fills-gaps plan', async () => {
  const { root, calls } = makeCtx();
  fire(switchIn(cardOf(root, 'Grease the Groove')), 'click', stopEvt());
  fire(switchIn(cardOf(root, 'Rest & Recovery')), 'click', stopEvt());
  await flush();
  assert.deepStrictEqual(calls.paused, [['Grease the Groove', true], ['Rest & Recovery', false]]);
  assert.strictEqual(calls.active.length, 0, 'an alongside plan is never handed to setActivePlan');
});
check('list: changing the dropdown sets the role', async () => {
  const { root, calls } = makeCtx();
  const sel = selectIn(cardOf(root, 'Pull Day'));
  sel.value = 'fallback';
  fire(sel, 'change', stopEvt());
  await flush();
  assert.deepStrictEqual(calls.role, [['Pull Day', 'fallback']]);
  assert.strictEqual(calls.nav.length, 0);
});
check('plan page: a role picker with the three roles, current one pressed; picking one sets it', async () => {
  const { root, calls } = makeCtx({ plan: 'Pull Day' });
  const radios = flat(root).filter(n => n.attrs && n.attrs.role === 'radio');
  assert.deepStrictEqual(radios.map(r => r.textContent.match(/^(Main plan|Add-on|Backup)/)?.[1]), ['Main plan', 'Add-on', 'Backup']);
  assert.deepStrictEqual(radios.map(r => r.attrs['aria-checked']), ['true', 'false', 'false']);
  fire(radios[1], 'click', stopEvt());
  await flush();
  assert.deepStrictEqual(calls.role, [['Pull Day', 'parallel']]);
});
check('plan page: the Active switch is on every plan — the active main plan can be switched OFF', async () => {
  const { root, calls } = makeCtx({ plan: 'Lunch Circuit' });
  const sw = switchIn(root);
  assert.strictEqual(sw.attrs['aria-checked'], 'true');
  assert.ok(/^Active/.test(sw.textContent));
  fire(sw, 'click', stopEvt());
  await flush();
  assert.deepStrictEqual(calls.active, [[['Lunch Circuit', 'Pull Day'], null]]);
  assert.ok(!byTag(root, 'button').some(b => b.textContent.includes('Make active')), 'the switch replaces Make active');
});

/* PLAIN WORDS (18 Nov 2026). Ruan: "user dont know what those terms means,
   options must be more clear or somewhere it needs to be explained". Each role
   option carries the line that says what it does, the list has one "How plans
   work" explainer, and the old jargon is gone from both pages. */
const MEANING = { 'Main plan': /Today follows/, 'Add-on': /on top of your main plan/, Backup: /no workout/ };
check('plain words: every role row on the plan page says what it does under its name', () => {
  const { root } = makeCtx({ plan: 'Grease the Groove' });
  const radios = flat(root).filter(n => n.attrs && n.attrs.role === 'radio');
  assert.strictEqual(radios.length, 3);
  for (const r of radios) {
    const name = Object.keys(MEANING).find(k => r.textContent.startsWith(k));
    assert.ok(name, r.textContent);
    assert.ok(MEANING[name].test(r.textContent), `${name} explains itself: ${r.textContent}`);
  }
});
check('plain words: the list has one "How plans work" explainer naming all three roles with their meaning', () => {
  const { root } = makeCtx();
  const help = flat(root).filter(n => hasClass(n, 'gv-plan-help'));
  assert.strictEqual(help.length, 1);
  for (const [name, re] of Object.entries(MEANING)) {
    assert.ok(help[0].textContent.includes(name) && re.test(help[0].textContent), name);
  }
});
check('plain words: no "Runs alongside" / "Fills gaps" jargon left on the list or a plan page', () => {
  for (const params of [{}, { plan: 'Grease the Groove' }, { plan: 'Rest & Recovery' }, { plan: 'Pull Day' }]) {
    const { root } = makeCtx(params);
    assert.ok(!/runs alongside|fills gaps/i.test(root.textContent), JSON.stringify(params));
  }
});

run('plan controls');
