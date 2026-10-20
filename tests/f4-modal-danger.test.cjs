'use strict';
/* B-L5-06 (usability fix wave 20 Oct 2026): A FORM MODAL'S ERROR IS RED.

   FormModal / ConfirmModal / EndSessionModal / PlanPickerModal mark their modalEl
   `.gv-modal` but, unlike the rep counter and media viewer, not `.gv-app` (which
   would impose the app root's flex column and the whole token set on a plain
   Obsidian dialog). The error line's `color: var(--gv-danger)` therefore resolved to
   nothing and fell back to the dialog's body colour: a validation message that does
   not look like one. The error line now carries its own --gv-danger, with the SAME
   two values the app root uses; this pins that they cannot drift apart. */
const assert = require('node:assert');
const cx = require('./css-cascade.js');

let failed = 0;
const check = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); }
  catch (e) { failed++; console.error('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
};
const rules = cx.load();
for (const theme of ['light', 'dark']) {
  check(`${theme}: the modal error resolves --gv-danger to the app's own value`, () => {
    const cls = theme === 'dark' ? 'body.theme-dark' : 'body.theme-light';
    const app = cx.computed(cx.chainOf([cls, 'div.gv-app']), '--gv-danger', rules);
    const err = cx.computed(cx.chainOf([cls, 'div.modal.gv-modal', 'div.gv-modal-err']), '--gv-danger', rules);
    assert.ok(app, 'the app root defines --gv-danger');
    assert.ok(err, `a .gv-modal error has no --gv-danger in ${theme}: its colour: var(--gv-danger) resolves to nothing`);
    assert.strictEqual(err.value, app.value, `modal ${err.value} vs app ${app.value}`);
  });
}
if (failed) { console.error(`${failed} check(s) failed`); process.exit(1); }
console.log('f4-modal-danger OK');
