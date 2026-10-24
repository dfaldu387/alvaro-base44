// Deterministic tests for live ETA, running-late messages and tracking links.
// No network, no database, no real messages. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRouteEta } from '../base44/shared/routeEta.ts';
import { routeFingerprint } from '../base44/shared/routeFingerprint.ts';
import { runRunningLate, planRunningLate, bucketIndexFor, lateKey } from '../base44/shared/runningLate.ts';
import { trackingIsLive, buildTrackingView, newTrackingToken, isTokenShape, trackingTokenFields } from '../base44/shared/bookingTracking.ts';
import { renderTemplate } from '../base44/shared/messageRender.ts';
import { ON_THE_WAY_BODY, ON_THE_WAY_BODY_V1 } from '../base44/shared/routeMessageTemplates.ts';

const DATE = '2026-10-14'; // AEDT (UTC+11) in Sydney
// An instant from Sydney wall-clock time on DATE.
const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 14, h - 11, m));
const iso = (h, m = 0) => at(h, m).toISOString();

// Three stops: 9:00, 10:15, 11:30. 45-minute services, 15-minute buffer (60 min occupancy), 15-minute drives.
function route(over = {}) {
  return {
    id: 'r1', route_status: 'finalised', team_member_id: 't1', team_member_name: 'Alvaro',
    stops: [
      { booking_request_id: 'A', order: 1, start_label: '9:00am', start_decimal: 9, end_label: '10:00am', drive_minutes: 15 },
      { booking_request_id: 'B', order: 2, start_label: '10:15am', start_decimal: 10.25, end_label: '11:15am', drive_minutes: 15 },
      { booking_request_id: 'C', order: 3, start_label: '11:30am', start_decimal: 11.5, end_label: '12:30pm', drive_minutes: null },
    ],
    stop_execution: [],
    ...over,
  };
}
const SERVICE = { A: 45, B: 45, C: 45 };
const eta = (r, now = at(10), extra = {}) => computeRouteEta({ date: DATE, route: r, service_minutes: SERVICE, now, ...extra });
const stopOf = (res, id) => res.stops.find(s => s.booking_request_id === id);

// ── 1. A stop in progress ───────────────────────────────────────────────────

test('a stop in progress: delay is measured at its predicted end and carried forward with the stored drive times', () => {
  // A started 9:30 (30 late). Service 45 -> ends 10:15; planned service end 9:45 -> 30 minutes late.
  const r = route({ stop_execution: [{ booking_request_id: 'A', state: 'in_service', arrived_at: iso(9, 25), started_at: iso(9, 30) }] });
  const res = eta(r, at(10, 0));
  assert.equal(res.status, 'ok');
  assert.deepEqual({ k: res.anchor.kind, id: res.anchor.booking_request_id, d: res.delay_minutes }, { k: 'in_progress', id: 'A', d: 30 });
  // B: A's occupancy ends 10:00 + 30 = 10:30, + 15 drive = 10:45 (booked 10:15).
  assert.equal(stopOf(res, 'B').eta_start_label, '10:45am');
  assert.equal(stopOf(res, 'B').delay_minutes, 30);
  assert.equal(stopOf(res, 'B').window_label, '10:45am–11:00am'); // a 15-minute window, not a minute
  // C: B ends 10:45 + 60 = 11:45, + 15 drive = 12:00 (booked 11:30).
  assert.equal(stopOf(res, 'C').eta_start_label, '12:00pm');
  assert.equal(stopOf(res, 'C').delay_minutes, 30);
  // The order was never changed.
  assert.deepEqual(res.stops.map(s => s.booking_request_id), ['A', 'B', 'C']);
  // The stop in progress has no ETA.
  assert.equal(stopOf(res, 'A').eta_start_label, null);
});

test('a cut that has run past its predicted end is never reported as finished in the past', () => {
  const r = route({ stop_execution: [{ booking_request_id: 'A', state: 'in_service', started_at: iso(9, 30) }] });
  // Predicted end 10:15, but it is 10:31 and the cut is still going.
  assert.equal(eta(r, at(10, 31)).delay_minutes, 46);
});

test('a completed stop has an actual time and no ETA; the latest timestamp is the anchor', () => {
  const r = route({ stop_execution: [
    { booking_request_id: 'A', state: 'completed', started_at: iso(9, 5), completed_at: iso(9, 50) },
    { booking_request_id: 'B', state: 'completed', started_at: iso(10, 40), completed_at: iso(11, 25) },
  ] });
  const res = eta(r, at(11, 30));
  assert.equal(res.anchor.booking_request_id, 'B');
  assert.equal(res.anchor.kind, 'completed');
  assert.equal(res.delay_minutes, 25); // 11:25 vs planned service end 10:15 + 45 = 11:00
  assert.equal(stopOf(res, 'A').eta_start_label, null);
  assert.equal(stopOf(res, 'A').delay_minutes, null);
  assert.deepEqual(stopOf(res, 'A').actual, { start_label: '9:05am', end_label: '9:50am' });
  assert.equal(stopOf(res, 'C').eta_start_label, '11:55am'); // B's occupancy ends 11:15 + 25 = 11:40, + 15 drive
});

// ── 2. A day running early ──────────────────────────────────────────────────

test('running early is clamped to zero: nobody is promised an earlier arrival than the booked time', () => {
  // A finished at 9:35, ten minutes before its planned service end of 9:45.
  const r = route({ stop_execution: [{ booking_request_id: 'A', state: 'completed', started_at: iso(8, 55), completed_at: iso(9, 35) }] });
  const res = eta(r, at(9, 40));
  assert.equal(res.anchor.raw_delay_minutes, -10);
  assert.equal(res.anchor.delay_minutes, 0);
  assert.equal(res.delay_minutes, 0);
  assert.equal(stopOf(res, 'B').eta_start_label, '10:15am'); // booked time, not 9:50
  assert.equal(stopOf(res, 'B').delay_minutes, 0);
  assert.equal(stopOf(res, 'C').eta_start_label, '11:30am');
});

test('idle time in the plan absorbs part of a delay', () => {
  const r = route();
  r.stops[1] = { ...r.stops[1], start_label: '10:30am', start_decimal: 10.5, end_label: '11:30am' }; // 15 min of slack before B
  r.stops[2] = { ...r.stops[2], start_label: '11:45am', start_decimal: 11.75, end_label: '12:45pm' };
  r.stop_execution = [{ booking_request_id: 'A', state: 'completed', started_at: iso(9, 20), completed_at: iso(10, 5) }];
  const res = eta(r, at(10, 5));
  assert.equal(res.delay_minutes, 20); // 10:05 vs 9:45
  assert.equal(stopOf(res, 'B').eta_start_label, '10:35am'); // 10:20 + 15 drive, booked 10:30
  assert.equal(stopOf(res, 'B').delay_minutes, 5);
});

test('nothing timed yet: the plan is the estimate, delay 0', () => {
  const res = eta(route(), at(8, 30));
  assert.equal(res.status, 'ok');
  assert.equal(res.anchor, null);
  assert.equal(res.delay_minutes, 0);
  assert.equal(stopOf(res, 'B').eta_start_label, '10:15am');
});

// ── 3. No finalised route ───────────────────────────────────────────────────

test('no finalised route: eta_unavailable with the reason, never a guess', () => {
  for (const r of [null, undefined, route({ route_status: 'draft' }), route({ route_status: 'finalising' }), route({ stops: [] })]) {
    const res = eta(r);
    assert.equal(res.status, 'eta_unavailable');
    assert.equal(res.reason, 'no_finalised_route');
    assert.ok(res.reason_text);
    assert.equal(res.delay_minutes, null);
    assert.ok(res.stops.every(s => s.eta_start_label === null && s.window_label === null));
  }
  const stale = eta(route({ route_status: 'needs_update' }));
  assert.equal(stale.status, 'eta_unavailable');
  assert.equal(stale.reason, 'route_needs_update');
});

// ── 4. Unverified driving times ─────────────────────────────────────────────

test('driving times that were never verified: eta_unavailable', () => {
  const r = route();
  r.stops[0] = { ...r.stops[0], drive_minutes: null };
  const res = eta(r);
  assert.equal(res.status, 'eta_unavailable');
  assert.equal(res.reason, 'driving_times_unverified');
  assert.ok(res.stops.every(s => s.eta_start_label === null));
  // The last stop never has a next leg, so its null drive time is fine.
  assert.equal(eta(route()).status, 'ok');
});

test('an anchor whose service length is unknown is unavailable, not guessed', () => {
  const r = route({ stop_execution: [{ booking_request_id: 'A', state: 'in_service', started_at: iso(9, 30) }] });
  const res = computeRouteEta({ date: DATE, route: r, service_minutes: {}, now: at(10) });
  assert.equal(res.reason, 'service_duration_missing');
});

test('a timestamp from another day is ignored, not trusted', () => {
  const r = route({ stop_execution: [{ booking_request_id: 'A', state: 'completed', completed_at: '2026-10-07T23:30:00.000Z' }] });
  assert.equal(eta(r).anchor, null);
});

// ── 5. The threshold fires exactly once across repeated sweeps ──────────────

function fakeDay({ stateOverrides = {} } = {}) {
  const bookings = ['A', 'B', 'C'].map((id, i) => ({
    id, client_name: `Client ${id} Smith`, phone: '0412345678', status: 'confirmed', requested_date: DATE,
    assigned_time: ['9:00am', '10:15am', '11:30am'][i], schedule_status: 'confirmed', duration_mins: 45,
    address_lat: -33.9, address_lng: 151.1, team_member_id: 't1', is_test: false, client_id: undefined,
  }));
  const rt = route({
    fingerprint: routeFingerprint(bookings),
    stop_execution: [
      { booking_request_id: 'A', state: 'in_service', started_at: iso(9, 30) },
      ...Object.entries(stateOverrides).map(([id, state]) => ({ booking_request_id: id, state })),
    ],
  });
  const rows = []; let n = 0;
  const match = (r, q) => Object.entries(q).every(([k, v]) => r[k] === v);
  const admin = {
    rows,
    entities: {
      DayRoute: { filter: async (q) => [rt].filter(r => r.id && q.date === DATE) },
      BookingRequest: {
        filter: async () => bookings.map(b => ({ ...b })),
        get: async (id) => bookings.find(b => b.id === id),
        update: async (id, d) => { Object.assign(bookings.find(b => b.id === id), d); },
      },
      ReminderClient: { get: async () => null },
      Message: { get: async () => null },
      MessagingSettings: { list: async () => [] },
      MessageOutbox: {
        filter: async (q) => rows.filter(r => match(r, q)).map(r => ({ ...r })),
        create: async (d) => { const r = { ...d, id: `o${++n}`, created_date: new Date(Date.UTC(2026, 9, 13, 23, 0, 0, n)).toISOString() }; rows.push(r); return { ...r }; },
        delete: async (id) => { rows.splice(rows.findIndex(r => r.id === id), 1); },
      },
    },
  };
  return admin;
}
const late = (admin) => admin.rows.filter(r => r.template_key === 'running_late');

test('buckets: over 20 minutes is the first, over 45 the second; 20 exactly is on time', () => {
  assert.equal(bucketIndexFor(20), -1);
  assert.equal(bucketIndexFor(21), 0);
  assert.equal(bucketIndexFor(25), 0);
  assert.equal(bucketIndexFor(28), 0);
  assert.equal(bucketIndexFor(45), 0);
  assert.equal(bucketIndexFor(46), 1);
  assert.equal(bucketIndexFor(null), -1);
});

test('25 minutes late sends once; repeated sweeps and drift to 28 do not send again; a materially worse bucket sends once more', async () => {
  const admin = fakeDay();
  // A started 9:30 -> predicted end 10:15 -> B and C are 30 minutes late.
  const first = await runRunningLate(admin, { now: at(10, 0) });
  assert.equal(first.queued, 2);
  assert.deepEqual(late(admin).map(r => r.idempotency_key).sort(), [lateKey('B', 'l20', DATE), lateKey('C', 'l20', DATE)].sort());

  for (const minute of [5, 10, 15]) { // repeated sweeps, same bucket
    const again = await runRunningLate(admin, { now: at(10, minute) });
    assert.equal(again.queued, 0);
  }
  assert.equal(late(admin).length, 2);

  // 45 is still the first bucket; the cut is still going at 10:30 -> 45 minutes.
  assert.equal((await runRunningLate(admin, { now: at(10, 30) })).queued, 0);
  // At 10:31 the delay is 46: a materially worse bucket, one more message each.
  assert.equal((await runRunningLate(admin, { now: at(10, 31) })).queued, 2);
  assert.equal((await runRunningLate(admin, { now: at(10, 36) })).queued, 0);
  assert.equal(late(admin).length, 4);

  // The message carries the new window and the booked time, for the barber's screen too.
  const msg = late(admin).find(r => r.idempotency_key === lateKey('B', 'l45', DATE));
  assert.equal(msg.payload.time, '10:15am');
  assert.match(msg.payload.eta_window, /^Arriving between /);
  assert.ok(msg.payload.window_label);
});

test('never for a stop the barber has already arrived at', async () => {
  const admin = fakeDay({ stateOverrides: { B: 'arrived' } });
  const res = await runRunningLate(admin, { now: at(10, 0) });
  assert.equal(res.queued, 1);
  assert.deepEqual(late(admin).map(r => r.booking_request_id), ['C']);
  assert.equal(planRunningLate([{ booking_request_id: 'X', state: 'arrived', window_label: '1:00pm–1:15pm', delay_minutes: 50 }], {}).length, 0);
});

test('a worse message already sent suppresses a lower bucket on recovery', () => {
  const stop = { booking_request_id: 'B', state: 'planned', window_label: '11:00am–11:15am', delay_minutes: 30 };
  assert.equal(planRunningLate([stop], { B: 1 }).length, 0);
  assert.equal(planRunningLate([stop], { B: 0 }).length, 0);
  assert.equal(planRunningLate([stop], {}).length, 1);
});

test('no live route, no running-late messages', async () => {
  const admin = fakeDay();
  admin.entities.DayRoute.filter = async () => [];
  assert.equal((await runRunningLate(admin, { now: at(10) })).queued, 0);
});

// ── 6. Tokens ───────────────────────────────────────────────────────────────

const booking = (over = {}) => ({
  id: 'B', client_name: 'Jordan Lee', phone: '0412 345 678', address: '1 Secret St', status: 'confirmed', requested_date: DATE,
  assigned_time: '10:15am', services: ['Skin Fade'], tracking_token: 'AbCdEfGhIjKlMnOpQrStUv', tracking_token_date: DATE, ...over,
});
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUv';

test('tokens are 22 URL-safe characters and unguessable', () => {
  const a = newTrackingToken(); const b = newTrackingToken();
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(a, b);
  assert.ok(isTokenShape(a));
  assert.ok(!isTokenShape('short'));
  assert.ok(!isTokenShape('has spaces and is long enough!'));
});

test('a token for the wrong date, an unknown token, or a closed booking is simply not live', () => {
  assert.equal(trackingIsLive(booking(), TOKEN, DATE), true);
  assert.equal(trackingIsLive(booking(), TOKEN, '2026-10-15'), false);      // used on another day
  assert.equal(trackingIsLive(booking(), TOKEN, '2026-10-13'), false);      // used the night before
  assert.equal(trackingIsLive(booking({ requested_date: '2026-10-21' }), TOKEN, '2026-10-21'), false); // booking moved: token was for the old date
  assert.equal(trackingIsLive(booking({ tracking_token_date: undefined }), TOKEN, DATE), false);
  assert.equal(trackingIsLive(undefined, TOKEN, DATE), false);              // unknown token
  assert.equal(trackingIsLive(booking(), 'ZZZZZZZZZZZZZZZZZZZZZZ', DATE), false);
  for (const status of ['declined', 'no_show', 'could_not_fit']) assert.equal(trackingIsLive(booking({ status }), TOKEN, DATE), false, status);
});

test('a moved booking gets a fresh token for its new date; a current token is kept', () => {
  assert.equal(trackingTokenFields(booking()), null);
  const fresh = trackingTokenFields(booking({ requested_date: '2026-10-21' }));
  assert.equal(fresh.tracking_token_date, '2026-10-21');
  assert.notEqual(fresh.tracking_token, TOKEN);
  assert.equal(trackingTokenFields(booking({ requested_date: undefined, tracking_token: undefined })), null);
});

test('the tracking view carries exactly six fields and nothing else', () => {
  const r = route({ stop_execution: [{ booking_request_id: 'A', state: 'in_service', started_at: iso(9, 30) }] });
  const view = buildTrackingView(booking(), [eta(r, at(10))]);
  assert.deepEqual(Object.keys(view).sort(), ['arrival_window', 'available', 'booked_time', 'first_name', 'service', 'state', 'stops_away']);
  assert.equal(view.first_name, 'Jordan');
  assert.equal(view.service, 'Skin Fade');
  assert.equal(view.booked_time, '10:15am');
  assert.equal(view.arrival_window, '10:45am–11:00am');
  assert.equal(view.state, 'planned');
  assert.equal(view.stops_away, 1); // A is still ahead
  const text = JSON.stringify(view);
  for (const secret of ['Secret St', '0412', 'Lee', 'Alvaro', 'r1']) assert.ok(!text.includes(secret), secret);
});

test('with no usable ETA the view still works, without a window', () => {
  const view = buildTrackingView(booking(), [eta(route({ route_status: 'draft' }))]);
  assert.equal(view.arrival_window, null);
  assert.equal(view.stops_away, null);
  assert.equal(view.state, 'planned');
});

test('the public tracking endpoint can only answer through the fixed view', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../base44/functions/getBookingTracking/entry.ts', import.meta.url), 'utf8');
  assert.match(src, /Response\.json\(buildTrackingView\(/);
  assert.ok((src.match(/Response\.json\(/g) || []).length === 2); // the view, and the one neutral answer
  for (const leak of ['.address', '.phone', 'team_member', 'route.stops', 'asServiceRole.entities.DayRoute']) assert.ok(!src.includes(leak), leak);
});

// ── Messages ────────────────────────────────────────────────────────────────

test('on_the_way without an ETA or link reads exactly as it always did; with them it adds the window', () => {
  const plain = renderTemplate(ON_THE_WAY_BODY_V1, { name: 'Sam' });
  for (const payload of [{ name: 'Sam' }, { name: 'Sam', eta_window: '', tracking_link: '' }, { name: 'Sam', eta_window: null, tracking_link: '  ' }]) {
    assert.deepEqual(renderTemplate(ON_THE_WAY_BODY, payload), plain);
  }
  const rich = renderTemplate(ON_THE_WAY_BODY, { name: 'Sam', eta_window: 'Arriving between 2:15pm and 2:30pm.', tracking_link: 'Track your barber live: https://x.test/status/abc' });
  assert.equal(rich.ok, true);
  assert.match(rich.text, /on the way to you now\. Arriving between 2:15pm and 2:30pm\. See you soon! Track your barber live/);
  // Everything else still refuses to render when missing.
  assert.equal(renderTemplate(ON_THE_WAY_BODY, { eta_window: 'x' }).ok, false);
});