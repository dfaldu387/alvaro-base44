// Admin-created bookings and the client merge. Both used to be written straight from the
// browser: a lost response produced a second booking, and the merge rewrote by NAME.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { loadEntry } from './helpers/loadEntry.mjs';
import { makeMemDb } from './helpers/memDb.mjs';

const createAdmin = await loadEntry('createAdminBooking');
const mergeEntry = await loadEntry('mergeClients');

const root = new URL('../', import.meta.url);
const SERVICES = [{ id: 's1', name: 'Skin Fade', price: 45, duration_mins: 45, is_active: true }];
const ymd = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const BODY = {
  client_name: 'Jo Bloggs', phone: '0412 345 678', email: 'jo@example.com', address: '1 Test St',
  requested_date: ymd(5), availability_window: '9am–12pm', service_items: [{ name: 'Skin Fade', qty: 1 }],
};

const asUser = (db, user = { id: 'u1', email: 'a@x.test', full_name: 'Alvaro', role: 'admin' }) => {
  globalThis.__b44Client = () => ({ auth: { me: async () => user }, entities: db.entities, asServiceRole: db.asServiceRole });
};
const post = (handler, body) => handler(new Request('https://app.test/f', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify(body) }));
const create = async (db, body, token = 'tok-1') => {
  asUser(db);
  const res = await post(createAdmin, { ...body, submission_token: token });
  return { status: res.status, json: await res.json() };
};
const world = (seed = {}) => makeMemDb({ Service: SERVICES, ...seed });
const bookings = (db) => db.table('BookingRequest');

// A database whose named entity methods are replaced.
const wrap = (db, over) => {
  const entities = new Proxy({}, { get: (_t, name) => { const e = db.entities[name]; return over[name] ? { ...e, ...over[name](e) } : e; } });
  return { ...db, entities, asServiceRole: { entities } };
};

// ── Creating ─────────────────────────────────────────────────────────────────────────────────
test('saving twice with the same token produces one booking, and the second save returns the first id', async () => {
  const db = world();
  const a = await create(db, BODY);
  const b = await create(db, BODY);
  assert.equal(a.status, 200);
  assert.equal(bookings(db).length, 1);
  assert.equal(b.json.id, a.json.id);
  assert.equal(b.json.duplicate, true);
});

test('closing and reopening (a new token) with the same details is a second booking', async () => {
  const db = world();
  const a = await create(db, BODY, 'tok-1');
  const b = await create(db, BODY, 'tok-2');
  assert.notEqual(a.json.id, b.json.id);
  assert.equal(bookings(db).length, 2);
});

test('a token lookup that fails is an error and creates nothing', async () => {
  const db = world();
  const broken = wrap(db, { BookingRequest: (e) => ({ filter: async (q, ...rest) => { if (q?.submission_token) throw new Error('lookup down'); return e.filter(q, ...rest); } }) });
  const { status, json } = await create(broken, BODY);
  assert.ok(status >= 500, `expected an error, got ${status}`);
  assert.equal(json.retryable, true);
  assert.equal(bookings(db).length, 0);
});

test('a save with no token is refused, never guessed', async () => {
  const db = world();
  asUser(db);
  const res = await post(createAdmin, BODY);
  assert.equal(res.status, 400);
  assert.equal(bookings(db).length, 0);
});

test('price, duration and group size sent by the browser are ignored; the catalogue decides', async () => {
  const db = world();
  const { json } = await create(db, { ...BODY, price: 1, duration_mins: 1, people_count: 9, group_discount: 99, location_tier: 'priority' });
  const row = bookings(db).find((r) => r.id === json.id);
  assert.equal(row.price, 45);
  assert.equal(row.duration_mins, 45);
  assert.equal(row.people_count, 1);
  assert.equal(row.group_discount, 0);
  assert.notEqual(row.location_tier, 'priority');
});

test('a service that is not in the catalogue is refused by name', async () => {
  const db = world();
  const { status, json } = await create(db, { ...BODY, service_items: [{ name: 'Made Up Cut', qty: 1 }] });
  assert.equal(status, 400);
  assert.match(json.error, /Made Up Cut/);
  assert.equal(bookings(db).length, 0);
});

test('an admin-created booking writes one audit row naming the person, and a retry does not add another', async () => {
  const db = world();
  await create(db, BODY);
  await create(db, BODY);
  const rows = db.table('ActivityLog').filter((r) => r.action === 'booking_created_by_admin');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_name, 'Alvaro');
  assert.equal(rows[0].related_record_id, bookings(db)[0].id);
});

test('if the audit row cannot be written the page gets a retryable error, and the retry completes it without a second booking', async () => {
  const db = world();
  let fail = true;
  const flaky = wrap(db, { ActivityLog: (e) => ({ create: async (d) => { if (fail) throw new Error('log down'); return e.create(d); } }) });
  const first = await create(flaky, BODY);
  assert.ok(first.status >= 500);
  fail = false;
  const second = await create(flaky, BODY);
  assert.equal(second.status, 200);
  assert.equal(bookings(db).length, 1);
  assert.equal(db.table('ActivityLog').filter((r) => r.action === 'booking_created_by_admin').length, 1);
});

test('test data is decided server-side: a last name of TEST is a test booking', async () => {
  const db = world();
  const { json } = await create(db, { ...BODY, client_name: 'Jo TEST', is_test: false });
  assert.equal(bookings(db).find((r) => r.id === json.id).is_test, true);
  const real = await create(db, { ...BODY, is_test: true }, 'tok-r');
  assert.notEqual(bookings(db).find((r) => r.id === real.json.id).is_test, true);
});

test('a test booking cannot be linked to a real client, nor a real one to a test client', async () => {
  const db = world({ ReminderClient: [{ id: 'c-real', client_name: 'Jo Bloggs' }, { id: 'c-test', client_name: 'Jo TEST', is_test: true }] });
  const a = await create(db, { ...BODY, client_name: 'Jo TEST', client_id: 'c-real' }, 'k1');
  const b = await create(db, { ...BODY, client_id: 'c-test' }, 'k2');
  assert.equal(a.status, 409);
  assert.equal(b.status, 409);
  assert.equal(bookings(db).length, 0);
  const ok = await create(db, { ...BODY, client_id: 'c-real' }, 'k3');
  assert.equal(bookings(db).find((r) => r.id === ok.json.id).client_id, 'c-real');
});

test('creating sends no customer text and no deposit request (as before)', async () => {
  const db = world();
  await create(db, BODY);
  assert.equal(db.table('MessageOutbox').length, 0);
  assert.equal(db.table('BookingPayment').length, 0);
});

test('Block Time still creates "[BLOCK] …", confirmed, price 0, in the shape the sync and the public page read', async () => {
  const db = world();
  const { json } = await create(db, { kind: 'block', day: 'Thursday', requested_date: ymd(5), start: 12, end: 13, reason: 'Lunch', notes: 'n', price: 500 });
  const row = bookings(db).find((r) => r.id === json.id);
  assert.equal(row.client_name, '[BLOCK] Lunch');
  assert.deepEqual([row.phone, row.status, row.price, row.assigned_time, row.duration_mins, row.availability_window, row.services[0]], ['BLOCK', 'confirmed', 0, '12:00pm', 60, '12:00pm–1:00pm', 'Lunch']);
  assert.notEqual(row.is_test, true);
  const again = await create(db, { kind: 'block', day: 'Thursday', requested_date: ymd(5), start: 12, end: 13, reason: 'Lunch' });
  assert.equal(again.json.id, json.id);
  assert.equal(bookings(db).length, 1);
});

test('an anonymous caller cannot create anything', async () => {
  const db = world();
  asUser(db);
  const res = await createAdmin(new Request('https://app.test/f', { method: 'POST', body: JSON.stringify({ ...BODY, submission_token: 't' }) }));
  assert.equal(res.status, 401);
  assert.equal(bookings(db).length, 0);
});

// ── Source guards ────────────────────────────────────────────────────────────────────────────
const walk = (dir) => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(`${dir}${d.name}/`) : [`${dir}${d.name}`]);
test('nothing under src/ creates or bulk-rewrites a BookingRequest', () => {
  for (const f of walk('src/').filter((p) => /\.(jsx?|tsx?)$/.test(p))) {
    const src = readFileSync(new URL(f, root), 'utf8');
    assert.doesNotMatch(src, /entities\.BookingRequest\.(create|updateMany|bulkCreate)/, f);
  }
});

// ── Merging ──────────────────────────────────────────────────────────────────────────────────
const merge = async (db, survivor = 'keep', dup = 'dup') => {
  asUser(db);
  const res = await post(mergeEntry, { survivor_id: survivor, duplicate_id: dup });
  return { status: res.status, json: await res.json() };
};
const clients = (over = {}) => [
  { id: 'keep', client_name: 'Sam Lee', phone: '0412345678', email: 'sam@keep.test', ...over.keep },
  { id: 'dup', client_name: 'Sam Lee', phone: '0412 345 678', email: 'old@dup.test', ...over.dup },
];
const mergeWorld = (extraBookings = [], over = {}) => makeMemDb({
  ReminderClient: clients(over),
  BookingRequest: [
    { id: 'b-open', client_id: 'dup', client_name: 'Sam Lee', phone: '0400000000', email: 'old@dup.test', status: 'pending' },
    { id: 'b-done', client_id: 'dup', client_name: 'Sam Lee', phone: '0411111111', email: 'day@used.test', status: 'completed' },
    { id: 'b-noshow', client_id: 'dup', client_name: 'Sam Lee', phone: '0411111112', email: 'ns@used.test', status: 'no_show' },
    { id: 'b-other', client_id: 'other', client_name: 'Sam Lee', phone: '0499999999', email: 'other@sam.test', status: 'pending' },
    { id: 'b-nolink', client_name: 'Sam Lee', phone: '0488888888', email: 'nolink@sam.test', status: 'pending' },
    ...extraBookings,
  ],
});

test('the same name with different phone numbers is refused with a readable reason, and nothing changes', async () => {
  const db = mergeWorld([], { dup: { phone: '0499 000 111' } });
  const { status, json } = await merge(db);
  assert.equal(status, 409);
  assert.match(json.error, /different phone numbers/);
  assert.equal(db.table('ReminderClient').length, 2);
  assert.equal(db.writes.length, 0);
});

test('a merge moves only bookings whose client id is the duplicate; a booking with no id is reported and left alone', async () => {
  const db = mergeWorld();
  const { json } = await merge(db);
  assert.equal(json.merged, true);
  const by = (id) => bookings(db).find((b) => b.id === id);
  assert.equal(by('b-open').client_id, 'keep');
  assert.equal(by('b-open').phone, '0412345678');
  assert.equal(by('b-other').client_id, 'other', 'another person with the same name is untouched');
  assert.equal(by('b-other').phone, '0499999999');
  assert.equal(by('b-nolink').client_id, undefined);
  assert.equal(by('b-nolink').phone, '0488888888');
  assert.equal(json.bookings_without_client_id_left_alone, 1);
  assert.equal(json.bookings_moved, 3);
  assert.deepEqual(db.table('ReminderClient').map((c) => c.id), ['keep']);
});

test('completed and no-show bookings keep the phone and email they were taken with', async () => {
  const db = mergeWorld();
  await merge(db);
  const done = bookings(db).find((b) => b.id === 'b-done');
  const ns = bookings(db).find((b) => b.id === 'b-noshow');
  assert.deepEqual([done.client_id, done.phone, done.email], ['keep', '0411111111', 'day@used.test']);
  assert.deepEqual([ns.client_id, ns.phone, ns.email], ['keep', '0411111112', 'ns@used.test']);
});

test('a merge writes one audit row with both client ids, the count moved, and who did it', async () => {
  const db = mergeWorld();
  await merge(db);
  const rows = db.table('ActivityLog').filter((r) => r.action === 'clients_merged');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].actor_name, 'Alvaro');
  assert.equal(rows[0].outcome, 'applied');
  assert.deepEqual([rows[0].details_json.ids.survivor_client_id, rows[0].details_json.ids.duplicate_client_id], ['keep', 'dup']);
  assert.equal(rows[0].details_json.counts.bookings_moved, 3);
});

test('a merge that fails while moving bookings leaves every client and booking as it was', async () => {
  const db = mergeWorld();
  const before = JSON.stringify(bookings(db));
  let calls = 0;
  const flaky = wrap(db, { BookingRequest: (e) => ({ bulkUpdate: async (rows) => { calls++; await e.bulkUpdate(rows); if (calls === 1) throw new Error('write failed after applying'); return rows; } }) });
  const { status, json } = await merge(flaky);
  assert.equal(status, 500);
  assert.equal(json.merged, false);
  assert.equal(JSON.stringify(bookings(db)), before);
  assert.deepEqual(db.table('ReminderClient').map((c) => c.id), ['keep', 'dup']);
});

test('a merge whose final delete fails puts the bookings back and keeps both clients', async () => {
  const db = mergeWorld();
  const before = JSON.stringify(bookings(db));
  const flaky = wrap(db, { ReminderClient: () => ({ delete: async () => { throw new Error('delete failed'); } }) });
  const { status, json } = await merge(flaky);
  assert.equal(status, 500);
  assert.equal(json.merged, false);
  assert.equal(JSON.stringify(bookings(db)), before);
  assert.deepEqual(db.table('ReminderClient').map((c) => c.id), ['keep', 'dup']);
});

test('with no audit row there is no merge', async () => {
  const db = mergeWorld();
  const noLog = wrap(db, { ActivityLog: () => ({ create: async () => { throw new Error('log down'); } }) });
  const { status } = await merge(noLog);
  assert.equal(status, 500);
  assert.equal(db.table('ReminderClient').length, 2);
  assert.equal(db.writes.filter((w) => w.entity === 'BookingRequest').length, 0);
});

test('a test client cannot be merged into a real one, nor the reverse', async () => {
  const a = mergeWorld([], { dup: { is_test: true } });
  assert.match((await merge(a)).json.error, /test client/i);
  const b = mergeWorld([], { keep: { is_test: true } });
  assert.match((await merge(b)).json.error, /test client/i);
  assert.equal(a.table('ReminderClient').length, 2);
});

test('a client cannot be merged into itself', async () => {
  const db = mergeWorld();
  assert.equal((await merge(db, 'keep', 'keep')).status, 409);
});

test('only an administrator can merge', async () => {
  const db = mergeWorld();
  asUser(db, { id: 'u2', email: 'cust@x.test', role: 'user' });
  const res = await post(mergeEntry, { survivor_id: 'keep', duplicate_id: 'dup' });
  assert.equal(res.status, 403);
  assert.equal(db.table('ReminderClient').length, 2);
});

// ── Merge across every entity read by client_id ──────────────────────────────────────────────
const ENTITIES = ['NoShowRecord', 'BookingPayment', 'Message', 'CampaignEntry', 'WorkflowItem', 'RecurringSetup', 'Appointment', 'BookingReplyFlag', 'UnmatchedReply', 'AssistantConversation'];
const LABEL = { NoShowRecord: 'no_show_records', BookingPayment: 'booking_payments', Message: 'messages', CampaignEntry: 'campaign_entries', WorkflowItem: 'workflow_items', RecurringSetup: 'recurring_setups', Appointment: 'appointments', BookingReplyFlag: 'reply_flags', UnmatchedReply: 'unmatched_replies', AssistantConversation: 'assistant_conversations' };
const fullWorld = (over = {}) => makeMemDb({
  ReminderClient: clients(over),
  BookingRequest: [{ id: 'b-1', client_id: 'dup', client_name: 'Sam Lee', status: 'completed', phone: '0412345678' }],
  ...Object.fromEntries(ENTITIES.map((e) => [e, [
    { id: `${e}-dup`, client_id: 'dup', campaign_week: '2026-W40', stage: 'reminder' },
    { id: `${e}-other`, client_id: 'other', campaign_week: '2026-W40', stage: 'reminder' },
  ]])),
  ActivityLog: [{ id: 'log-1', client_id: 'dup', action: 'reminder_sent' }],
  MessageOutbox: [{ id: 'ob-1', client_id: 'dup' }],
  AssistantEvent: [{ id: 'ev-1', client_id: 'dup' }],
});

test('a merge moves every entity read by client_id, leaves other people alone, and the audit row names a count for each', async () => {
  const db = fullWorld();
  const { json } = await merge(db);
  assert.equal(json.merged, true);
  const audit = db.table('ActivityLog').find((r) => r.action === 'clients_merged');
  for (const e of ENTITIES) {
    assert.equal(db.table(e).find((r) => r.id === `${e}-dup`).client_id, 'keep', e);
    assert.equal(db.table(e).find((r) => r.id === `${e}-other`).client_id, 'other', e);
    assert.equal(audit.details_json.counts[`${LABEL[e]}_moved`], 1, e);
    assert.equal(json.moved[`${LABEL[e]}_moved`], 1, e);
  }
  assert.equal(audit.details_json.counts.bookings_moved, 1);
});

test('ActivityLog, MessageOutbox and AssistantEvent keep pointing at the duplicate on purpose: they are history and a draining queue', async () => {
  const db = fullWorld();
  await merge(db);
  assert.equal(db.table('ActivityLog').find((r) => r.id === 'log-1').client_id, 'dup');
  assert.equal(db.table('MessageOutbox')[0].client_id, 'dup');
  assert.equal(db.table('AssistantEvent')[0].client_id, 'dup');
});

test('a campaign entry the survivor already has for the same week and stage is not doubled', async () => {
  const db = fullWorld();
  db.table('CampaignEntry').push({ id: 'ce-keep', client_id: 'keep', campaign_week: '2026-W40', stage: 'reminder' });
  const { json } = await merge(db);
  assert.equal(json.campaign_entries_left_duplicate, 1);
  assert.equal(db.table('CampaignEntry').filter((r) => r.client_id === 'keep').length, 1);
});

test('two no-shows survive a merge: the survivor still counts 2 and the deposit decision is unchanged', async () => {
  const { evaluateForBooking } = await import('../base44/shared/paymentService.ts');
  const rules = { enabled: true, min_no_shows: 2, no_show_deposit_amount: 20 };
  const db = makeMemDb({
    ReminderClient: clients(),
    BookingRequest: [{ id: 'done', client_id: 'dup', status: 'completed', client_name: 'Sam Lee' }],
    NoShowRecord: [{ id: 'n1', client_id: 'dup' }, { id: 'n2', client_id: 'dup' }],
  });
  const booking = { price: 45, people_count: 1 };
  const before = await evaluateForBooking(db.asServiceRole, { ...booking, client_id: 'dup' }, rules);
  assert.deepEqual(before.rules, ['no_shows']);
  assert.match(before.reasons[0], /2 earlier no-shows/);
  assert.equal((await merge(db)).json.merged, true);
  const after = await evaluateForBooking(db.asServiceRole, { ...booking, client_id: 'keep' }, rules);
  assert.match(after.reasons[0], /2 earlier no-shows/);
  assert.deepEqual([after.required, after.amount, after.rules], [before.required, before.amount, before.rules]);
});

test('a Message re-point that fails puts every already-moved entity back, keeps the duplicate, and says nothing was changed', async () => {
  const db = fullWorld();
  const snap = () => JSON.stringify(Object.fromEntries([...ENTITIES, 'BookingRequest'].map((e) => [e, db.table(e)])));
  const before = snap();
  let hits = 0; // only the forward write fails; putting Messages back (nothing was written) succeeds
  const flaky = wrap(db, { Message: () => ({ bulkUpdate: async () => { if (++hits === 1) throw new Error('messages down'); } }) });
  const { status, json } = await merge(flaky);
  assert.equal(status, 500);
  assert.equal(json.merged, false);
  assert.equal(json.inconsistent, undefined);
  assert.match(json.error, /Nothing was changed/);
  assert.equal(snap(), before);
  assert.deepEqual(db.table('ReminderClient').map((c) => c.id), ['keep', 'dup']);
  assert.ok(db.writes.some((w) => w.entity === 'NoShowRecord'), 'NoShowRecord had been moved before the failure');
});

test('a failed delete followed by a failed read is inconsistent and never reported as merged', async () => {
  const db = fullWorld();
  let deleteTried = false;
  const flaky = wrap(db, { ReminderClient: (e) => ({
    delete: async () => { deleteTried = true; throw new Error('delete failed'); },
    get: async (id) => { if (deleteTried) throw new Error('read failed'); return e.get(id); },
  }) });
  const { status, json } = await merge(flaky);
  assert.equal(status, 500);
  assert.equal(json.inconsistent, true);
  assert.equal(json.merged, false);
  assert.equal(db.table('ActivityLog').find((r) => r.action === 'clients_merged').outcome, 'failed');
});

test('a test client cannot be merged into a real one, so none of the new entities move either', async () => {
  const db = fullWorld({ dup: { is_test: true } });
  const { status } = await merge(db);
  assert.equal(status, 409);
  for (const e of ENTITIES) assert.equal(db.table(e).find((r) => r.id === `${e}-dup`).client_id, 'dup', e);
  assert.equal(db.writes.length, 0);
});

// ── Capacity on admin creates ───────────────────────────────────────────────────────────────
test('an admin booking on a day already at its limit is created, with the capacity reason, and is not held', async () => {
  const day = ymd(5);
  const db = world({
    GroupDiscountSettings: [{ max_bookings_per_day: 2 }],
    BookingRequest: [
      { id: 'x1', requested_date: day, status: 'confirmed', client_name: 'A' },
      { id: 'x2', requested_date: day, status: 'confirmed', client_name: 'B' },
    ],
  });
  const { status, json } = await create(db, BODY);
  assert.equal(status, 200);
  assert.equal(json.capacity_status_at_submission, 'waitlist');
  assert.match(json.capacity_reason, /already has 2 confirmed bookings \(limit 2\)/);
  const row = bookings(db).find((r) => r.id === json.id);
  assert.ok(row, 'the booking was created');
  assert.notEqual(row.protection_hold, true);
  assert.notEqual(row.waitlist, true);
  assert.notEqual(row.placement_status, 'needs_review');
});

test('an admin booking on a day with room has no capacity reason', async () => {
  const db = world();
  const { json } = await create(db, BODY);
  assert.equal(json.capacity_reason, null);
  assert.equal(json.capacity_status_at_submission, 'available');
});

test('the three removed modals are gone from src/', () => {
  for (const f of walk('src/').filter((p) => /\.(jsx?|tsx?)$/.test(p))) {
    assert.doesNotMatch(readFileSync(new URL(f, root), 'utf8'), /AddRequestModal|AddBookingModal|AddClientModal/, f);
  }
});

// ── Admin client creation ───────────────────────────────────────────────────────────────────
const clientsEntry = await loadEntry('createAdminClients');
const makeClients = async (db, body, user) => {
  asUser(db, user);
  const res = await post(clientsEntry, body);
  return { status: res.status, json: await res.json() };
};
const clientRows = (db) => db.table('ReminderClient');
const audits = (db) => db.table('ActivityLog').filter((r) => r.action === 'client_created_by_admin');

test('a client named "Sam TEST" is created as a test client, and one named "Sam Lee" as a real one, whatever the browser sends', async () => {
  const db = world();
  const { json } = await makeClients(db, { clients: [{ client_name: 'Sam TEST', is_test: false }, { client_name: 'Sam Lee', is_test: true }] });
  assert.equal(json.created.length, 2);
  assert.equal(clientRows(db).find((c) => c.client_name === 'Sam TEST').is_test, true);
  assert.notEqual(clientRows(db).find((c) => c.client_name === 'Sam Lee').is_test, true);
});

test('Create Booking for a brand-new "Sam TEST" client saves, and the booking and the client are both test', async () => {
  const db = world();
  const { json: made } = await makeClients(db, { clients: [{ client_name: 'Sam TEST' }] });
  const { status, json } = await create(db, { ...BODY, client_name: 'Sam TEST', client_id: made.created[0].id });
  assert.equal(status, 200);
  assert.equal(bookings(db).find((r) => r.id === json.id).is_test, true);
  assert.equal(clientRows(db)[0].is_test, true);
});

test('Create Booking for a brand-new "Sam Lee" client saves, and both records are real', async () => {
  const db = world();
  const { json: made } = await makeClients(db, { clients: [{ client_name: 'Sam Lee' }] });
  const { status, json } = await create(db, { ...BODY, client_name: 'Sam Lee', client_id: made.created[0].id });
  assert.equal(status, 200);
  assert.notEqual(bookings(db).find((r) => r.id === json.id).is_test, true);
  assert.notEqual(clientRows(db)[0].is_test, true);
});

test('a booking for an existing real client, named with a TEST surname, is still refused', async () => {
  const db = world({ ReminderClient: [{ id: 'c-real', client_name: 'Sam Lee' }] });
  const { status } = await create(db, { ...BODY, client_name: 'Sam TEST', client_id: 'c-real' });
  assert.equal(status, 409);
  assert.equal(bookings(db).length, 0);
});

test('a matched save updates the existing client by phone and never rewrites its is_test, in either direction', async () => {
  const db = world({ ReminderClient: [
    { id: 'real', client_name: 'Sam Lee', phone: '0412345678', email: 'sam@x.test' },
    { id: 'test', client_name: 'Pat TEST', phone: '0499999999', is_test: true },
  ] });
  const a = await makeClients(db, { match_existing: true, clients: [{ client_name: 'Samuel Lee', phone: '0412 345 678' }] });
  assert.equal(a.json.created.length, 0);
  assert.equal(a.json.updated.length, 1);
  assert.notEqual(clientRows(db).find((c) => c.id === 'real').is_test, true);
  await makeClients(db, { match_existing: true, clients: [{ client_name: 'Pat TEST', phone: '0499 999 999', notes: 'x' }] });
  assert.equal(clientRows(db).find((c) => c.id === 'test').is_test, true);
  assert.equal(clientRows(db).length, 2);
});

test('a matched save by email updates instead of creating a duplicate', async () => {
  const db = world({ ReminderClient: [{ id: 'real', client_name: 'Sam Lee', email: 'sam@x.test' }] });
  const { json } = await makeClients(db, { match_existing: true, clients: [{ client_name: 'Sam Lee', email: 'SAM@x.test', notes: 'hi' }] });
  assert.equal(json.updated.length, 1);
  assert.equal(clientRows(db).length, 1);
});

test('a save never matches across the test boundary: a test save creates its own client beside a real one with the same phone', async () => {
  const db = world({ ReminderClient: [{ id: 'real', client_name: 'Sam Lee', phone: '0412345678' }] });
  const { json } = await makeClients(db, { match_existing: true, clients: [{ client_name: 'Sam TEST', phone: '0412345678' }] });
  assert.equal(json.created.length, 1);
  assert.equal(json.created[0].is_test, true);
  assert.equal(clientRows(db).find((c) => c.id === 'real').client_name, 'Sam Lee');
});

test('a CSV import with one TEST row and one ordinary row creates one of each in a single batched write', async () => {
  const db = world();
  await makeClients(db, { clients: [{ client_name: 'Ann TEST' }, { client_name: 'Bob Smith' }] });
  assert.equal(db.writes.filter((w) => w.entity === 'ReminderClient' && w.op === 'bulkCreate').length, 1);
  assert.equal(db.writes.filter((w) => w.entity === 'ReminderClient' && w.op === 'create').length, 0);
  assert.equal(clientRows(db).filter((c) => c.is_test === true).length, 1);
  assert.equal(clientRows(db).filter((c) => c.is_test !== true).length, 1);
});

test('favouriting a booking with no client creates one with the booking\'s is_test', async () => {
  const db = world({ BookingRequest: [{ id: 'b-t', client_name: 'Legacy Flagged', is_test: true }, { id: 'b-r', client_name: 'Real Person' }] });
  await makeClients(db, { clients: [{ client_name: 'Legacy Flagged', is_favourite: true, from_booking_id: 'b-t' }, { client_name: 'Real Person', is_favourite: true, from_booking_id: 'b-r' }] });
  assert.equal(clientRows(db).find((c) => c.client_name === 'Legacy Flagged').is_test, true);
  assert.notEqual(clientRows(db).find((c) => c.client_name === 'Real Person').is_test, true);
});

test('each admin-created client writes one audit row naming the person; automation is refused', async () => {
  const db = world();
  await makeClients(db, { clients: [{ client_name: 'A One' }, { client_name: 'B Two' }] });
  assert.equal(audits(db).length, 2);
  assert.ok(audits(db).every((r) => r.actor_name === 'Alvaro'));
  const refused = await makeClients(db, { clients: [{ client_name: 'C Three' }] }, { id: 'svc', role: 'service', email: 'x@y.test' });
  assert.ok(refused.status === 401 || refused.status === 403);
  assert.equal(clientRows(db).length, 2);
});

test('the browser no longer writes client records directly', () => {
  for (const f of walk('src/').filter((p) => /\.(jsx?|tsx?)$/.test(p))) {
    assert.doesNotMatch(readFileSync(new URL(f, root), 'utf8'), /ReminderClient\.(create|bulkCreate)/, f);
  }
});