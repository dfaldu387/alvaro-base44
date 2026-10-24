// Business settings: one row per entity, written only by the server, only the fields a screen owns.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { loadEntry } from './helpers/loadEntry.mjs';
import { makeMemDb } from './helpers/memDb.mjs';

const save = await loadEntry('saveSettings');
const S = await import('../base44/shared/settingsStore.ts');
const { capacityLimit } = await import('../base44/shared/publicDayFit.ts');

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const ADMIN = { id: 'u-admin', email: 'a@x.test', full_name: 'Alvaro', role: 'admin' };
const STAFF = { id: 'u-staff', email: 's@x.test', full_name: 'Sam Barber', role: 'user' };
const MEMBER = { id: 'tm1', user_id: 'u-staff', name: 'Sam Barber', status: 'Active', role: 'barber' };

const asUser = (db, user) => {
  globalThis.__b44Client = () => ({ auth: { me: async () => user }, entities: db.entities, asServiceRole: db.asServiceRole });
};
const call = async (db, entity, screen, data, { user = ADMIN, headers = {} } = {}) => {
  asUser(db, user);
  const res = await save(new Request('https://app.test/f', {
    method: 'POST', headers: { authorization: 'Bearer t', ...headers }, body: JSON.stringify({ entity, screen, data }),
  }));
  return { status: res.status, json: await res.json() };
};
const rows = (db, entity) => db.table(entity);
const audits = (db, action) => db.table('ActivityLog').filter((r) => r.action === action);

const DISCOUNTS = { enabled: true, max_group_booking_people: 6, tier_2_type: 'fixed', tier_2_amount: 12, tier_3_type: 'fixed', tier_3_amount: 25, tier_4plus_type: 'percentage', tier_4plus_amount: 15 };
const COVERAGE = { service_centre_lat: -33.9, service_centre_lng: 151.1, service_centre_address: 'Hurstville NSW', extended_radius_km: 28, maximum_service_radius_km: 40 };

// ── 1. No row, two screens at once ───────────────────────────────────────────────────────────
test('with no row, two screens saving at the same time leave ONE row holding both sets of values', async () => {
  for (let i = 0; i < 5; i++) {
    const db = makeMemDb({}, { tick: 2 });
    const [a, b, c] = await Promise.all([
      call(db, 'GroupDiscountSettings', 'availability', { max_bookings_per_day: 11 }),
      call(db, 'GroupDiscountSettings', 'coverage', COVERAGE),
      call(db, 'GroupDiscountSettings', 'discounts', DISCOUNTS),
    ]);
    assert.deepEqual([a.status, b.status, c.status], [200, 200, 200]);
    const all = rows(db, 'GroupDiscountSettings');
    assert.equal(all.length, 1, 'exactly one row');
    assert.equal(all[0].max_bookings_per_day, 11);
    assert.equal(all[0].service_centre_address, 'Hurstville NSW');
    assert.equal(all[0].maximum_service_radius_km, 40);
    assert.equal(all[0].tier_3_amount, 25);
  }
});

// ── 2. A screen never blanks another screen's fields ─────────────────────────────────────────
test('saving the coverage centre never clears max_bookings_per_day (or the discount tiers)', async () => {
  const db = makeMemDb({});
  await call(db, 'GroupDiscountSettings', 'availability', { max_bookings_per_day: 12 });
  await call(db, 'GroupDiscountSettings', 'discounts', DISCOUNTS);
  await call(db, 'GroupDiscountSettings', 'coverage', COVERAGE);
  const [row] = rows(db, 'GroupDiscountSettings');
  assert.equal(row.max_bookings_per_day, 12);
  assert.equal(row.tier_2_amount, 12);
  assert.equal(row.extended_radius_km, 28);
  assert.equal(rows(db, 'GroupDiscountSettings').length, 1);
});

test('saving the cap never clears the discount tiers or the coverage radii', async () => {
  const db = makeMemDb({});
  await call(db, 'GroupDiscountSettings', 'coverage', COVERAGE);
  await call(db, 'GroupDiscountSettings', 'discounts', DISCOUNTS);
  await call(db, 'GroupDiscountSettings', 'availability', { max_bookings_per_day: 9 });
  const [row] = rows(db, 'GroupDiscountSettings');
  assert.equal(row.tier_3_amount, 25);
  assert.equal(row.tier_4plus_type, 'percentage');
  assert.equal(row.maximum_service_radius_km, 40);
  assert.equal(row.service_centre_lat, -33.9);
  assert.equal(row.max_bookings_per_day, 9);
});

test('a screen cannot send a field it does not own, and the row is left alone', async () => {
  const db = makeMemDb({ GroupDiscountSettings: [{ id: 'g1', created_date: '2026-01-01T00:00:00Z', max_bookings_per_day: 12 }] });
  const r = await call(db, 'GroupDiscountSettings', 'discounts', { ...DISCOUNTS, max_bookings_per_day: 1 });
  assert.equal(r.status, 400);
  assert.equal(rows(db, 'GroupDiscountSettings')[0].max_bookings_per_day, 12);
  assert.equal((await call(db, 'GroupDiscountSettings', 'availability', { max_bookings_per_day: 'many' })).status, 400);
  assert.equal((await call(db, 'MessagingSettings', 'campaign', { messaging_mode: 'live' })).status, 400, 'the live switch is not a campaign field');
  assert.equal((await call(db, 'Nope', 'x', { a: 1 })).status, 400);
});

// ── 3. Damaged state: two rows ───────────────────────────────────────────────────────────────
test('with two rows present, the next save merges them into one, keeps every set value, deletes the extra, and audits it', async () => {
  const db = makeMemDb({
    GroupDiscountSettings: [
      // Oldest: has the tiers and the real cap.
      { id: 'old', created_date: '2026-09-05T00:00:00Z', updated_date: '2026-09-23T00:00:00Z', max_bookings_per_day: 14, tier_2_amount: 10, tier_3_amount: 21, enabled: true },
      // Newer: has the coverage but a DIFFERENT tier_2 and no cap and no tier_3.
      { id: 'new', created_date: '2026-10-01T00:00:00Z', updated_date: '2026-10-02T00:00:00Z', service_centre_lat: -33.9, service_centre_address: 'Hurstville NSW', tier_2_amount: 15, tier_3_amount: null, max_group_booking_people: '' },
    ],
  });
  const r = await call(db, 'GroupDiscountSettings', 'availability', { max_bookings_per_day: 16 });
  assert.equal(r.status, 200);
  const all = rows(db, 'GroupDiscountSettings');
  assert.equal(all.length, 1);
  assert.equal(all[0].id, 'old', 'the oldest row is the one kept');
  assert.equal(all[0].service_centre_address, 'Hurstville NSW', 'a value only the newer row had is kept');
  assert.equal(all[0].tier_2_amount, 15, 'newest set value wins');
  assert.equal(all[0].tier_3_amount, 21, 'a blank never overwrites a set value');
  assert.equal(all[0].max_bookings_per_day, 16, 'then the save itself applies');
  const [merged] = audits(db, 'settings_merged');
  assert.ok(merged, 'a merge audit row exists');
  assert.equal(merged.actor_name, 'Alvaro');
  assert.match(merged.detail, /tier_2_amount/);
  assert.match(merged.detail, /service_centre_address/);
  assert.equal(merged.details_json.counts.rows_deleted, 1);
});

test('a blank on the newer row never wins; the reader sees the same merged record before any save', async () => {
  const two = [
    { id: 'a', created_date: '2026-01-01T00:00:00Z', max_bookings_per_day: 14 },
    { id: 'b', created_date: '2026-02-01T00:00:00Z', max_bookings_per_day: null, service_centre_lat: 1 },
  ];
  const db = makeMemDb({ GroupDiscountSettings: two });
  const view = await S.readSettings(db.asServiceRole, 'GroupDiscountSettings');
  assert.equal(view.id, 'a');
  assert.equal(view.max_bookings_per_day, 14);
  assert.equal(view.service_centre_lat, 1);
  assert.equal(rows(db, 'GroupDiscountSettings').length, 2, 'reading changes nothing');
});

test('a per-barber discount row is a separate record and is never merged into the business row', async () => {
  const db = makeMemDb({ GroupDiscountSettings: [
    { id: 'biz', created_date: '2026-01-01T00:00:00Z', max_bookings_per_day: 9 },
    { id: 'barber', created_date: '2026-02-01T00:00:00Z', team_member_id: 'tm1', max_bookings_per_day: 3 },
  ] });
  await call(db, 'GroupDiscountSettings', 'availability', { max_bookings_per_day: 10 });
  assert.deepEqual(rows(db, 'GroupDiscountSettings').map((r) => [r.id, r.max_bookings_per_day]).sort(), [['barber', 3], ['biz', 10]]);
  assert.equal(audits(db, 'settings_merged').length, 0);
});

// ── 4. capacityLimit agrees after any screen saves ───────────────────────────────────────────
test('capacityLimit() returns the saved cap after any of the three screens saves, never the fallback 8', async () => {
  const db = makeMemDb({});
  await call(db, 'GroupDiscountSettings', 'availability', { max_bookings_per_day: 12 });
  const cap = async () => capacityLimit((await S.readSettingsList(db.asServiceRole, 'GroupDiscountSettings')).find((s) => !s.team_member_id));
  assert.equal(await cap(), 12);
  await call(db, 'GroupDiscountSettings', 'coverage', COVERAGE);
  assert.equal(await cap(), 12);
  await call(db, 'GroupDiscountSettings', 'discounts', DISCOUNTS);
  assert.equal(await cap(), 12);
  assert.equal(capacityLimit(null), 8, 'the fallback is only for no row at all');
});

// ── 5. Same guarantee on every settings entity ───────────────────────────────────────────────
const EVERY = [
  ['BookingRules', 'window', { minimum_notice_hours: 12, maximum_booking_days: 45 }, 'rules', { auto_accept_requests: true, cancellation_policy: 'Be kind' }],
  ['DepositRules', 'deposits', { enabled: true, deposit_type: 'fixed', deposit_amount: 25 }, null, null],
  ['MessagingSettings', 'campaign', { campaign_run_hour: 9, campaign_booking_link: 'https://x.test/book' }, null, null],
  ['SchedulingSettings', 'protection', { auto_lock_confirmed: false }, null, null],
  ['SchedulingBotSettings', 'bot', { enabled: true, mode: 'suggest', status: 'optimising' }, null, null],
  ['BookingProtectionRules', 'limits', { enabled: true, max_per_phone_hour: 4 }, null, null],
];
for (const [entity, screen, data, screen2, data2] of EVERY) {
  test(`${entity}: concurrent first saves leave one row; a second screen never blanks the first`, async () => {
    const db = makeMemDb({}, { tick: 2 });
    const other = screen2 ? call(db, entity, screen2, data2) : call(db, entity, screen, data);
    const results = await Promise.all([call(db, entity, screen, data), other]);
    assert.ok(results.every((r) => r.status === 200), JSON.stringify(results));
    assert.equal(rows(db, entity).length, 1);
    for (const [k, v] of Object.entries({ ...data, ...(data2 || {}) })) assert.deepEqual(rows(db, entity)[0][k], v, k);
  });
  test(`${entity}: two existing rows are reconciled into the oldest, the extra deleted and audited`, async () => {
    const [firstField] = Object.keys(data);
    const db = makeMemDb({ [entity]: [
      { id: 'o', created_date: '2026-01-01T00:00:00Z', updated_date: '2026-01-02T00:00:00Z', [firstField]: data[firstField] },
      { id: 'n', created_date: '2026-02-01T00:00:00Z', updated_date: '2026-02-02T00:00:00Z', ...Object.fromEntries(Object.entries(data).slice(1)) },
    ] });
    const r = await call(db, entity, screen, data);
    assert.equal(r.status, 200);
    assert.deepEqual(rows(db, entity).map((x) => x.id), ['o']);
    for (const [k, v] of Object.entries(data)) assert.deepEqual(rows(db, entity)[0][k], v, k);
    assert.equal(audits(db, 'settings_merged').length, 1);
  });
}

test('a save does not touch the switches owned by dedicated functions (mode, dry-run, assistant)', async () => {
  const db = makeMemDb({ MessagingSettings: [{ id: 'm', created_date: '2026-01-01T00:00:00Z', messaging_mode: 'live', campaign_dry_run: false, assistant_mode: 'live', allowlist_numbers: ['0412345678'] }] });
  await call(db, 'MessagingSettings', 'campaign', { campaign_run_hour: 8 });
  const [row] = rows(db, 'MessagingSettings');
  assert.deepEqual([row.messaging_mode, row.campaign_dry_run, row.assistant_mode, row.allowlist_numbers], ['live', false, 'live', ['0412345678']]);
});

// ── 6. Who may change settings ───────────────────────────────────────────────────────────────
test('a staff member cannot change any settings; an admin can; automation is refused', async () => {
  const db = makeMemDb({ TeamMember: [MEMBER] });
  for (const [entity, screen, data] of EVERY.map(([e, s, d]) => [e, s, d])) {
    const staff = await call(db, entity, screen, data, { user: STAFF });
    assert.equal(staff.status, 403, `${entity} staff`);
    const auto = await call(db, entity, screen, data, { headers: { 'x-workflow-run': 'r1' } });
    assert.equal(auto.status, 403, `${entity} automation`);
    assert.equal(rows(db, entity).length, 0, `${entity} nothing written`);
    assert.equal((await call(db, entity, screen, data)).status, 200, `${entity} admin`);
  }
  const customer = await call(db, 'DepositRules', 'deposits', { enabled: true }, { user: { id: 'c', email: 'c@x.test', role: 'user' } });
  assert.equal(customer.status, 403);
  asUser(db, ADMIN);
  const anon = await save(new Request('https://app.test/f', { method: 'POST', body: '{}' }));
  assert.equal(anon.status, 401);
});

// ── 7. Every change is audited ───────────────────────────────────────────────────────────────
test('every settings change writes an audit row naming the person and the fields that changed', async () => {
  const db = makeMemDb({ TeamMember: [{ id: 'own', user_id: 'u-owner', name: 'Owner Olive', status: 'Active', role: 'owner' }] });
  await call(db, 'GroupDiscountSettings', 'availability', { max_bookings_per_day: 10 }, { user: { id: 'u-owner', email: 'o@x.test', role: 'user' } });
  await call(db, 'GroupDiscountSettings', 'availability', { max_bookings_per_day: 10 });
  const [log] = audits(db, 'settings_changed');
  assert.equal(audits(db, 'settings_changed').length, 1, 'an unchanged value writes nothing and audits nothing');
  assert.equal(log.actor_name, 'Owner Olive');
  assert.match(log.summary, /Booking Availability/);
  assert.match(log.summary, /max_bookings_per_day/);
  await call(db, 'DepositRules', 'deposits', { deposit_amount: 30, enabled: true });
  const dep = audits(db, 'settings_changed').find((r) => /Deposit Rules/.test(r.summary));
  assert.equal(dep.actor_name, 'Alvaro');
  assert.match(dep.summary, /deposit_amount/);
  assert.match(dep.summary, /enabled/);
  assert.doesNotMatch(JSON.stringify(log) + JSON.stringify(dep), /@x\.test/, 'no email address in the log');
});

test('if the audit row cannot be written, nothing is changed', async () => {
  const db = makeMemDb({ SchedulingSettings: [{ id: 's', created_date: '2026-01-01T00:00:00Z', auto_lock_confirmed: true }] });
  const entities = new Proxy({}, { get: (_t, n) => (n === 'ActivityLog' ? { create: async () => { throw new Error('down'); } } : db.entities[n]) });
  globalThis.__b44Client = () => ({ auth: { me: async () => ADMIN }, entities, asServiceRole: { entities } });
  const orig = console.error; console.error = () => {};
  let res;
  try {
    res = await save(new Request('https://app.test/f', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ entity: 'SchedulingSettings', screen: 'protection', data: { auto_lock_confirmed: false } }) }));
  } finally { console.error = orig; }
  assert.equal(res.status, 500);
  assert.equal(rows(db, 'SchedulingSettings')[0].auto_lock_confirmed, true);
});

test('the audit trail page includes settings changes', () => {
  assert.match(read('src/lib/auditTrail.js'), /'settings_'/);
});

// ── 8 & 9. Source guards ─────────────────────────────────────────────────────────────────────
const walk = (dir) => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${dir}${d.name}/`) : [`${dir}${d.name}`]));

test('the browser never creates or updates a settings entity', () => {
  const re = /entities\.(GroupDiscountSettings|BookingRules|DepositRules|MessagingSettings|SchedulingSettings|SchedulingBotSettings|BookingProtectionRules)\.(create|update)/;
  const offenders = walk('src/').filter((f) => /\.(jsx?|tsx?)$/.test(f) && re.test(read(f)));
  assert.deepEqual(offenders, []);
});

test('on the server only the settings store and the dedicated switch functions write these entities', () => {
  const re = /entities\.(GroupDiscountSettings|BookingRules|DepositRules|SchedulingSettings|SchedulingBotSettings|BookingProtectionRules)\.(create|update|delete)/;
  const files = [...walk('base44/functions/'), ...walk('base44/shared/')].filter((f) => f.endsWith('.ts') && re.test(read(f)));
  assert.deepEqual(files, [], 'settings writes go through settingsStore (which uses a variable table handle)');
  // MessagingSettings: the three dedicated functions update their own switch; none of them creates.
  const create = [...walk('base44/functions/'), ...walk('base44/shared/')].filter((f) => /entities\.MessagingSettings\.create/.test(read(f)));
  assert.deepEqual(create, []);
});

test('no settings reader asks for 50 rows any more', () => {
  const offenders = [...walk('base44/functions/'), ...walk('base44/shared/')]
    .filter((f) => f.endsWith('.ts') && /GroupDiscountSettings\.list\('-created_date', 50\)/.test(read(f)));
  assert.deepEqual(offenders, []);
  assert.match(read('base44/shared/assistantBookingLive.ts'), /readSettingsList\(admin, 'GroupDiscountSettings'\)/);
});

test('no booking or client create from the browser has come back', () => {
  const files = walk('src/').filter((f) => /\.(jsx?|tsx?)$/.test(f));
  assert.deepEqual(files.filter((f) => /entities\.BookingRequest\.create/.test(read(f))), []);
  assert.deepEqual(files.filter((f) => /entities\.ReminderClient\.(create|bulkCreate)/.test(read(f))), []);
});

test('no other scheduling engine was touched', () => {
  // dayRoute.ts and routeFlowOptimiser.ts were released from this byte-lock when
  // Connect Appointments had to be fixed: the route now covers the barber's whole
  // day and every consecutive pair gets exactly one drive leg. What the lock was
  // protecting — the engines that must not change as a side effect of other work —
  // stays locked, and the released behaviour is pinned in tests/routeLegs.test.mjs.
  // routeFingerprint.ts joined them: the day a route is stamped from and the day it is
  // judged against had to become one shared rule (routeDayRows), never two.
  // schedulingValidator.ts and appointmentTiming.ts were released with the rounding
  // fix (honest travel minutes, one whole-minute 5-minute step); the behaviour is
  // pinned in tests/routeLegs.test.mjs and tests/connectedSchedule.test.mjs.
  assert.equal(execSync(
    'git diff --stat -- base44/shared/reshuffleEngine.ts base44/shared/routeFlowEngine.ts base44/shared/publicBusyBookings.ts || true',
    { cwd: root },
  ).toString().trim(), '');
});