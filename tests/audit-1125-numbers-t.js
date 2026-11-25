'use strict';
/* Not a test: a tiny runner so one guard file reports EVERY failing finding by
   name instead of stopping at the first. t(name, fn) records; done() throws. */
const failed = [];
const t = (name, fn) => { try { fn(); } catch (e) { failed.push(`${name}: ${e.message.split('\n')[0]}`); } };
const done = label => {
  if (failed.length) { console.error(failed.map(f => '  FAIL ' + f).join('\n')); throw new Error(`${label}: ${failed.length} failing`); }
  console.log(label + ' OK');
};
module.exports = { t, done };
