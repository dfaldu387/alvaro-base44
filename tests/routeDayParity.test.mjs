// The Calendar and the Route tab must agree about which bookings are on a given day.
// They disagreed: the Route tab read only `status`, so a provisionally placed booking showed on
// the Calendar, was counted by Connect Appointments, and arrived at the Route tab as
// "No clients on this day" — an empty day for a day that had work in it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const { isPlacedOnCalendar, SCHEDULED_STATUSES, SCHEDULE_PLACED } = await import('../src/lib/appointmentUtils.js');

test('a provisionally placed booking is on the calendar, whatever its status says', () => {
  const provisional = { assigned_time: '12:50', status: 'pending', schedule_status: 'provisional' };
  assert.equal(isPlacedOnCalendar(provisional), true);
  // The old Route-tab rule dropped it. This is the exact shape that produced the empty day.
  assert.equal(SCHEDULED_STATUSES.includes(provisional.status), false, 'status alone is not enough');
});

test('every placement state the calendar accepts is accepted, and an unplaced request is not', () => {
  for (const schedule_status of SCHEDULE_PLACED) {
    assert.equal(isPlacedOnCalendar({ assigned_time: '09:00', status: 'pending', schedule_status }), true, schedule_status);
  }
  for (const status of SCHEDULED_STATUSES) {
    assert.equal(isPlacedOnCalendar({ assigned_time: '09:00', status, schedule_status: 'unscheduled' }), true, status);
  }
  // No time, or no placement at all, is not on the calendar.
  assert.equal(isPlacedOnCalendar({ status: 'confirmed', schedule_status: 'confirmed' }), false, 'no assigned_time');
  assert.equal(isPlacedOnCalendar({ assigned_time: '09:00', status: 'pending', schedule_status: 'unscheduled' }), false);
});

test('source guard: the Route tab and the Calendar use the one shared rule, not their own copy', () => {
  for (const f of ['src/pages/admin/AdminRoute.jsx', 'src/pages/admin/Schedule.jsx']) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.match(src, /isPlacedOnCalendar\(/, `${f} uses the shared rule`);
    assert.doesNotMatch(src, /SCHEDULED_STATUSES\.includes\(/, `${f} does not re-implement it`);
  }
});

test('the Route tab lists the day ahead, not only work already finished', () => {
  const src = read('src/pages/admin/AdminRoute.jsx');
  const listed = src.match(/const ROUTE_STATUSES = \[([^\]]+)\]/)?.[1];
  assert.ok(listed, 'ROUTE_STATUSES is declared');
  const statuses = [...listed.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  // Every status a booking can actually carry once loaded comes from mapDbStatus. An upcoming
  // appointment is 'draft' (status pending) or 'scheduled' (confirmed / waitlist); if the route
  // list does not accept those, the Route tab can only ever show completed stops.
  for (const s of ['draft', 'scheduled', 'completed']) {
    assert.ok(statuses.includes(s), `ROUTE_STATUSES is missing '${s}': an upcoming day would read as empty`);
  }
  // A stop that is not happening is not a stop.
  for (const s of ['cancelled', 'no_show', 'blocked']) {
    assert.ok(!statuses.includes(s), `ROUTE_STATUSES should not include '${s}'`);
  }
});

test('mapDbStatus never produces a status the route list ignores for a live booking', async () => {
  const utils = await import('../src/lib/appointmentUtils.js');
  const src = read('src/pages/admin/AdminRoute.jsx');
  const statuses = [...src.match(/const ROUTE_STATUSES = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  // These are the DB statuses of a booking that is still going to happen, or has just happened.
  for (const dbStatus of ['pending', 'confirmed', 'waitlist', 'completed']) {
    const appt = utils.reqToAppt({ assigned_time: '11:00', status: dbStatus, schedule_status: 'provisional', requested_date: '2026-10-20', client_name: 'A B' });
    assert.ok(appt, `reqToAppt returned null for ${dbStatus}`);
    assert.ok(statuses.includes(appt.status), `a '${dbStatus}' booking maps to '${appt.status}', which the Route tab drops`);
  }
});
