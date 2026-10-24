// Fix 2: one function answers "is this finalised route still valid", and the hourly arrival job asks it.
// Fix 3: an arrival time that changes reaches the customer, never leaving a stale time standing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMemDb } from './helpers/memDb.mjs';

const fp = await import('../base44/shared/routeFingerprint.ts');
const { currentRouteStatus } = await import('../base44/shared/currentRouteStatus.ts');
const { runArrivalTimes, arrivalKey } = await import('../base44/shared/arrivalTimes.ts');
const { loadDayEta } = await import('../base44/shared/routeEtaLoader.ts');

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const DATE = '2026-10-16';

const booking = (over = {}) => ({
  id: 'b1', requested_date: DATE, team_member_id: 't1', is_test: false, status: 'confirmed', schedule_status: 'confirmed',
  assigned_time: '9:00am', duration_mins: 45, phone: '0412345678', client_name: 'Sam Jones', address_lat: -33.8, address_lng: 151.2, ...over,
});

function world() {
  const rows = [booking()];
  const db = makeMemDb({
    BookingRequest: rows,
    DayRoute: [{
      id: 'r1', date: DATE, route_status: 'finalised', team_member_id: 't1', team_member_name: 'Alvaro', is_test: false,
      fingerprint: fp.routeFingerprint(rows), stops: [{ booking_request_id: 'b1', order: 1, start_label: '9:00am', start_decimal: 9 }],
    }],
  });
  return db;
}
/** Re-finalising a day: the booking and the stored route both move to the new time, and the fingerprint is rebuilt. */
function refinalise(db, label, decimal) {
  db.table('BookingRequest')[0].assigned_time = label;
  const route = db.table('DayRoute')[0];
  route.stops = [{ booking_request_id: 'b1', order: 1, start_label: label, start_decimal: decimal }];
  route.fingerprint = fp.routeFingerprint(db.table('BookingRequest'));
}
const run = (db) => runArrivalTimes(db.asServiceRole, { date: DATE, trigger: 'scheduled' });
const outbox = (db) => db.table('MessageOutbox');

// ── Fix 2 ────────────────────────────────────────────────────────────────────────────────────
test('one shared function answers whether a finalised route still matches its day', () => {
  assert.equal(typeof currentRouteStatus, 'function');
  const rows = [booking()];
  const route = { route_status: 'finalised', team_member_id: 't1', is_test: false, fingerprint: fp.routeFingerprint(rows) };
  assert.equal(currentRouteStatus(route, rows), 'finalised');
  assert.equal(currentRouteStatus(route, [booking({ assigned_time: '10:00am' })]), 'needs_update');
  assert.equal(currentRouteStatus(route, [...rows, booking({ id: 'b2', assigned_time: '11:00am' })]), 'needs_update');
  // Another barber's appointment is not part of this route's day.
  assert.equal(currentRouteStatus(route, [...rows, booking({ id: 'b9', team_member_id: 't2', assigned_time: '1:00pm' })]), 'finalised');
  // A route covers its barber's whole day, so an appointment added to that day —
  // test data included — makes the stored route out of date until it is rebuilt.
  assert.equal(currentRouteStatus(route, [...rows, booking({ id: 'b8', is_test: true, assigned_time: '2:00pm' })]), 'needs_update');
  // Only a finalised route is re-checked: other statuses are returned as stored.
  assert.equal(currentRouteStatus({ ...route, route_status: 'draft' }, rows), 'draft');
  assert.equal(currentRouteStatus({ ...route, route_status: 'needs_update' }, rows), 'needs_update');
});

test('both readers call that one function, and neither compares fingerprints itself', () => {
  for (const file of ['base44/shared/routeEtaLoader.ts', 'base44/shared/arrivalTimes.ts']) {
    const src = read(file);
    assert.match(src, /currentRouteStatus\(/, `${file} asks the shared function`);
    assert.doesNotMatch(src, /routeFingerprint\(|\.fingerprint/, `${file} has no fingerprint comparison of its own`);
  }
});

test('the hourly arrival job refuses to send from a route that no longer matches its day, and records why, without anyone opening the calendar', async () => {
  const db = world();
  db.table('BookingRequest')[0].assigned_time = '10:00am';       // changed after finalisation; nobody has looked at the day since
  const summary = await run(db);
  assert.equal(summary.queued, 0);
  assert.equal(outbox(db).length, 0, 'nothing was queued');
  assert.equal(db.table('DayRoute')[0].route_status, 'finalised', 'the stored status was not touched: the job decided from the day itself');
  const log = db.table('ArrivalRunLog');
  assert.equal(log.length, 1);
  assert.equal(log[0].outcome, 'skipped');
  assert.match(log[0].reason, /changed after it was finalised/i);
  assert.equal(summary.skipped_routes, 1);
});

test('a route that still matches its day is sent from, as before', async () => {
  const db = world();
  const summary = await run(db);
  assert.equal(summary.queued, 1);
  assert.equal(outbox(db)[0].payload.time, '9:00am');
});

test('the ETA reader and the arrival job agree on the same day', async () => {
  const db = world();
  db.table('BookingRequest')[0].assigned_time = '10:00am';
  const eta = await loadDayEta(db.asServiceRole, DATE, new Date('2026-10-15T20:00:00Z'));
  assert.notEqual(eta.results[0].status, 'finalised');
  assert.equal((await run(db)).queued, 0);
});

// ── Fix 3 ────────────────────────────────────────────────────────────────────────────────────
test('a changed arrival time is refreshed in the unsent message, not left standing', async () => {
  const db = world();
  await run(db);
  assert.equal(outbox(db)[0].status, 'pending');
  refinalise(db, '10:30am', 10.5);
  const again = await run(db);
  assert.equal(outbox(db).length, 1, 'still one message');
  assert.equal(outbox(db)[0].payload.time, '10:30am', 'it now carries the new time');
  assert.equal(again.queued, 0);
  assert.equal(again.refreshed, 1);
  refinalise(db, '11:00am', 11);
  await run(db);
  assert.equal(outbox(db).length, 1);
  assert.equal(outbox(db)[0].payload.time, '11:00am');
});

test('an unchanged time changes nothing', async () => {
  const db = world();
  await run(db);
  const before = JSON.stringify(outbox(db));
  const again = await run(db);
  assert.equal(JSON.stringify(outbox(db)), before);
  assert.equal(again.already_queued, 1);
  assert.equal(again.refreshed || 0, 0);
});

test('once the first time has gone out, a changed time goes out as a correction, once', async () => {
  const db = world();
  await run(db);
  outbox(db)[0].status = 'sent';                                  // the customer holds 9:00am
  refinalise(db, '10:30am', 10.5);
  const first = await run(db);
  assert.equal(first.queued, 1);
  assert.equal(outbox(db).length, 2);
  const [original, correction] = outbox(db);
  assert.equal(original.payload.time, '9:00am', 'the sent message is history, never rewritten');
  assert.equal(correction.payload.time, '10:30am');
  assert.equal(correction.template_key, 'arrival_time');
  assert.equal(correction.status, 'pending');
  assert.notEqual(correction.idempotency_key, arrivalKey('b1', DATE));
  assert.equal(correction.idempotency_key.split('|').length, 4);

  await run(db);                                                  // a re-run adds nothing
  assert.equal(outbox(db).length, 2);

  refinalise(db, '11:00am', 11);                                  // changed again before the correction went: refresh it
  await run(db);
  assert.equal(outbox(db).length, 2);
  assert.equal(outbox(db)[1].payload.time, '11:00am');
});

test('the one-message-per-booking-and-date key is unchanged', () => {
  assert.equal(arrivalKey('abc', '2026-10-14'), 'sms|abc|arrival_time|2026-10-14');
});