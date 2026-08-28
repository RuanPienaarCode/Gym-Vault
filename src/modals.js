'use strict';
/* Small form modals, built on Obsidian's Modal + Setting so they match the
   host UI and stay iOS-safe (no window.prompt/confirm/alert — those don't
   exist in Electron). One generic FormModal covers every add/edit form. */

const { Modal, Setting } = require('obsidian');

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
    Promise.resolve(this.onSubmit(this.values)).catch(e => console.error('gym-vault form submit', e));
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
        Promise.resolve(this.onConfirm()).catch(e => console.error('gym-vault confirm', e));
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
      const row = c.createDiv({ cls: `gv-card gv-optrow${on ? ' on' : ''}` });
      const main = row.createDiv({ cls: 'gv-optrow-main' });
      main.createDiv({ cls: 'gv-optrow-name', text: p.name });
      main.createDiv({ cls: 'gv-optrow-desc', text: planSummary(p) });
      if (on) row.createDiv({ cls: 'gv-optrow-desc', text: 'active' });
      row.addEventListener('click', () => {
        this.close();
        if (!on) Promise.resolve(this.onPick(p)).catch(e => console.error('gym-vault switch plan', e));
      });
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

module.exports = { FormModal, ConfirmModal, PlanPickerModal };
