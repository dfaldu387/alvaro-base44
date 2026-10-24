// Pins down the CURRENT public booking path so the shared-creator extraction cannot change it.
// This file must pass before the extraction and, unchanged, after it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEntry, makeLooseDb } from './helpers/loadEntry.mjs';

const AREA = {
  id: 'z1', name: 'St George', active: true, team_member_id: 'tm1', team_member_name: 'Alvaro',
  latitude: -33.95, longitude: 151.1, radius_km: 25, colour: '#8B5CF6', sort_order: 1,
  service_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => ({ day_of_week: d, enabled: true, open_time: 9, close_time: 19, max_bookings: 8 })),
};
const SERVICES = [{ id: 's1', name: 'Skin Fade', price: 45, duration_mins: 45, is_active: true }];

const ymd = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const dayName = (d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${d}T00:00:00Z`).getUTCDay()];
const date = ymd(4);
const BODY = {
  client_name: 'Patrick Nolan', phone: '0423987654', email: 'patrick.nolan@example.com', address: '1 Test Street, Bexley NSW',
  address_lat: -33.95, address_lng: 151.1, day: dayName(date), requested_date: date,
  services: ['Skin Fade'], participants: [{ primary_service: 'Skin Fade', addons: [] }],
  availability_window: '4pm-7pm', submission_token: 'tok-1', messaging_consent: true,
};

async function submit(rules, body = BODY) {
  const db = makeLooseDb({ ServiceArea: [AREA], Service: SERVICES, BookingRules: [{ minimum_notice_hours: 0, maximum_booking_days: 60, ...rules }], BookingProtectionRules: [{ enabled: false }] });
  globalThis.__b44Client = () => db;
  const handler = await loadEntry('submitPublicBooking');
  const res = await handler(new Request('https://x.test/submitPublicBooking', { method: 'POST', body: JSON.stringify(body) }));
  return { db, res, json: await res.json() };
}
const bookingCreates = (db) => db.writes.filter((w) => w.entity === 'BookingRequest' && w.op === 'create');

test('auto-accept ON: the booking is saved confirmed, unscheduled, with no time', async () => {
  const { db, json } = await submit({ auto_accept_requests: true });
  assert.equal(json.success, true, JSON.stringify(json));
  assert.equal(json.auto_accepted, true);
  assert.equal(json.status, 'confirmed');
  const [c] = bookingCreates(db);
  assert.equal(bookingCreates(db).length, 1);
  assert.equal(c.data.status, 'confirmed');
  assert.equal(c.data.assigned_time, null);
  assert.equal(c.data.schedule_status, 'unscheduled');
  assert.equal(c.data.placement_status, 'processing');
  assert.equal(c.data.booking_source, 'Online Booking');
});

test('auto-accept OFF: the booking is saved pending, still handed to auto-place with no time', async () => {
  const { db, json } = await submit({ auto_accept_requests: false });
  assert.equal(json.success, true);
  assert.equal(json.auto_accepted, false);
  const [c] = bookingCreates(db);
  assert.equal(c.data.status, 'pending');
  assert.equal(c.data.assigned_time, null);
  assert.equal(c.data.schedule_status, 'unscheduled');
});

test('the follow-ups run: the customer text is attempted and the deposit decision is made', async () => {
  const { db, json } = await submit({ auto_accept_requests: true });
  assert.ok('message_queued' in json && 'deposit' in json);
  assert.deepEqual(Object.keys(json.deposit).sort(), ['amount', 'reason', 'required']);
  // The text goes through the outbox pipeline and a payment record is created for the booking.
  assert.ok(db.writes.some((w) => w.entity === 'BookingPayment' && w.op === 'create'), 'payment record created');
  assert.ok(db.writes.some((w) => w.entity === 'MessageOutbox' || w.entity === 'Message'), 'a customer message was attempted');
});

test('a resend with the same submission token creates nothing new', async () => {
  const db = makeLooseDb({ ServiceArea: [AREA], Service: SERVICES, BookingRules: [{ minimum_notice_hours: 0, maximum_booking_days: 60 }],
    BookingRequest: [{ id: 'old', submission_token: 'tok-1', status: 'pending' }] });
  globalThis.__b44Client = () => db;
  const handler = await loadEntry('submitPublicBooking');
  const json = await (await handler(new Request('https://x.test/', { method: 'POST', body: JSON.stringify(BODY) }))).json();
  assert.equal(json.duplicate, true);
  assert.equal(json.id, 'old');
  assert.equal(bookingCreates(db).length, 0);
});

test('invalid input is refused with 400 and nothing is written', async () => {
  const { db, res, json } = await submit({}, { ...BODY, phone: '123' });
  assert.equal(res.status, 400);
  assert.equal(json.error, 'Validation failed');
  assert.equal(db.writes.length, 0);
});