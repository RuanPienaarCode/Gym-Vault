'use strict';

const { PluginSettingTab, Setting, Notice } = require('obsidian');
const { SKINS, ACCENTS, MUSIC_APPS } = require('./constants');
const { isMusicUrl, parseMusicTarget, appLabel } = require('./music-link');
const { makeIo } = require('./data');

class GymSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl: c } = this;
    c.empty();

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
}

module.exports = { GymSettingTab };
