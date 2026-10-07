'use strict';
/* SHARED HARNESS for the guards that must drive the REAL controller and the
   REAL guided session (not a reimplementation of either): a fake DOM, a fake
   clock/timer queue, a recording speechSynthesis, a fake AudioContext, a
   fake devicemotion source and a wake-lock stub. Nothing here reimplements
   app logic; it only stands in for the browser. Not a *.test.cjs, so the
   runner does not execute it.

   Obsidian's real device-local storage is modelled on purpose: app.
   saveLocalStorage(key, data) JSON-stringifies and a falsy `data` REMOVES
   the key; app.loadLocalStorage(key) parses or returns null (checked against
   Obsidian 1.14's app.js). */
const Module = require('node:module');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');

/* ---------------- clock + timers ---------------- */
const clock = { now: 1_780_000_000_000 };
const realDateNow = Date.now;
Date.now = () => clock.now;
const timers = new Map();
let tid = 1;
function setT(fn, ms) { const id = tid++; timers.set(id, { fn, at: clock.now + Math.max(0, ms || 0), every: null }); return id; }
function setI(fn, ms) { const id = tid++; timers.set(id, { fn, at: clock.now + Math.max(1, ms || 0), every: Math.max(1, ms || 0) }); return id; }
function clr(id) { timers.delete(id); }
function advance(ms) {
  const end = clock.now + ms;
  for (let guard = 0; guard < 1e6; guard++) {
    let best = null;
    for (const [id, t] of timers) if (t.at <= end && (!best || t.at < best[1].at || (t.at === best[1].at && id < best[0]))) best = [id, t];
    if (!best) break;
    const [id, t] = best;
    clock.now = t.at;
    if (t.every) t.at += t.every; else timers.delete(id);
    t.fn();
  }
  clock.now = end;
}
/* iOS-style suspension: JS frozen for `ms`, then every overdue timer fires
   ONCE on resume (intervals do not replay the missed ticks). */
function suspend(ms) {
  clock.now += ms;
  for (const t of timers.values()) if (t.at < clock.now) t.at = clock.now;
  advance(0);
}
const liveIntervals = () => [...timers.values()].filter(t => t.every).length;

/* ---------------- fake DOM ---------------- */
let DOC_ROOT = null;
class N {
  constructor(tag) {
    this.tag = String(tag).toLowerCase(); this.tagName = this.tag.toUpperCase();
    this.nodeType = 1; this.childNodes = []; this.parentNode = null; this.attrs = {}; this.listeners = {};
    this._cls = new Set(); this.value = ''; this.disabled = false; this.hidden = false;
    const p = {}; this.style = { _p: p, setProperty(k, v) { p[k] = v; }, removeProperty(k) { delete p[k]; } };
  }
  get className() { return [...this._cls].join(' '); }
  set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get classList() {
    const s = this._cls;
    return { [Symbol.iterator]: () => [...s][Symbol.iterator](), add: (...c) => c.forEach(x => s.add(x)), remove: (...c) => c.forEach(x => s.delete(x)),
      toggle: (c, f) => { const on = f === undefined ? !s.has(c) : !!f; if (on) s.add(c); else s.delete(c); return on; },
      contains: c => s.has(c) };
  }
  addClass(c) { this._cls.add(c); } removeClass(c) { this._cls.delete(c); }
  setText(t) { this.textContent = t; }
  createEl(tag, o) { const n = new N(tag); if (o && o.text) n.textContent = o.text; if (o && o.cls) n.className = o.cls; this.appendChild(n); return n; }
  empty() { this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; if (k === 'value') this.value = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener(ev, fn) { const l = this.listeners[ev]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  append(...kids) { for (const k of kids) this.appendChild(k && k.nodeType ? k : new T(k)); }
  appendChild(k) { if (k.parentNode) k.parentNode.removeChild(k); k.parentNode = this; this.childNodes.push(k); return k; }
  insertBefore(k, ref) {
    if (k.parentNode) k.parentNode.removeChild(k);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    k.parentNode = this;
    if (i < 0) this.childNodes.push(k); else this.childNodes.splice(i, 0, k);
    return k;
  }
  removeChild(k) { const i = this.childNodes.indexOf(k); if (i >= 0) this.childNodes.splice(i, 1); k.parentNode = null; return k; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  get firstChild() { return this.childNodes[0] || null; }
  get children() { return this.childNodes.filter(c => c.nodeType === 1); }
  get nextSibling() { if (!this.parentNode) return null; const s = this.parentNode.childNodes; return s[s.indexOf(this) + 1] || null; }
  get textContent() { return this.childNodes.map(c => c.textContent).join(''); }
  set textContent(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; const s = v == null ? '' : String(v); if (s !== '') this.appendChild(new T(s)); }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === DOC_ROOT; }
  matches(sel) { return sel.split(',').some(s => simpleMatch(this, s.trim())); }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
  querySelectorAll(sel) { const out = []; const walk = n => { for (const c of n.childNodes) if (c.nodeType === 1) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  contains(o) { let n = o; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  focus() {} blur() {} select() {} scrollIntoView() {}
  getBoundingClientRect() { return { left: 0, top: 0, bottom: 0, right: 0, width: 0, height: 0 }; }
  get offsetWidth() { return 0; }
  getContext() { return null; }
}
class T { constructor(t) { this.nodeType = 3; this.text = String(t); this.parentNode = null; } get textContent() { return this.text; } set textContent(v) { this.text = String(v); } }
function simpleMatch(n, s) {
  const m = s.match(/^([a-z0-9-]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
  if (!m) return false;
  if (m[1] && n.tag !== m[1].toLowerCase()) return false;
  for (const c of (m[2] || '').split('.').filter(Boolean)) if (!n._cls.has(c)) return false;
  for (const a of (m[3] || '').match(/\[[^\]]+\]/g) || []) {
    const [, k, v] = a.match(/\[([^=\]]+)(?:="?([^"\]]*)"?)?\]/);
    if (!n.hasAttribute(k)) return false;
    if (v !== undefined && n.getAttribute(k) !== v) return false;
  }
  return true;
}
const docListeners = {};
const document = {
  createElement: t => new N(t), createElementNS: (_ns, t) => new N(t), createTextNode: t => new T(t),
  addEventListener(ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); },
  removeEventListener(ev, fn) { const l = docListeners[ev]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
  visibilityState: 'visible', activeElement: null,
};
DOC_ROOT = new N('html');
global.document = document;

function fire(node, type, extra) {
  let stopped = false;
  const evt = Object.assign({ type, target: node, currentTarget: node, button: 0, key: undefined,
    preventDefault() {}, stopPropagation() { stopped = true; } }, extra || {});
  for (let n = node; n && !stopped; n = n.parentNode) {
    evt.currentTarget = n;
    for (const fn of [...(n.listeners[type] || [])]) fn(evt);
  }
}
const click = n => fire(n, 'click');
const tapZone = n => fire(n, 'mousedown', { button: 0 });

/* ---------------- window: speech, audio, motion, wake lock ---------------- */
const speech = [];
const windowListeners = {};
class Utt { constructor(t) { this.text = t; } }
const audioLog = [];
class FakeAC {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.sampleRate = 48000; this.destination = {}; audioLog.push(['new-ac']); }
  resume() { this.state = 'running'; audioLog.push(['resume']); return Promise.resolve(); }
  close() { this.state = 'closed'; return Promise.resolve(); }
  createOscillator() { const ac = this; return { type: '', frequency: { value: 0 }, connect: g => g, start(at) { audioLog.push(['tone', this.frequency.value, at]); }, stop() {} }; }
  createGain() { return { gain: { value: 1, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: x => x }; }
  createBufferSource() { return { connect() {}, start() { audioLog.push(['clip', this.buffer && this.buffer.key]); }, stop() { audioLog.push(['clip-stop', this.buffer && this.buffer.key]); } }; }
  decodeAudioData(buf, ok) { ok({ duration: 1, key: buf.key }); }
}
let motionPermission = null; // null = no requestPermission (Android/desktop); else a function returning a promise
function MotionEvt() {}
const win = {
  setTimeout: setT, clearTimeout: clr, setInterval: setI, clearInterval: clr,
  requestAnimationFrame: fn => setT(() => fn(clock.now), 16), cancelAnimationFrame: clr,
  matchMedia: () => ({ matches: false }),
  speechSynthesis: {
    speak(u) { speech.push({ op: 'speak', text: String(u.text), t: clock.now }); },
    cancel() { speech.push({ op: 'cancel', t: clock.now }); },
    getVoices: () => [], addEventListener() {}, removeEventListener() {},
  },
  SpeechSynthesisUtterance: Utt,
  AudioContext: FakeAC,
  DeviceMotionEvent: MotionEvt,
  addEventListener(ev, fn) { (windowListeners[ev] = windowListeners[ev] || []).push(fn); },
  removeEventListener(ev, fn) { const l = windowListeners[ev]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
  visualViewport: null, innerHeight: 800,
  open: () => null,
};
Object.defineProperty(MotionEvt, 'requestPermission', { configurable: true, get() { return motionPermission || undefined; } });
global.window = win;
const wakeLog = [];
const nav = {
  wakeLock: { request: () => { const s = { released: false, release() { s.released = true; wakeLog.push('release'); } }; wakeLog.push('acquire'); return Promise.resolve(s); } },
  language: 'en-ZA',
};
Object.defineProperty(global, 'navigator', { value: nav, configurable: true, writable: true });
global.ResizeObserver = undefined;

function emitMotion(mag) {
  for (const fn of [...(windowListeners.devicemotion || [])]) fn({ accelerationIncludingGravity: { x: 0, y: 0, z: mag } });
}
const motionListeners = () => (windowListeners.devicemotion || []).length;

/* ---------------- obsidian + modal stubs ---------------- */
const notices = [];
const modals = [];
const obsidian = {
  setIcon: (elx) => { elx.appendChild(new N('svg')); },
  Notice: class { constructor(m) { notices.push(String(m)); } },
  Modal: class { constructor(app) { this.app = app; this.contentEl = new N('div'); this.modalEl = new N('div'); this.titleEl = new N('div'); } open() { modals.push(this); if (this.onOpen) this.onOpen(); } close() { if (this.onClose) this.onClose(); } },
  Setting: class { constructor() {} addButton() { return this; } },
  Menu: class { addItem() { return this; } showAtMouseEvent() {} showAtPosition() {} },
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: true },
};
class CapModal { constructor(app, opts) { this.opts = opts || {}; } open() { modals.push(this); } close() {} }
const modalStub = {
  EndSessionModal: class extends CapModal { get kind() { return 'end'; } },
  ConfirmModal: class extends CapModal { get kind() { return 'confirm'; } },
  FormModal: class extends CapModal { get kind() { return 'form'; } },
  PlanPickerModal: class extends CapModal { get kind() { return 'picker'; } },
};

let ioStub = null;
const origLoad = Module._load;
Module._load = function (req, parent, ...rest) {
  if (req === 'obsidian') return obsidian;
  if (req === './modals') return modalStub;
  if (req === './data' && ioStub) return { makeIo: () => ioStub };
  return origLoad.call(this, req, parent, ...rest);
};

/* ---------------- synthetic vault (NOT Ruan's data) ---------------- */
function ex(name, fm) { return { name, fm: Object.assign({ unit: 'reps', type: 'strength', equipment: 'bodyweight' }, fm || {}), body: '', file: { path: `Gym/Exercises/${name}.md` } }; }
function workout(date, rows) { return { name: date, fm: { date, day: 'Old day', plan: 'Synthetic Plan' }, rows, file: { path: `Gym/Workouts/${date}.md` } }; }

function makeData(opts) {
  const o = opts || {};
  const { parsePlanBody } = require(path.join(SRC, 'plan-parse'));
  const planBody = o.planBody || '## Day A (any)\n\n- Push-ups | 2 x 10\n- Plank | 2 x 30s\n';
  return {
    profile: { fm: {}, body: '' }, body: [], present: true, unreadable: 0, unreadablePaths: [], duplicateExercises: [], rootExists: true,
    exercises: o.exercises || [ex('Push-ups'), ex('Plank', { unit: 'seconds' }), ex('Goblet Squat', { unit: 'kg' })],
    plans: [{ name: 'Synthetic Plan', fm: { active: 'true' }, file: { path: 'Gym/Plans/Synthetic Plan.md' }, model: parsePlanBody(planBody) }],
    goals: o.goals || [],
    workouts: o.workouts || [workout('2026-01-01', [
      { exercise: 'Push-ups', set: 1, reps: '12', weight_kg: '', seconds: '', note: '', distance_km: '' },
      { exercise: 'Plank', set: 1, reps: '', weight_kg: '', seconds: '40', note: '', distance_km: '' },
    ])],
  };
}

/* Obsidian's device-local storage, as app.js implements it. One instance is
   shared by every boot() in a test to model "the same device, relaunched". */
function makeStorage() {
  const m = new Map();
  return {
    raw: m,
    saveLocalStorage(key, data) { if (data) m.set(key, JSON.stringify(data)); else m.delete(key); },
    loadLocalStorage(key) { try { const t = m.get(key); if (t) return JSON.parse(t); } catch (e) { /* unreadable */ } return null; },
  };
}

/* A process kill: nothing gets to run stop(), onClose() or a flush. Every
   timer and every listener the old controller registered simply never fires
   again. */
function killProcess() {
  timers.clear();
  for (const k of Object.keys(windowListeners)) delete windowListeners[k];
  for (const k of Object.keys(docListeners)) delete docListeners[k];
}

/* opts.settings  -> plugin settings overrides
   opts.app       -> merged over the stub app (vault, metadataCache, saveLocalStorage...)
   opts.plugin    -> merged over the stub plugin (_ownWrites, forEachView...)
   opts.view      -> merged over the stub view (registerEvent...)
   opts.storage   -> a makeStorage(); its two methods become app.saveLocalStorage/loadLocalStorage
   opts.data      -> patch merged over the synthetic vault (e.g. { present: false, rootExists: true })
   everything else (planBody, exercises, workouts...) feeds makeData(). */
async function boot(opts) {
  const o = opts || {};
  const saved = [];
  let loads = 0, scaffolds = 0;
  ioStub = {
    scaffold: async () => { scaffolds++; },
    loadAll: async () => { loads++; return Object.assign(makeData(o), o.data || {}); },
    saveWorkout: async w => { saved.push(JSON.parse(JSON.stringify(w))); if (o.saveDelayMs) await new Promise(r => setT(r, o.saveDelayMs)); },
    saveExercise: async () => {},
    listVoiceClips: async () => [],
    readVoiceClip: async () => new ArrayBuffer(0),
  };
  const { DEFAULT_SETTINGS } = require(path.join(SRC, 'constants'));
  const settings = Object.assign({}, DEFAULT_SETTINGS, { soundMode: 'voice', musicApp: 'none' }, o.settings || {});
  const contentEl = new N('div');
  DOC_ROOT.appendChild(contentEl);
  const app = Object.assign({
    appId: 'test-vault-id',
    vault: { on: () => ({}) }, metadataCache: { on: () => ({}) },
    workspace: { getLeaf: () => ({ openFile() {} }) },
  }, o.storage ? { saveLocalStorage: o.storage.saveLocalStorage, loadLocalStorage: o.storage.loadLocalStorage } : {}, o.app || {});
  const plugin = Object.assign({ app, settings, manifest: { id: 'gym-app' }, saveSettings: async () => {}, _lastWrite: 0 }, o.plugin || {});
  const view = Object.assign({ plugin, contentEl, registerEvent() {}, registerDomEvent() {} }, o.view || {});
  const { mountApp } = require(path.join(SRC, 'controller'));
  const ctl = mountApp(view);
  await ctl.start();
  return { ctl, ctx: ctl.ctx, saved, contentEl, settings, plugin, app, view, loads: () => loads, scaffolds: () => scaffolds };
}
const flush = () => new Promise(r => setImmediate(r));

/* Find helpers */
const page = ctx => ctx.view.contentEl.querySelector('main.gv-page');
const byLabel = (root, label) => root.querySelectorAll('button').concat(root.querySelectorAll('[role=button]')).find(b => b.getAttribute('aria-label') === label);
const byText = (root, text) => root.querySelectorAll('button').find(b => b.textContent.trim() === text);
const countText = ctx => { const n = page(ctx).querySelector('.gv-session-count'); return n ? n.textContent : null; };
const spoken = () => speech.filter(s => s.op === 'speak').map(s => s.text);
/* What was actually HEARD: an utterance is cut if a cancel lands < minMs after it started. */
function heard(minMs) {
  const out = [];
  for (let i = 0; i < speech.length; i++) {
    const s = speech[i];
    if (s.op !== 'speak' || s.text === '') continue;
    const cut = speech.slice(i + 1).find(x => x.op === 'cancel');
    const life = cut ? cut.t - s.t : Infinity;
    out.push({ text: s.text, t: s.t, audibleMs: life, cut: life < (minMs || 250) });
  }
  return out;
}

module.exports = {
  SRC, clock, timers, advance, suspend, liveIntervals, N, T, fire, click, tapZone, document, win, speech, spoken, heard,
  audioLog, wakeLog, notices, modals, emitMotion, motionListeners, setMotionPermission: f => { motionPermission = f; },
  boot, makeStorage, killProcess, windowListeners, flush, page, byLabel, byText, countText, makeData, ex, workout, docListeners,
};
