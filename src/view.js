'use strict';
/* The workspace view hosting the gym app. */

const { ItemView, Notice } = require('obsidian');
const { VIEW_TYPE } = require('./constants');
const { mountApp } = require('./controller');

class GymView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return 'Gym'; }
  getIcon() { return 'dumbbell'; }

  async onOpen() {
    this.appCtl = mountApp(this);
    await this.appCtl.start();
    this.setupKeyboardViewport();
  }

  /* Mobile keyboard fix (same shape as the budget plugin): Obsidian's pane
     doesn't shrink when the iOS soft keyboard opens, so cap the app's height
     to the visible area while the keyboard is up so the focused set input
     can scroll into view. */
  setupKeyboardViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = this.contentEl;
    const KB_MIN = 120;
    const adjust = () => {
      const keyboard = window.innerHeight - (vv.height + vv.offsetTop);
      if (keyboard > KB_MIN) {
        const top = root.getBoundingClientRect().top;
        const h = (vv.offsetTop + vv.height) - top;
        if (h > 120) root.style.height = `${h}px`;
        window.setTimeout(() => {
          const a = document.activeElement;
          if (a && root.contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) {
            a.scrollIntoView({ block: 'center' });
          }
        }, 60);
      } else {
        root.style.height = '';
      }
    };
    this.registerDomEvent(vv, 'resize', adjust);
    this.registerDomEvent(vv, 'scroll', adjust);
  }

  async onClose() {
    if (this.appCtl) {
      /* The session is written to the device first, so the notice can say what
         actually became of it: "kept" only when the device took it. A closed
         view with nothing logged yet has nothing to say. */
      const kept = this.appCtl.keepDraft();
      if (kept === 'kept') {
        new Notice('Gym: the view closed mid-workout — your session is kept on this device and offered back when Gym reopens.', 8000);
      } else if (kept === 'lost') {
        new Notice('Gym: the view closed mid-workout and this device could not hold on to it — that session was not saved.', 8000);
      }
      this.appCtl.stop();
    }
  }
}

module.exports = { GymView };
