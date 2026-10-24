/**
 * dateScope — the calendar's date coordinate system.
 *
 * Every calendar record (appointment, block, drive leg, Route Flow result) is
 * bound to one real date (YYYY-MM-DD). Weekday names are never used to place a
 * record on the grid — they are only used to resolve which concrete date a
 * record refers to when its date was never stored.
 */
import { addDays, format } from 'date-fns';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Date → 'yyyy-MM-dd' (local calendar date, never UTC-shifted) */
export function dateKey(date) {
  return format(date, 'yyyy-MM-dd');
}

/** 'yyyy-MM-dd' → local Date at midnight */
export function fromDateKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/**
 * The next occurrence of a weekday on/after `fromDate`.
 * Used only to resolve a concrete date for a record that has a weekday but no
 * stored date — never to place a record on more than one day.
 */
export function nextDateForWeekday(fromDate, dayName) {
  const idx = WEEKDAYS.indexOf(dayName);
  if (idx < 0) return null;
  const base = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  return dateKey(addDays(base, (idx - base.getDay() + 7) % 7));
}