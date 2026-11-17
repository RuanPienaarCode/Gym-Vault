'use strict';
/* Audit 16 Nov 2026, lane DATA, finding 9 (Medium) — the "Log measurement"
   form.

   Its fields were `<input type="number">`. A browser number input holds
   exactly one decimal separator, the period: in a comma-decimal locale (South
   Africa) "82,5" leaves `.value` an EMPTY STRING, so the weight vanished and
   appendBodyRow dropped it as "not measured". The form only validated the
   date, so a date-only submit — or one whose every figure had just vanished —
   wrote an all-empty row to the Body Log. dom.js already documents the fix
   (`numericInput` / `normaliseNumber`, a text input with inputmode=decimal)
   and the logging screens use it; the generic FormModal now has a `decimal`
   kind that does too, and the measurement form (and the profile's height)
   uses it. A submit with no measurement is refused with a message.

   Drives the real page-profile.js + modals.js over a fake DOM and a Setting
   stub that behaves like Obsidian's (controlEl, addText, addButton). */
const assert = require('node:assert');
const T = require('./f3-stub');

/* ---- an Obsidian Modal / Setting that is just enough for FormModal ------- */
const { mkNode } = T;
const decorate = x => {
  x.addClass = c => x.classList.add(c);
  x.setText = t => { x._text = t; };
  x.createDiv = opts => { const d = decorate(mkNode('div')); if (opts && opts.cls) d.className = opts.cls; x.append(d); return d; };
  x.createEl = (tag, opts) => { const d = decorate(mkNode(tag)); if (opts && opts.text) d._text = opts.text; x.append(d); return d; };
  return x;
};
const modals = [];
const settings = [];
T.stub.Modal = class {
  constructor(app) {
    this.app = app; this.closed = false;
    this.modalEl = decorate(mkNode('div')); this.contentEl = decorate(mkNode('div')); this.titleEl = decorate(mkNode('div'));
    modals.push(this);
  }
  open() { this.onOpen(); }
  close() { this.closed = true; }
};
T.stub.Setting = class {
  constructor(container) {
    this.controlEl = decorate(mkNode('div'));
    this.name = ''; this.button = null; this.textInput = null;
    container.append(this.controlEl);
    settings.push(this);
  }
  setName(n) { this.name = n; return this; }
  setDesc() { return this; }
  addText(cb) {
    const inputEl = decorate(mkNode('input'));
    inputEl.type = 'text';
    let onChange = null;
    inputEl.addEventListener('input', () => onChange && onChange(inputEl.value));
    const comp = {
      inputEl,
      setPlaceholder() { return comp; },
      setValue(v) { inputEl.value = v; return comp; },
      onChange(fn) { onChange = fn; return comp; },
    };
    this.controlEl.append(inputEl);
    this.textInput = inputEl;
    cb(comp);
    return this;
  }
  addDropdown(cb) {
    const comp = { addOption() {}, setValue() { return comp; }, onChange() { return comp; } };
    cb(comp); return this;
  }
  addButton(cb) {
    const b = {
      setButtonText(t) { b.text = t; return b; }, setCta() { return b; }, setWarning() { return b; },
      onClick(fn) { b.click = fn; return b; },
    };
    cb(b); this.button = b; return this;
  }
};

const profile = require('../src/page-profile');

/* ---- the harness --------------------------------------------------------- */
const writes = { body: [], profile: [] };
const ctx = {
  data: { profile: { fm: { name: 'Test', height_cm: '180' }, body: '' }, body: [], bodyFile: null },
  settings: {}, state: {}, app: {}, nav() {}, notice() {}, reload() {}, openFile() {},
  io: {
    listPhotos: async () => [],
    appendBodyRow: async row => { writes.body.push({ ...row }); },
    saveProfile: async (fm) => { writes.profile.push({ ...fm }); return true; },
  },
};
const pageRoot = T.render(profile, ctx);
const buttons = T.findAll(pageRoot, 'gv-btn');
const clickByText = (nodes, text) => {
  const b = nodes.find(x => String(x.textContent).includes(text));
  assert.ok(b, `no button "${text}"`);
  b.click();
};

/* A text field is Obsidian's own addText input; a decimal field is appended to controlEl. */
const inputOf = label => { const s = settings.find(x => x.name === label); return s.textInput || s.controlEl.children[0]; };

const openMeasurement = () => {
  modals.length = 0; settings.length = 0;
  clickByText(buttons, 'Measurement');
  const m = modals[modals.length - 1];
  const field = label => inputOf(label);
  const type = (label, text) => {
    const i = field(label);
    i.value = text;
    (i.listeners.input || []).forEach(fn => fn({}));
  };
  const submit = async () => {
    const before = writes.body.length;
    settings.find(s => s.button && s.button.click).button.click();
    await new Promise(r => setTimeout(r, 5));
    return writes.body.length > before ? writes.body[writes.body.length - 1] : null;
  };
  return { m, field, type, submit, err: () => m.errEl && m.errEl._text };
};

let failed = 0;
const queue = [];
const check = (name, fn) => queue.push([name, fn]);

check('F9 the weight field is a text input with a decimal keypad, not type=number', async () => {
  const { field } = openMeasurement();
  const w = field('Weight (kg)');
  assert.notStrictEqual(w.type, 'number', 'weight is still <input type="number">: "82,5" reads back empty in a comma locale');
  assert.strictEqual(w.attrs.type, 'text');
  assert.strictEqual(w.attrs.inputmode, 'decimal');
});

check('F9 every measurement field takes the same path; only the date and the note do not', async () => {
  const { field } = openMeasurement();
  for (const label of ['Weight (kg)', 'Body fat %', 'Waist (cm)', 'Chest (cm)', 'Hips (cm)', 'Arm (cm)', 'Thigh (cm)', 'Resting heart rate',
    'Blood pressure — systolic', 'Blood pressure — diastolic', 'Total cholesterol (mmol/L)', 'Glucose (mmol/L)']) {
    assert.strictEqual(field(label).attrs && field(label).attrs.inputmode, 'decimal', `${label} is not a decimal text field`);
  }
  assert.strictEqual(field('Date').type, 'date');
  assert.notStrictEqual(field('Note').attrs && field('Note').attrs.inputmode, 'decimal');
});

check('F9 typing "82,5" stores 82.5', async () => {
  const f = openMeasurement();
  f.type('Weight (kg)', '82,5');
  const row = await f.submit();
  assert.ok(row, `nothing was written (error: ${f.err()})`);
  assert.strictEqual(row.weight_kg, '82.5');
});

check('F9 a figure pasted with its unit is cleaned ("82,5 kg" -> 82.5), and junk is not stored', async () => {
  const f = openMeasurement();
  f.type('Weight (kg)', '82,5 kg');
  f.type('Waist (cm)', 'abc');
  const row = await f.submit();
  assert.ok(row, `nothing was written (error: ${f.err()})`);
  assert.strictEqual(row.weight_kg, '82.5');
  assert.strictEqual(row.waist_cm, '', 'junk survived into the row');
});

check('F9 a date-only submit is refused with a message and writes nothing', async () => {
  const f = openMeasurement();
  const row = await f.submit();
  assert.strictEqual(row, null, `an all-empty row was written: ${JSON.stringify(row)}`);
  assert.ok(f.err() && /measurement/i.test(f.err()), `no message to the user, error line: ${JSON.stringify(f.err())}`);
  assert.strictEqual(f.m.closed, false, 'the form closed on a refused submit');
});

check('F9 a note alone is not a measurement either', async () => {
  const f = openMeasurement();
  f.type('Note', 'felt great');
  const row = await f.submit();
  assert.strictEqual(row, null, 'a note-only row was written');
  assert.ok(/measurement/i.test(f.err() || ''), `error line: ${JSON.stringify(f.err())}`);
});

check('F9 figures that are only junk count as no measurement', async () => {
  const f = openMeasurement();
  f.type('Weight (kg)', 'abc');
  const row = await f.submit();
  assert.strictEqual(row, null, `a row of nothing was written: ${JSON.stringify(row)}`);
});

check('F9 a missing date is still refused with the date message', async () => {
  const f = openMeasurement();
  f.field('Date').value = '';
  (f.field('Date').listeners.input || []).forEach(fn => fn({}));
  f.type('Weight (kg)', '80');
  const row = await f.submit();
  assert.strictEqual(row, null);
  assert.ok(/date/i.test(f.err() || ''), `error line: ${JSON.stringify(f.err())}`);
});

check('F9 one real measurement is written once, with the others blank', async () => {
  const f = openMeasurement();
  f.type('Resting heart rate', '58');
  const row = await f.submit();
  assert.ok(row);
  assert.strictEqual(row.resting_hr, '58');
  assert.strictEqual(row.weight_kg, '');
});

check('F9 the profile\'s height takes a comma decimal too (an empty height blanked the saved one)', async () => {
  modals.length = 0; settings.length = 0;
  const edit = T.findAll(pageRoot, 'gv-icon-btn').find(b => b.attrs['aria-label'] === 'Edit profile');
  assert.ok(edit, 'no edit button');
  edit.click();
  const h = inputOf('Height (cm)');
  assert.strictEqual(h.attrs.inputmode, 'decimal');
  h.value = '172,5';
  h.listeners.input.forEach(fn => fn({}));
  settings.find(s => s.button && s.button.click).button.click();
  await new Promise(r => setTimeout(r, 5));
  assert.strictEqual(writes.profile[writes.profile.length - 1].height_cm, '172.5');
});

(async () => {
  for (const [name, fn] of queue) {
    try { await fn(); console.log('  ok   ' + name); }
    catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e && e.message || e).split('\n').join('\n       ')); }
  }
  if (failed) { console.log(`audit-1116-data-profile-measure: ${failed} of ${queue.length} guard(s) FAILED`); process.exit(1); }
  console.log(`audit-1116-data-profile-measure OK (${queue.length} guards)`);
})();
