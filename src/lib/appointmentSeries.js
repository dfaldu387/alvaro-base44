import { addDays, format, isAfter } from 'date-fns';

/**
 * Recurrence maths for a repeating manual appointment — pure, so the form and its
 * tests always agree on which dates a series covers.
 *
 * A series is only ever a list of DATES. What each occurrence then becomes (an
 * exact-time appointment, or an availability window Route Flow may place inside) is
 * decided by the scheduling type, and is the same for every date in the list.
 */

/** Hard ceiling on one save: a series can never queue an unbounded number of bookings. */
export const MAX_OCCURRENCES = 52;
/** "Ends: Never" creates this many upcoming appointments — a rolling horizon, not infinity. */
export const NEVER_HORIZON = 8;

/** Date → 'yyyy-MM-dd' (local calendar date, never UTC-shifted). */
function keyOf(date) {
  return format(date, 'yyyy-MM-dd');
}

/** 'yyyy-MM-dd' → local Date at midnight, or null when the key is unusable. */
function parseKey(key) {
  const parts = String(key || '').split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The dates a series falls on, starting with `startDate` itself.
 * ends: 'never' → NEVER_HORIZON dates · 'after' → that many appointments · 'on' → dates up to `untilDate`.
 */
export function occurrenceDates({ startDate, everyWeeks = 1, ends = 'never', count = 1, untilDate = null } = {}) {
  const base = parseKey(startDate);
  if (!base) return [];
  const stepDays = Math.max(1, Math.round(Number(everyWeeks) || 1)) * 7;

  let limit = NEVER_HORIZON;
  if (ends === 'after') limit = Math.min(MAX_OCCURRENCES, Math.max(1, Math.round(Number(count) || 1)));
  else if (ends === 'on') limit = MAX_OCCURRENCES;

  const until = ends === 'on' ? parseKey(untilDate) : null;
  // "On a date" without a date yet is one appointment until a date is chosen.
  if (ends === 'on' && !until) return [keyOf(base)];

  const dates = [];
  for (let i = 0; dates.length < limit; i += 1) {
    const day = addDays(base, i * stepDays);
    if (until && isAfter(day, until)) break;
    dates.push(keyOf(day));
  }
  return dates;
}

/** "Weekly", "Every 2 weeks", "Every 3 weeks"… */
export function frequencyLabel(everyWeeks) {
  const n = Math.max(1, Math.round(Number(everyWeeks) || 1));
  return n === 1 ? 'Weekly' : `Every ${n} weeks`;
}

/** "Never", "6 appointments", "Until 20 Dec 2026". */
export function endsLabel({ ends = 'never', count = 1, untilDate = null } = {}) {
  if (ends === 'after') return `${Math.max(1, Math.round(Number(count) || 1))} appointments`;
  if (ends === 'on') {
    const date = parseKey(untilDate);
    return date
      ? `Until ${date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : 'Until a date';
  }
  return 'Never';
}