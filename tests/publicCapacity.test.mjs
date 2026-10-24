// Capacity and public availability, pinned against the code AS SHIPPED (sheet 10).
// Page side: publicBookingData -> daySummaries. Submit side: submitPublicBooking -> the saved record.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEntry } from './helpers/loadEntry.mjs';
import { loadPublicData } from './helpers/loadPublicData.mjs';
import { makeMemDb } from './helpers/memDb.mjs';
import { dayHasRoom, occupiedOn, isAtCapacity, confirmedOnDate, serverCapacityStatus } from '../base44/shared/publicDayFit.ts';

const ymd = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const dayName = (d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${d}T00:00:00Z`).getUTCDay()];
const DATE = ymd(4);
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const HOURS = DAYS.map((d) => ({ day_of_week: d, is_open: true, open_time: 9, close_time: 19 }));
const BARBER = { id: 'tm1', name: 'Alvaro', role: 'owner', status: 'Active', is_bookable: true, working_hours: HOURS };
const SERVICE = { id: 's1', name: 'Skin Fade', price: 45, duration_mins: 45, buffer_mins: 0, is_active: true };
const RULES = { minimum_notice_hours: 0, maximum_booking_days: 60 };
const AREA = {
  id: 'z1', name: 'St George', active: true, team_member_id: 'tm1', team_member_name: 'Alvaro',
  latitude: -33.95, longitude: 151.1, radius_km: 25, colour: '#8B5CF6', sort_order: 1,
  service_days: DAYS.map((d) => ({ day_of_week: d, enabled: true, open_time: 9, close_time: 19, max_bookings: 8 })),
};

const booking = (over = {}) => ({
  id: `b-${Math.random().toString(36).slice(2, 8)}`, client_name: 'Someone', requested_date: DATE, day: dayName(DATE),
  status: 'confirmed', assigned_time: '9:00am', duration_mins: 45, team_member_id: 'tm1', is_test: false, ...over,
});
const googleBlock = (over = {}) => booking({ client_name: '[BLOCK] Google Calendar', block_source: 'google_calendar', google_owner_user_id: 'u1', google_event_id: 'e1', phone: 'BLOCK', ...over });

async function page(bookings, { max = 8 } = {}) {
  const db = makeMemDb({
    BookingRules: [RULES], Service: [SERVICE], TeamMember: [BARBER], ServiceArea: [AREA],
    GroupDiscountSettings: [{ max_bookings_per_day: max }], BookingRequest: bookings,
  });
  globalThis.__b44Client = () => db;
  const handler = await loadPublicData();
  const res = await handler(new Request('https://x.test/publicBookingData', { method: 'POST', body: '{}' }));
  assert.equal(res.status, 200);
  const json = await res.json();
  return json.daySummaries[DATE];
}

// ── 1. A day with room is offered; a day at capacity is not ──────────────────
test('a day with room is offered', async () => {
  const s = await page([booking({ assigned_time: '9:00am' })], { max: 3 });
  assert.notEqual(s.customer_status, 'closed');
  assert.equal(s.closed_reason, undefined);
});

test('a day at capacity is not offered, and says it is full', async () => {
  const rows = ['9:00am', '11:00am', '1:00pm'].map((t) => booking({ assigned_time: t }));
  const s = await page(rows, { max: 3 });
  assert.equal(s.customer_status, 'closed');
  assert.equal(s.closed_reason, 'full');
});

test('one booking under the limit is still offered', async () => {
  const rows = ['9:00am', '11:00am'].map((t) => booking({ assigned_time: t }));
  const s = await page(rows, { max: 3 });
  assert.notEqual(s.customer_status, 'closed');
});

// ── 3. Behaviour did not get looser ──────────────────────────────────────────
test('a day the count rule rejects stays rejected, however empty the diary looks', async () => {
  // Three confirmed bookings, all with no time (they hold no slot), so the diary is wide open.
  const rows = [1, 2, 3].map(() => booking({ assigned_time: undefined }));
  const s = await page(rows, { max: 3 });
  assert.equal(s.customer_status, 'closed', 'room in the diary must not reopen a day at its limit');
  assert.equal(s.closed_reason, 'full');
});

test('the room rule only ever closes: for every count and every diary, count >= limit means closed', () => {
  const diaries = [[], [{ start: 9, end: 10 }], [{ start: 9, end: 19 }]];
  for (let count = 0; count <= 6; count++) {
    for (const busy of diaries) {
      const room = dayHasRoom(9, 19, busy, 45);
      const offered = !isAtCapacity(count, 3) && room;
      if (count >= 3) assert.equal(offered, false, `count ${count} must never be offered`);
    }
  }
  // An unreadable count never opens anything: a day with no room is closed whatever the count.
  assert.equal(dayHasRoom(9, 19, [{ start: 9, end: 19 }], 45), false);
});

test('a day with no gap for the shortest service is closed even under the count', async () => {
  const s = await page([booking({ assigned_time: '9:00am', duration_mins: 600 })], { max: 8 });
  assert.equal(s.customer_status, 'closed');
  assert.equal(s.closed_reason, 'no_room');
});

// ── 5. Blocks count; another barber's bookings do not ────────────────────────
test('a Google Calendar block holds the barber\'s time like a booking does', async () => {
  const s = await page([googleBlock({ assigned_time: '9:00am', duration_mins: 600 })], { max: 8 });
  assert.equal(s.closed_reason, 'no_room');
});

test('a hand-made block (BlockTimeModal shape) holds time too', async () => {
  const s = await page([booking({ client_name: '[BLOCK] Dentist', phone: 'BLOCK', assigned_time: '9:00am', duration_mins: 600 })], { max: 8 });
  assert.equal(s.closed_reason, 'no_room');
});

test('another barber\'s block or booking does not take this barber\'s time', async () => {
  const other = [
    googleBlock({ team_member_id: 'tm2', assigned_time: '9:00am', duration_mins: 600 }),
    booking({ team_member_id: 'tm2', assigned_time: '9:00am', duration_mins: 600 }),
  ];
  const s = await page(other, { max: 8 });
  assert.notEqual(s.customer_status, 'closed');
  assert.deepEqual(occupiedOn(other.map((b) => ({ ...b })), DATE, 'tm1'), []);
});

test('a block with no barber holds everyone\'s time', () => {
  const busy = occupiedOn([booking({ team_member_id: null, assigned_time: '10:00am', duration_mins: 60 })], DATE, 'tm1');
  assert.equal(busy.length, 1);
});

test('pending, declined and cancelled requests never hold time', () => {
  for (const status of ['pending', 'declined', 'cancelled', 'waitlist']) {
    assert.deepEqual(occupiedOn([booking({ status })], DATE, 'tm1'), [], status);
  }
});

test('the capacity status the server records follows the stored count', () => {
  assert.equal(serverCapacityStatus(0, 8), 'available');
  assert.equal(serverCapacityStatus(6, 8), 'limited');
  assert.equal(serverCapacityStatus(8, 8), 'waitlist');
  assert.equal(confirmedOnDate([booking(), booking({ status: 'pending' }), booking({ requested_date: ymd(9) })], DATE), 1);
});

// ── 2 + 6. Submission: the server counts, the browser cannot talk it out of it ──
const BODY = {
  client_name: 'Patrick Nolan', phone: '0423987654', email: 'patrick.nolan@example.com', address: '1 Test Street, Bexley NSW',
  address_lat: -33.95, address_lng: 151.1, day: dayName(DATE), requested_date: DATE,
  services: ['Skin Fade'], participants: [{ primary_service: 'Skin Fade', addons: [] }],
  availability_window: '4pm-7pm', submission_token: 'cap-tok-1', messaging_consent: true,
};

async function submit(stored, { max = 3, autoAccept = false, body = BODY } = {}) {
  const db = makeMemDb({
    ServiceArea: [AREA], Service: [SERVICE], BookingRules: [{ ...RULES, auto_accept_requests: autoAccept }],
    BookingProtectionRules: [{ enabled: false }], GroupDiscountSettings: [{ max_bookings_per_day: max }],
    BookingRequest: stored,
  });
  globalThis.__b44Client = () => db;
  const handler = await loadEntry('submitPublicBooking');
  const res = await handler(new Request('https://x.test/submitPublicBooking', { method: 'POST', body: JSON.stringify(body) }));
  const json = await res.json();
  const created = db.writes.find((w) => w.entity === 'BookingRequest' && w.op === 'create');
  return { db, json, created: created?.data };
}
const full = () => ['9:00am', '11:00am', '1:00pm'].map((t) => booking({ assigned_time: t }));

test('a submission for a day with room is saved normally, not held', async () => {
  const { json, created } = await submit([booking()], { max: 3 });
  assert.equal(json.success, true, JSON.stringify(json));
  assert.notEqual(created.protection_hold, true);
  assert.equal(created.waitlist, false);
  assert.equal(created.capacity_status_at_submission, 'available');
});

test('an over-capacity submission is saved in full but held for a person, never auto-accepted', async () => {
  const { json, created } = await submit(full(), { max: 3, autoAccept: true });
  assert.equal(json.success, true, 'the customer is not turned away');
  assert.equal(created.protection_hold, true);
  assert.equal(created.waitlist, true);
  assert.equal(created.placement_status, 'needs_review');
  assert.notEqual(created.status, 'confirmed', 'a held request is never auto-accepted');
  assert.ok(created.protection_codes.includes('over_capacity'));
  assert.equal(json.auto_accepted, false);
});

test('the hold reason is readable: it names the count and the limit', async () => {
  const { created } = await submit(full(), { max: 3 });
  assert.equal(created.protection_reasons[0], 'This day already has 3 confirmed bookings (limit 3).');
  assert.match(created.placement_reason, /^Held for review: This day already has 3 confirmed bookings \(limit 3\)\./);
});

test('a browser that claims the day is empty cannot make an over-capacity booking succeed', async () => {
  const lie = { ...BODY, waitlist: false, capacity_status_at_submission: 'available', capacity: { confirmed: 0 }, confirmed_count: 0 };
  const { created } = await submit(full(), { max: 3, body: lie });
  assert.equal(created.protection_hold, true);
  assert.equal(created.waitlist, true);
  assert.equal(created.capacity_status_at_submission, 'waitlist', 'the recorded status comes from stored bookings');
});

test('test bookings are not held by capacity, and test rows do not fill a real day', async () => {
  const testRows = full().map((b) => ({ ...b, is_test: true }));
  const { created } = await submit(testRows, { max: 3 });
  assert.notEqual(created.protection_hold, true);
});