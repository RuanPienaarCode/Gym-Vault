'use strict';
/* Calendar helpers. Pure — no DOM, no obsidian import.

   All dates cross module boundaries as ISO `YYYY-MM-DD` strings (the same
   shape Obsidian daily notes and the workout filenames use); Date objects
   stay local to a function. Construction goes through the (y, m, d) Date
   constructor so everything is LOCAL time — `new Date('2026-08-26')` parses
   as UTC midnight and shifts a day in any non-UTC zone. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const pad2 = n => String(n).padStart(2, '0');

const toISO = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

function fromISO(iso) {
  const m = (iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

const todayISO = () => toISO(new Date());

/* getDay(): 0=Sun..6=Sat → our mon-first keys. */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const weekdayKey = iso => {
  const d = fromISO(iso);
  return d ? DAY_KEYS[d.getDay()] : null;
};

function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/* ISO date of the first day of the week containing `iso`. */
function startOfWeek(iso, weekStart) {
  const d = fromISO(iso);
  const first = weekStart === 'sun' ? 0 : 1;
  const back = (d.getDay() - first + 7) % 7;
  d.setDate(d.getDate() - back);
  return toISO(d);
}

/* Short human date — "26 Aug" or "26 Aug 2025" when not this year. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtShort(iso) {
  const d = fromISO(iso);
  if (!d) return iso || '';
  const now = new Date();
  const y = d.getFullYear() === now.getFullYear() ? '' : ` ${d.getFullYear()}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}${y}`;
}

function monthLabel(iso) {
  const d = fromISO(iso);
  return d ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
}

/* Whole days from a → b (negative when b is before a). */
function daysBetween(aIso, bIso) {
  const a = fromISO(aIso), b = fromISO(bIso);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

module.exports = {
  ISO_DATE, toISO, fromISO, todayISO, weekdayKey, addDays,
  startOfWeek, fmtShort, monthLabel, daysBetween,
};
