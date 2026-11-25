'use strict';
/* "Choose another workout" (audit 25 Nov 2026, finding 30). Today follows the
   active plan; doing something else for ONE day used to mean switching the
   plan for good. This lists every plan that has something to train and starts
   the chosen day through the normal start path, without touching which plan is
   active. Read-only: it writes nothing itself, it hands (plan, day) back. */

const { Modal } = require('obsidian');
const { el, ico, emptyLine, clear } = require('./dom');
const { WEEKDAY_LABELS } = require('./constants');
const { planRole, startDayFor } = require('./plan-parse');

/* The dialog is appended to <body>, outside the view, so it wears the live
   root's skin and accent classes: modals.js wearApp, the one rule. */
const { wearApp } = require('./modals');

/* A list this long is worth a search box. */
const SEARCH_FROM = 11;
/* In-use plans lead in the Plans list's own order: main, add-on, backup. */
const ROLE_RANK = { active: 0, alongside: 1, 'fills-gaps': 2 };

/* The rows, pure. Every plan with something to train (switched-off ones too),
   plans in use first, the rest in the order they came. `pick` is the day
   plan-parse.startDayFor opens on `todayKey`: the same day the Plans page's
   start card shows. */
function pickerRows(plans, activePlan, todayKey) {
  const rows = [];
  (plans || []).forEach((plan, i) => {
    const pick = startDayFor(plan, todayKey);
    if (!pick) return;
    const role = planRole(plan, activePlan);
    rows.push({ plan, pick, inUse: !!role, rank: role ? ROLE_RANK[role] : 3, i });
  });
  rows.sort((a, b) => a.rank - b.rank || a.i - b.i);
  return rows.map(({ plan, pick, inUse }) => ({ plan, pick, inUse }));
}

const whenWord = pick => (pick.today ? 'today' : (WEEKDAY_LABELS[pick.weekday] || pick.weekday));

class WorkoutPickerModal extends Modal {
  /* rows: pickerRows(...). onStart(plan, day): the caller's start path. */
  constructor(app, { rows, onStart }) {
    super(app);
    this.rows = rows || []; this.onStart = onStart; this.q = '';
  }
  onOpen() {
    this.modalEl.addClass('gv-modal');
    wearApp(this.modalEl);
    this.titleEl.setText('Choose another workout');
    const c = this.contentEl;
    const list = el('div', {});
    const draw = () => {
      clear(list);
      const needle = this.q.trim().toLowerCase();
      const shown = this.rows.filter(r => !needle
        || String(r.plan.name).toLowerCase().includes(needle)
        || String(r.pick.day.name || '').toLowerCase().includes(needle));
      if (!shown.length) { list.append(emptyLine(`No workout matches “${this.q.trim()}”.`)); return; }
      let group = null;
      for (const r of shown) {
        if (r.inUse !== group) {
          group = r.inUse;
          if (this.rows.some(x => x.inUse) && this.rows.some(x => !x.inUse)) {
            list.append(el('div', { class: 'gv-kicker gv-picker-group' }, group ? 'In use' : 'Other plans'));
          }
        }
        list.append(this.row(r));
      }
    };
    if (this.rows.length >= SEARCH_FROM) {
      c.append(el('input', {
        class: 'gv-search', type: 'search', placeholder: 'Search plans…', 'aria-label': 'Search plans',
        oninput: e => { this.q = e.target.value; draw(); },
      }));
    }
    c.append(list);
    draw();
  }
  row({ plan, pick }) {
    const go = el('button', { class: 'gv-btn gv-btn-small', type: 'button', 'aria-label': `Start ${pick.day.name}: ${plan.name}` },
      ico('play'), el('span', {}, 'Start'));
    go.addEventListener('click', () => {
      this.close();
      this.onStart(plan, pick.day);
    });
    return el('div', { class: 'gv-card gv-alsotoday gv-picker-row' },
      el('div', { class: 'gv-alsotoday-main' },
        el('div', { class: 'gv-alsotoday-name' }, plan.name),
        el('div', { class: 'gv-alsotoday-plan' }, `${pick.day.name} · ${whenWord(pick)}`)),
      go);
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = { pickerRows, WorkoutPickerModal, SEARCH_FROM };
