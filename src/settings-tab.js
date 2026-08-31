'use strict';

const { PluginSettingTab, Setting, Notice } = require('obsidian');
const { SKINS, ACCENTS, MUSIC_APPS, SOUND_MODES } = require('./constants');
const { isMusicUrl, parseMusicTarget, appLabel } = require('./music-link');
const { makeIo } = require('./data');
const sound = require('./sound');

class GymSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl: c } = this;
    c.empty();
    /* display() runs again every time the tab is reopened, and each run
       subscribes to `voiceschanged`. Without this the listeners pile up on a
       global object that outlives the tab. */
    if (this._stopVoices) { this._stopVoices(); this._stopVoices = null; }

    new Setting(c)
      .setName('Gym folder')
      .setDesc('Vault folder holding your exercises, plans, workouts, goals and body log.')
      .addText(t => t
        .setValue(this.plugin.settings.gymFolder)
        .onChange(async v => {
          this.plugin.settings.gymFolder = v.trim() || 'Gym';
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));

    new Setting(c)
      .setName('Week starts on')
      .addDropdown(d => d
        .addOption('mon', 'Monday')
        .addOption('sun', 'Sunday')
        .setValue(this.plugin.settings.weekStart)
        .onChange(async v => {
          this.plugin.settings.weekStart = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
        }));

    new Setting(c)
      .setName('Style')
      .setDesc('How the gym looks. Both styles use the same data.')
      .addDropdown(d => {
        for (const [key, label] of SKINS) d.addOption(key, label);
        d.setValue(this.plugin.settings.skin || 'floor')
          .onChange(async v => {
            this.plugin.settings.skin = v;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          });
      });

    new Setting(c)
      .setName('Accent color')
      .setDesc('The highlight color threading through the whole app.')
      .addDropdown(d => {
        for (const [key, label] of ACCENTS) d.addOption(key, label);
        d.setValue(this.plugin.settings.accent || 'lime')
          .onChange(async v => {
            this.plugin.settings.accent = v;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          });
      });

    this.renderSound(c);

    new Setting(c)
      .setName('Music app')
      .setDesc('Adds a shortcut button in guided sessions to jump out and change the song.')
      .addDropdown(d => {
        for (const [key, label] of MUSIC_APPS) d.addOption(key, label);
        d.setValue(this.plugin.settings.musicApp || 'none')
          .onChange(async v => {
            this.plugin.settings.musicApp = v;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          });
      });

    this.renderPlaylists(c);

    new Setting(c)
      .setName('Open on startup')
      .setDesc('Open the gym view when Obsidian launches.')
      .addToggle(t => t
        .setValue(this.plugin.settings.openOnStartup)
        .onChange(async v => {
          this.plugin.settings.openOnStartup = v;
          await this.plugin.saveSettings();
        }));

    new Setting(c)
      .setName('Plan library')
      .setDesc('Where "Browse" on the Plans page fetches shared plans from. Any repo with a plans.json, plans/ and exercises/ works.')
      .addText(t => t
        .setValue(this.plugin.settings.planRepo)
        .onChange(async v => {
          this.plugin.settings.planRepo = v.trim();
          await this.plugin.saveSettings();
        }));

    new Setting(c)
      .setName('Download images for offline')
      .setDesc('Fetch every remote exercise image into Gym/Attachments and point the notes at the local files, so the library works with no connection. Videos keep streaming (they are large).')
      .addButton(b => b
        .setButtonText('Download images')
        .onClick(async () => {
          b.setDisabled(true).setButtonText('Downloading…');
          try {
            const r = await makeIo(this.plugin).downloadMedia();
            this.plugin.refreshViews();
            new Notice(r.saved || r.patched
              ? `Gym: ${r.saved} image${r.saved === 1 ? '' : 's'} downloaded, ${r.patched} note${r.patched === 1 ? '' : 's'} updated${r.failed ? `, ${r.failed} failed (try again online)` : ''}.`
              : r.failed ? `Gym: downloads failed (${r.failed}) — are you online?` : 'Gym: all images are already local.', 7000);
          } catch (e) {
            new Notice(`Gym: download failed (${e.message || e})`, 6000);
          } finally {
            b.setDisabled(false).setButtonText('Download images');
          }
        }));

    new Setting(c)
      .setName('Refresh starter media')
      .setDesc('Update the demonstration images and videos on the starter exercises to the latest set. Only touches media that is still the bundled default — anything you set yourself stays.')
      .addButton(b => b
        .setButtonText('Refresh media')
        .onClick(async () => {
          try {
            const n = await makeIo(this.plugin).refreshSeedMedia();
            this.plugin.refreshViews();
            new Notice(n ? `Gym: media refreshed on ${n} exercise${n === 1 ? '' : 's'}.` : 'Gym: everything already up to date.', 5000);
          } catch (e) {
            new Notice(`Gym: media refresh failed (${e.message || e})`, 6000);
          }
        }));

    new Setting(c)
      .setName('Starter files')
      .setDesc('Re-run first-time setup. Existing files are never overwritten — only missing starters are created.')
      .addButton(b => b
        .setButtonText('Create starter files')
        .onClick(async () => {
          try {
            await makeIo(this.plugin).scaffold();
            this.plugin.settings.onboarded = true;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
            new Notice('Gym: starter files are in place.', 5000);
          } catch (e) {
            new Notice(`Gym: setup failed (${e.message || e})`, 6000);
          }
        }));
  }

  /* Saved music links, offered in guided sessions and on the setup screen.

     A link is validated HERE, at the point of entry, and refused if
     music-link.js cannot parse it — the alternative is storing it and having
     the button do nothing months later, mid-session, with no clue why. An
     already-stored link that no longer parses (a hand-edited settings file,
     a sync from an older version) is shown with its problem stated rather
     than quietly disappearing, because it does quietly disappear from the
     pickers and that would otherwise be inexplicable. */
  /* Count-back: HOW the app answers a rep, a countdown or a record.

     Two settings, not one, and the second only appears when the first is
     'voice' — a voice picker under "Beeps" is a control over nothing.

     Everything here is guarded by what the DEVICE can actually do, because
     the alternative is a settings screen that promises something and then
     stays quiet. sound.resolveMode() is the authority; this only surfaces
     its answer, and says so out loud when the two differ. */
  renderSound(c) {
    const caps = sound.capabilities();
    const mode = this.plugin.settings.soundMode || 'voice';
    const effective = sound.resolveMode(mode, caps);

    const desc = SOUND_MODES.find(m => m[0] === mode);
    const setting = new Setting(c)
      .setName('Count-back')
      .setDesc(desc ? desc[2] : '')
      .addDropdown(d => {
        for (const [key, label] of SOUND_MODES) {
          /* Vibration is listed only where navigator.vibrate exists — iOS
             WebKit has no such API, and an option that can only ever be a
             no-op on the user's own phone is worse than an absent one.

             THE STORED MODE IS ALWAYS LISTED, though, even when this device
             cannot do it. Settings sync across devices: a vault where
             'vibrate' was chosen on an Android phone opens on an iPhone
             where that option does not exist, and setValue() on a <select>
             that lacks the option selects NOTHING — so the dropdown would
             read "Voice" while the stored setting was still 'vibrate', and
             the next change would overwrite a choice the user never saw.
             Showing it, with the note below explaining what will actually
             happen, is the honest version. */
          const supported = key === 'vibrate' ? caps.vibrate
            : key === 'beep' ? caps.audio
            : key === 'voice' ? (caps.speech || caps.audio)
            : true;
          if (!supported && key !== mode) continue;
          d.addOption(key, supported ? label : `${label} (not on this device)`);
        }
        d.setValue(mode).onChange(async v => {
          this.plugin.settings.soundMode = v;
          await this.plugin.saveSettings();
          this.plugin.refreshViews();
          this.display(); // the voice picker appears/disappears with the mode
        });
      });

    /* Said plainly rather than silently substituted: the user asked for one
       thing and is getting another, and finding that out in the gym is
       worse than reading it here. */
    if (effective !== mode) {
      setting.setDesc(
        `${desc ? desc[2] + ' ' : ''}This device cannot do that, so it will ` +
        (effective === 'silent' ? 'stay silent.' : `use ${effective}s instead.`),
      );
    }

    if (mode !== 'voice' || !caps.speech) return;

    const voiceSetting = new Setting(c)
      .setName('Voice')
      .setDesc('Which voice does the counting. The list comes from this device — a voice picked on your phone may not exist on your desktop, where the default is used instead.');

    voiceSetting.addDropdown(d => {
      const fill = voices => {
        d.selectEl.empty();
        d.addOption('', 'Device default');
        for (const v of voices) d.addOption(v.voiceURI, v.lang ? `${v.name} (${v.lang})` : v.name);
        /* Re-assert the stored value AFTER repopulating: setValue on a
           <select> that does not yet contain the option silently selects
           nothing, which would read back as "Device default" and then
           overwrite the real choice on the next change. */
        const stored = this.plugin.settings.voiceURI || '';
        d.setValue(voices.some(v => v.voiceURI === stored) ? stored : '');
      };
      this._stopVoices = sound.watchVoices(fill);
      d.onChange(async v => {
        this.plugin.settings.voiceURI = v;
        await this.plugin.saveSettings();
      });
    });

    voiceSetting.addButton(b => b
      .setButtonText('Test')
      /* The click is the user gesture iOS wants before it will speak at all;
         unlock() has to happen in this stack, not after an await. */
      .onClick(() => {
        sound.unlock();
        sound.cue('record', 'three, two, one, new record', this.plugin.settings);
      }));
  }

  renderPlaylists(c) {
    const list = Array.isArray(this.plugin.settings.playlists) ? this.plugin.settings.playlists : [];

    new Setting(c)
      .setName('Playlists')
      .setDesc('Saved Spotify or Apple Music links, offered alongside the music button in a guided session. Paste the share link — "Copy link to playlist" in Spotify, "Share → Copy Link" in Apple Music.')
      .setHeading();

    const save = async () => {
      await this.plugin.saveSettings();
      this.plugin.refreshViews();
      this.display();
    };

    list.forEach((pl, i) => {
      const target = parseMusicTarget(pl && pl.url);
      const row = new Setting(c).setName((pl && pl.name) || 'Untitled');
      row.setDesc(target
        ? `${appLabel(target.app)}${target.kind ? ` · ${target.kind}` : ''}`
        : 'This link can no longer be opened, so it is not offered in sessions. Remove it and paste the share link again.');
      row.addExtraButton(b => b
        .setIcon('trash-2')
        .setTooltip('Remove')
        .onClick(async () => { list.splice(i, 1); this.plugin.settings.playlists = list; await save(); }));
    });

    if (!list.length) {
      new Setting(c).setDesc('Nothing saved yet — the music button still opens the app you picked above.');
    }

    /* Name and link get a row each rather than sharing one: two text inputs
       plus a button in a single Setting's control area is unusable on a
       phone, which is where a playlist actually gets added. */
    let draftName = '';
    let draftUrl = '';
    new Setting(c)
      .setName('Add a playlist')
      .setDesc('What you want to call it.')
      .addText(t => t.setPlaceholder('Name').onChange(v => { draftName = v; }));
    new Setting(c)
      .setDesc('The share link.')
      .addText(t => t.setPlaceholder('https://open.spotify.com/playlist/…').onChange(v => { draftUrl = v; }))
      .addButton(b => b
        .setButtonText('Add')
        .onClick(async () => {
          const name = draftName.trim();
          if (!name) { new Notice('Gym: give the playlist a name.', 5000); return; }
          if (!isMusicUrl(draftUrl)) {
            new Notice('Gym: that is not a Spotify or Apple Music link. Copy the share link from the app and paste it here.', 7000);
            return;
          }
          this.plugin.settings.playlists = list.concat([{ name, url: draftUrl.trim() }]);
          await save();
        }));
  }

  /* Obsidian calls hide() when the settings dialog closes. The voices
     listener is on window.speechSynthesis, which outlives this tab. */
  hide() {
    if (this._stopVoices) { this._stopVoices(); this._stopVoices = null; }
  }
}

module.exports = { GymSettingTab };
