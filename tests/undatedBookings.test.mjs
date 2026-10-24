// An undated booking must never block a time slot on the public booking page.
// No network, no database. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blocksTimeSlot, busyBookings } from '../base44/shared/publicBusyBookings.ts';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('an undated booking never blocks a time slot, whatever its status or time', () => {
  const statuses = ['pending', 'confirmed', 'completed', 'cancelled', 'declined', 'waitlist', 'blocked', 'rescheduled', 'no_show', 'could_not_fit'];
  for (const status of statuses) {
    for (const day of ['Tuesday', 'Flexible', undefined]) {
      for (const requested_date of [undefined, null, '']) {
        const b = { status, day, requested_date, assigned_time: '2:00pm', duration_mins: 45 };
        assert.equal(blocksTimeSlot(b), false, `undated ${status} booking (day ${day}) must not block`);
      }
    }
  }
  assert.deepEqual(busyBookings([{ status: 'confirmed', day: 'Tuesday', assigned_time: '2:00pm' }]), []);
});

test('a dated, timed, confirmed or completed booking still blocks its slot (and only those)', () => {
  const base = { requested_date: '2026-10-20', assigned_time: '2:00pm' };
  assert.equal(blocksTimeSlot({ ...base, status: 'confirmed' }), true);
  assert.equal(blocksTimeSlot({ ...base, status: 'completed' }), true);
  for (const status of ['pending', 'cancelled', 'declined', 'blocked']) assert.equal(blocksTimeSlot({ ...base, status }), false);
  assert.equal(blocksTimeSlot({ requested_date: '2026-10-20', status: 'confirmed' }), false, 'no time, nothing to block');
});

test('the booking page has no weekday fallback for undated bookings, and the server uses the shared rule', () => {
  const page = read('src/components/booking/steps/AvailabilityStep.jsx');
  assert.match(page, /\.filter\(r => r\.requested_date === dateStr\)/);
  assert.doesNotMatch(page, /return r\.day === dayName/);
  assert.match(read('base44/functions/publicBookingData/entry.ts'), /selectBusyBookings\(sanitizedBookings\)/);
});