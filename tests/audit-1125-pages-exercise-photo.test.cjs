'use strict';
/* AUDIT 25 NOV 2026, #29 (Medium): adding a picture to an exercise needed a
   typed file path ("vault path or https URL"). Nobody types a file path on a
   phone.

   What this pins:
     P1  The exercise form's Images row has an "Add photo" button backed by a
         hidden <input type="file" accept="image/*"> (the iOS-safe way; no
         `capture`, so the phone offers camera AND library). The text box stays
         for a pasted URL.
     P2  A chosen picture is saved under <Gym folder>/Attachments/<exercise>/,
         the Gym folder THIS phone uses, and its vault path is appended to the
         Images field (never replacing what is there).
     P3  A second picture the same day never overwrites the first; a clash in
         another letter case counts (macOS/iOS are case-insensitive).
     P4  A path with a comma (the Images box splits on commas) goes in as a
         [[link]], which the box keeps whole.
     P5  The picture goes through photo-capture's toJpegBytes (longest edge
         1600, JPEG 0.85), the same size rule as progress photos.
     P6  A new exercise with no name yet has no folder to save into: it says
         so and writes nothing. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const T = require('./f3-stub');
const { makeVault } = require('./gym-fake-vault');

/* ---- an Obsidian Modal/Setting good enough to open the real FormModal ---- */
const withDiv = n => { n.createDiv = () => { const d = T.mkNode('div'); d.setText = t => { d._text = t; }; n.append(d); return d; }; return n; };
class Modal {
  constructor(app) { this.app = app; this.modalEl = { addClass() {} }; this.titleEl = { setText() {} }; this.contentEl = withDiv(T.mkNode('div')); }
  open() { this.onOpen(); } close() { this.closed = true; }
}
class Setting {
  constructor(container) {
    this.settingEl = T.mkNode('div'); this.controlEl = T.mkNode('div'); this.settingEl.append(this.controlEl);
    this.name = ''; container.append(this.settingEl);
    (Setting.all || (Setting.all = [])).push(this);
  }
  setName(n) { this.name = n; return this; }
  setDesc(d) { this.desc = d; return this; }
  addText(fn) {
    const s = this;
    const t = { inputEl: { type: 'text' }, value: '', setValue(v) { this.value = String(v); return this; }, setPlaceholder(p) { this.ph = p; return this; }, onChange(f) { this._c = f; return this; } };
    s.text = t; fn(t); return this;
  }
  addDropdown(fn) { fn({ addOption() { return this; }, setValue() { return this; }, onChange() { return this; } }); return this; }
  addToggle(fn) { fn({ setValue() { return this; }, onChange() { return this; } }); return this; }
  addTextArea(fn) { return this.addText(fn); }
  addButton(fn) {
    const b = { label: '', disabled: false, setButtonText(x) { this.label = x; return this; }, setCta() { return this; }, setWarning() { return this; }, setDisabled(v) { this.disabled = v; return this; }, onClick(f) { this._click = f; return this; } };
    (this.buttons || (this.buttons = [])).push(b); fn(b); return this;
  }
}
T.stub.Modal = Modal;
T.stub.Setting = Setting;
const notices = [];
T.stub.Notice = class { constructor(m) { notices.push(String(m)); } };

const { FormModal } = require('../src/modals');
const exercises = require('../src/page-exercises');
const photo = require('../src/exercise-photo');

const failures = [];
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok   ${name}`); } catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${String(e && e.message || e).split('\n')[0]}`); }
};
const tick = () => new Promise(r => setImmediate(r));
const BYTES = new Uint8Array([0xff, 0xd8, 0xff]).buffer;

(async () => {
  await test('P1 the Images row has Add photo and a hidden image file input; the text box stays', async () => {
    Setting.all = [];
    const fields = exercises.exerciseFields({ image: 'https://x.example/a.jpg' }, 'Pull-ups', async () => 'Gym/Attachments/Pull-ups/p.jpg');
    const img = fields.find(f => f.key === 'image');
    assert.strictEqual(img.kind, 'images', `the Images field is kind "${img.kind}"`);
    assert.strictEqual(typeof img.onPhoto, 'function');
    const m = new FormModal({}, { title: 't', fields, onSubmit() {} });
    m.open();
    const row = Setting.all.find(s => s.name === 'Images');
    assert.ok(row.text, 'the text box for a pasted URL is gone');
    assert.strictEqual(row.text.value, 'https://x.example/a.jpg');
    const add = (row.buttons || []).find(b => b.label === 'Add photo');
    assert.ok(add, 'no Add photo button');
    const input = T.findAll(row.controlEl, 'gv-photo-input')[0];
    assert.ok(input, 'no file input');
    assert.strictEqual(input.tag, 'input');
    assert.strictEqual(input.getAttribute('type'), 'file');
    assert.strictEqual(input.getAttribute('accept'), 'image/*');
    assert.strictEqual(input.getAttribute('capture'), undefined, '`capture` would take away the photo library');
    assert.strictEqual(input.hidden, true, 'the native file input must not show');
    let clicked = 0; input.click = () => { clicked++; };
    add._click();
    assert.strictEqual(clicked, 1, 'Add photo must open the picker');
  });
  await test('P2 a chosen picture is appended to the Images field', async () => {
    Setting.all = [];
    const seen = [];
    const fields = exercises.exerciseFields({ image: 'https://x.example/a.jpg' }, 'Pull-ups', async (file, values) => { seen.push([file.name, values.image]); return 'Gym/Attachments/Pull-ups/Pull-ups 2026-11-25.jpg'; });
    let submitted = null;
    const m = new FormModal({}, { title: 't', fields, onSubmit: v => { submitted = v; } });
    m.open();
    const row = Setting.all.find(s => s.name === 'Images');
    const input = T.findAll(row.controlEl, 'gv-photo-input')[0];
    input.files = [{ name: 'IMG_1.HEIC' }];
    (input.listeners.change || []).forEach(fn => fn());
    await tick(); await tick();
    assert.deepStrictEqual(seen, [['IMG_1.HEIC', 'https://x.example/a.jpg']]);
    assert.strictEqual(m.values.image, 'https://x.example/a.jpg, Gym/Attachments/Pull-ups/Pull-ups 2026-11-25.jpg');
    assert.strictEqual(row.text.value, m.values.image, 'the box must show the new path');
    assert.strictEqual(exercises.parseImages(m.values.image).length, 2, 'the two entries must parse as two images');
    m.submit();
    assert.strictEqual(submitted.image, m.values.image);
  });
  await test('P2 saved under <this phone\'s Gym folder>/Attachments/<exercise>/', async () => {
    const v = makeVault();
    const stamps = [];
    const p = await photo.saveExercisePhoto({ vault: v }, { gymFolder: 'Gym Anna', exercise: 'Pull-ups', bytes: BYTES, dateISO: '2026-11-25', onWrite: x => stamps.push(x) });
    assert.strictEqual(p, 'Gym Anna/Attachments/Pull-ups/Pull-ups 2026-11-25.jpg');
    assert.ok(v.getFileByPath(p), 'nothing written');
    assert.ok(stamps.includes(p), 'the write must be recorded as our own (the watcher skips it)');
  });
  await test('P3 the same day twice, or a clash in another case, never overwrites', async () => {
    const v = makeVault([['Gym/Attachments/pull-ups/pull-ups 2026-11-25.jpg', 'old']]);
    const p = await photo.saveExercisePhoto({ vault: v }, { gymFolder: 'Gym', exercise: 'Pull-ups', bytes: BYTES, dateISO: '2026-11-25' });
    assert.ok(/ 2\.jpg$/i.test(p), `got ${p}`);
    const q = await photo.saveExercisePhoto({ vault: v }, { gymFolder: 'Gym', exercise: 'Pull-ups', bytes: BYTES, dateISO: '2026-11-25' });
    assert.ok(/ 3\.jpg$/i.test(q), `got ${q}`);
    assert.strictEqual(v._disk.get('Gym/Attachments/pull-ups/pull-ups 2026-11-25.jpg'), 'old');
  });
  await test('P4 a path with a comma goes in as a [[link]] the box keeps whole', () => {
    assert.strictEqual(photo.withImage('', 'Gym/Attachments/Squat/a.jpg'), 'Gym/Attachments/Squat/a.jpg');
    assert.strictEqual(photo.withImage('a.jpg, ', 'Gym/b.jpg'), 'a.jpg, Gym/b.jpg');
    const val = photo.withImage('a.jpg', 'Gym, Anna/Attachments/Squat/b.jpg');
    assert.deepStrictEqual(exercises.parseImages(val), ['a.jpg', '[[Gym, Anna/Attachments/Squat/b.jpg]]']);
  });
  await test('P5 the picture is resized by photo-capture\'s toJpegBytes', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'exercise-photo.js'), 'utf8');
    assert.ok(/require\('\.\/photo-capture'\)/.test(src) && /toJpegBytes\(/.test(src), 'exercise-photo must reuse toJpegBytes');
  });
  await test('P6 a new exercise with no name says so and writes nothing', async () => {
    const v = makeVault();
    const ctx = { app: { vault: v }, settings: { gymFolder: 'Gym' }, plugin: {}, notice: m => notices.push(m) };
    const prev = photo.fileToJpeg;
    photo.fileToJpeg = async () => BYTES;
    try {
      const add = exercises.photoAdder(ctx, '');
      notices.length = 0;
      assert.strictEqual(await add({ name: 'x.jpg' }, { name: '  ' }), null);
      assert.ok(notices.some(n => /name/i.test(n)), 'it must say a name is needed');
      assert.ok(!v._log.some(e => e[0] === 'createBinary'));
      const saved = await add({ name: 'x.jpg' }, { name: 'Pull-ups' });
      assert.ok(saved && saved.indexOf('Gym/Attachments/Pull-ups/') === 0, `got ${saved}`);
    } finally { photo.fileToJpeg = prev; }
  });

  if (failures.length) { console.log(`audit-1125 pages exercise photo: ${failures.length} FAILED`); process.exit(1); }
  console.log('audit-1125 pages exercise photo OK');
})();
