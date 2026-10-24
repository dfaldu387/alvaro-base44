import test from 'node:test';
import assert from 'node:assert/strict';
import { occurrenceDates, frequencyLabel, endsLabel, MAX_OCCURRENCES, NEVER_HORIZON } from '../src/lib/appointmentSeries.js';

/**
 * Repeating appointments: which dates a series covers, and nothing else.
 * A Friday series must stay on Fridays, an "ends" rule must actually end, and a
 * series must never queue an unbounded number of bookings.
 */

test('a weekly series keeps the same weekday and starts on the chosen date', () => {
  const dates = occurrenceDates({ startDate: '2026-10-23', everyWeeks: 1, ends: 'after', count: 4 });
  assert.deepEqual(dates, ['2026-10-23', '2026-10-30', '2026-11-06', '2026-11-13']);
  for (const key of dates) assert.equal(new Date(`${key}T12:00:00`).getDay(), 5, 'every occurrence is a Friday');
});

test('every 2 weeks steps a fortnight, never a week', () => {
  const dates = occurrenceDates({ startDate: '2026-10-23', everyWeeks: 2, ends: 'after', count: 3 });
  assert.deepEqual(dates, ['2026-10-23', '2026-11-06', '2026-11-20']);
});

test('Ends: Never creates a rolling horizon, not infinity', () => {
  const dates = occurrenceDates({ startDate: '2026-10-23', everyWeeks: 1, ends: 'never' });
  assert.equal(dates.length, NEVER_HORIZON);
});

test('Ends: on a date stops on or before that date', () => {
  const dates = occurrenceDates({ startDate: '2026-10-23', everyWeeks: 1, ends: 'on', untilDate: '2026-11-06' });
  assert.deepEqual(dates, ['2026-10-23', '2026-10-30', '2026-11-06']);
  const short = occurrenceDates({ startDate: '2026-10-23', everyWeeks: 1, ends: 'on', untilDate: '2026-10-24' });
  assert.deepEqual(short, ['2026-10-23']);
});

test('an end date before the first date creates nothing extra', () => {
  const dates = occurrenceDates({ startDate: '2026-10-23', everyWeeks: 1, ends: 'on', untilDate: '2026-10-01' });
  assert.equal(dates.length, 0);
});

test('no series can exceed the hard ceiling', () => {
  const dates = occurrenceDates({ startDate: '2026-10-23', everyWeeks: 1, ends: 'after', count: 500 });
  assert.equal(dates.length, MAX_OCCURRENCES);
});

test('a missing or impossible start date yields no occurrences', () => {
  assert.deepEqual(occurrenceDates({ startDate: null }), []);
  assert.deepEqual(occurrenceDates({ startDate: 'not-a-date' }), []);
});

test('labels read the way the form writes them', () => {
  assert.equal(frequencyLabel(1), 'Weekly');
  assert.equal(frequencyLabel(2), 'Every 2 weeks');
  assert.equal(endsLabel({ ends: 'never' }), 'Never');
  assert.equal(endsLabel({ ends: 'after', count: 6 }), '6 appointments');
  assert.match(endsLabel({ ends: 'on', untilDate: '2026-12-20' }), /20 Dec 2026/);
});