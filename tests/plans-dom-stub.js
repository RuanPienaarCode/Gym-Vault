'use strict';
/* A minimal DOM + obsidian stub sufficient to require and drive
   src/page-plans.js's render() through its PLAN-DETAIL path for real —
   not a reimplementation of its rules, the actual module. Shared by the
   plans-*.test.cjs files below so none of them reinvents it.

   Modelled on prose.test.cjs's document stub, extended with two things
   page-plans.js's edit-mode row actually depends on:
     - a real <input>.value property (setAttribute('value', …) updates it,
       matching a browser <input>'s reflected IDL attribute), because the
       Target-field peel reads and rewrites .value directly;
     - node.contains(), because the deferred-reload fix walks the row with
       it to decide whether focus left the row or just moved within it. */

function mkNode(tag) {
  const n = {
    nodeType: 1, tag, className: '', style: { display: '' },
    children: [], attrs: {}, listeners: {}, value: undefined, disabled: false,
    classList: { add(c) { n.className = (n.className + ' ' + c).trim(); } },
    setAttribute(k, v) {
      n.attrs[k] = String(v);
      if (k === 'value' && n.tag === 'input') n.value = String(v);
    },
    addEventListener(ev, fn) { (n.listeners[ev] ||= []).push(fn); },
    append(...kids) { for (const k of kids) n.children.push(k); },
    contains(other) {
      if (other === n) return true;
      return n.children.some(c => c && typeof c.contains === 'function' && c.contains(other));
    },
    querySelector: () => null,
    get textContent() {
      return n.children.map(c => (c.nodeType === 3 ? c.text : (c.textContent || ''))).join('');
    },
  };
  return n;
}

function makeDocument() {
  return {
    createElement: tag => mkNode(tag),
    createTextNode: t => ({ nodeType: 3, tag: '#text', text: String(t) }),
  };
}

/* Fire every listener registered for `type`, in the order they were added. */
function fire(node, type, evt) {
  for (const fn of (node.listeners[type] || [])) fn(evt || {});
}

/* Every node in the subtree, depth-first, text nodes included. */
function flat(node) {
  return node.nodeType === 3 ? [node] : [node, ...node.children.flatMap(flat)];
}

const byTag = (node, tag) => flat(node).filter(n => n.tag === tag);
const hasClass = (node, c) => String(node.className || '').split(/\s+/).includes(c);

/* The only obsidian surface page-plans.js's require tree actually touches:
   setIcon (dom.js), Modal/Setting/Notice (modals.js). None of the modal
   classes are exercised by these guards — Add/Delete are never clicked —
   so they only need to exist, not behave. */
const obsidianStub = {
  setIcon: () => {},
  Modal: class { constructor(app) { this.app = app; } open() {} close() {} },
  Setting: class { constructor(el) { this.el = el; } },
  Notice: class {},
};

module.exports = { makeDocument, fire, flat, byTag, hasClass, obsidianStub };
