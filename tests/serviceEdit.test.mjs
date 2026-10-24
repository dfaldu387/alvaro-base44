// Calendar side-panel service edits: services and participants can never disagree (sheet 11).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planFlatServiceEdit, buildCatalogue, recalculateBookingItems } from '../base44/shared/bookingItems.ts';

const SERVICES = [
  { name: 'Skin Fade', price: 45, duration_mins: 45, is_active: true },
  { name: 'Beard Trim', price: 20, duration_mins: 20, is_active: true },
];
const ADDONS = [{ name: 'Eyebrow Clean', price_adjustment: 10, duration_adjustment: 10, is_active: true }];
const ADDON_NAMES = ADDONS.map((a) => a.name);
const catalogue = buildCatalogue(SERVICES, ADDONS);
const settings = {};

test('single booking: participants are rebuilt from the same list as services', () => {
  const plan = planFlatServiceEdit({
    currentParticipants: [{ primary_service: 'Skin Fade', addons: [] }],
    services: ['Skin Fade', 'Eyebrow Clean'],
    addonNames: ADDON_NAMES,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.participants, [{ primary_service: 'Skin Fade', addons: ['Eyebrow Clean'] }]);

  const items = recalculateBookingItems({ services: ['Skin Fade', 'Eyebrow Clean'], participants: plan.participants, catalogue, settings });
  assert.deepEqual(items.names, ['Skin Fade', 'Eyebrow Clean']);
  assert.equal(items.durationMins, 55);
  assert.equal(items.totalPrice, 55);
  assert.equal(items.peopleCount, 1);
});

test('single booking: the occupancy fed by participants equals the price/length fed by services', () => {
  const services = ['Beard Trim'];
  const plan = planFlatServiceEdit({ currentParticipants: [], services, addonNames: ADDON_NAMES });
  assert.equal(plan.ok, true);
  const fromParticipants = recalculateBookingItems({ services: [], participants: plan.participants, catalogue, settings });
  const fromServices = recalculateBookingItems({ services, participants: [], catalogue, settings });
  assert.equal(fromParticipants.durationMins, fromServices.durationMins);
  assert.equal(fromParticipants.totalPrice, fromServices.totalPrice);
});

test('a stale participants record is replaced, not kept', () => {
  const plan = planFlatServiceEdit({
    currentParticipants: [{ primary_service: 'Skin Fade', addons: ['Eyebrow Clean'] }],
    services: ['Beard Trim'],
    addonNames: ADDON_NAMES,
  });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.participants, [{ primary_service: 'Beard Trim', addons: [] }]);
});

test('group booking: the edit is refused with a readable reason', () => {
  const plan = planFlatServiceEdit({
    currentParticipants: [{ primary_service: 'Skin Fade', addons: [] }, { primary_service: 'Beard Trim', addons: [] }],
    services: ['Skin Fade'],
    addonNames: ADDON_NAMES,
  });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /group booking/i);
  assert.match(plan.error, /Edit on the booking in Bookings/);
});

test('a list needing a second person is refused rather than flattened', () => {
  const plan = planFlatServiceEdit({
    currentParticipants: [{ primary_service: 'Skin Fade', addons: [] }],
    services: ['Skin Fade', 'Beard Trim'],
    addonNames: ADDON_NAMES,
  });
  assert.equal(plan.ok, false);
  assert.match(plan.error, /more than one person/i);
});

test('the server runs the plan before any save, and the panel never writes the booking itself', () => {
  const entry = readFileSync('base44/functions/updateBookingRequest/entry.ts', 'utf8');
  assert.ok(entry.indexOf('planFlatServiceEdit(') < entry.indexOf('recalculateBookingItems({'));
  assert.match(entry, /GROUP_EDIT_REFUSED/);
  for (const f of ['AppointmentDetailPanel', 'AppointmentDetail']) {
    const src = readFileSync(`src/components/schedule/${f}.jsx`, 'utf8');
    assert.doesNotMatch(src, /participants: \[\]/, f);
    assert.match(src, /isGroup/, f);
  }
});