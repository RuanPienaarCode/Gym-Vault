'use strict';
/* A fake Obsidian vault for the vault-write guards (plans-edit-race,
   vault-stale-writes, scaffold-keeps-active-plan, export-save-real-files,
   missing-exercise-warning). Not a test itself — the file name has no
   `.test.cjs`, so scripts/run-tests.mjs does not run it.

   It copies the write TIMING of Obsidian 1.14.4, which is the whole point:
     - modify()/process() resolve only AFTER the write has landed, and the
       text cache that cachedRead() serves is replaced at that moment — until
       then cachedRead() returns the OLD text. A reload that starts before a
       write lands therefore reads stale text.
     - process() reads the file as it is on disk when it is called, runs the
       callback, and writes; two overlapping process() calls are NOT
       serialised here (a pessimistic model, so any ordering the plugin owes
       us has to come from the plugin).
     - create() refuses when the path exists, case-INsensitively (macOS and
       iOS volumes), exactly like Vault.create.
   Everything is synthetic. */
const Module = require('node:module');
const path = require('node:path');

class TFile {
  constructor(p) {
    this.path = p;
    this.name = p.split('/').pop();
    this.extension = this.name.indexOf('.') >= 0 ? this.name.split('.').pop() : '';
    this.basename = this.name.replace(/\.[^.]+$/, '');
    this.parent = null;
  }
}
class TFolder {
  constructor(p) { this.path = p; this.children = []; this.parent = null; }
}

const notices = [];
class Notice { constructor(message) { notices.push(String(message)); } }

const obsidianStub = {
  TFile, TFolder, Notice,
  normalizePath: p => String(p).replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, ''),
  requestUrl: async () => { throw new Error('offline'); },
  setIcon: () => {},
  Modal: class { constructor(app) { this.app = app; } open() {} close() {} },
  Setting: class { constructor(el) { this.el = el; } },
  Plugin: class {}, ItemView: class {}, PluginSettingTab: class {},
};

global.window = global.window || {};
global.window.setTimeout = (fn, ms) => setTimeout(fn, ms);
global.window.clearTimeout = t => clearTimeout(t);

/* Load a src/ module with `obsidian` stubbed. */
function loadSrc(name) {
  const origLoad = Module._load;
  Module._load = (req, ...rest) => (req === 'obsidian' ? obsidianStub : origLoad(req, ...rest));
  try { return require(path.join(__dirname, '..', 'src', name)); }
  finally { Module._load = origLoad; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeVault(files = [], opts = {}) {
  const delay = opts.delay || 0;
  const byPath = new Map();
  const disk = new Map();
  const cache = new Map();
  const folders = new Map();
  const log = [];
  const busy = new Map();
  const mkFolder = p => {
    if (folders.has(p)) return folders.get(p);
    const f = new TFolder(p);
    folders.set(p, f); byPath.set(p, f);
    const slash = p.lastIndexOf('/');
    if (slash > 0) { const par = mkFolder(p.slice(0, slash)); par.children.push(f); f.parent = par; }
    return f;
  };
  const addFile = (p, data) => {
    const dir = mkFolder(p.slice(0, p.lastIndexOf('/')));
    const f = new TFile(p);
    f.parent = dir; dir.children.push(f);
    byPath.set(p, f); disk.set(p, data); cache.set(p, data);
    return f;
  };
  mkFolder('Gym');
  for (const [p, text] of files) addFile(p, text);

  const diskExists = p => {
    if (byPath.has(p)) return true;
    const lp = p.toLowerCase();
    for (const k of byPath.keys()) if (k.toLowerCase() === lp) return true;
    return false;
  };
  const remove = f => {
    byPath.delete(f.path); disk.delete(f.path); cache.delete(f.path);
    if (f.parent) f.parent.children = f.parent.children.filter(c => c !== f);
  };

  const v = {
    _disk: disk, _log: log, overlaps: [],
    getAbstractFileByPath: p => byPath.get(p) || null,
    getFileByPath: p => (byPath.get(p) instanceof TFile ? byPath.get(p) : null),
    getFolderByPath: p => (byPath.get(p) instanceof TFolder ? byPath.get(p) : null),
    cachedRead: async f => (cache.has(f.path) ? cache.get(f.path) : ''),
    read: async f => disk.get(f.path),
    readBinary: async f => disk.get(f.path),
    createFolder: async p => { mkFolder(p); },
    async create(p, text) {
      if (diskExists(p)) throw new Error('File already exists.');
      log.push(['create', p]);
      addFile(p, text);
    },
    async createBinary(p, data) {
      if (diskExists(p)) throw new Error('File already exists.');
      log.push(['createBinary', p]);
      addFile(p, data);
    },
    async modify(f, text) {
      log.push(['modify', f.path]);
      if (delay) await sleep(delay);
      disk.set(f.path, text); cache.set(f.path, text);
    },
    async modifyBinary(f, data) {
      log.push(['modifyBinary', f.path]);
      if (delay) await sleep(delay);
      disk.set(f.path, data); cache.set(f.path, data);
    },
    async process(f, fn) {
      log.push(['process', f.path]);
      if (!disk.has(f.path)) throw new Error(`ENOENT: no such file or directory, open '${f.path}'`);
      /* Overlap detector: the plugin is expected to run one save of a note at
         a time (data.js exclusive()); this records that it did not. */
      busy.set(f.path, (busy.get(f.path) || 0) + 1);
      if (busy.get(f.path) > 1) v.overlaps.push(f.path);
      try {
        const next = fn(disk.get(f.path));
        if (typeof next !== 'string') throw new Error('process callback must return a string');
        if (delay) await sleep(delay);
        disk.set(f.path, next); cache.set(f.path, next);
        return next;
      } finally { busy.set(f.path, busy.get(f.path) - 1); }
    },
    async trash(f) { log.push(['trash', f.path]); remove(f); },
    getResourcePath: f => `app://local/${f.path}`,
    /* A change made by something else (another device, an editor pane): both
       the disk and Obsidian's cache see it; the PLUGIN's in-memory records do
       not until it reloads. */
    externalWrite(p, text) {
      if (!byPath.has(p)) addFile(p, text); else { disk.set(p, text); cache.set(p, text); }
      log.push(['EXTERNAL-write', p]);
    },
    externalTrash(p) { const f = byPath.get(p); if (f) { remove(f); log.push(['EXTERNAL-trash', p]); } },
  };
  return v;
}

function makePlugin(v, settings = {}) {
  return {
    app: { vault: v, fileManager: null, metadataCache: { getFirstLinkpathDest: () => null } },
    settings: { gymFolder: 'Gym', planRepo: '', ...settings },
    _lastWrite: 0,
  };
}

/* A tiny named-check runner so a failure says WHICH guard broke, with the
   wrong value in the message. Sets a non-zero exit code; never throws out of
   the file, so every guard in it still runs. */
function makeRunner() {
  const queue = [];
  let failed = 0;
  return {
    check(name, fn) { queue.push([name, fn]); },
    async run(label) {
      for (const [name, fn] of queue) {
        try { await fn(); console.log(`  ok   ${name}`); }
        catch (e) { failed++; console.log(`  FAIL ${name}\n       ${String(e && e.message || e).split('\n').join('\n       ')}`); }
      }
      if (failed) { console.log(`${label}: ${failed} of ${queue.length} guard(s) FAILED`); process.exitCode = 1; }
      else console.log(`${label} OK (${queue.length} guards)`);
    },
  };
}

module.exports = { TFile, TFolder, Notice, notices, obsidianStub, loadSrc, makeVault, makePlugin, makeRunner, sleep };
