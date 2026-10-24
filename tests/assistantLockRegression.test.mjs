// REGRESSION: Route Flow auto-place and reshuffle must never move a booking the assistant created.
//
// The assistant creates a booking already placed and `locked` (shared/publicBookingCreate). Nothing in
// the assistant code stops Route Flow from touching it. The protection is two OTHER pre-existing rules:
//   1. routeFlowEngine.processBookingRequest skips any booking that already has a time and a
//      schedule_status other than 'unscheduled' ("already_placed").
//   2. provisionalPlacement.isAutomationAllowed only allows 'provisional', so reshuffle treats
//      'locked' as an anchor.
// If either rule is changed, an assistant booking (a time a customer was TOLD) could silently move.
// This test fails if so. Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { makeLooseDb } from './helpers/loadEntry.mjs';

// The engines import 'base44:runtime' (platform secrets). Under Node it is replaced by an empty
// fake token, and fetch answers the Mapbox matrix with a flat 10-minute drive between any two stops,
// so nothing touches the network.
const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: () => "test-token" };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));
globalThis.fetch = async (url) => {
  const count = String(url).split('/driving/')[1].split('?')[0].split(';').length;
  const grid = (v) => Array.from({ length: count }, (_, i) => Array.from({ length: count }, (_, j) => (i === j ? 0 : v)));
  return { ok: true, json: async () => ({ durations: grid(600), distances: grid(5000) }), text: async () => '' };
};
const { processBookingRequest } = await import('../base44/shared/routeFlowEngine.ts');
const { optimiseDay, loadDay } = await import('../base44/shared/routeFlowOptimiser.ts');
const { isAutomationAllowed } = await import('../base44/shared/provisionalPlacement.ts');

const DATE = '2026-10-16'; // Friday
const PROMISED = '11:00am';

// Exactly the fields the shared creator writes for an assistant booking.
const assistantBooking = (over = {}) => ({
  id: 'assist1', client_name: 'Sam Rivera', day: 'Friday', requested_date: DATE, status: 'pending',
  booking_source: 'Assistant Booking', schedule_status: 'locked', placement_status: 'placed',
  assigned_time: PROMISED, assistant_promised_time: PROMISED, assistant_conversation_id: 'conv1',
  availability_window: '9:00am-5:00pm', duration_mins: 45, is_test: false, team_member_id: 't1',
  address_lat: -33.95, address_lng: 151.12, services: ['Skin Fade'], ...over,
});
const provisional = (over = {}) => ({
  id: 'prov1', client_name: 'Jo Provisional', day: 'Friday', requested_date: DATE, status: 'confirmed',
  schedule_status: 'provisional', placement_status: 'placed', assigned_time: '3:00pm',
  availability_window: '9:00am-5:00pm', duration_mins: 45, is_test: false, team_member_id: 't1',
  address_lat: -33.9, address_lng: 151.2, services: ['Skin Fade'], ...over,
});
const seed = (rows) => ({
  BookingRequest: rows,
  SchedulingBotSettings: [{ id: 'sb', enabled: true, mode: 'auto_optimise', auto_place_new_requests: true }],
  TeamMember: [{ id: 't1', name: 'Alvaro', status: 'Active', start_location_lat: -33.9, start_location_lng: 151.1,
    working_hours: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(d => ({ day_of_week: d, is_open: true, open_time: 8, close_time: 18 })) }],
  Service: [{ id: 's1', name: 'Skin Fade', price: 45, duration_mins: 45, is_active: true }],
});
const bookingWrites = (db, id) => db.writes.filter(w => w.entity === 'BookingRequest' && w.op !== 'create' && w.id === id);

test('ASSISTANT LOCK DEPENDS ON TWO ROUTE FLOW RULES: auto-place leaves a locked assistant booking alone (already_placed)', async () => {
  const db = makeLooseDb(seed([assistantBooking()]));
  const out = await processBookingRequest(db, { bookingId: 'assist1', actorName: 'Route Flow', actorRole: 'automation' });
  assert.equal(out.body.skipped, true);
  assert.equal(out.body.reason, 'already_placed');
  assert.equal(db.tables.BookingRequest.find(b => b.id === 'assist1').assigned_time, PROMISED);
  assert.equal(bookingWrites(db, 'assist1').length, 0, 'auto-place wrote nothing to the booking');
});

test('ASSISTANT LOCK DEPENDS ON TWO ROUTE FLOW RULES: reshuffle treats a locked assistant booking as an anchor and never moves it', async () => {
  // Another provisional booking sits in the day, so the optimiser has real work to consider.
  const db = makeLooseDb(seed([assistantBooking(), provisional()]));
  const loaded = await loadDay(db, { date: DATE, day: 'Friday', teamMemberId: 't1', isTest: false });
  assert.equal(loaded.ok, true, `day loads (${loaded.reason})`);
  const item = loaded.items.find(i => i.id === 'assist1');
  assert.ok(item, 'the assistant booking is part of the day');
  assert.equal(item.anchor, true, 'it is an anchor: the optimiser may not move it');

  const result = await optimiseDay(db, { date: DATE, day: 'Friday', teamMemberId: 't1', isTest: false }, { actorName: 'Route Flow', actorRole: 'automation' });
  assert.equal(db.tables.BookingRequest.find(b => b.id === 'assist1').assigned_time, PROMISED, `assigned_time unchanged (${result.reason || 'ran'})`);
  assert.equal(bookingWrites(db, 'assist1').length, 0, 'reshuffle wrote nothing to the booking');
  assert.equal(db.tables.BookingRequest.find(b => b.id === 'assist1').assistant_promised_time, PROMISED);
});

test('ASSISTANT LOCK DEPENDS ON TWO ROUTE FLOW RULES: only a provisional booking is ever movable by automation', () => {
  assert.equal(isAutomationAllowed('provisional'), true);
  for (const s of ['locked', 'confirmed', 'unscheduled', undefined, null, '']) assert.equal(isAutomationAllowed(s), false, String(s));
  // Rule 1 is pinned at the source: if the idempotency check is weakened this fails with a clear message.
  const engine = readFileSync(new URL('../base44/shared/routeFlowEngine.ts', import.meta.url), 'utf8');
  assert.match(engine, /booking\.assigned_time && booking\.schedule_status && booking\.schedule_status !== 'unscheduled'/,
    "routeFlowEngine's already_placed rule changed: assistant bookings (locked, with a promised time) could now be moved by auto-place");
  // Both reshuffle paths gate on the same rule.
  for (const f of ['../base44/shared/routeFlowOptimiser.ts', '../base44/functions/routeFlowEvaluateReshuffleV2/entry.ts']) {
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /isAutomationAllowed\(/, `${f} must gate movement on isAutomationAllowed`);
  }
});