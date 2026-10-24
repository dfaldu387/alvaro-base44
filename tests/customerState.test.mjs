// "Barber preparing" and "Arriving soon" are DERIVED for the customer's tracking view and can never be stored.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeRouteEta } from '../base44/shared/routeEta.ts';
import { buildTrackingView } from '../base44/shared/bookingTracking.ts';
import { transition, STOP_ACTIONS, CUSTOMER_LABEL } from '../base44/shared/routeStopStates.ts';
import { deriveCustomerState, ARRIVING_SOON_MINUTES, PREPARING_LEAD_MINUTES } from '../base44/shared/customerStopState.ts';

const DATE = '2026-10-14'; // AEDT (UTC+11)
const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 14, h - 11, m));
const iso = (h, m = 0) => at(h, m).toISOString();
const SERVICE = { A: 45, B: 45, C: 45 };

function route(exec = [], over = {}) {
  return {
    id: 'r1', route_status: 'finalised', team_member_id: 't1', team_member_name: 'Alvaro',
    stops: [
      { booking_request_id: 'A', order: 1, start_label: '9:00am', start_decimal: 9, end_label: '10:00am', drive_minutes: 15 },
      { booking_request_id: 'B', order: 2, start_label: '10:15am', start_decimal: 10.25, end_label: '11:15am', drive_minutes: 15 },
      { booking_request_id: 'C', order: 3, start_label: '11:30am', start_decimal: 11.5, end_label: '12:30pm', drive_minutes: null },
    ],
    stop_execution: exec,
    ...over,
  };
}
const view = (id, r, now) => {
  const eta = computeRouteEta({ date: DATE, route: r, service_minutes: SERVICE, now });
  return buildTrackingView({ id, client_name: 'Pat Nolan', services: ['Skin Fade'], assigned_time: '9:00am', status: 'confirmed' }, [eta], now);
};
const done = (id, h, m) => ({ booking_request_id: id, state: 'completed', completed_at: iso(h, m), started_at: iso(h - 1, 15) });

// ── Arriving soon ────────────────────────────────────────────────────────────
test('on the way and the ETA is within 10 minutes: Arriving soon', () => {
  const r = route([{ booking_request_id: 'A', state: 'on_the_way' }]);
  assert.equal(view('A', r, at(8, 52)).state, 'arriving_soon'); // ETA 9:00, 8 minutes away
  assert.equal(view('A', r, at(8, 50)).state, 'arriving_soon'); // exactly 10 minutes
});

test('on the way but the ETA is further than 10 minutes: still On the way', () => {
  const r = route([{ booking_request_id: 'A', state: 'on_the_way' }]);
  assert.equal(view('A', r, at(8, 49)).state, 'on_the_way');
  assert.equal(view('A', r, at(8, 20)).state, 'on_the_way');
});

test('a late day: the ETA the customer is shown drives the label, not the booked time', () => {
  // A completed at 10:15 (30 late against a 9:45 planned service end) => B ETA 10:45. B is on the way.
  const r = route([done('A', 10, 15), { booking_request_id: 'B', state: 'on_the_way' }]);
  assert.equal(view('B', r, at(10, 20)).state, 'on_the_way'); // 25 minutes to the 10:45 ETA
  assert.equal(view('B', r, at(10, 38)).state, 'arriving_soon');
});

test('a stale ETA never shows Arriving soon: it falls back to On the way', () => {
  const r = route([{ booking_request_id: 'A', state: 'on_the_way' }]);
  assert.equal(view('A', r, at(9, 5)).state, 'arriving_soon'); // 5 minutes past the ETA is still believable
  assert.equal(view('A', r, at(9, 11)).state, 'on_the_way');   // 11 minutes past: the estimate has stopped being true
  assert.equal(view('A', r, at(11, 0)).state, 'on_the_way');
});

test('an unavailable ETA never shows Arriving soon or Barber preparing', () => {
  for (const bad of [
    route([{ booking_request_id: 'A', state: 'on_the_way' }], { route_status: 'needs_update' }),
    route([{ booking_request_id: 'A', state: 'on_the_way' }], { route_status: 'draft' }),
    route([{ booking_request_id: 'A', state: 'on_the_way' }], { stops: route().stops.map((s) => ({ ...s, drive_minutes: null })) }),
  ]) {
    const state = view('A', bad, at(8, 55)).state;
    assert.ok(!['arriving_soon', 'preparing'].includes(state), state);
  }
  // A route that needs rebuilding, or has unverified drives, still reports the stored state.
  assert.equal(view('A', route([{ booking_request_id: 'A', state: 'on_the_way' }], { route_status: 'needs_update' }), at(8, 55)).state, 'on_the_way');
  const planned = route([], { route_status: 'needs_update' });
  assert.equal(view('A', planned, at(8, 45)).state, 'planned');
  assert.equal(deriveCustomerState(null, null, Date.now()), null);
});

// ── Barber preparing ─────────────────────────────────────────────────────────
test('planned, nobody ahead and within 30 minutes of the ETA: Barber preparing', () => {
  const r = route();
  assert.equal(view('A', r, at(8, 35)).state, 'preparing'); // 25 minutes before 9:00
  assert.equal(view('A', r, at(8, 30)).state, 'preparing'); // exactly 30
  assert.equal(view('A', r, at(8, 29)).state, 'planned');   // 31 minutes
});

test('planned but a job is still being worked ahead of this one: not preparing', () => {
  const r = route([{ booking_request_id: 'A', state: 'in_service', arrived_at: iso(9, 0), started_at: iso(9, 0) }]);
  assert.equal(view('B', r, at(10, 0)).state, 'planned');
});

test('the stop before is finished: the next customer sees Barber preparing', () => {
  const r = route([done('A', 10, 0)]);
  assert.equal(view('B', r, at(10, 5)).state, 'preparing');
});

test('a planned stop whose ETA is long past is not preparing (stale)', () => {
  assert.equal(view('A', route(), at(9, 40)).state, 'planned');
});

test('arrived, in service and completed are shown exactly as stored', () => {
  const r = route([{ booking_request_id: 'A', state: 'arrived', arrived_at: iso(8, 58) }]);
  assert.equal(view('A', r, at(9, 0)).state, 'arrived');
  const s = route([{ booking_request_id: 'A', state: 'in_service', started_at: iso(9, 0) }]);
  assert.equal(view('A', s, at(9, 10)).state, 'in_service');
});

test('the thresholds are the ones documented', () => {
  assert.equal(ARRIVING_SOON_MINUTES, 10);
  assert.equal(PREPARING_LEAD_MINUTES, 30);
});

// ── They can no longer be written ────────────────────────────────────────────
test('no action can reach preparing or arriving_soon, and a stored one is not a state', () => {
  for (const from of [undefined, 'planned', 'on_the_way', 'arrived', 'in_service', 'completed', 'skipped', 'preparing', 'arriving_soon']) {
    for (const action of STOP_ACTIONS) {
      const r = transition(from, action, 'because');
      if (r.ok) assert.ok(!['preparing', 'arriving_soon'].includes(r.state), `${from} + ${action}`);
    }
  }
});

test('the state machine still walks planned -> on the way -> arrived -> in service -> completed', () => {
  let s = 'planned';
  for (const [action, want] of [['on_the_way', 'on_the_way'], ['arrive', 'arrived'], ['start', 'in_service'], ['complete', 'completed']]) {
    const r = transition(s, action);
    assert.equal(r.ok && r.state, want);
    s = r.state;
  }
  assert.equal(transition('planned', 'start').code, 'NOT_ARRIVED');
  assert.equal(transition('arrived', 'complete').code, 'NOT_STARTED');
  assert.equal(transition('completed', 'complete').already, true);
  assert.equal(transition('arrived', 'on_the_way').already, true);
});

test('the customer labels are kept', () => {
  assert.equal(CUSTOMER_LABEL.preparing, 'Barber preparing');
  assert.equal(CUSTOMER_LABEL.arriving_soon, 'Arriving soon');
});

test('the stored enums and the state type no longer contain the two derived states', () => {
  const entity = readFileSync(new URL('../base44/entities/DayRoute.jsonc', import.meta.url), 'utf8');
  const stored = entity.slice(entity.indexOf('"stop_execution"'));
  assert.doesNotMatch(stored, /"preparing"|"arriving_soon"|"Barber preparing"|"Arriving soon"/);
  const states = readFileSync(new URL('../base44/shared/routeStopStates.ts', import.meta.url), 'utf8');
  assert.match(states, /export type StopState = 'planned' \| 'on_the_way' \| 'arrived' \| 'in_service' \| 'completed' \| 'skipped';/);
  assert.match(states, /const ORDER: StopState\[\] = \['planned', 'on_the_way', 'arrived', 'in_service', 'completed'\];/);
  const panel = readFileSync(new URL('../src/components/route/CurrentStopPanel.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /arriving_soon|'preparing'/);
});

test('deriving costs nothing: the derivation file reads and writes nothing', () => {
  const src = readFileSync(new URL('../base44/shared/customerStopState.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /entities|fetch\(|mapbox|setInterval|setTimeout|\.update\(|\.create\(/i);
});