'use strict';
/* DOM + obsidian stub for the lane-F3 page guards. Not a test (no .test.cjs
   suffix). Installs globals on require; load the src pages AFTER requiring it. */
const Module = require('node:module');

const mkNode = tag => {
  const n = {
    nodeType: 1, tag, className: '', style: {}, children: [], attrs: {}, listeners: {}, parent: null,
    hidden: false, disabled: false, value: '',
    classList: {
      add(c) { const s = new Set(String(n.className).split(/\s+/).filter(Boolean)); s.add(c); n.className = [...s].join(' '); },
      remove(c) { const s = new Set(String(n.className).split(/\s+/).filter(Boolean)); s.delete(c); n.className = [...s].join(' '); },
      contains(c) { return String(n.className).split(/\s+/).includes(c); },
      toggle(c, on) { const want = on === undefined ? !this.contains(c) : !!on; return want ? this.add(c) : this.remove(c); },
    },
    setAttribute(k, v) { n.attrs[k] = String(v); },
    getAttribute(k) { return n.attrs[k]; },
    removeAttribute(k) { delete n.attrs[k]; },
    addEventListener(ev, fn) { (n.listeners[ev] || (n.listeners[ev] = [])).push(fn); },
    append(...kids) { for (const k of kids) { if (k && k.nodeType === 1) k.parent = n; n.children.push(k); } },
    appendChild(k) { n.append(k); return k; },
    get firstChild() { return n.children[0] || null; },
    removeChild(k) { n.children = n.children.filter(c => c !== k); return k; },
    empty() { n.children = []; n._text = undefined; },
    get childNodes() { return n.children; },
    get textContent() {
      if (n._text !== undefined) return n._text;
      return n.children.map(c => (c.nodeType === 3 ? c.text : c.textContent || '')).join(' ');
    },
    set textContent(v) { n._text = v; n.children = []; },
    querySelector(sel) { return findAll(n, sel.replace(/^\./, ''), sel.charAt(0) !== '.')[0] || null; },
    querySelectorAll(sel) { return findAll(n, sel.replace(/^\./, ''), sel.charAt(0) !== '.'); },
    click() { (n.listeners.click || []).forEach(fn => fn({ stopPropagation() {}, preventDefault() {}, target: n })); },
  };
  return n;
};
function findAll(node, want, byTag, out) {
  out = out || [];
  for (const c of node.children || []) {
    if (c.nodeType !== 1) continue;
    if (byTag ? c.tag === want : String(c.className).split(/\s+/).includes(want)) out.push(c);
    findAll(c, want, byTag, out);
  }
  return out;
}
global.document = {
  addEventListener() {}, removeEventListener() {}, hidden: false,
  createElement: mkNode,
  createElementNS: (_ns, tag) => mkNode(tag),
  createTextNode: t => ({ nodeType: 3, tag: '#text', text: String(t) }),
};
global.window = global.window || {};
const stub = {
  setIcon: () => {}, Notice: class {}, Modal: class {}, Setting: class {},
  ItemView: class {}, Plugin: class {}, PluginSettingTab: class {}, TFile: class {}, TFolder: class {},
  normalizePath: p => p, requestUrl: async () => ({}), Platform: { isMobile: false }, MarkdownRenderer: null,
};
const origLoad = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? stub : origLoad(req, ...rest));

const render = (page, ctx) => { const root = mkNode('div'); page.render(ctx, root); return root; };
module.exports = { mkNode, findAll: (n, cls) => findAll(n, cls, false), render, stub };
