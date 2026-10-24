// Fix 4: applying a reviewed reshuffle is all or nothing. One refused move writes nothing at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { loadEntry } from './helpers/loadEntry.mjs';

// The platform's secrets module does not exist under Node: it reads whatever the test put in globalThis.__secrets.
const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: (k) => (globalThis.__secrets || {})[k] };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));
import { makeMemDb } from './helpers/memDb.mjs';

const handler = await loadEntry('routeFlowApplyReshuffleV2');
const root = new URL('../', import.meta.url);
// A date comfortably past the 24h minimum-notice rule, whatever day the suite runs on.
const FUTURE = new Date(Date.now() + 10 * 86400000);
const DATE = FUTURE.toISOString().slice(0, 10);
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][FUTURE.getUTCDay()];

const hours = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => ({ day_of_week: d, is_open: true, open_time: 7, close_time: 21 }));
const appt = (id, time, over = {}) => ({
  id, requested_date: DATE, day: DAY_NAME, team_member_id: 't1', is_test: false, status: 'confirmed', schedule_status: 'provisional',
  assigned_time: time, duration_mins: 30, client_name: id, availability_window: '8am-8pm', address_lat: -33.8, address_lng: 151.2, ...over,
});
const change = (id, from, to) => ({ booking_request_id: id, moving: true, from_label: from, to_label: to });

function world({ lockSecond = false, suggestion = {} } = {}) {
  return makeMemDb({
    BookingRequest: [appt('b1', '9:00am'), appt('b2', '1:00pm', lockSecond ? { schedule_status: 'locked' } : {})],
    TeamMember: [{ id: 't1', name: 'Alvaro', status: 'Active', role: 'owner', working_hours: hours }],
    RouteFlowSuggestion: [{
      id: 'sg1', status: 'pending', suggestion_date: DATE, team_member_id: 't1', team_member_name: 'Alvaro',
      changes: [change('b1', '9:00am', '10:00am'), change('b2', '1:00pm', '2:00pm')], ...suggestion,
    }],
  });
}
const apply = async (db) => {
  globalThis.__b44Client = () => ({ auth: { me: async () => ({ id: 'u1', email: 'a@x.test', role: 'admin' }) }, entities: db.entities, asServiceRole: { entities: db.entities } });
  const res = await handler(new Request('https://app.test/functions/routeFlowApplyReshuffleV2', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ suggestion_id: 'sg1' }) }));
  return { status: res.status, json: await res.json() };
};
const times = (db) => db.table('BookingRequest').map((b) => b.assigned_time);
const moved = (db) => db.writes.filter((w) => w.entity === 'BookingRequest');

test('control: with every move valid, the whole reshuffle is written', async () => {
  const db = world();
  const { json } = await apply(db);
  assert.equal(json.applied, true, JSON.stringify(json));
  assert.deepEqual(times(db), ['10:00am', '2:00pm']);
});

test('a refused move (a booking locked since the suggestion was made) writes nothing at all, with a readable reason', async () => {
  const db = world({ lockSecond: true });
  const { status, json } = await apply(db);
  assert.equal(moved(db).length, 0, 'not even the valid move was written');
  assert.deepEqual(times(db), ['9:00am', '1:00pm']);
  assert.notEqual(json.applied, true);
  assert.equal(db.table('RouteFlowSuggestion')[0].status, 'pending', 'the suggestion is not marked applied');
  assert.match(json.message || json.error || '', /nothing was moved/i);
  assert.ok(status >= 200);
});

test('a move the validator refuses on live data writes nothing at all', async () => {
  const db = world({ suggestion: { changes: [change('b1', '9:00am', '10:00am'), change('b2', '1:00pm', '11:30pm')] } }); // after closing
  const { json } = await apply(db);
  assert.equal(moved(db).length, 0);
  assert.deepEqual(times(db), ['9:00am', '1:00pm']);
  assert.notEqual(json.applied, true);
  assert.ok(Array.isArray(json.invalid_reasons) && json.invalid_reasons.length > 0, 'the reason is returned');
});

test('a day that changed while the moves were being checked writes nothing', async () => {
  const db = world();
  // The day is edited by someone else part-way through: after the first validation read.
  let reads = 0;
  const realFilter = db.entities.BookingRequest.filter;
  const wrapped = new Proxy(db.entities, { get: (t, name) => {
    const e = t[name];
    if (name !== 'BookingRequest') return e;
    return { ...e, filter: async (...a) => { const r = await realFilter(...a); if (++reads === 2) db.table('BookingRequest')[1].updated_date = 'changed-by-someone-else'; return r; } };
  } });
  const sloppy = { ...db, entities: wrapped, asServiceRole: { entities: wrapped } };
  globalThis.__b44Client = () => ({ auth: { me: async () => ({ id: 'u1', email: 'a@x.test', role: 'admin' }) }, entities: wrapped, asServiceRole: sloppy.asServiceRole });
  const res = await handler(new Request('https://app.test/x', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ suggestion_id: 'sg1' }) }));
  const json = await res.json();
  assert.equal(moved(db).length, 0);
  assert.notEqual(json.applied, true);
  assert.match(json.message || '', /changed/i);
});

test('source guard: it reuses the day-version check and writes all moves in one call', () => {
  const src = readFileSync(new URL('base44/functions/routeFlowApplyReshuffleV2/entry.ts', root), 'utf8');
  assert.match(src, /readDayVersion\(/);
  assert.equal((src.match(/BookingRequest\.update\(/g) || []).length, 0, 'no per-move update');
  assert.equal((src.match(/BookingRequest\.bulkUpdate\(/g) || []).length, 1);
});