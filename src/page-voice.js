'use strict';
/* Your voice — record the count-in, the rep counts and the celebrations in
   your own voice, one clip at a time.

   TWO SURFACES, ONE RECORDER. The list at the bottom is the inventory:
   every clip the app can use, grouped, with record / play / delete on each
   row. The card at the top is the WIZARD: a queue of clips walked one at a
   time — say the word, hear it back, keep it or take it again, next. The
   list's record button simply starts the wizard with a queue of one, so
   there is exactly one place a microphone is ever opened.

   THE GESTURE, AGAIN. Every tap that leads to a sound calls sound.unlock()
   synchronously first — the record tap especially, because getUserMedia is
   async and iOS will not resume an AudioContext after the tap's stack has
   gone. The pattern is the same one page-session-setup.js's beginSession
   is built around.

   RE-RENDER DISCIPLINE. While the microphone is live nothing re-renders:
   the level meter and the button are mutated in place, because a full
   render mid-take would replace the node the meter is writing to. The
   page re-renders only at phase changes (ready → recording → review →
   next), where the DOM is meant to change anyway.

   State lives on ctx.state.voiceUi so leaving and coming back resumes a
   half-finished queue; pageCleanup cancels a live take so a microphone can
   never stay open on a page nobody is looking at. */

const { el, ico, clear, toggleRow, clickableCard } = require('./dom');
const { CUES, GROUPS, cueFor, progressOf, prepareClip } = require('./voice-pack');
const { canRecord, startRecording } = require('./voice-record');
const voiceClips = require('./voice-clips');
const sound = require('./sound');
const { ConfirmModal } = require('./modals');

function uiState(ctx) {
  if (!ctx.state.voiceUi) {
    ctx.state.voiceUi = {
      queue: [],        // clip keys still to record, in order
      at: 0,            // index into queue
      phase: 'idle',    // idle | ready | recording | review | saving
      rec: null,        // the live recorder handle
      take: null,       // prepareClip() result awaiting keep/again
      takeBuffer: null, // the take decoded, for the preview
      error: '',
      loaded: false,
    };
  }
  return ctx.state.voiceUi;
}

function render(ctx, root) {
  const ui = uiState(ctx);
  const settings = ctx.settings;
  const recordable = canRecord();

  /* Leaving mid-take: release the microphone. Never advances the queue —
     the same rule countdown.stop() follows: teardown is not a decision. */
  ctx.state.pageCleanup = () => {
    if (ui.rec) { try { ui.rec.cancel(); } catch (e) { /* ignore */ } ui.rec = null; }
    if (ui.phase === 'recording') ui.phase = 'ready';
    sound.cancel();
  };

  /* First visit: make sure the registry reflects the folder before the
     rows say what exists. Fingerprinted, so a second call costs nothing. */
  if (!ui.loaded) {
    voiceClips.loadClips(ctx.io)
      .then(() => { ui.loaded = true; if (ctx.state.page === 'voice') ctx.rerender(); })
      .catch(e => { ui.loaded = true; console.error('gym-vault voice clips', e); });
  }

  const back = el('button', { class: 'gv-icon-btn', type: 'button', 'aria-label': 'Back to profile' }, ico('arrow-left'));
  back.addEventListener('click', () => ctx.nav('profile'));
  root.append(el('div', { class: 'gv-toolbar' }, back, el('h2', { class: 'gv-toolbar-title' }, 'Your voice')));

  const progress = progressOf(sound.clipKeys());
  const inUse = (settings.soundMode || 'voice') === 'custom';

  /* ---- what this is, and where it stands ---- */
  const hero = el('div', { class: 'gv-hero gv-voice-hero' });
  hero.append(el('p', { class: 'gv-kicker' }, 'Count yourself in'));
  hero.append(el('h3', { class: 'gv-display gv-hero-title' },
    el('span', { class: 'gv-mark' }, progress.recorded ? `${progress.recorded} of ${progress.total}` : 'Your voice')));
  hero.append(el('p', { class: 'gv-hero-sub' },
    progress.recorded === progress.total
      ? 'Every clip is yours. Anything you re-record replaces the old take.'
      : progress.recorded
        ? `${progress.total - progress.recorded} still spoken by the device voice. Record them whenever — a gap is never silence.`
        : 'Record the five-four-three-two-one, the word that starts a set, each rep as it lands, and the moments worth shouting. Anything you skip stays in the device voice.'));
  const bar = el('div', { class: 'gv-voice-bar', role: 'img', 'aria-label': `${progress.recorded} of ${progress.total} clips recorded` });
  const fill = el('span', { class: 'gv-voice-bar-fill' });
  fill.style.setProperty('--gv-voice-pct', String(progress.total ? progress.recorded / progress.total : 0));
  bar.append(fill);
  hero.append(el('div', { class: 'gv-voice-progress' }, bar));
  root.append(hero);

  /* The switch. Off means the device voice — not silent: this page only
     decides WHOSE voice, and the count-back setting still decides whether. */
  root.append(toggleRow('Use my voice',
    inUse
      ? 'The app counts with your recordings, and the device voice fills any gap.'
      : 'Off — the device voice does the counting. Flip it once you have a few clips.',
    inUse,
    next => {
      ctx.plugin.settings.soundMode = next ? 'custom' : 'voice';
      ctx.settings = ctx.plugin.settings;
      Promise.resolve(ctx.plugin.saveSettings()).catch(e => console.error('gym-vault save sound mode', e));
      ctx.rerender();
    }));

  if (!recordable) {
    root.append(el('div', { class: 'gv-warn-line' }, ico('mic-off'),
      el('span', {}, 'This device does not allow recording here. Clips recorded on another device still play — the vault syncs them like any other file.')));
  }

  /* ---- the wizard, or the way into it ---- */
  if (ui.queue.length) {
    renderWizard(ctx, root, ui);
  } else {
    const actions = el('div', { class: 'gv-voice-actions gv-voice-actions-top' });
    if (progress.missing.length && recordable) {
      const startBtn = el('button', { class: 'gv-btn', type: 'button' },
        ico('mic'), el('span', {}, `Record the missing ${progress.missing.length}`));
      startBtn.addEventListener('click', () => startWizard(ctx, ui, progress.missing.map(c => c.key)));
      actions.append(startBtn);
    }
    if (recordable) {
      const allBtn = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button' },
        ico('rotate-ccw'), el('span', {}, progress.missing.length ? 'Record all from the top' : 'Re-record everything'));
      allBtn.addEventListener('click', () => startWizard(ctx, ui, CUES.map(c => c.key)));
      actions.append(allBtn);
    }
    if (actions.childNodes.length) root.append(actions);
  }

  /* ---- the inventory ---- */
  for (const g of GROUPS) {
    root.append(el('div', { class: 'gv-section-title' }, ico(g.id === 'moments' ? 'zap' : g.id === 'reps' ? 'audio-lines' : 'timer'), el('span', {}, g.label)));
    root.append(el('p', { class: 'gv-dim gv-voice-blurb' }, g.blurb));
    const list = el('div', { class: 'gv-card-list' });
    for (const c of CUES.filter(c => c.group === g.id)) list.append(cueRow(ctx, ui, c, recordable));
    root.append(list);
  }
  root.append(el('p', { class: 'gv-microcopy' },
    'Exercise names in a timed circuit stay in the device voice — there are as many as your library.'));
}

/* One row of the inventory. */
function cueRow(ctx, ui, cue, recordable) {
  const have = sound.hasClip(cue.key);
  const secs = sound.clipSeconds(cue.key);
  const row = el('div', { class: `gv-card gv-voice-row${have ? ' have' : ''}` },
    el('div', { class: 'gv-voice-row-main' },
      el('div', { class: 'gv-voice-row-name' }, cue.label),
      el('div', { class: 'gv-voice-row-meta' },
        have ? `${secs ? secs.toFixed(1) + ' s' : 'recorded'} · say "${cue.say}"` : `device voice · say "${cue.say}"`)));
  const actions = el('div', { class: 'gv-voice-row-actions' });
  if (have) {
    const play = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': `Play ${cue.label}` }, ico('play'));
    play.addEventListener('click', () => { sound.unlock(); sound.playClip(cue.key); });
    actions.append(play);
  }
  if (recordable) {
    const rec = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': `${have ? 'Re-record' : 'Record'} ${cue.label}` }, ico('mic'));
    rec.addEventListener('click', () => startWizard(ctx, ui, [cue.key]));
    actions.append(rec);
  }
  if (have) {
    const del = el('button', { class: 'gv-icon-btn gv-icon-btn-small', type: 'button', 'aria-label': `Delete ${cue.label}` }, ico('trash-2'));
    del.addEventListener('click', () => new ConfirmModal(ctx.app, {
      title: `Delete "${cue.label}"?`,
      message: 'The device voice takes over for this one until you record it again. The file follows your Obsidian "Deleted files" setting.',
      onConfirm: () => deleteClip(ctx, ui, cue.key),
    }).open());
    actions.append(del);
  }
  row.append(actions);
  return row;
}

async function deleteClip(ctx, ui, key) {
  try {
    const entry = (await ctx.io.listVoiceClips()).find(e => e.key === key);
    if (entry) await ctx.io.trash(entry.file);
    sound.setClip(key, null);
    voiceClips.invalidate();
    ui.error = '';
  } catch (e) {
    ui.error = `Could not delete that clip (${e.message || e}).`;
  }
  ctx.rerender();
}

/* ---------- the wizard ---------- */

function startWizard(ctx, ui, keys) {
  if (ui.rec) { try { ui.rec.cancel(); } catch (e) { /* ignore */ } ui.rec = null; }
  ui.queue = keys.slice();
  ui.at = 0;
  ui.phase = 'ready';
  ui.take = null;
  ui.takeBuffer = null;
  ui.error = '';
  ctx.rerender();
}

function endWizard(ctx, ui) {
  if (ui.rec) { try { ui.rec.cancel(); } catch (e) { /* ignore */ } ui.rec = null; }
  ui.queue = [];
  ui.at = 0;
  ui.phase = 'idle';
  ui.take = null;
  ui.takeBuffer = null;
  ctx.rerender();
}

function advance(ctx, ui) {
  ui.at++;
  ui.take = null;
  ui.takeBuffer = null;
  ui.error = '';
  if (ui.at >= ui.queue.length) {
    const n = ui.queue.length;
    endWizard(ctx, ui);
    ctx.notice(n === 1 ? 'saved.' : `${n} clips done.`);
    return;
  }
  ui.phase = 'ready';
  ctx.rerender();
}

function renderWizard(ctx, root, ui) {
  const key = ui.queue[ui.at];
  const cue = cueFor(key);
  if (!cue) { endWizard(ctx, ui); return; }
  const group = GROUPS.find(g => g.id === cue.group);
  const card = el('div', { class: 'gv-card gv-voice-wizard', 'aria-live': 'polite' });
  card.append(el('p', { class: 'gv-kicker' }, `${ui.at + 1} of ${ui.queue.length} · ${group ? group.label : ''}`));
  card.append(el('div', { class: 'gv-display gv-voice-word' }, cue.label));
  card.append(el('p', { class: 'gv-voice-say' }, 'Say: ', el('b', {}, `“${cue.say}”`)));

  /* The one big button. Its face changes with the phase, in place. */
  const btn = el('button', { class: 'gv-voice-rec', type: 'button' });
  const level = el('div', { class: 'gv-voice-level', 'aria-hidden': 'true' });
  const levelFill = el('span', { class: 'gv-voice-level-fill' });
  level.append(levelFill);
  const setFace = (icon, text, cls) => {
    clear(btn);
    btn.append(ico(icon), el('span', {}, text));
    btn.className = `gv-voice-rec${cls ? ' ' + cls : ''}`;
    btn.setAttribute('aria-label', text);
  };

  if (ui.phase === 'recording') setFace('square', 'Tap to stop', 'live');
  else if (ui.phase === 'review') setFace('play', `${ui.take ? ui.take.seconds.toFixed(1) + ' s' : ''} · hear it`, 'review');
  else if (ui.phase === 'saving') setFace('check', 'Saving…', 'review');
  else setFace('mic', 'Tap to record', '');

  const stopTake = () => {
    if (!ui.rec) { ui.phase = 'ready'; ctx.rerender(); return; }
    const raw = ui.rec.stop();
    ui.rec = null;
    const clip = prepareClip(raw.samples, raw.rate);
    if (!clip) {
      ui.error = 'Nothing was heard — try again, a little closer to the microphone.';
      ui.phase = 'ready';
      ctx.rerender();
      return;
    }
    ui.take = clip;
    ui.takeBuffer = null;
    ui.phase = 'review';
    ui.error = '';
    ctx.rerender();
    /* Hear it straight away. The context is already running (the record
       tap resumed it), so a buffer started after this await still plays. */
    sound.decodeClip(clip.wav)
      .then(buf => { ui.takeBuffer = buf; if (ui.phase === 'review' && ui.take === clip) sound.playBuffer(buf); })
      .catch(e => { ui.error = `Could not play that back (${e.message || e}).`; ctx.rerender(); });
  };

  btn.addEventListener('click', () => {
    if (ui.phase === 'recording') { stopTake(); return; }
    if (ui.phase === 'review') { sound.unlock(); if (ui.takeBuffer) sound.playBuffer(ui.takeBuffer); return; }
    if (ui.phase !== 'ready') return;
    /* THE GESTURE: unlock in the tap's own stack, before the async open. */
    sound.unlock();
    ui.error = '';
    ui.phase = 'recording';
    setFace('square', 'Tap to stop', 'live');
    startRecording({
      onLevel: v => levelFill.style.setProperty('--gv-level', String(Math.min(1, v * 4))),
      onLimit: () => stopTake(),
    }).then(rec => {
      /* Stopped (or left) before the microphone came up: release it. */
      if (ui.phase !== 'recording') { rec.cancel(); return; }
      ui.rec = rec;
    }).catch(e => {
      ui.error = e.message || String(e);
      ui.phase = 'ready';
      ctx.rerender();
    });
  });
  card.append(btn, level);

  const actions = el('div', { class: 'gv-voice-actions' });
  if (ui.phase === 'review' && ui.take) {
    const keep = el('button', { class: 'gv-btn', type: 'button' }, ico('check'), el('span', {}, 'Keep'));
    keep.addEventListener('click', async () => {
      const take = ui.take;
      ui.phase = 'saving';
      ctx.rerender();
      try {
        /* Decode BEFORE the write, and hand the vault its own copy: nothing
           in the Vault API promises not to detach the buffer it is given,
           and a decode after that would be a decode of an empty buffer. */
        const buf = ui.takeBuffer || await sound.decodeClip(take.wav);
        await ctx.io.saveVoiceClip(key, take.wav.slice(0));
        sound.setClip(key, buf);
        voiceClips.invalidate();
        advance(ctx, ui);
      } catch (e) {
        ui.error = `Could not save that clip (${e.message || e}).`;
        ui.phase = 'review';
        ctx.rerender();
      }
    });
    const again = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button' }, ico('rotate-ccw'), el('span', {}, 'Again'));
    again.addEventListener('click', () => { ui.take = null; ui.takeBuffer = null; ui.phase = 'ready'; ctx.rerender(); });
    actions.append(keep, again);
  }
  if (ui.phase === 'ready' || ui.phase === 'review') {
    const skip = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button' }, ico('skip-forward'), el('span', {}, 'Skip'));
    skip.addEventListener('click', () => advance(ctx, ui));
    actions.append(skip);
  }
  const stop = el('button', { class: 'gv-btn gv-btn-ghost gv-btn-small', type: 'button', 'aria-label': 'Stop recording clips' }, ico('chevron-left'), el('span', {}, 'Done for now'));
  stop.addEventListener('click', () => endWizard(ctx, ui));
  actions.append(stop);
  card.append(actions);

  if (ui.error) card.append(el('p', { class: 'gv-voice-error', role: 'alert' }, ui.error));
  root.append(card);
}

module.exports = { render };
