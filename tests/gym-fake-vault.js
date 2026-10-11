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
   Two iCloud failure modes can be switched on (opts):
     - emptyRead: [path]   the file is on disk with real content (stat.size > 0)
                           but read()/cachedRead()/adapter.read() hand back ''
                           - an undownloaded or partly synced file.
     - unindexed: [[path, text]]   the file is on DISK but not yet in the vault
                           index (a fresh sync): getFileByPath finds nothing,
                           create() says "File already exists.", adapter.exists
                           /read/write see it. v.index(path) lets the vault catch up.
   v.adapter is Obsidian's DataAdapter (exists/read/write/stat/process) unless
   opts.noAdapter.
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
    /* Obsidian's TFile.stat: size is the bytes on disk, known even when the text has not arrived. */
    this.stat = { size: 0, mtime: 0, ctime: 0 };
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
  const emptyRead = new Set(opts.emptyRead || []);
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
    sized(f, data);
    return f;
  };
  const sized = (f, data) => { f.stat.size = typeof data === 'string' ? data.length : (data && data.byteLength) || 0; };
  const shown = (p, data) => (emptyRead.has(p) && typeof data === 'string' ? '' : data);
  mkFolder('Gym');
  for (const [p, text] of files) addFile(p, text);
  /* On disk, not (yet) in the vault index. */
  for (const [p, text] of opts.unindexed || []) disk.set(p, text);

  const diskKey = p => {
    if (disk.has(p)) return p;
    const lp = p.toLowerCase();
    for (const k of disk.keys()) if (k.toLowerCase() === lp) return k;
    return null;
  };
  const diskExists = p => {
    if (byPath.has(p) || diskKey(p) !== null) return true;
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
    cachedRead: async f => (cache.has(f.path) ? shown(f.path, cache.get(f.path)) : ''),
    read: async f => shown(f.path, disk.get(f.path)),
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
      disk.set(f.path, text); cache.set(f.path, text); sized(f, text);
    },
    async modifyBinary(f, data) {
      log.push(['modifyBinary', f.path]);
      if (delay) await sleep(delay);
      disk.set(f.path, data); cache.set(f.path, data); sized(f, data);
    },
    async process(f, fn) {
      log.push(['process', f.path]);
      if (!disk.has(f.path)) throw new Error(`ENOENT: no such file or directory, open '${f.path}'`);
      /* Overlap detector: the plugin is expected to run one save of a note at
         a time (data.js exclusive()); this records that it did not. */
      busy.set(f.path, (busy.get(f.path) || 0) + 1);
      if (busy.get(f.path) > 1) v.overlaps.push(f.path);
      try {
        const next = fn(shown(f.path, disk.get(f.path)));
        if (typeof next !== 'string') throw new Error('process callback must return a string');
        if (delay) await sleep(delay);
        disk.set(f.path, next); cache.set(f.path, next); sized(f, next);
        emptyRead.delete(f.path);
        return next;
      } finally { busy.set(f.path, busy.get(f.path) - 1); }
    },
    async trash(f) { log.push(['trash', f.path]); remove(f); },
    getResourcePath: f => `app://local/${f.path}`,
    /* A change made by something else (another device, an editor pane): both
       the disk and Obsidian's cache see it; the PLUGIN's in-memory records do
       not until it reloads. */
    externalWrite(p, text) {
      if (!byPath.has(p)) addFile(p, text); else { disk.set(p, text); cache.set(p, text); sized(byPath.get(p), text); }
      log.push(['EXTERNAL-write', p]);
    },
    /* The vault index catches up with a file that was only on disk. */
    index(p) { if (disk.has(p) && !byPath.has(p)) addFile(p, disk.get(p)); },
    /* The undownloaded file finishes downloading. */
    download(p) { emptyRead.delete(p); },
    /* ... or the reverse: iCloud evicts it, its bytes stay on the books but its text is gone. */
    undownload(p) { emptyRead.add(p); },
    /* The disk changes under an UNINDEXED file (another device's sync); the index is not told. */
    diskWrite(p, text) { disk.set(p, text); },
    externalTrash(p) { const f = byPath.get(p); if (f) { remove(f); log.push(['EXTERNAL-trash', p]); } },
  };
  /* Obsidian's DataAdapter: straight to disk, no index. */
  if (!opts.noAdapter) {
    v.adapter = {
      async exists(p) { return diskExists(p); },
      async read(p) {
        const k = diskKey(p);
        if (k === null) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
        return shown(k, disk.get(k));
      },
      async stat(p) {
        const k = diskKey(p);
        if (k === null) return null;
        const d = disk.get(k);
        return { type: 'file', size: typeof d === 'string' ? d.length : 0, mtime: 0, ctime: 0 };
      },
      async write(p, text) {
        const k = diskKey(p) || p;
        log.push(['adapter-write', k]);
        if (delay) await sleep(delay);
        disk.set(k, text);
        const f = byPath.get(k);
        if (f) { cache.set(k, text); sized(f, text); }
        emptyRead.delete(k);
      },
      async process(p, fn) {
        const k = diskKey(p);
        if (k === null) throw new Error(`ENOENT: no such file or directory, open '${p}'`);
        const next = fn(shown(k, disk.get(k)));
        if (typeof next !== 'string') throw new Error('process callback must return a string');
        log.push(['adapter-process', k]);
        disk.set(k, next);
        const f = byPath.get(k);
        if (f) { cache.set(k, next); sized(f, next); }
        emptyRead.delete(k);
        return next;
      },
    };
  }
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
