// Connect Appointments joins EVERY consecutive appointment on the day with exactly
// one derived drive leg: three appointments produce two legs, five produce four, and
// a segment whose travel cannot be estimated or does not fit the gap is still a leg —
// it is shown as Travel unavailable / Travel conflict, never dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { makeMemDb } from './helpers/memDb.mjs';

// The engines import 'base44:runtime' (platform secrets). Under Node it is replaced
// by a fake token; this test never calls Mapbox — every travel time is supplied
// directly, so what is being checked is the leg arithmetic, not the network.
const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: () => "test-token" };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { planDriveLegs, resolveRouteTargets } = await import('../base44/shared/dayRoute.ts');
const { toTravelMins } = await import('../base44/shared/mapboxTravel.ts');
const { routeDayRows, routeFingerprint } = await import('../base44/shared/routeFingerprint.ts');
const { currentRouteStatus } = await import('../base44/shared/currentRouteStatus.ts');
const { driveMinutes } = await import('../src/lib/driveTime.js');

const DATE = '2026-10-20';
const DAY = 'Tuesday';

/** One day's stop list, in order. Occupancy end = start + service (+ buffer). */
const stop = (id, startLabel, startDecimal, minutes, driveMinutes = null) => ({
  booking_request_id: id,
  order: 0,
  start_label: startLabel,
  start_decimal: startDecimal,
  end_label: (() => {
    const h = Math.floor(startDecimal);
    const m = Math.round((startDecimal - h) * 60) + minutes;
    const hh = h + Math.floor(m / 60);
    const mm = m % 60;
    const suffix = hh >= 12 ? 'pm' : 'am';
    const hour12 = hh % 12 === 0 ? 12 : hh % 12;
    return `${hour12}:${String(mm).padStart(2, '0')}${suffix}`;
  })(),
  drive_minutes: driveMinutes,
});

// The day exactly as reported: Emily 10:25am (75 min), Moey 12:00pm (35 min),
// Alvaro 1:15pm (35 min). Emily → Moey drives 20 min, Moey → Alvaro drives 15 min
// (Mapbox 676 s on the real addresses, rounded up to the next 5).
const emily = stop('emily', '10:25am', 10.4167, 75, 20);
const moey = stop('moey', '12:00pm', 12, 35, 15);
const alvaro = stop('alvaro', '1:15pm', 13.25, 35, null);

test('three appointments on a day produce exactly two drive legs, in order', () => {
  const plan = planDriveLegs([emily, moey, alvaro], { date: DATE, day: DAY, isTest: false });
  assert.equal(plan.legs.length, 2, '3 appointments = 2 drive legs');
  assert.deepEqual(
    plan.legs.map((l) => [l.from_appointment_id, l.to_appointment_id]),
    [
      ['db-emily', 'db-moey'],
      ['db-moey', 'db-alvaro'],
    ],
    'the middle and final leg are both present, in route order',
  );
  assert.deepEqual(plan.legs.map((l) => l.duration_minutes), [20, 15]);
  assert.equal(plan.review, 0);
  assert.deepEqual(plan.legs.map((l) => l.fits_gap), [true, true]);
});

test('five appointments produce four drive legs — one per consecutive pair', () => {
  const stops = [
    stop('a', '9:00am', 9, 30, 10),
    stop('b', '10:00am', 10, 30, 10),
    stop('c', '11:00am', 11, 30, 10),
    stop('d', '12:00pm', 12, 30, 10),
    stop('e', '1:00pm', 13, 30, null),
  ];
  const plan = planDriveLegs(stops, { date: DATE, day: DAY, isTest: false });
  assert.equal(plan.legs.length, 4);
  assert.equal(plan.legs[0].from_appointment_id, 'db-a');
  assert.equal(plan.legs[3].to_appointment_id, 'db-e');
});

test('a segment whose travel cannot be calculated is kept and flagged for review', () => {
  const lost = { ...emily, drive_minutes: null };   // Emily → Moey could not be estimated
  const plan = planDriveLegs([lost, moey, alvaro], { date: DATE, day: DAY, isTest: false });
  assert.equal(plan.legs.length, 2, 'the leg is not skipped');
  const [first, second] = plan.legs;
  assert.equal(first.from_appointment_id, 'db-emily');
  assert.equal(first.to_appointment_id, 'db-moey');
  assert.equal(first.availability, 'unavailable');
  assert.equal(first.needs_review, true);
  assert.equal(first.duration_minutes, undefined, 'no duration is invented');
  assert.equal(first.fits_gap, true, 'unknown travel is not reported as a conflict');
  assert.equal(plan.unavailable, 1);
  assert.equal(plan.review, 1);
  assert.equal(second.availability, 'known', 'the rest of the route is unaffected');
});

test('travel that does not fit the gap is kept, marked as a conflict, and given its earliest feasible start', () => {
  // The next appointment is 15 minutes after the previous one ends, but the drive is 25.
  const tight = stop('x', '1:00pm', 13, 30, 25);
  const next = stop('y', '1:45pm', 13.75, 30, null);
  const plan = planDriveLegs([tight, next], { date: DATE, day: DAY, isTest: false });
  assert.equal(plan.legs.length, 1, 'the leg is never removed');
  const leg = plan.legs[0];
  assert.equal(leg.fits_gap, false);
  assert.equal(leg.needs_review, true);
  assert.equal(leg.gap_minutes, 15, 'only 15 minutes are free');
  assert.equal(leg.duration_minutes, 25, '25 minutes of driving are required');
  assert.equal(leg.earliest_feasible_start, '1:55pm', 'the earliest the next appointment could start');
  assert.equal(plan.conflict, 1);
  assert.equal(plan.review, 1);
});

test('travel time is honest to the minute — never padded up to a 5-minute mark', () => {
  const mins = (m) => toTravelMins(m * 60);
  assert.equal(mins(12), 12, 'a 12-minute drive is not stretched to 15');
  assert.equal(mins(18), 18);
  assert.equal(mins(23), 23);
  assert.equal(mins(15), 15);
  // The calendar's own display rule agrees with the engine's.
  assert.deepEqual([12, 18, 23, 26, 15].map(driveMinutes), [12, 18, 23, 26, 15]);
});

test('one route covers the barber\'s whole day, so a real appointment is never stranded beside test data', async () => {
  const rows = [
    { id: 't1', requested_date: DATE, day: DAY, team_member_id: 'barber', is_test: true, assigned_time: '10:25am', status: 'confirmed', duration_mins: 75 },
    { id: 't2', requested_date: DATE, day: DAY, team_member_id: 'barber', is_test: true, assigned_time: '12:00pm', status: 'confirmed', duration_mins: 35 },
    { id: 'r1', requested_date: DATE, day: DAY, team_member_id: 'barber', is_test: false, assigned_time: '1:15pm', status: 'confirmed', duration_mins: 35 },
  ];
  const db = makeMemDb({ BookingRequest: rows, TeamMember: [{ id: 'barber', name: 'Alvaro' }] });

  const whole = await resolveRouteTargets(db.asServiceRole, { date: DATE });
  assert.equal(whole.targets.length, 1, 'one route per barber, not one per universe');
  assert.equal(whole.appointments, 3, 'every placed appointment is a stop on it');
  assert.equal(whole.targets[0].is_test, false, 'a day holding real work is a real route');
  assert.equal(whole.targets[0].universe, null, 'read the whole day');

  // A caller that asks for one universe still gets exactly that universe.
  const testOnly = await resolveRouteTargets(db.asServiceRole, { date: DATE, isTest: true });
  assert.equal(testOnly.appointments, 2);
  assert.equal(testOnly.targets[0].is_test, true);
  assert.equal(testOnly.targets[0].universe, true);
});

// The day a route is STAMPED from and the day it is JUDGED against must be the same
// set. While they were not — a real route stamped from the real universe alone — a day
// was marked "needs_update" seconds after every successful connect, and the calendar
// then hid every drive leg on it.
test("a freshly finalised route covers, and is stamped from, the barber's whole day", () => {
  const rows = [
    { id: 'emily', assigned_time: '10:25am', team_member_id: 't1', is_test: true, status: 'confirmed', schedule_status: 'provisional', duration_mins: 75 },
    { id: 'moey', assigned_time: '12:00pm', team_member_id: 't1', is_test: true, status: 'confirmed', schedule_status: 'provisional', duration_mins: 35 },
    { id: 'alvaro', assigned_time: '12:50pm', team_member_id: 't1', is_test: false, status: 'confirmed', schedule_status: 'provisional', duration_mins: 35 },
    { id: 'unplaced', team_member_id: 't1', status: 'pending', schedule_status: 'unscheduled' },
    { id: 'other-barber', assigned_time: '10:00am', team_member_id: 't2', is_test: false, status: 'confirmed', schedule_status: 'provisional', duration_mins: 30 },
  ];
  const stamped = routeFingerprint(routeDayRows(rows, { team_member_id: 't1', universe: null }));
  const route = { route_status: 'finalised', team_member_id: 't1', is_test: false, fingerprint: stamped };

  assert.equal(routeDayRows(rows, { team_member_id: 't1', universe: null }).length, 4, 'the barber’s whole day, test appointments included');
  assert.equal(currentRouteStatus(route, rows), 'finalised', 'connecting a day must not mark it out of date');

  // The stamp that used to be written (real universe only) is exactly what broke it.
  const realOnly = routeFingerprint(rows.filter(r => r.team_member_id === 't1' && r.is_test !== true));
  assert.equal(currentRouteStatus({ ...route, fingerprint: realOnly }, rows), 'needs_update', 'a stamp narrower than the day is stale');

  // A route that really is test-only is stamped and judged on the test universe.
  const testRoute = {
    route_status: 'finalised', team_member_id: 't1', is_test: true,
    fingerprint: routeFingerprint(routeDayRows(rows, { team_member_id: 't1', universe: true })),
  };
  assert.equal(currentRouteStatus(testRoute, rows), 'finalised');
});