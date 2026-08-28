'use strict';
/* Export — hand the training log to a coach, or paste it into a chat.

   Two ways out, because neither works everywhere: copy to clipboard (fast,
   but a long export can be awkward on mobile) and save a note into
   Gym/Exports/ (always works, and on iOS the note can then go out through
   Obsidian's own share sheet). */

const { el, ico } = require('./dom');
const { todayISO, fmtShort } = require('./dates');
const { buildSummary, buildCsv, buildJson } = require('./export');

const FORMATS = [
  ['summary', 'Summary', 'Readable markdown — the one to send a coach or paste into a chat.', 'md'],
  ['csv', 'Raw sets (CSV)', 'One row per logged set, for a spreadsheet.', 'csv'],
  ['json', 'Everything (JSON)', 'Full structured data, best for analysis.', 'json'],
];
const RANGES = [[30, 'Last 30 days'], [90, 'Last 90 days'], [0, 'Everything']];

function render(ctx, root) {
  const ui = ctx.state.exportUi || (ctx.state.exportUi = {
    format: 'summary', days: 90, includeBody: true, includeHealth: false,
  });
  const today = todayISO();

  root.append(el('div', { class: 'gv-toolbar' }, el('div', { class: 'gv-toolbar-title' }, 'Export')));
  root.append(el('p', { class: 'gv-hero-sub gv-export-lede' },
    'Build a snapshot of your training to share. Nothing leaves the vault until you copy or save it.'));

  const opts = () => ({ days: ui.days || null, includeBody: ui.includeBody, includeHealth: ui.includeHealth, today, weekStart: ctx.settings.weekStart });
  const build = () => {
    try {
      if (ui.format === 'csv') return buildCsv(ctx.data, opts());
      if (ui.format === 'json') return buildJson(ctx.data, opts());
      return buildSummary(ctx.data, opts());
    } catch (e) {
      console.error('gym-vault export', e);
      return `Could not build the export (${e.message}).`;
    }
  };

  /* Format */
  root.append(el('div', { class: 'gv-section-title' }, ico('clipboard-list'), el('span', {}, 'Format')));
  const fmtWrap = el('div', { class: 'gv-card-list' });
  for (const [key, label, desc] of FORMATS) {
    const card = el('div', { class: `gv-card gv-optrow${ui.format === key ? ' on' : ''}` },
      el('div', { class: 'gv-optrow-main' },
        el('div', { class: 'gv-optrow-name' }, label),
        el('div', { class: 'gv-optrow-desc' }, desc)),
      ui.format === key ? ico('circle-check', 'gv-optrow-tick') : '');
    card.addEventListener('click', () => { ui.format = key; ctx.rerender(); });
    fmtWrap.append(card);
  }
  root.append(fmtWrap);

  /* Range */
  root.append(el('div', { class: 'gv-section-title' }, ico('calendar-days'), el('span', {}, 'How much')));
  const chips = el('div', { class: 'gv-chips' });
  for (const [days, label] of RANGES) {
    const c = el('button', { class: `gv-chip${ui.days === days ? ' on' : ''}`, type: 'button' }, label);
    c.addEventListener('click', () => { ui.days = days; ctx.rerender(); });
    chips.append(c);
  }
  root.append(chips);

  /* What to include — health markers off by default and clearly labelled. */
  root.append(el('div', { class: 'gv-section-title' }, ico('user'), el('span', {}, 'Include')));
  const toggles = el('div', { class: 'gv-card-list' });
  toggles.append(toggleRow(ctx, 'Body measurements', 'Weight, waist, body fat and the rest of the body log.',
    ui.includeBody, v => { ui.includeBody = v; if (!v) ui.includeHealth = false; }));
  toggles.append(toggleRow(ctx, 'Health markers', 'Blood pressure, cholesterol and glucose. Off by default — this is medical information.',
    ui.includeHealth, v => { ui.includeHealth = v; if (v) ui.includeBody = true; }));
  root.append(toggles);

  /* Preview + actions */
  const text = build();
  const bytes = text.length;   // ASCII-ish export; close enough for a size hint
  root.append(el('div', { class: 'gv-section-title' }, ico('search'), el('span', {}, 'Preview')));
  root.append(el('div', { class: 'gv-dim gv-export-size' },
    `${text.split('\n').length} lines · ~${Math.max(1, Math.round(bytes / 1024))} KB`));
  const pre = el('pre', { class: 'gv-export-preview' });
  pre.textContent = text;
  root.append(pre);

  const copyBtn = el('button', { class: 'gv-btn', type: 'button' }, ico('clipboard-list'), el('span', {}, 'Copy'));
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      ctx.notice('export copied to the clipboard.');
    } catch (e) {
      /* Clipboard can be refused (permissions, no gesture, older webview) —
         saying so beats a button that silently does nothing. */
      ctx.notice('could not reach the clipboard — use "Save to vault" instead.');
    }
  });
  const saveBtn = el('button', { class: 'gv-btn gv-btn-ghost', type: 'button' }, ico('plus'), el('span', {}, 'Save to vault'));
  saveBtn.addEventListener('click', async () => {
    try {
      const ext = (FORMATS.find(f => f[0] === ui.format) || [])[3] || 'md';
      const path = await ctx.io.saveExport(text, ui.format, ext);
      ctx.notice(`saved to ${path}`);
      ctx.reload();
    } catch (e) {
      ctx.notice(`could not save the export (${e.message || e})`);
    }
  });
  root.append(el('div', { class: 'gv-export-actions' }, copyBtn, saveBtn));
  root.append(el('p', { class: 'gv-dim gv-export-note' },
    'Saved exports land in Gym/Exports. On a phone, open that note and use Obsidian’s share button to send it on.'));
}

function toggleRow(ctx, name, desc, value, onChange) {
  const row = el('div', { class: `gv-card gv-optrow${value ? ' on' : ''}` },
    el('div', { class: 'gv-optrow-main' },
      el('div', { class: 'gv-optrow-name' }, name),
      el('div', { class: 'gv-optrow-desc' }, desc)),
    el('span', { class: `gv-switch${value ? ' on' : ''}`, role: 'img', 'aria-label': value ? 'included' : 'not included' }));
  row.addEventListener('click', () => { onChange(!value); ctx.rerender(); });
  return row;
}

module.exports = { render };
