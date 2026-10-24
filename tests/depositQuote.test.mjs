// The Review step asks the server what deposit it will be asked for, before submitting; and email is optional.
// The quote is advisory and read-only. The booking creator still decides, from the stored data, and never
// reads a deposit from the request. No network, no real database: an in-memory one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { loadEntry } from './helpers/loadEntry.mjs';
import { makeMemDb } from './helpers/memDb.mjs';

const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: (k) => (globalThis.__secrets || {})[k] };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { validateBookingInput } = await import('../base44/shared/publicBookingValidators.ts');
const { lookupWebsiteClient, resolveWebsiteClient } = await import('../base44/shared/websiteClient.ts');
const { evaluateProtection, resolveProtectionRules } = await import('../base44/shared/bookingProtection.ts');
const { DEPOSIT_QUOTE_LINE } = await import('../base44/shared/depositQuote.ts');

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const AREA = {
  id: 'z1', name: 'St George', active: true, team_member_id: 'tm1', team_member_name: 'Alvaro',
  latitude: -33.95, longitude: 151.1, radius_km: 25, colour: '#8B5CF6', sort_order: 1,
  service_days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => ({ day_of_week: d, enabled: true, open_time: 9, close_time: 19, max_bookings: 8 })),
};
const SERVICES = [{ id: 's1', name: 'Skin Fade', price: 45, duration_mins: 45, is_active: true }];
const RULES_ON = { id: 'dr1', enabled: true, new_client_deposit_amount: 20 };

const ymd = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
const dayName = (d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(`${d}T00:00:00Z`).getUTCDay()];
const date = ymd(4);
const BODY = {
  client_name: 'Patrick Nolan', phone: '0423987654', email: 'patrick.nolan@example.com', address: '1 Test Street, Bexley NSW',
  address_lat: -33.95, address_lng: 151.1, day: dayName(date), requested_date: date,
  services: ['Skin Fade'], participants: [{ primary_service: 'Skin Fade', addons: [] }],
  availability_window: '4pm-7pm', submission_token: 'tok-1', messaging_consent: true,
};

const world = (seed = {}) => makeMemDb({
  ServiceArea: [AREA], Service: SERVICES, DepositRules: [RULES_ON],
  BookingRules: [{ minimum_notice_hours: 0, maximum_booking_days: 60 }], BookingProtectionRules: [{ enabled: false }],
  ...seed,
});
const call = async (name, db, body, ip = '10.0.0.1') => {
  globalThis.__b44Client = () => db;
  const handler = await loadEntry(name);
  const res = await handler(new Request('https://x.test/f', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const quote = (db, body = BODY, ip) => call('publicDepositQuote', db, body, ip);
const submit = (db, body = BODY, ip) => call('submitPublicBooking', db, body, ip);
// Writes other than the rate-limit counters: everything the quote must never make.
const realWrites = (db) => db.writes.filter((w) => w.entity !== 'RateLimitHit');
const payments = (db) => db.table('BookingPayment');

const RETURNING = {
  ReminderClient: [{ id: 'c1', client_name: 'Patrick Nolan', phone: '0423987654', email: 'patrick.nolan@example.com', is_test: false }],
  BookingRequest: [{ id: 'old', client_id: 'c1', status: 'completed', created_date: '2020-01-01T00:00:00.000Z' }],
};

// ── the quote ────────────────────────────────────────────────────────────────────────────────────────

test('a first-time customer is quoted the amount, with one fixed line and nothing else', async () => {
  const { status, json } = await quote(world());
  assert.equal(status, 200);
  assert.deepEqual(json, { required: true, amount: 20, line: DEPOSIT_QUOTE_LINE });
});

test('the quote creates nothing: no client, booking, payment or audit row', async () => {
  const db = world();
  const before = ['ReminderClient', 'BookingRequest', 'BookingPayment', 'ActivityLog'].map((e) => db.table(e).length);
  await quote(db);
  await quote(db, { ...BODY, client_name: 'Someone Else', phone: '0411222333' });
  assert.deepEqual(['ReminderClient', 'BookingRequest', 'BookingPayment', 'ActivityLog'].map((e) => db.table(e).length), before);
  assert.deepEqual(realWrites(db), [], 'not one write apart from the rate-limit counter');
});

test('a returning customer with no deposit due sees nothing, identical to every other "no"', async () => {
  const returning = (await quote(world(RETURNING))).json;
  const rulesOff = (await quote(world({ DepositRules: [{ ...RULES_ON, enabled: false }] }))).json;
  const testName = (await quote(world(), { ...BODY, client_name: 'Sam TEST' })).json;
  const notABooking = (await quote(world(), { client_name: 'x' })).json;
  assert.deepEqual(returning, { required: false, amount: 0 });
  assert.deepEqual(rulesOff, returning);
  assert.deepEqual(testName, returning);
  assert.deepEqual(notABooking, returning);
});

test('the response never carries a no-show count, a client id, a match flag or a reason', async () => {
  const noShows = [1, 2, 3].map((i) => ({ id: `ns${i}`, client_id: 'c1', booking_request_id: `b${i}` }));
  const db = world({ ...RETURNING, NoShowRecord: noShows, DepositRules: [{ ...RULES_ON, min_no_shows: 3, no_show_deposit_amount: 35 }] });
  const { json } = await quote(db);
  assert.deepEqual(json, { required: true, amount: 35, line: DEPOSIT_QUOTE_LINE });
  assert.doesNotMatch(JSON.stringify(json), /no-show|no_show|c1|client|match|found|new|earlier|\b3\b/i);
  // The same fixed line for a brand-new customer: it cannot say why.
  assert.equal((await quote(world())).json.line, json.line);
});

test('the quote needs both a real name and a real mobile: without them it answers like "no"', async () => {
  for (const bad of [{ phone: '123' }, { phone: '' }, { client_name: '' }, { client_name: 'A' }]) {
    assert.deepEqual((await quote(world(), { ...BODY, ...bad })).json, { required: false, amount: 0 }, JSON.stringify(bad));
  }
});

test('after-hours and group bookings are quoted by the same rules the booking uses', async () => {
  const db = world({ DepositRules: [{ ...RULES_ON, new_client_deposit_amount: 0, after_hours_deposit_amount: 15 }] });
  assert.equal((await quote(db, { ...BODY, after_hours_mode: 'come_to_me', after_hours_slot: '7:30pm' })).json.amount, 15);
  assert.equal((await quote(db)).json.required, false);
});

// ── one number in three places ───────────────────────────────────────────────────────────────────────

test('one number: the quote, the confirmation and the stored deposit are equal', async () => {
  const quoted = (await quote(world())).json;
  const db = world();
  const { json } = await submit(db);
  assert.equal(json.success, true, JSON.stringify(json));
  assert.equal(quoted.required, true);
  assert.equal(json.deposit.required, true);
  assert.equal(quoted.amount, json.deposit.amount);
  assert.equal(payments(db).length, 1);
  assert.equal(payments(db)[0].deposit_amount, quoted.amount);
});

test('one number for a returning customer too: nothing quoted, nothing charged', async () => {
  const quoted = (await quote(world(RETURNING))).json;
  const db = world(RETURNING);
  const { json } = await submit(db);
  assert.equal(quoted.required, false);
  assert.equal(json.deposit.required, false);
  assert.equal(payments(db)[0].deposit_amount, 0);
});

test('a test booking never needs a deposit, at the quote or at the booking', async () => {
  const body = { ...BODY, client_name: 'Sam TEST', email: 'sam@example.com' };
  assert.equal((await quote(world(), body)).json.required, false);
  const db = world();
  const { json } = await submit(db, body);
  assert.equal(json.success, true);
  assert.equal(json.deposit.required, false);
  assert.equal(payments(db)[0].deposit_amount, 0);
});

// ── the server decides ───────────────────────────────────────────────────────────────────────────────

test('a forged deposit in the request changes nothing the server decides', async () => {
  const db = world();
  const { json } = await submit(db, { ...BODY, deposit_amount: 0, deposit: { required: false, amount: 0 }, deposit_required: false, quote: { amount: 0 } });
  assert.equal(json.deposit.amount, 20);
  assert.equal(payments(db)[0].deposit_amount, 20);
  assert.equal(payments(db)[0].state, 'deposit_due');
});

test('source guard: the create path never reads a deposit figure from the request', () => {
  for (const f of ['base44/shared/publicBookingCreate.ts', 'base44/shared/paymentService.ts', 'base44/functions/submitPublicBooking/entry.ts']) {
    const src = read(f);
    assert.doesNotMatch(src, /body\??\.(deposit|quote)/i, `${f} reads no deposit from the body`);
    assert.doesNotMatch(src, /depositQuote|publicDepositQuote/, `${f} knows nothing of the quote`);
  }
  // And the browser does not send its quote back: the submit payload is built before, and apart from, it.
  const book = read('src/pages/Book.jsx');
  const submitFn = book.slice(book.indexOf('const handleSubmit'), book.indexOf('const reset'));
  assert.doesNotMatch(submitFn, /depositQuote/);
  assert.doesNotMatch(book.slice(book.indexOf('const buildBookingFields'), book.indexOf('const depositQuote')), /deposit/i);
});

test('source guard: the browser holds no copy of the deposit rules', () => {
  for (const f of ['src/hooks/useDepositQuote.js', 'src/pages/Book.jsx', 'src/components/booking/steps/ReviewStep.jsx']) {
    assert.doesNotMatch(read(f), /new_client_deposit_amount|evaluateDeposit|min_no_shows/, f);
  }
});

// ── a quote never blocks a booking ───────────────────────────────────────────────────────────────────

test('source guard: a failed, slow or empty quote leaves Submit untouched', () => {
  const hookSrc = read('src/hooks/useDepositQuote.js');
  assert.match(hookSrc, /QUOTE_TIMEOUT_MS/, 'it gives up after a timeout');
  assert.match(hookSrc, /\.catch\(\(\) => \{/, 'an error is swallowed');
  const review = read('src/components/booking/steps/ReviewStep.jsx');
  assert.match(review, /disabled=\{submitting\}/, 'Submit is disabled by submitting alone');
  assert.doesNotMatch(review, /disabled=\{[^}]*depositQuote/);
  // The confirmation screen still reads the server's answer from the booking response.
  assert.match(read('src/pages/Book.jsx'), /setDeposit\(res\?\.data\?\.deposit \|\| null\)/);
});

test('the endpoint failing does not stop a booking from being made', async () => {
  const db = world();
  const down = { ...db, entities: new Proxy({}, { get: (_t, n) => (n === 'RateLimitHit' ? { filter: async () => { throw new Error('down'); } } : db.entities[n]) }) };
  down.asServiceRole = { entities: down.entities };
  globalThis.__b44Client = () => down;
  const res = await (await loadEntry('publicDepositQuote'))(new Request('https://x.test/f', { method: 'POST', body: JSON.stringify(BODY) }));
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { error: 'Quote unavailable.' });
  const { json } = await submit(world());
  assert.equal(json.success, true);
});

// ── rate limit ───────────────────────────────────────────────────────────────────────────────────────

test('the quote is rate-limited per connection, and never uses a booking allowance', async () => {
  const db = world({ BookingProtectionRules: [{ enabled: true, max_per_ip_hour: 1, max_per_phone_hour: 1 }] });
  const statuses = [];
  for (let i = 0; i < 14; i++) statuses.push((await quote(db, BODY, '10.9.9.9')).status);
  assert.deepEqual([...new Set(statuses.slice(0, 12))], [200]);
  assert.equal(statuses[12], 429);
  // Another connection is unaffected.
  assert.equal((await quote(db, BODY, '10.8.8.8')).status, 200);
  // Fourteen quotes later the same connection still has its whole booking allowance.
  const { json } = await submit(db, BODY, '10.9.9.9');
  assert.equal(json.success, true);
  const created = db.table('BookingRequest').find((b) => b.id === json.id);
  assert.notEqual(created.protection_hold, true, 'the quotes were not counted as bookings');
  assert.ok(db.table('RateLimitHit').every((r) => r.bucket.startsWith('public_deposit_quote|')), 'only its own counters');
});

// ── email is optional ────────────────────────────────────────────────────────────────────────────────

test('the validator: no email is fine, a malformed one is not', () => {
  const noEmail = { ...BODY }; delete noEmail.email;
  assert.equal(validateBookingInput(noEmail).valid, true);
  assert.equal(validateBookingInput({ ...BODY, email: '' }).valid, true);
  assert.equal(validateBookingInput({ ...BODY, email: '   ' }).valid, true);
  assert.equal(validateBookingInput({ ...BODY, email: 'patrick@' }).valid, false);
  assert.equal(validateBookingInput({ ...BODY, email: 'not an email' }).valid, false);
});

test('a booking with no email is saved, and its client is created with an empty email', async () => {
  const db = world();
  const body = { ...BODY }; delete body.email;
  const { status, json } = await submit(db, body);
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.success, true);
  const [client] = db.table('ReminderClient');
  assert.equal(client.email, '');
  assert.equal(db.table('BookingRequest')[0].email_normalised, null);
  assert.equal(payments(db).length, 1, 'payment is unaffected by there being no email');
});

test('a booking with a malformed email is still refused, and nothing is written', async () => {
  const db = world();
  const { status, json } = await submit(db, { ...BODY, email: 'patrick@' });
  assert.equal(status, 400);
  assert.equal(json.error, 'Validation failed');
  assert.deepEqual(realWrites(db), []);
});

test('two email-less bookings from different phones never count towards each other', async () => {
  const rules = [{ enabled: true, max_per_email_hour: 1, max_per_ip_hour: 0, max_per_phone_hour: 0 }];
  const db = world({ BookingProtectionRules: rules });
  const a = { ...BODY, email: '', phone: '0423987654', client_name: 'Patrick Nolan', submission_token: 'a' };
  const b = { ...BODY, email: '', phone: '0411222333', client_name: 'Marcus Webb', submission_token: 'b' };
  const first = await submit(db, a);
  const second = await submit(db, b);
  assert.equal(first.json.success, true); assert.equal(second.json.success, true);
  for (const r of db.table('BookingRequest')) assert.notEqual(r.protection_hold, true, `${r.client_name} was not flagged`);
  // The limit itself is live: a real address already used this hour IS counted.
  const db2 = world({ BookingProtectionRules: rules, BookingRequest: [{ id: 'earlier', email_normalised: 'same@example.com', created_date: new Date().toISOString() }] });
  const third = await submit(db2, { ...b, email: 'same@example.com' });
  assert.equal(db2.table('BookingRequest').find((r) => r.id === third.json.id).protection_hold, true);
});

test('the protection rule itself: an empty address is never "the same customer"', () => {
  const rules = resolveProtectionRules({ enabled: true, max_per_email_hour: 1 });
  const signals = { phoneHour: 0, emailHour: 5, ipHour: 0, activeUnconfirmed: 0, distinctNamesDay: 1, declinedRepeatHoursAgo: null };
  const base = { rules, signals, location: {} };
  const named = { name: 'Patrick Nolan', phone: '0423987654' };
  assert.deepEqual(evaluateProtection({ ...base, contact: { ...named, email: '' } }).codes, []);
  assert.deepEqual(evaluateProtection({ ...base, contact: { ...named, email: undefined } }).codes, []);
  assert.deepEqual(evaluateProtection({ ...base, contact: { ...named, email: 'a@b.com' } }).codes, ['rate_email']);
});

// ── identity matching ────────────────────────────────────────────────────────────────────────────────

test('a returning customer is matched on phone with no email, and on email when the phone changed', async () => {
  const db = world(RETURNING);
  const noEmail = await lookupWebsiteClient(db.asServiceRole, { phone: '0423 987 654', email: '' }, false);
  assert.deepEqual(noEmail, { status: 'linked', client_id: 'c1', matched_by: 'phone' });
  const newPhone = await lookupWebsiteClient(db.asServiceRole, { phone: '0455000111', email: 'Patrick.Nolan@example.com' }, false);
  assert.deepEqual(newPhone, { status: 'linked', client_id: 'c1', matched_by: 'email' });
  // Nobody known: no phone match, and no email to fall back on.
  assert.equal(await lookupWebsiteClient(db.asServiceRole, { phone: '0455000111', email: '' }, false), null);
  assert.deepEqual(realWrites(db), [], 'looking up writes nothing');
});

test('the read-only lookup and the creating resolver agree on who the customer is', async () => {
  const two = { ReminderClient: [
    { id: 'c1', client_name: 'A', phone: '0423987654', email: 'a@x.com', created_date: '2020-01-01' },
    { id: 'c2', client_name: 'B', phone: '0423987654', email: 'b@x.com', created_date: '2020-01-02' },
  ] };
  for (const s of [{ phone: '0423987654', email: 'b@x.com' }, { phone: '0423987654', email: '' }, { phone: '0400000000', email: 'a@x.com' }, { phone: '0400000000', email: '' }]) {
    const db = world(two);
    const looked = await lookupWebsiteClient(db.asServiceRole, s, false);
    const resolved = await resolveWebsiteClient(world(two).asServiceRole, { ...s, client_name: 'N', participants: [] }, false);
    assert.equal(looked?.status ?? 'created', resolved.status, JSON.stringify(s));
    assert.equal(looked?.client_id ?? null, resolved.status === 'created' ? null : resolved.client_id, JSON.stringify(s));
  }
});

test('the Details and Review steps say the email is optional and only check one that is given', () => {
  assert.match(read('src/components/booking/steps/DetailsStep.jsx'), /Email Address[\s\S]{0,80}\(optional\)/);
  assert.match(read('src/components/booking/steps/ReviewStep.jsx'), /Email Address <span[^>]*>\(optional\)/);
  assert.match(read('src/pages/Book.jsx'), /if \(email\.trim\(\) && !validateEmail\(email\)\)/);
  assert.match(read('src/components/booking/steps/ReviewStep.jsx'), /editForm\.email\.trim\(\) && !validateEmailFmt/);
});