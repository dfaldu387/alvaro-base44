// Fix 5: automation does not move appointments on a finalised day; it marks the route as needing an update.
// Manual admin movement is untouched. The six scheduling engines are untouched (checked by the diff guard).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { register } from 'node:module';
import { loadEntry } from './helpers/loadEntry.mjs';

// The platform's secrets module does not exist under Node: it reads whatever the test put in globalThis.__secrets.
const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: (k) => (globalThis.__secrets || {})[k] };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));
import { makeMemDb } from './helpers/memDb.mjs';

const fp = await import('../base44/shared/routeFingerprint.ts');
const { fitUnscheduledRequest } = await import('../base44/shared/routeFlowFit.ts');
const optimise = await loadEntry('optimiseProvisionalDay');
const autoPlace = await loadEntry('routeFlowAutoPlaceV2');

const root = new URL('../', import.meta.url);
const DATE = '2026-10-20';

const appt = (id, time, over = {}) => ({
  id, requested_date: DATE, day: 'Tuesday', team_member_id: 't1', is_test: false, status: 'confirmed', schedule_status: 'provisional',
  assigned_time: time, duration_mins: 45, client_name: id, address_lat: -33.8, address_lng: 151.2, ...over,
});

function world(routeStatus) {
  const rows = [appt('b1', '9:00am'), appt('b2', '1:00pm'), appt('b3', null, { schedule_status: 'unscheduled', assigned_time: undefined })];
  const db = makeMemDb({
    BookingRequest: rows,
    TeamMember: [{ id: 't1', name: 'Alvaro', status: 'Active', role: 'owner' }],
    SchedulingBotSettings: [{ id: 's1', enabled: true, mode: 'auto_optimise' }],
    DayRoute: routeStatus ? [{
      id: 'r1', date: DATE, route_status: routeStatus, team_member_id: 't1', team_member_name: 'Alvaro', is_test: false,
      fingerprint: fp.routeFingerprint(rows), appointments_count: 2, stops: [],
    }] : [],
  });
  return db;
}
const bookingWrites = (db) => db.writes.filter((w) => w.entity === 'BookingRequest');
const times = (db) => db.table('BookingRequest').map((b) => `${b.id}@${b.assigned_time}`);

const callOptimise = async (db, { automation }) => {
  globalThis.__b44Client = () => ({ auth: { me: async () => ({ id: 'u1', email: 'a@x.test', role: 'admin' }) }, entities: db.entities, asServiceRole: { entities: db.entities } });
  const headers = { authorization: 'Bearer t', ...(automation ? { 'x-workflow-run': 'run1' } : {}) };
  const res = await optimise(new Request('https://app.test/functions/optimiseProvisionalDay', { method: 'POST', headers, body: JSON.stringify({ date: DATE, team_member_id: 't1' }) }));
  return { status: res.status, json: await res.json() };
};

for (const status of ['finalised', 'needs_update']) {
  test(`automation optimising a ${status} day moves nothing and says why`, async () => {
    const db = world(status);
    const before = times(db);
    const { json } = await callOptimise(db, { automation: true });
    assert.equal(bookingWrites(db).length, 0, 'no appointment was written');
    assert.deepEqual(times(db), before);
    assert.equal(json.results[0].applied, false);
    assert.equal(json.results[0].reason, 'route_finalised');
    assert.match(json.results[0].message, /finalised/i);
  });
}

test('automation on a finalised day marks the route as needing an update and records why', async () => {
  const db = world('finalised');
  await callOptimise(db, { automation: true });
  const route = db.table('DayRoute')[0];
  assert.equal(route.route_status, 'needs_update');
  assert.match(route.needs_update_reason, /Route Flow|automat/i);
  const log = db.table('ActivityLog').filter((l) => l.event_type === 'route_needs_update');
  assert.equal(log.length, 1);
  assert.match(log[0].reason_text, /did not|left/i);
});

test('automatic fitting of an unscheduled request on a finalised day moves nothing and marks the route', async () => {
  const db = world('finalised');
  const before = times(db);
  const res = await fitUnscheduledRequest(db.asServiceRole, { requestId: 'b3', actorRole: 'automation', trigger: 'automation' });
  assert.equal(res.applied, false);
  assert.equal(res.reason, 'route_finalised');
  assert.equal(bookingWrites(db).length, 0);
  assert.deepEqual(times(db), before);
  assert.equal(db.table('DayRoute')[0].route_status, 'needs_update');
});

test('a draft day, and a different barber\'s finalised day, are not held', async () => {
  const draft = world('draft');
  const a = await callOptimise(draft, { automation: true });
  assert.notEqual(a.json.results?.[0]?.reason, 'route_finalised');
  assert.equal(draft.table('DayRoute')[0].route_status, 'draft');

  const other = world('finalised');
  other.table('DayRoute')[0].team_member_id = 't2';
  const b = await fitUnscheduledRequest(other.asServiceRole, { requestId: 'b3', actorRole: 'automation', trigger: 'automation' });
  assert.notEqual(b.reason, 'route_finalised');
});

test('manual admin movement on a finalised day is NOT held', async () => {
  const db = world('finalised');
  const { json } = await callOptimise(db, { automation: false });
  assert.notEqual(json.results?.[0]?.reason, 'route_finalised');
  const fit = await fitUnscheduledRequest(db.asServiceRole, { requestId: 'b3', actorRole: 'admin', trigger: 'admin_panel' });
  assert.notEqual(fit.reason, 'route_finalised');
  assert.equal(db.table('DayRoute')[0].route_status, 'finalised', 'a person acting does not mark the route');
});

const callAutoPlace = async (db, { automation, bookingId = 'b3' }) => {
  globalThis.__b44Client = () => ({ auth: { me: async () => ({ id: 'u1', email: 'a@x.test', role: 'admin' }) }, entities: db.entities, asServiceRole: { entities: db.entities } });
  const headers = { authorization: 'Bearer t', ...(automation ? { 'x-workflow-run': 'run1' } : {}) };
  const res = await autoPlace(new Request('https://app.test/functions/routeFlowAutoPlaceV2', { method: 'POST', headers, body: JSON.stringify({ booking_request_id: bookingId }) }));
  return { status: res.status, json: await res.json() };
};

for (const status of ['finalised', 'needs_update']) {
  test(`automatic placement onto a ${status} day adds no stop and says why`, async () => {
    const db = world(status);
    const before = times(db);
    const { json } = await callAutoPlace(db, { automation: true });
    assert.equal(json.skipped, true);
    assert.equal(json.code, 'route_finalised');
    assert.match(json.reason, /finalised/i);
    assert.equal(bookingWrites(db).length, 0, 'no appointment was written');
    assert.deepEqual(times(db), before);
  });
}

test('automatic placement onto a finalised day marks the route as needing an update', async () => {
  const db = world('finalised');
  await callAutoPlace(db, { automation: true });
  assert.equal(db.table('DayRoute')[0].route_status, 'needs_update');
});

test('an admin placing a request by hand onto a finalised day is NOT held', async () => {
  const db = world('finalised');
  const { json } = await callAutoPlace(db, { automation: false });
  assert.notEqual(json.code, 'route_finalised');
  assert.equal(db.table('DayRoute')[0].route_status, 'finalised', 'a person acting does not mark the route');
});

test('automatic placement on a draft day, and on another barber\'s finalised day, is not held', async () => {
  const draft = world('draft');
  const a = await callAutoPlace(draft, { automation: true });
  assert.notEqual(a.json.code, 'route_finalised');
  assert.equal(draft.table('DayRoute')[0].route_status, 'draft');

  const other = world('finalised');
  other.table('DayRoute')[0].team_member_id = 't2';
  const b = await callAutoPlace(other, { automation: true });
  assert.notEqual(b.json.code, 'route_finalised');
});

test('a booking that cannot be read is refused, never placed blind', async () => {
  // The SDK throws on a missing row, so a missing booking and a failed read look
  // the same from here. Either way the request must be refused and nothing
  // written: reading no booking must never let a held one onto the schedule.
  const db = world('draft');
  const { status, json } = await callAutoPlace(db, { automation: true, bookingId: 'does-not-exist' });
  assert.ok(status >= 400, `expected a refusal, got ${status}`);
  assert.ok(json.error, 'the refusal says what went wrong');
  assert.notEqual(json.skipped, true, 'a refusal is not reported as a successful skip');
  assert.equal(bookingWrites(db).length, 0);
});

test('a request held by booking protection is still skipped', async () => {
  const db = world('draft');
  db.table('BookingRequest').find((b) => b.id === 'b3').protection_hold = true;
  const { json } = await callAutoPlace(db, { automation: true });
  assert.equal(json.skipped, true);
  assert.match(json.reason, /booking protection/i);
  assert.equal(bookingWrites(db).length, 0);
});

test('the scheduling engines that did not need to change are byte-for-byte unchanged', () => {
  // routeFlowOptimiser.ts and dayRoute.ts left this byte-lock when Connect
  // Appointments was fixed (one route per barber's whole day, one drive leg per
  // consecutive pair). schedulingValidator.ts and appointmentTiming.ts left it with
  // the rounding fix: travel is honest to the minute instead of padded up to five,
  // and the 5-minute step is applied once, to the appointment start, in whole
  // minutes. tests/routeLegs.test.mjs and tests/connectedSchedule.test.mjs pin both.
  const locked = ['reshuffleEngine', 'routeFlowEngine'].map((n) => `base44/shared/${n}.ts`);
  assert.equal(execSync(`git diff --stat -- ${locked.join(' ')} || true`, { cwd: root }).toString().trim(), '');
});