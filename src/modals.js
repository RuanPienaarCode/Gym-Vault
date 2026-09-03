'use strict';
/* Small form modals, built on Obsidian's Modal + Setting so they match the
   host UI and stay iOS-safe (no window.prompt/confirm/alert — those don't
   exist in Electron). One generic FormModal covers every add/edit form. */

const { Modal, Setting, Notice } = require('obsidian');
const { el, clickableCard } = require('./dom');

/* A modal action that fails must SAY so. These all used to land in
   console.error alone, which on a phone is invisible — a delete that threw
   looked exactly like a delete that did nothing, and cost a debugging round
   to tell apart. */
const failed = (what, e) => {
  console.error(`gym-vault ${what}`, e);
  new Notice(`Gym: ${what} failed — ${(e && e.message) || e}`, 8000);
};

/* fields: [{key, label, kind: 'text'|'number'|'date'|'dropdown'|'toggle'|'textarea',
             options?, value?, placeholder?, desc?}]
   onSubmit(values) — called only when required fields validate. */
class FormModal extends Modal {
  constructor(app, { title, fields, submitLabel, onSubmit, validate }) {
    super(app);
    this.titleText = title;
    this.fields = fields;
    this.submitLabel = submitLabel || 'Save';
    this.onSubmit = onSubmit;
    this.validate = validate;
    this.values = {};
    for (const f of fields) this.values[f.key] = f.value ?? (f.kind === 'toggle' ? false : '');
  }

  onOpen() {
    this.modalEl.addClass('gv-modal');
    this.titleEl.setText(this.titleText);
    const c = this.contentEl;
    for (const f of this.fields) {
      const s = new Setting(c).setName(f.label);
      if (f.desc) s.setDesc(f.desc);
      if (f.kind === 'dropdown') {
        s.addDropdown(d => {
          for (const [val, label] of f.options) d.addOption(val, label);
          d.setValue(String(this.values[f.key] ?? ''));
          d.onChange(v => { this.values[f.key] = v; });
        });
      } else if (f.kind === 'toggle') {
        s.addToggle(t => t.setValue(!!this.values[f.key]).onChange(v => { this.values[f.key] = v; }));
      } else if (f.kind === 'textarea') {
        s.addTextArea(t => {
          t.setValue(String(this.values[f.key] ?? ''));
          if (f.placeholder) t.setPlaceholder(f.placeholder);
          t.onChange(v => { this.values[f.key] = v; });
        });
      } else {
        s.addText(t => {
          if (f.kind === 'number') t.inputEl.type = 'number';
          if (f.kind === 'date') t.inputEl.type = 'date';
          if (f.placeholder) t.setPlaceholder(f.placeholder);
          t.setValue(String(this.values[f.key] ?? ''));
          t.onChange(v => { this.values[f.key] = v; });
        });
      }
    }
    this.errEl = c.createDiv({ cls: 'gv-modal-err' });
    new Setting(c).addButton(b => b.setButtonText(this.submitLabel).setCta().onClick(() => this.submit()));
  }

  submit() {
    const err = this.validate ? this.validate(this.values) : null;
    if (err) { this.errEl.setText(err); return; }
    this.close();
    // After close so a throwing handler can't strand a dead modal on screen.
    Promise.resolve(this.onSubmit(this.values)).catch(e => failed('save', e));
  }

  onClose() { this.contentEl.empty(); }
}

class ConfirmModal extends Modal {
  constructor(app, { title, message, confirmLabel, onConfirm }) {
    super(app);
    this.t = title; this.m = message; this.cl = confirmLabel || 'Delete'; this.onConfirm = onConfirm;
  }
  onOpen() {
    this.modalEl.addClass('gv-modal');
    this.titleEl.setText(this.t);
    this.contentEl.createEl('p', { text: this.m });
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText('Cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText(this.cl).setWarning().onClick(() => {
        this.close();
        Promise.resolve(this.onConfirm()).catch(e => failed('delete', e));
      }));
  }
  onClose() { this.contentEl.empty(); }
}

/* Ending a session is a FORK, not a confirmation — the two ways out are save
   and discard, and the sheet has to name BOTH. It used to be a ConfirmModal
   titled "Discard session?", which meant the only route to *keeping* a
   workout ran under a heading that said the opposite: you tapped X (an icon
   that reads as cancel), landed on discard-flavoured chrome, and had to
   trust that "Bank it" was the save. Reported from a 0.10.2 smoke test.

   onReview is optional and exists for exactly one caller: the guided screen,
   where "back to the overview" is a third, non-committal way out AND the
   only route there, since the log page is not a nav tab. On the log page
   itself there is nothing to go back to, so it is left off. */
class EndSessionModal extends Modal {
  constructor(app, { onSave, onDiscard, onReview }) {
    super(app);
    this.onSave = onSave; this.onDiscard = onDiscard; this.onReview = onReview || null;
  }
  onOpen() {
    this.modalEl.addClass('gv-modal');
    this.titleEl.setText('End session');
    this.contentEl.createEl('p', { text: 'Save what you logged, or throw the session away.' });
    /* Order is Obsidian's: the way back first, the destructive next, the
       primary last and rightmost — so the save is under the thumb and the
       discard is not where a hurried tap lands. */
    const s = new Setting(this.contentEl)
      .addButton(b => b.setButtonText('Keep going').onClick(() => this.close()));
    if (this.onReview) {
      s.addButton(b => b.setButtonText('Back to the log').onClick(() => {
        this.close();
        this.onReview();
      }));
    }
    s.addButton(b => b.setButtonText('Discard').setWarning().onClick(() => {
      this.close();
      Promise.resolve(this.onDiscard()).catch(e => failed('discarding the session', e));
    }));
    s.addButton(b => b.setButtonText('Bank it').setCta().onClick(() => {
      this.close();
      Promise.resolve(this.onSave()).catch(e => failed('saving the session', e));
    }));
  }
  onClose() { this.contentEl.empty(); }
}

/* Switch which plan drives the dashboard. Parallel and fallback plans are
   listed too but not selectable — they are not alternatives, they fill in
   around whatever is active, and saying so beats hiding them. */
class PlanPickerModal extends Modal {
  constructor(app, { plans, extras, currentName, onPick }) {
    super(app);
    this.plans = plans; this.extras = extras || []; this.currentName = currentName; this.onPick = onPick;
  }
  onOpen() {
    this.modalEl.addClass('gv-modal');
    this.titleEl.setText('Switch plan');
    const c = this.contentEl;
    for (const p of this.plans) {
      const on = p.name === this.currentName;
      /* This modal's rows are its ONLY interactive content — before
         clickableCard these were plain createDiv()s with a click listener
         and no keyboard route at all, so there was no way to switch plans
         without a mouse/touch. */
      const row = clickableCard(
        { class: `gv-card gv-optrow${on ? ' on' : ''}` },
        () => {
          this.close();
          if (!on) Promise.resolve(this.onPick(p)).catch(e => failed('switching plan', e));
        },
        el('div', { class: 'gv-optrow-main' },
          el('div', { class: 'gv-optrow-name' }, p.name),
          el('div', { class: 'gv-optrow-desc' }, planSummary(p))),
        on ? el('div', { class: 'gv-optrow-desc' }, 'active') : '');
      c.append(row);
    }
    for (const p of this.extras) {
      const row = c.createDiv({ cls: 'gv-card gv-optrow gv-optrow-static' });
      const main = row.createDiv({ cls: 'gv-optrow-main' });
      main.createDiv({ cls: 'gv-optrow-name', text: p.name });
      main.createDiv({ cls: 'gv-optrow-desc',
        text: String(p.fm.fallback) === 'true'
          ? 'Fills any day your plan leaves empty — always on.'
          : 'Runs alongside whichever plan is active — always on.' });
    }
  }
  onClose() { this.contentEl.empty(); }
}

function planSummary(p) {
  const days = p.model.days.filter(d => d.items.length);
  return `${days.length} day${days.length === 1 ? '' : 's'} · ${days.map(d => d.weekday).join(', ')}`;
}

module.exports = { FormModal, ConfirmModal, EndSessionModal, PlanPickerModal };
