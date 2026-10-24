// The date shown on the Review step must be the date that gets submitted. It was not: the summary
// took only the weekday NAME and rebuilt a date by finding "the next such weekday", so anything
// outside the coming seven days displayed wrong — today showed as a week later, and a day chosen
// two weeks out showed as next week's. The customer read one date and submitted another.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const { formatAppointmentDate, ordinalSuffix, formatIsoDate } = await import('../src/lib/bookingDateUtils.js');

test('the date shown is the date chosen, however far ahead it is', () => {
  // Exactly the live reproduction on 21 Oct 2026: today is a Wednesday and showed "28th".
  assert.equal(formatAppointmentDate(new Date(2026, 9, 21)), 'Wednesday 21st October');
  // A day later this week.
  assert.equal(formatAppointmentDate(new Date(2026, 9, 23)), 'Friday 23rd October');
  // The same weekday a week further out — the old rule showed this as the 23rd.
  assert.equal(formatAppointmentDate(new Date(2026, 9, 30)), 'Friday 30th October');
  // Across a month boundary, and a year boundary.
  assert.equal(formatAppointmentDate(new Date(2026, 10, 2)), 'Monday 2nd November');
  assert.equal(formatAppointmentDate(new Date(2027, 0, 1)), 'Friday 1st January');
});

test('every day of a month formats with the right ordinal', () => {
  const expected = { 1: 'st', 2: 'nd', 3: 'rd', 21: 'st', 22: 'nd', 23: 'rd', 31: 'st' };
  for (let d = 1; d <= 31; d++) assert.equal(ordinalSuffix(d), expected[d] || 'th', `day ${d}`);
});

test('the formatter never reconstructs a date from a weekday name', () => {
  const src = read('src/lib/bookingDateUtils.js');
  const fn = src.slice(src.indexOf('export function formatAppointmentDate'));
  assert.doesNotMatch(fn, /diff \+= 7|indexOf\(dayName\)/, 'it formats the given date, nothing else');
  // And the page must hand it the real Date, not the weekday name.
  assert.match(read('src/pages/Book.jsx'), /formatAppointmentDate\(selectedDate\)/);
});

test('the customer is told which Friday their booking is', () => {
  // The status page could only show a weekday, because checkBookingStatus never sent the date.
  assert.equal(formatIsoDate('2026-10-30'), 'Friday 30th October');
  assert.equal(formatIsoDate('2026-10-21'), 'Wednesday 21st October');
  assert.equal(formatIsoDate('2027-01-01'), 'Friday 1st January');
});

test('a stored date never shifts by a timezone, and a flexible booking falls back to its weekday', () => {
  // Parsed field by field: `new Date('2026-10-30')` is UTC midnight and can land on the 29th.
  assert.equal(formatIsoDate('2026-01-01'), 'Thursday 1st January');
  assert.equal(formatIsoDate('2026-12-31'), 'Thursday 31st December');
  for (const bad of ['', null, undefined, 'Flexible', '2026-10', 'not a date']) {
    assert.equal(formatIsoDate(bad), '', JSON.stringify(bad));
  }
});

test('the status endpoint sends the date, and the page prefers it over the weekday', () => {
  assert.match(read('base44/functions/checkBookingStatus/entry.ts'), /requested_date: b\.requested_date/);
  assert.match(read('src/pages/ClientStatus.jsx'), /formatIsoDate\(booking\.requested_date\) \|\| booking\.day/);
});

