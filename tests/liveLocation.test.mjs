// Live barber location: the pure ETA model, the one-row store, the throttle, the day-end clear and the guards.
// No network, no real database, no real position: everything here is invented by this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { loadEntry, makeLooseDb } from './helpers/loadEntry.mjs';

const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: (k) => (globalThis.__secrets || {})[k] };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));
globalThis.__secrets = { CUTDELUXEMAP: 'fake-token-for-tests' };

const { computeRouteEta } = await import('../base44/shared/routeEta.ts');
const { routeFingerprint } = await import('../base44/shared/routeFingerprint.ts');
const { loadDayEta } = await import('../base44/shared/routeEtaLoader.ts');
const { runRunningLate } = await import('../base44/shared/runningLate.ts');
const L = await import('../base44/shared/liveLocation.ts');

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const DATE = '2026-10-14'; // AEDT (UTC+11)
const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 14, h - 11, m));
const iso = (h, m = 0) => at(h, m).toISOString();

// A 9:00, B 10:15, C 11:30. 45-minute services, 60 minutes occupied, 15-minute drives.
function route(exec = []) {
  return {
    id: 'r1', route_status: 'finalised', team_member_id: 't1', team_member_name: 'Alvaro',
    stops: [
      { booking_request_id: 'A', order: 1, start_label: '9:00am', start_decimal: 9, end_label: '10:00am', drive_minutes: 15 },
      { booking_request_id: 'B', order: 2, start_label: '10:15am', start_decimal: 10.25, end_label: '11:15am', drive_minutes: 15 },
      { booking_request_id: 'C', order: 3, start_label: '11:30am', start_decimal: 11.5, end_label: '12:30pm', drive_minutes: null },
    ],
    stop_execution: exec,
  };
}
const SERVICE = { A: 45, B: 45, C: 45 };
const eta = (r, now, live) => computeRouteEta({ date: DATE, route: r, service_minutes: SERVICE, now, ...(live === undefined ? {} : { live }) });
const stopOf = (res, id) => res.stops.find((s) => s.booking_request_id === id);

// A completed on time at 9:45; B is on the way. Tap-based ETA for B: 10:15 (booked time).
const onTheWay = (completedAt = iso(9, 45)) => route([
  { booking_request_id: 'A', state: 'completed', started_at: iso(9, 0), completed_at: completedAt },
  { booking_request_id: 'B', state: 'on_the_way', on_the_way_at: iso(9, 50) },
]);
const NOW = at(10, 0);
const goodLive = (over = {}) => ({
  lat: -33.9, lng: 151.1, accuracy_m: 20, taken_at: iso(9, 59), stop_id: 'B', drive_minutes: 40, measured_at: iso(9, 59), ...over,
});

// ── 1. Location off: identical to today, to the minute ───────────────────────────────────────
test('location off: the ETA is identical whether live is absent, undefined or null', () => {
  for (const r of [onTheWay(), onTheWay(iso(10, 15)), route(), route([{ booking_request_id: 'A', state: 'in_service', started_at: iso(9, 30) }])]) {
    const base = eta(r, NOW);
    assert.deepEqual(eta(r, NOW, null), base);
    assert.deepEqual(eta(r, NOW, undefined), base);
    assert.equal('live_stop_id' in base, false);
  }
  const base = eta(onTheWay(), NOW);
  assert.equal(stopOf(base, 'B').eta_start_label, '10:15am');
  assert.equal(stopOf(base, 'C').eta_start_label, '11:30am');
  assert.equal(base.delay_minutes, 0);
});

// ── 2. A bad fix changes nothing ─────────────────────────────────────────────────────────────
test('stale, low-accuracy, implausible, wrong-stop and malformed fixes each change nothing (whole result identical)', () => {
  const base = eta(onTheWay(), NOW);
  const bad = {
    'stale position': { taken_at: iso(9, 50) },
    'stale measurement': { measured_at: iso(9, 50) },
    'low accuracy': { accuracy_m: 250 },
    'no accuracy': { accuracy_m: 0 },
    'implausibly far': { drive_minutes: 200 },
    'negative drive': { drive_minutes: -5 },
    'unknown drive (lookup failed)': { drive_minutes: NaN },
    'another stop': { stop_id: 'C' },
    'from the future': { taken_at: iso(10, 30), measured_at: iso(10, 30) },
    'no timestamp': { taken_at: '' },
    'measured on another day': { measured_at: '2026-10-07T23:00:00.000Z', taken_at: iso(9, 59) },
    'not a place': { lat: 0, lng: 0 },
    'out of range': { lat: 123 },
    'NaN position': { lng: NaN },
  };
  for (const [name, over] of Object.entries(bad)) {
    assert.deepEqual(eta(onTheWay(), NOW, goodLive(over)), base, name);
  }
});

test('"on the route" scales with the planned drive but never below the 60 minute floor', () => {
  const base = eta(onTheWay(), NOW);
  assert.equal(stopOf(eta(onTheWay(), NOW, goodLive({ drive_minutes: 60 })), 'B').eta_start_label, '10:59am');
  assert.deepEqual(eta(onTheWay(), NOW, goodLive({ drive_minutes: 61 })), base);
});

// ── 3. Further away than planned pushes the ETA out ──────────────────────────────────────────
test('a fix showing him further away than planned pushes the next ETA out, and the stops behind it', () => {
  const res = eta(onTheWay(), NOW, goodLive());           // measured 9:59 + 40 = 10:39
  assert.equal(stopOf(res, 'B').eta_start_label, '10:39am');
  assert.equal(stopOf(res, 'B').delay_minutes, 24);
  assert.equal(stopOf(res, 'B').window_label, '10:35am–10:50am');
  assert.equal(stopOf(res, 'C').eta_start_label, '11:54am'); // 10:39 + 60 + 15
  assert.equal(res.delay_minutes, 24, 'the day slip follows, so the existing late rules see it');
  assert.equal(res.live_stop_id, 'B');
  assert.deepEqual(res.stops.map((s) => s.booking_request_id), ['A', 'B', 'C'], 'order never changes');
});

// ── 4. Early changes nothing ─────────────────────────────────────────────────────────────────
test('a fix showing him early never pulls a time earlier than the booked time or the tap-based time', () => {
  const near = goodLive({ drive_minutes: 2 });
  assert.deepEqual(eta(onTheWay(), NOW, near), eta(onTheWay(), NOW));
  assert.equal(stopOf(eta(onTheWay(), NOW, near), 'B').eta_start_label, '10:15am');
  // Already running 30 late by taps: a fix that says "10:20" does not lift the 10:45 he was told.
  const late = onTheWay(iso(10, 15));
  assert.equal(stopOf(eta(late, NOW), 'B').eta_start_label, '10:45am');
  assert.deepEqual(eta(late, NOW, goodLive({ drive_minutes: 20, measured_at: iso(9, 59) })), eta(late, NOW));
});

test('a fix only applies to a stop that is on_the_way', () => {
  for (const state of ['planned', 'preparing', 'arrived', 'in_service']) {
    const r = route([{ booking_request_id: 'A', state: 'completed', completed_at: iso(9, 45) }, { booking_request_id: 'B', state, arrived_at: iso(10, 0) }]);
    assert.deepEqual(eta(r, NOW, goodLive()), eta(r, NOW), state);
  }
});

test('the first stop of the day, with nothing timed yet, can be pushed out and carries on', () => {
  const r = route([{ booking_request_id: 'A', state: 'on_the_way' }]);
  const res = eta(r, at(8, 40), goodLive({ stop_id: 'A', taken_at: iso(8, 39), measured_at: iso(8, 39), drive_minutes: 45 }));
  assert.equal(stopOf(res, 'A').eta_start_label, '9:24am');
  assert.equal(stopOf(res, 'B').eta_start_label, '10:39am'); // 9:24 + 60 + 15
  assert.deepEqual(eta(r, at(8, 40), goodLive({ stop_id: 'A', taken_at: iso(8, 39), measured_at: iso(8, 39), drive_minutes: 5 })), eta(r, at(8, 40)));
});

// ── 5. routeEta stays pure ───────────────────────────────────────────────────────────────────
test('routeEta.ts has no import, no read, no write, no network call and no clock of its own; it does not mutate its input', () => {
  const src = read('base44/shared/routeEta.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /^\s*import\s/m);
  assert.doesNotMatch(src, /\bfetch\s*\(|\basync\b|\bawait\b|\bentities\b|base44|XMLHttpRequest|WebSocket|secrets|process\.env/);
  assert.doesNotMatch(src, /Date\.now\s*\(|new Date\(\s*\)/);
  const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
  const input = deepFreeze({ date: DATE, route: onTheWay(), service_minutes: { ...SERVICE }, now: NOW, live: goodLive() });
  assert.doesNotThrow(() => computeRouteEta(input));
});

// ── 6. The loader hands the stored row over, read-only, and only when it is needed ───────────
function fakeDay({ live, exec } = {}) {
  const bookings = ['A', 'B', 'C'].map((id, i) => ({
    id, client_name: `Client ${id} Smith`, phone: '0412345678', status: 'confirmed', requested_date: DATE,
    assigned_time: ['9:00am', '10:15am', '11:30am'][i], schedule_status: 'confirmed', duration_mins: 45,
    address_lat: -33.9, address_lng: 151.1, team_member_id: 't1', is_test: false,
  }));
  const rt = { ...route(exec || onTheWay().stop_execution), fingerprint: routeFingerprint(bookings) };
  const outbox = []; let n = 0; const reads = { live: 0 };
  const match = (r, q) => Object.entries(q).every(([k, v]) => r[k] === v);
  return {
    outbox, reads,
    entities: {
      DayRoute: { filter: async (q) => [rt].filter(() => q.date === DATE) },
      BookingRequest: { filter: async () => bookings.map((b) => ({ ...b })), get: async (id) => bookings.find((b) => b.id === id), update: async () => {} },
      BarberLiveLocation: { filter: async () => { reads.live++; return live ? [{ ...live }] : []; }, delete: async () => {}, update: async () => {} },
      ReminderClient: { get: async () => null }, Message: { get: async () => null }, MessagingSettings: { list: async () => [] },
      MessageOutbox: {
        filter: async (q) => outbox.filter((r) => match(r, q)).map((r) => ({ ...r })),
        create: async (d) => { const r = { ...d, id: `o${++n}`, created_date: new Date(Date.UTC(2026, 9, 13, 23, 0, 0, n)).toISOString() }; outbox.push(r); return { ...r }; },
        delete: async (id) => { outbox.splice(outbox.findIndex((r) => r.id === id), 1); },
      },
    },
  };
}
const row = (over = {}) => ({
  team_member_id: 't1', service_date: DATE, sharing_on: true, lat: -33.9, lng: 151.1, accuracy_m: 20, taken_at: iso(9, 59),
  travel_stop_id: 'B', travel_drive_minutes: 40, travel_measured_at: iso(9, 59), ...over,
});

test('loadDayEta: sharing off, no row, or a failed lookup gives the tap-based ETA; a good row pushes it out', async () => {
  const off = await loadDayEta(fakeDay(), DATE, NOW);
  assert.equal(stopOf(off.results[0], 'B').eta_start_label, '10:15am');
  for (const live of [row({ sharing_on: false }), row({ travel_drive_minutes: null }), row({ lat: null }), row({ taken_at: iso(9, 40) })]) {
    const day = await loadDayEta(fakeDay({ live }), DATE, NOW);
    assert.deepEqual(day.results[0].stops, off.results[0].stops);
  }
  const on = await loadDayEta(fakeDay({ live: row() }), DATE, NOW);
  assert.equal(stopOf(on.results[0], 'B').eta_start_label, '10:39am');
});

test('loadDayEta makes no live read at all unless a stop is on the way', async () => {
  const admin = fakeDay({ live: row(), exec: [{ booking_request_id: 'A', state: 'in_service', started_at: iso(9, 30) }] });
  await loadDayEta(admin, DATE, NOW);
  assert.equal(admin.reads.live, 0);
});

test('a live-timed delay past the threshold fires the existing running-late message once; with it off, nothing', async () => {
  const quiet = fakeDay();
  assert.equal((await runRunningLate(quiet, { now: NOW })).queued, 0);
  const admin = fakeDay({ live: row() }); // B 24 late, C 24 late: past the 20-minute bucket
  const first = await runRunningLate(admin, { now: NOW });
  assert.equal(first.queued, 2);
  assert.deepEqual(admin.outbox.map((r) => r.template_key), ['running_late', 'running_late']);
  assert.equal((await runRunningLate(admin, { now: at(10, 1) })).queued, 0, 'repeat sweeps do not send again');
});

// ── 7. The barber's function: one row, the throttle, the gates ───────────────────────────────
const today = L.sydneyToday();
function setup({ state = 'on_the_way', member = true, sharing = true, user = { id: 'u1', email: 'a@x.test', role: 'user' } } = {}) {
  const db = makeLooseDb({
    TeamMember: member ? [{ id: 't1', name: 'Alvaro', user_id: 'u1', role: 'barber', status: 'Active' }] : [],
    DayRoute: [{
      id: 'r1', date: today, team_member_id: 't1', route_status: 'finalised', is_test: false,
      stops: [{ booking_request_id: 'B1', order: 1 }, { booking_request_id: 'B2', order: 2 }],
      stop_execution: [{ booking_request_id: 'B1', state }],
    }],
    BookingRequest: [
      { id: 'B1', team_member_id: 't1', address_lat: -33.85, address_lng: 151.2 },
      { id: 'B2', team_member_id: 't1', address_lat: -33.9, address_lng: 151.1 },
    ],
    BarberLiveLocation: sharing ? [{ id: 'L1', team_member_id: 't1', service_date: today, sharing_on: true }] : [],
  });
  globalThis.__b44Client = () => ({ auth: { me: async () => user }, entities: db.entities, asServiceRole: db.asServiceRole });
  return db;
}
const fixNow = (over = {}) => ({ action: 'update', lat: -33.86, lng: 151.21, accuracy_m: 15, taken_at: new Date().toISOString(), ...over });
let fetchCalls = 0;
const realFetch = globalThis.fetch;
test.beforeEach(() => {
  fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({ durations: [[0, 1500], [1500, 0]], distances: [[0, 9000], [9000, 0]] }) }; };
});
test.after(() => { globalThis.fetch = realFetch; });

const handler = await loadEntry('liveLocation');
const call = async (body, headers = { authorization: 'Bearer test' }) => {
  const res = await handler(new Request('https://app.test/functions/liveLocation', { method: 'POST', headers, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
};
const rows = (db) => db.tables.BarberLiveLocation || [];

test('update while on the way stores ONE position and makes ONE lookup; the minutes come from the road time', async () => {
  const db = setup();
  const r = await call(fixNow());
  assert.equal(r.json.stored, true);
  assert.equal(r.json.lookup, 'ok');
  assert.equal(fetchCalls, 1);
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0].travel_drive_minutes, 25);
  assert.equal(rows(db)[0].travel_stop_id, 'B1');
  assert.equal(rows(db)[0].accuracy_m, 15);
  assert.equal(db.tables.LiveLookupCount[0].lookups, 1);
});

test('throttle: repeated reads inside one interval cause exactly one lookup, and the row is never appended to', async () => {
  const db = setup();
  const first = await call(fixNow());
  assert.equal(first.json.stored, true);
  for (let i = 0; i < 6; i++) {
    const again = await call(fixNow({ lat: -33.87 - i / 1000 }));
    assert.equal(again.json.stored, false);
    assert.equal(again.json.reason, 'throttled');
    assert.equal(again.json.lookups_made, 0);
  }
  assert.equal(fetchCalls, 1);
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0].lat, -33.86, 'the stored fix is the one the lookup was made from');
  assert.equal(db.tables.LiveLookupCount[0].lookups, 1);
  // An interval later, one more.
  rows(db)[0].travel_checked_at = new Date(Date.now() - (L.LOOKUP_INTERVAL_SECONDS + 1) * 1000).toISOString();
  assert.equal((await call(fixNow())).json.stored, true);
  assert.equal(fetchCalls, 2);
  assert.equal(db.tables.LiveLookupCount[0].lookups, 2);
  assert.equal(rows(db).length, 1);
});

test('nothing is captured, and nothing is paid for, when the switch is off', async () => {
  const db = setup({ sharing: false });
  const r = await call(fixNow());
  assert.deepEqual([r.json.stored, r.json.reason], [false, 'switch_off']);
  assert.equal(fetchCalls, 0);
  assert.equal(rows(db).length, 0);
});

test('nothing is captured while a stop is planned, arrived, in_service or completed', async () => {
  for (const state of ['planned', 'preparing', 'arrived', 'in_service', 'completed', 'skipped']) {
    const db = setup({ state });
    const r = await call(fixNow());
    assert.deepEqual([r.json.stored, r.json.reason], [false, 'not_in_transit'], state);
    assert.equal(fetchCalls, 0, state);
    assert.equal(rows(db)[0].lat ?? null, null, state);
  }
});

test('stale, low-accuracy, positionless and implausibly distant fixes are not stored and cost no lookup', async () => {
  const db = setup();
  const bad = [
    [fixNow({ taken_at: new Date(Date.now() - 10 * 60000).toISOString() }), 'stale'],
    [fixNow({ accuracy_m: 400 }), 'low_accuracy'],
    [fixNow({ accuracy_m: undefined }), 'no_accuracy'],
    [fixNow({ taken_at: undefined }), 'no_timestamp'],
    [fixNow({ lat: undefined }), 'no_position'],
    [fixNow({ lat: -37.8, lng: 144.9 }), 'implausible'], // Melbourne, 700 km from the stop
  ];
  for (const [body, reason] of bad) {
    const r = await call(body);
    assert.deepEqual([r.json.stored, r.json.reason], [false, reason]);
  }
  assert.equal(fetchCalls, 0);
  assert.equal(rows(db)[0].lat ?? null, null);
});

test('a failed travel-time lookup stores the position but no drive time, so the ETA falls back; it is counted and throttled', async () => {
  const db = setup();
  globalThis.fetch = async () => { fetchCalls++; return { ok: false, status: 500, text: async () => 'boom' }; };
  const r = await call(fixNow());
  assert.deepEqual([r.json.stored, r.json.lookup], [true, 'failed']);
  assert.equal(rows(db)[0].travel_drive_minutes, null);
  assert.equal(db.tables.LiveLookupCount[0].failures, 1);
  assert.equal((await call(fixNow())).json.reason, 'throttled');
  assert.equal(fetchCalls, 1);
  // ...and the loader treats that row as no fix at all.
  const live = { ...rows(db)[0], travel_measured_at: null };
  const day = await loadDayEta(fakeDay({ live: { ...row(), travel_drive_minutes: live.travel_drive_minutes } }), DATE, NOW);
  assert.equal(stopOf(day.results[0], 'B').eta_start_label, '10:15am');
});

test('switching off deletes the row, and with it the position', async () => {
  const db = setup();
  await call(fixNow());
  assert.equal(rows(db).length, 1);
  const r = await call({ action: 'off' });
  assert.equal(r.json.sharing, false);
  assert.equal(rows(db).length, 0);
  assert.equal((await call({ action: 'status' })).json.sharing, false);
});

test('switching on makes ONE row for the barber, only for today, only with stops left, and never by automation or for another barber', async () => {
  const db = setup({ sharing: false });
  assert.equal((await call({ action: 'on', team_member_id: 'someone-else' })).json.sharing, true);
  assert.equal((await call({ action: 'on' })).json.sharing, true);
  assert.equal(rows(db).length, 1);
  assert.equal(rows(db)[0].team_member_id, 't1');
  assert.equal(rows(db)[0].service_date, today);

  const auto = setup({ sharing: false });
  const viaWorkflow = await call({ action: 'on' }, { authorization: 'Bearer test', 'x-workflow-run': 'run-1' });
  assert.equal(viaWorkflow.status, 403);
  assert.equal(rows(auto).length, 0);

  setup({ sharing: false, member: false });
  assert.equal((await call({ action: 'on' })).status, 403);

  const done = setup({ sharing: false });
  done.tables.DayRoute[0].stop_execution = [{ booking_request_id: 'B1', state: 'completed' }, { booking_request_id: 'B2', state: 'skipped' }];
  const r = await call({ action: 'on' });
  assert.equal(r.status, 409);
  assert.equal(rows(done).length, 0);

  assert.equal((await call({ action: 'status' }, {})).status, 401, 'no credential, no answer');
});

test("yesterday's switch is not today's: it is deleted and reads as off", async () => {
  const db = setup();
  rows(db)[0].service_date = '2020-01-01';
  assert.equal((await call({ action: 'status' })).json.sharing, false);
  assert.equal(rows(db).length, 0);
});

// ── 8. Clearing: arrival, the end of the day, expiry ─────────────────────────────────────────
function cleanupDb(over = {}) {
  return makeLooseDb({ BarberLiveLocation: [{ id: 'L1', team_member_id: 't1', service_date: today, sharing_on: true, lat: -33.9, lng: 151.1, accuracy_m: 10, taken_at: new Date().toISOString(), travel_stop_id: 'B1', travel_drive_minutes: 12, ...over }] });
}
const stops = [{ booking_request_id: 'B1' }, { booking_request_id: 'B2' }];
const step = (db, action, execution) => L.afterStepCleanup(db.asServiceRole, { memberId: 't1', action, stops, execution, who: 'Alvaro' });

test('arriving forgets the position but keeps the switch; completing a middle stop keeps the switch', async () => {
  const db = cleanupDb();
  await step(db, 'arrive', [{ booking_request_id: 'B1', state: 'arrived' }]);
  const r = db.tables.BarberLiveLocation[0];
  assert.equal(r.lat, null); assert.equal(r.travel_drive_minutes, null); assert.equal(r.sharing_on, true);
  await step(db, 'complete', [{ booking_request_id: 'B1', state: 'completed' }]);
  assert.equal(db.tables.BarberLiveLocation.length, 1);
});

test('completing or skipping the LAST stop deletes the row (switch off, fix gone) and logs only that it went off', async () => {
  for (const action of ['complete', 'skip']) {
    const db = cleanupDb();
    await step(db, action, [{ booking_request_id: 'B1', state: 'completed' }, { booking_request_id: 'B2', state: action === 'skip' ? 'skipped' : 'completed' }]);
    assert.equal(db.tables.BarberLiveLocation.length, 0, action);
    const log = db.tables.ActivityLog;
    assert.equal(log.length, 1);
    assert.equal(log[0].action, 'live_location_off');
    assert.doesNotMatch(JSON.stringify(log), /-33\.9|151\.1/);
  }
});

test('advanceRouteStop calls the cleanup after saving a step, and never lets it undo the step', () => {
  // The step write and its cleanup live in the one shared module that advanceRouteStop and routeCheckout both use.
  assert.match(read('base44/functions/advanceRouteStop/entry.ts'), /writeStopStep\(/);
  assert.match(read('base44/functions/routeCheckout/entry.ts'), /writeStopStep\(/);
  const src = read('base44/shared/routeStopStep.ts');
  assert.ok(src.indexOf('DayRoute.update(record.id, patch)') < src.indexOf('afterStepCleanup('));
  assert.match(read('base44/shared/liveLocation.ts'), /export async function afterStepCleanup[\s\S]*try \{[\s\S]*catch/);
});

test('the sweep clears an expired position and deletes yesterday\'s switch; a fresh one is untouched', async () => {
  const old = new Date(Date.now() - 10 * 60000).toISOString();
  const db = cleanupDb({ taken_at: old });
  assert.deepEqual(await L.purgeExpired(db.asServiceRole), { deleted: 0, cleared: 1 });
  assert.equal(db.tables.BarberLiveLocation[0].lat, null);
  const fresh = cleanupDb();
  assert.deepEqual(await L.purgeExpired(fresh.asServiceRole), { deleted: 0, cleared: 0 });
  const yesterday = cleanupDb({ service_date: '2020-01-01' });
  assert.deepEqual(await L.purgeExpired(yesterday.asServiceRole), { deleted: 1, cleared: 0 });
  assert.equal(yesterday.tables.BarberLiveLocation.length, 0);
  const noTime = cleanupDb({ taken_at: null });
  assert.equal((await L.purgeExpired(noTime.asServiceRole)).cleared, 1, 'a fix with no timestamp is not kept');
});

// ── 9. Guards ────────────────────────────────────────────────────────────────────────────────
function entitySchemas() {
  return readdirSync(new URL('base44/entities/', root)).filter((f) => f.endsWith('.jsonc')).map((f) => {
    const t = read(`base44/entities/${f}`);
    let j; try { j = JSON.parse(t); } catch { j = JSON.parse(t.replace(/^\s*\/\/.*$/gm, '')); }
    return j;
  });
}

test('no entity stores a position history: positions live on one row, with no list, log or trail', () => {
  const COORD = /(^|_)(lat|lng|latitude|longitude|position|coords?|coordinates|gps)(_|$)/i;
  // Entities that hold an ADDRESS or a fixed place (not a movement): the only other coordinate fields in the app.
  const ADDRESS_ENTITIES = new Set(['BookingRequest', 'GroupDiscountSettings', 'ServiceArea', 'TeamMember']);
  const found = new Map();
  const walk = (name, props, path, inArray) => {
    for (const [k, v] of Object.entries(props || {})) {
      if (COORD.test(k)) found.set(name, [...(found.get(name) || []), { path: path + k, inArray }]);
      if (v?.properties) walk(name, v.properties, `${path}${k}.`, inArray);
      if (v?.items?.properties) walk(name, v.items.properties, `${path}${k}[].`, true);
    }
  };
  const schemas = entitySchemas();
  for (const s of schemas) walk(s.name, s.properties, '', false);
  for (const [name, hits] of found) {
    assert.ok(name === 'BarberLiveLocation' || ADDRESS_ENTITIES.has(name), `${name} has a coordinate field that is not a known address field`);
    assert.ok(hits.every((h) => !h.inArray), `${name} stores coordinates inside a list`);
  }
  const live = schemas.find((s) => s.name === 'BarberLiveLocation');
  assert.ok(live, 'the live location entity exists');
  assert.ok(Object.values(live.properties).every((p) => p.type !== 'array' && p.type !== 'object'), 'no list or object on the live row');
  assert.ok(Object.keys(live.properties).every((k) => !/history|trail|log|path|track|points|breadcrumb/i.test(k)));
  assert.ok(schemas.every((s) => !/(location|position|gps|track).*(history|log|trail|point|breadcrumb)|(history|log|trail).*(location|position|gps)/i.test(s.name)), 'no trail-like entity name');
  assert.ok(Object.keys(schemas.find((s) => s.name === 'LiveLookupCount').properties).every((k) => !COORD.test(k)), 'the counter holds no position');
  for (const s of schemas.filter((x) => ['BarberLiveLocation', 'LiveLookupCount'].includes(x.name))) {
    for (const op of ['read', 'create', 'update', 'delete']) assert.equal(s.rls[op].user_condition.role, 'service_role_only', `${s.name} ${op}`);
  }
});

test('the code only ever overwrites the one row: no append, no bulk write, no position in any audit or message', () => {
  const fn = read('base44/functions/liveLocation/entry.ts');
  const shared = read('base44/shared/liveLocation.ts');
  for (const src of [fn, shared]) assert.doesNotMatch(src, /bulkCreate|\.push\(\s*\{[^}]*lat/);
  assert.equal((fn.match(/BarberLiveLocation\.create\(/g) || []).length, 1);
  assert.ok(fn.indexOf('if (row) return Response.json({ sharing: true })') < fn.indexOf('BarberLiveLocation.create('), 'create only when the barber has no row');
  // Position never reaches the audit log, the tracking view or a customer message.
  assert.doesNotMatch(fn, /ActivityLog/);
  const auditBody = shared.slice(shared.indexOf('async function note('), shared.indexOf('/** Forget the position'));
  assert.doesNotMatch(auditBody, /\blat\b|\blng\b|accuracy|taken_at|row\./);
  assert.doesNotMatch(read('base44/shared/bookingTracking.ts'), /BarberLiveLocation|\blat\b|\blng\b/);
  assert.doesNotMatch(read('base44/shared/runningLate.ts'), /BarberLiveLocation|travel_drive/);
});

test('nothing but the barber\'s own call switches sharing on: no workflow, function or schedule does', () => {
  const dirs = readdirSync(new URL('base44/functions/', root), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const n of dirs.filter((d) => d !== 'liveLocation')) {
    let src = ''; try { src = read(`base44/functions/${n}/entry.ts`); } catch { continue; }
    assert.doesNotMatch(src, /sharing_on:\s*true|BarberLiveLocation\.create/, n);
  }
  for (const f of readdirSync(new URL('base44/workflows/', root))) assert.doesNotMatch(read(`base44/workflows/${f}`), /liveLocation/, f);
  assert.match(read('base44/functions/liveLocation/entry.ts'), /actor\.automation\) return Response\.json\(\{ error: 'Live location is switched by the barber only\.'/);
  assert.match(read('base44/functions/liveLocation/entry.ts'), /actor\.member_id/);
  assert.doesNotMatch(read('base44/functions/liveLocation/entry.ts'), /body\??\.team_member_id|body\??\.member/);
});

test('the paid travel-time call is behind the staff gate, and the admin-only mapboxDriveMatrix endpoint is unchanged', () => {
  assert.match(read('base44/functions/liveLocation/entry.ts'), /resolveSchedulingActor/);
  assert.match(read('base44/functions/mapboxDriveMatrix/entry.ts'), /requireAdminActor/);
  assert.doesNotMatch(read('base44/functions/mapboxDriveMatrix/entry.ts'), /BarberLiveLocation|liveLocation/);
});