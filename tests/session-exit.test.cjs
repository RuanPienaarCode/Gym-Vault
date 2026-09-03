'use strict';
/* THE BUG THIS LOCKS (issue #1, from a 0.10.2 smoke test): there was no way
   to SAVE a session from the live workout screen. The only exit was an X,
   which navigated to the log overview — and the overview's own chrome was
   discard-flavoured throughout: the back arrow was aria-labelled "Discard
   session", it opened a sheet titled "Discard session?", and the button that
   actually wrote the note sat beside a "Discard session" button under it.
   Someone trying to KEEP three sets had to walk a cancel icon, a discard
   heading, and trust "Bank it".

   The data path was never wrong. These guards are on the exit: the sheet
   both routes share must name BOTH ways out, and no control that saves or
   merely leaves may be labelled as a discard. */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

/* ---- a Modal/Setting stub rich enough to render EndSessionModal ---- */

const made = [];
class Modal {
  constructor() {
    this.modalEl = { addClass: () => {} };
    this.titleEl = { text: '', setText(t) { this.text = t; } };
    this.contentEl = {
      paras: [],
      createEl(_tag, o) { this.paras.push(o && o.text); return {}; },
      empty() {},
    };
    this.closed = 0;
  }
  close() { this.closed++; }
  open() { this.onOpen(); }
}
class Setting {
  constructor() { this.buttons = []; made.push(this); }
  addButton(fn) {
    const b = {
      text: '', cta: false, warning: false, click: null,
      setButtonText(t) { this.text = t; return this; },
      setCta() { this.cta = true; return this; },
      setWarning() { this.warning = true; return this; },
      onClick(f) { this.click = f; return this; },
    };
    fn(b);
    this.buttons.push(b);
    return this;
  }
}

const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian'
  ? { Modal, Setting, Notice: class {} }
  : origLoad(req, ...rest));
const { EndSessionModal } = require('../src/modals');
Module._load = origLoad;

const openSheet = opts => {
  made.length = 0;
  const m = new EndSessionModal({}, opts);
  m.open();
  return { modal: m, buttons: made.flatMap(s => s.buttons) };
};

/* ---- GUARD 1: the sheet is a fork, and it says so ---- */
{
  let saved = 0, discarded = 0, reviewed = 0;
  const { modal, buttons } = openSheet({
    onSave: () => { saved++; }, onDiscard: () => { discarded++; }, onReview: () => { reviewed++; },
  });

  assert.strictEqual(modal.titleEl.text, 'End session',
    'the sheet every exit shares must not be titled as a discard — that was the whole bug');

  const labels = buttons.map(b => b.text);
  assert.deepStrictEqual(labels, ['Keep going', 'Back to the log', 'Discard', 'Bank it'],
    'the sheet must offer all four ways out, with the save last (rightmost, under the thumb)');

  const save = buttons.find(b => b.cta);
  const discard = buttons.find(b => b.warning);
  assert.strictEqual(save.text, 'Bank it', 'the PRIMARY action must be the save');
  assert.strictEqual(discard.text, 'Discard', 'the destructive action must be the discard');
  assert.ok(buttons.indexOf(save) > buttons.indexOf(discard),
    'the discard must not sit where a hurried tap on the primary lands');

  /* Each one runs its own handler, and closes the sheet first. */
  for (const b of buttons) b.click();
  assert.deepStrictEqual([saved, discarded, reviewed], [1, 1, 1],
    'every action must fire exactly its own callback');
  assert.strictEqual(modal.closed, 4, 'every action closes the sheet, including Keep going');
}

/* ---- GUARD 2: onReview is optional, and dropping it drops only that row ---- */
{
  const { buttons } = openSheet({ onSave: () => {}, onDiscard: () => {} });
  assert.deepStrictEqual(buttons.map(b => b.text), ['Keep going', 'Discard', 'Bank it'],
    'without a review route the sheet must still offer save and discard');
}

/* ---- GUARD 3: no exit control is labelled as a discard ---- */

const read = f => fs.readFileSync(path.join(__dirname, '..', 'src', f), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

{
  /* The live screen's X and the overview's back arrow both merely LEAVE.
     Labelling either as a discard is what sent the reporter looking for a
     save that was never there. */
  for (const f of ['page-session.js', 'page-log.js']) {
    const src = strip(read(f));
    assert.ok(!/'aria-label':\s*'Discard session'/.test(src),
      `${f}: an exit control is aria-labelled "Discard session" — it leaves, it does not discard`);
  }

  /* The only surviving "Discard session?" confirm belongs to the button that
     IS the destructive route. Anywhere else it is the old bug back. */
  const log = strip(read('page-log.js'));
  const confirms = log.match(/title:\s*'Discard session\?'/g) || [];
  assert.strictEqual(confirms.length, 1,
    'only the explicit Discard button may confirm under a "Discard session?" heading');
}

/* ---- GUARD 4: the live screen can save without going through X ---- */
{
  const src = strip(read('page-session.js'));
  assert.match(src, /gv-session-finish/,
    'the rest phase must carry a visible Finish — ending early is a rest-phase decision');
  assert.match(src, /finishBtn\.addEventListener\('click',\s*\(\)\s*=>\s*finishSession\(ctx,\s*draft\)\)/,
    'that Finish must bank the session, not merely navigate');
  assert.match(src, /new EndSessionModal\(/,
    'the live screen exit must go through the End session sheet');
  assert.ok(!/'aria-label':\s*'Exit to overview'/.test(src),
    'X no longer silently drops you on the overview — it asks');
}

console.log('session exit OK (the sheet names both ways out; no exit is labelled a discard; rest can bank)');
