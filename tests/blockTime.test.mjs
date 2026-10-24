import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEntry } from './helpers/loadEntry.mjs';
import { makeMemDb } from './helpers/memDb.mjs';

/**
 * Blocked time is editable and removable — and always safe.
 *
 * A block is an ordinary schedule record, so changing it changes the day: removing one
 * hands its time back to scheduling, a repeating block asks which occurrences go with
 * it, and a real client appointment can never be deleted through this door.
 */
const manage = await loadEntry('manageBlockTime');

const asAdmin = (db) => () => ({
  auth: { me: async () => ({ id: 'u1', email: 'a@x.test', full_name: 'Alvaro', role: 'admin' }) },
  entities: db.entities,
  asServiceRole: db.asServiceRole,
});

const block = (id, date, start, dur, extra = {}) => ({
  id,
  client_name: '[BLOCK] Lunch',
  phone: 'BLOCK',
  day: 'Thursday',
  requested_date: date,
  assigned_time: start,
  duration_mins: dur,
  availability_window: '12pm–1pm',
  services: ['Lunch'],
  status: 'confirmed',
  ...extra,
});

const appointment = (id, date, start, dur, name = 'Emily Davidson') => ({
  id,
  client_name: name,
  day: 'Thursday',
  requested_date: date,
  assigned_time: start,
  duration_mins: dur,
  status: 'confirmed',
});

async function call(db, payload) {
  globalThis.__b44Client = asAdmin(db);
  const res = await manage(new Request('https://app.test/f', {
    method: 'POST', headers: { authorization: 'Bearer x' }, body: JSON.stringify(payload),
  }));
  return { status: res.status, json: await res.json() };
}

test('a block can be edited: new title, time and duration', async () => {
  const db = makeMemDb({ BookingRequest: [block('b1', '2026-10-22', '12:00pm', 60)] });
  const { json } = await call(db, {
    action: 'update', booking_request_id: 'b1', reason: 'Personal', start: 12.5, end: 13.5,
  });
  assert.equal(json.saved, true);
  const row = db.table('BookingRequest')[0];
  assert.equal(row.client_name, '[BLOCK] Personal');
  assert.equal(row.services[0], 'Personal');
  assert.equal(row.assigned_time, '12:30pm');
  assert.equal(row.duration_mins, 60);
  assert.equal(row.availability_window, '12:30pm–1:30pm');
});

test('a drag that sends no title keeps the block its own title', async () => {
  const db = makeMemDb({ BookingRequest: [block('b1', '2026-10-22', '12:00pm', 60)] });
  const { json } = await call(db, { action: 'update', booking_request_id: 'b1', start: 13, end: 14 });
  assert.equal(json.saved, true);
  assert.equal(db.table('BookingRequest')[0].client_name, '[BLOCK] Lunch');
  assert.equal(db.table('BookingRequest')[0].assigned_time, '1:00pm');
});

test('an edit that would double-book is refused, never silently dropped', async () => {
  const db = makeMemDb({
    BookingRequest: [
      block('b1', '2026-10-22', '12:00pm', 60),
      appointment('a1', '2026-10-22', '12:30pm', 60),
    ],
  });
  const { status, json } = await call(db, {
    action: 'update', booking_request_id: 'b1', reason: 'Lunch', start: 12.5, end: 13.5,
  });
  assert.equal(status, 409);
  assert.match(json.error, /Emily/);
  assert.equal(db.table('BookingRequest').find((r) => r.id === 'b1').assigned_time, '12:00pm');
});

test('removing a block deletes the record, so the time is free again', async () => {
  const db = makeMemDb({ BookingRequest: [block('b1', '2026-10-22', '12:00pm', 60)] });
  const { json } = await call(db, { action: 'delete', booking_request_id: 'b1' });
  assert.equal(json.saved, true);
  assert.equal(json.removed, 1);
  assert.equal(db.table('BookingRequest').length, 0);
});

test('a repeating block asks for its scope: one, this and future, or the whole series', async () => {
  const rows = [
    block('b1', '2026-10-22', '12:00pm', 60),
    block('b2', '2026-10-29', '12:00pm', 60),
    block('b3', '2026-11-05', '12:00pm', 60),
  ];
  const series = [{ id: 's1', booking_request_ids: ['b1', 'b2', 'b3'], frequency_weeks: 1, first_date: '2026-10-22' }];

  const one = makeMemDb({ BookingRequest: rows.map((r) => ({ ...r })), AppointmentSeries: series.map((s) => ({ ...s, booking_request_ids: [...s.booking_request_ids] })) });
  const single = await call(one, { action: 'delete', booking_request_id: 'b2', scope: 'this' });
  assert.equal(single.json.removed, 1);
  assert.deepEqual(one.table('BookingRequest').map((r) => r.id).sort(), ['b1', 'b3']);
  assert.deepEqual(one.table('AppointmentSeries')[0].booking_request_ids, ['b1', 'b3']);

  const future = makeMemDb({ BookingRequest: rows.map((r) => ({ ...r })), AppointmentSeries: series.map((s) => ({ ...s, booking_request_ids: [...s.booking_request_ids] })) });
  const later = await call(future, { action: 'delete', booking_request_id: 'b2', scope: 'future' });
  assert.equal(later.json.removed, 2);
  assert.deepEqual(future.table('BookingRequest').map((r) => r.id), ['b1']);

  const whole = makeMemDb({ BookingRequest: rows.map((r) => ({ ...r })), AppointmentSeries: series.map((s) => ({ ...s, booking_request_ids: [...s.booking_request_ids] })) });
  const all = await call(whole, { action: 'delete', booking_request_id: 'b1', scope: 'series' });
  assert.equal(all.json.removed, 3);
  assert.equal(whole.table('BookingRequest').length, 0);
  assert.equal(whole.table('AppointmentSeries').length, 0, 'the empty series goes with it');
});

test('editing a series keeps each occurrence on its own date', async () => {
  const db = makeMemDb({
    BookingRequest: [
      block('b1', '2026-10-22', '12:00pm', 60),
      block('b2', '2026-10-29', '12:00pm', 60),
    ],
    AppointmentSeries: [{ id: 's1', booking_request_ids: ['b1', 'b2'], frequency_weeks: 1, first_date: '2026-10-22' }],
  });
  const { json } = await call(db, {
    action: 'update', booking_request_id: 'b1', reason: 'Admin Time', start: 14, end: 15,
    requested_date: '2026-10-22', scope: 'series',
  });
  assert.equal(json.updated, 2);
  const rows = db.table('BookingRequest');
  assert.equal(rows[0].requested_date, '2026-10-22');
  assert.equal(rows[1].requested_date, '2026-10-29');
  assert.equal(rows[1].assigned_time, '2:00pm');
  assert.equal(rows[1].client_name, '[BLOCK] Admin Time');
});

test('a real client appointment can never be deleted through the block endpoint', async () => {
  const db = makeMemDb({ BookingRequest: [appointment('a1', '2026-10-22', '12:00pm', 60)] });
  const { status, json } = await call(db, { action: 'delete', booking_request_id: 'a1' });
  assert.equal(status, 400);
  assert.match(json.error, /appointment/i);
  assert.equal(db.table('BookingRequest').length, 1);
});