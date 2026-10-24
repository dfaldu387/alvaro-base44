import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEntry } from './helpers/loadEntry.mjs';
import { makeMemDb } from './helpers/memDb.mjs';
import { summarisePeople, quantityGroups, addUnit, removeUnit, newPerson, participantsOf } from '../src/lib/bookingPeople.js';

/**
 * Manual bookings are PEOPLE, not a flat list of unique services.
 *
 * Two Haircuts is two people, an add-on stays with its own person and never becomes a
 * person of its own, and the browser's preview must agree with what the server writes.
 */

const SERVICES = [
  { id: 's1', name: 'Haircut', price: 45, duration_mins: 35, is_active: true },
  { id: 's2', name: 'Kids Cut', price: 25, duration_mins: 20, is_active: true },
];
const ADDONS = [
  { id: 'a1', name: 'Beard', price_adjustment: 10, duration_adjustment: 10, is_active: true },
  { id: 'a2', name: 'Design', price_adjustment: 5, duration_adjustment: 5, is_active: true },
];
const SETTINGS = {
  id: 'g1', enabled: true, max_group_booking_people: 6, max_bookings_per_day: 8,
  tier_2_type: 'fixed', tier_2_amount: 10,
  tier_3_type: 'fixed', tier_3_amount: 21,
  tier_4plus_type: 'percentage', tier_4plus_amount: 10,
};

const haircut = (addons = []) => newPerson('Haircut', addons);
const kids = () => newPerson('Kids Cut');

// ── The preview the form shows ───────────────────────────────────────────────
test('two of the same service are two people, priced and timed twice', () => {
  const { peopleCount, durationMins, subtotal } = summarisePeople([haircut(), haircut()], SERVICES, ADDONS, SETTINGS);
  assert.equal(peopleCount, 2);
  assert.equal(durationMins, 70);
  assert.equal(subtotal, 90);
});

test('an add-on adds time and price to its own person and never becomes a person', () => {
  const people = [haircut(['Beard']), kids(), kids()];
  const s = summarisePeople(people, SERVICES, ADDONS, SETTINGS);
  assert.equal(s.peopleCount, 3, 'three people, not four');
  assert.equal(s.durationMins, 35 + 10 + 20 + 20);
  assert.equal(s.addonMins, 10);
  assert.equal(s.subtotal, 45 + 10 + 25 + 25);
  assert.equal(s.rows[0].addons.join(','), 'Beard');
  assert.equal(s.rows[1].addons.length, 0, 'the add-on stayed with person 1');
});

test('the group discount follows the number of people', () => {
  const two = summarisePeople([haircut(), haircut()], SERVICES, ADDONS, SETTINGS);
  assert.equal(two.discount, 10);
  const three = summarisePeople([haircut(['Beard']), kids(), kids()], SERVICES, ADDONS, SETTINGS);
  assert.equal(three.discount, 21);
  assert.equal(three.total, three.subtotal - 21);
});

test('quantity groups read back exactly what the people are', () => {
  const people = [haircut(), kids(), haircut(), kids(), kids()];
  assert.deepEqual(quantityGroups(people), [
    { name: 'Haircut', count: 2 },
    { name: 'Kids Cut', count: 3 },
  ]);
});

test('a unit is added and removed without touching anyone else', () => {
  const people = [haircut(['Beard']), kids()];
  const more = addUnit(people, 'Haircut');
  assert.equal(more.length, 3);
  assert.equal(more[2].primary, 'Haircut');
  assert.equal(more[2].addons.length, 0, 'a new person starts with no add-ons');
  const fewer = removeUnit(more, 'Haircut');
  assert.equal(fewer.length, 2);
  assert.deepEqual(participantsOf(fewer), [
    { primary_service: 'Haircut', addons: ['Beard'] },
    { primary_service: 'Kids Cut', addons: [] },
  ]);
});

// ── What the server actually writes ─────────────────────────────────────────
const createAdmin = await loadEntry('createAdminBooking');
const asAdmin = (db) => () => ({ auth: { me: async () => ({ id: 'u1', email: 'a@x.test', full_name: 'Alvaro', role: 'admin' }) }, entities: db.entities, asServiceRole: db.asServiceRole });
const ymd = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const world = () => makeMemDb({ Service: SERVICES, AddOn: ADDONS, GroupDiscountSettings: [SETTINGS] });

async function create(db, participants, token = 'tok-1') {
  globalThis.__b44Client = asAdmin(db);
  const body = {
    client_name: 'Jo Bloggs', phone: '0412 345 678', address: '1 Test St',
    requested_date: ymd(5), availability_window: '9am–12pm', participants,
    submission_token: token,
  };
  const res = await createAdmin(new Request('https://app.test/f', { method: 'POST', headers: { authorization: 'Bearer x' }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json() };
}

test('two Haircuts save as two people, priced and timed from the catalogue', async () => {
  const db = world();
  const { status, json } = await create(db, [
    { primary_service: 'Haircut', addons: [] },
    { primary_service: 'Haircut', addons: [] },
  ]);
  assert.equal(status, 200);
  const row = db.table('BookingRequest').find(r => r.id === json.id);
  assert.equal(row.people_count, 2);
  assert.equal(row.duration_mins, 70);
  assert.equal(row.subtotal, 90);
  assert.equal(row.price, 80, 'two people earn the two-person discount');
});

test('add-ons stay on their person and are not counted as people', async () => {
  const db = world();
  const { json } = await create(db, [
    { primary_service: 'Haircut', addons: ['Beard'] },
    { primary_service: 'Kids Cut', addons: [] },
  ]);
  const row = db.table('BookingRequest').find(r => r.id === json.id);
  assert.equal(row.people_count, 2);
  assert.equal(row.duration_mins, 35 + 10 + 20);
  assert.deepEqual(row.participants, [
    { primary_service: 'Haircut', addons: ['Beard'] },
    { primary_service: 'Kids Cut', addons: [] },
  ]);
});

test('one person can carry several add-ons', async () => {
  const db = world();
  const { json } = await create(db, [{ primary_service: 'Kids Cut', addons: ['Beard', 'Design'] }]);
  const row = db.table('BookingRequest').find(r => r.id === json.id);
  assert.equal(row.people_count, 1);
  assert.equal(row.duration_mins, 20 + 10 + 5);
  assert.equal(row.price, 25 + 10 + 5);
  assert.equal(row.group_discount, 0, 'one person earns no group discount');
});

test('an add-on that is not in the catalogue is refused, never added for free', async () => {
  const db = world();
  const { status, json } = await create(db, [{ primary_service: 'Haircut', addons: ['Free Extra'] }]);
  assert.equal(status, 400);
  assert.match(json.error, /Free Extra/);
  assert.equal(db.table('BookingRequest').length, 0);
});

test('a person with no main service is refused', async () => {
  const db = world();
  const { status } = await create(db, [{ primary_service: '', addons: ['Beard'] }]);
  assert.equal(status, 400);
  assert.equal(db.table('BookingRequest').length, 0);
});