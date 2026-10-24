// Payment security guards: roles and ownership, server-side pricing, payment-before-complete,
// webhook signature (fail closed) + replay + rate limit, refund limits, link rate limit,
// secret exposure and test-data isolation. Every key, token and id here is invented.
// No network, no database, no real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { loadEntry } from './helpers/loadEntry.mjs';
import { makeMemDb } from './helpers/memDb.mjs';

const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: (k) => (globalThis.__secrets || {})[k] };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { SQUARE_SECRETS, LIVE_SWITCH } = await import('../base44/shared/squareConfig.ts');
const { computeSquareSignature } = await import('../base44/shared/squareSignature.ts');
const { takePaymentLinkSlot, PAYMENT_LINK_LIMITS } = await import('../base44/shared/paymentRateLimit.ts');

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const NAMES = Object.values(SQUARE_SECRETS);
const KEY = 'invented-signing-key-aaaa';
const TOKEN = 'invented-access-token-zzzz';
const WEBHOOK_URL = 'https://app.test/functions/squareWebhook';
const liveSecrets = (over = {}) => ({
  ...Object.fromEntries(NAMES.map((n) => [n, `invented-${n.toLowerCase()}`])),
  [SQUARE_SECRETS.webhookKey]: KEY, [SQUARE_SECRETS.accessToken]: TOKEN,
  [SQUARE_SECRETS.environment]: 'sandbox', [LIVE_SWITCH]: 'true', ...over,
});

// ── actors ───────────────────────────────────────────────────────────────────────────────────
const ADMIN = { id: 'u-admin', email: 'admin@x.test', role: 'admin' };
const BARBER_A = { id: 'u-a', email: 'a@x.test', role: 'user' };
const BARBER_B = { id: 'u-b', email: 'b@x.test', role: 'user' };
const STRANGER = { id: 'u-s', email: 's@x.test', role: 'user' };
const team = [
  { id: 'tm-a', user_id: 'u-a', email: 'a@x.test', name: 'Barber A', role: 'barber', status: 'Active' },
  { id: 'tm-b', user_id: 'u-b', email: 'b@x.test', name: 'Barber B', role: 'barber', status: 'Active' },
];

function world(paymentOver = {}, bookingOver = {}) {
  return makeMemDb({
    TeamMember: team,
    BookingRequest: [{ id: 'b1', client_name: 'Sam', status: 'confirmed', payment_status: 'Unpaid', team_member_id: 'tm-a', requested_date: '2026-10-23', is_test: true, price: 40, ...bookingOver }],
    BookingPayment: [{
      id: 'p1', booking_request_id: 'b1', state: 'balance_due', total_amount: 40, deposit_amount: 0, amount_paid: 0, amount_refunded: 0,
      currency: 'AUD', payment_provider: 'test_double', provider_payment_id: 'SIMULATED-1', op_seq: 0, is_test: true, ...paymentOver,
    }],
  }, { tick: 1 });
}
const invoke = async (handler, db, who, body, headers = {}) => {
  globalThis.__b44Client = () => ({ auth: { me: async () => who }, entities: db.entities, asServiceRole: { entities: db.entities } });
  const h = who ? { authorization: 'Bearer invented', ...headers } : headers;
  const res = await handler(new Request('https://app.test/functions/x', { method: 'POST', headers: h, body: JSON.stringify(body) }));
  return { status: res.status, json: await res.json().catch(() => ({})), headers: res.headers };
};

const checkout = await loadEntry('routeCheckout');
const action = await loadEntry('paymentAction');
const routePay = await loadEntry('routePayment');
const webhook = await loadEntry('squareWebhook');
const health = await loadEntry('paymentsHealth');

test.beforeEach(() => { globalThis.__secrets = {}; });

// ── 1. Roles and ownership ───────────────────────────────────────────────────────────────────
test('guard 1: anonymous callers are refused by every money endpoint', async () => {
  for (const [h, body] of [[checkout, { action: 'complete' }], [routePay, { action: 'mark_cash' }], [action, { action: 'refund', outcome: 'keep', amount: 5, reason: 'abc', expected_op_seq: 0 }]]) {
    const db = world();
    const r = await invoke(h, db, null, { booking_request_id: 'b1', ...body });
    assert.equal(r.status, 401);
    assert.equal(db.writes.length, 0);
  }
});

test('guard 1: a barber cannot touch another barber\'s booking, route or payment', async () => {
  for (const act of ['pay_card', 'pay_offline', 'complete', 'edit_services', 'set_reminder']) {
    const db = world({ amount_paid: 40, state: 'paid_in_full' });
    const r = await invoke(checkout, db, BARBER_B, { booking_request_id: 'b1', action: act, method: 'Cash', services: ['X'], frequency: 'Weekly' });
    assert.equal(r.status, 403, act);
    assert.equal(db.writes.filter((w) => w.entity !== 'RateLimitHit').length, 0, `${act} wrote nothing`);
  }
  for (const act of ['send_link', 'mark_cash']) {
    const db = world();
    const r = await invoke(routePay, db, BARBER_B, { booking_request_id: 'b1', action: act });
    assert.equal(r.status, 403, act);
    assert.equal(db.writes.length, 0);
  }
});

test('guard 1: a signed-in person with no team record is refused outright', async () => {
  const db = world();
  assert.equal((await invoke(checkout, db, STRANGER, { booking_request_id: 'b1', action: 'complete' })).status, 403);
  assert.equal((await invoke(action, db, STRANGER, { booking_request_id: 'b1', action: 'mark_received', method: 'Cash' })).status, 403);
});

test('guard 1/5: refunds, waivers and manual payments are administrator only, even for the booking\'s own barber', async () => {
  for (const body of [
    { action: 'refund', outcome: 'keep', amount: 5, reason: 'test refund', expected_op_seq: 0 },
    { action: 'mark_received', method: 'Cash', amount: 5 },
    { action: 'write_off', reason: 'testing' },
    { action: 'request_link', expected_op_seq: 0 },
  ]) {
    const db = world({ amount_paid: 40, state: 'paid_in_full' });
    const r = await invoke(action, db, BARBER_A, { booking_request_id: 'b1', ...body });
    assert.equal(r.status, 403, body.action);
    assert.equal(db.writes.length, 0, `${body.action} wrote nothing`);
  }
});

test('guard 1: every function that mutates money or bookings gates on a resolved actor (source guard)', () => {
  const gated = ['routeCheckout', 'routePayment', 'paymentAction', 'ensureBookingPayment', 'paymentFollowUp', 'paymentsHealth', 'migratePaymentState', 'advanceRouteStop', 'markNoShow', 'bookingTransition', 'confirmBooking', 'declineBookingRequest', 'updateBookingRequest', 'createAdminBooking'];
  for (const name of gated) {
    assert.match(read(`base44/functions/${name}/entry.ts`), /resolveSchedulingActor|requireAdminActor|requireAdmin|auth\.me\(/, `${name} has an actor check`);
  }
  // The only money endpoint without a user is the webhook, which proves itself by signature instead.
  assert.match(read('base44/functions/squareWebhook/entry.ts'), /verifySquareSignature/);
});

// ── 2. Pricing integrity ─────────────────────────────────────────────────────────────────────
test('guard 2: no money endpoint reads a price, total or amount that the barber\'s screen sends', () => {
  for (const name of ['routeCheckout', 'routePayment']) {
    const src = read(`base44/functions/${name}/entry.ts`);
    assert.doesNotMatch(src, /body\??\.(amount|price|total|subtotal|total_amount)\b/, `${name} ignores client amounts`);
  }
  // The checkout's repricing takes service NAMES only and prices them from the live catalogue.
  const co = read('base44/functions/routeCheckout/entry.ts');
  assert.match(co, /buildCatalogue\(/);
  assert.match(co, /recalculateBookingItems\(/);
  assert.doesNotMatch(co, /body\??\.services\b[^;\n]*price/);
});

test('guard 2: offline checkout payment records what is OWED, whatever amount the request claims', async () => {
  const db = world({ total_amount: 40, amount_paid: 0 });
  const r = await invoke(checkout, db, ADMIN, { booking_request_id: 'b1', action: 'pay_offline', method: 'Cash', amount: 1, total: 1, price: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const p = db.table('BookingPayment')[0];
  assert.equal(p.amount_paid, 40);
  assert.equal(p.state, 'paid_in_full');
});

test('guard 2: a manual payment can never exceed the booking total, and a refund can never exceed what was paid', async () => {
  let db = world({ total_amount: 40, amount_paid: 30, state: 'balance_due' });
  let r = await invoke(action, db, ADMIN, { booking_request_id: 'b1', action: 'mark_received', method: 'Cash', amount: 50 });
  assert.equal(r.status, 409);
  assert.equal(db.table('BookingPayment')[0].amount_paid, 30);
  db = world({ amount_paid: 40, state: 'paid_in_full' });
  r = await invoke(action, db, ADMIN, { booking_request_id: 'b1', action: 'refund', outcome: 'keep', amount: 40.01, reason: 'too much', expected_op_seq: 0 });
  assert.equal(r.status, 409);
});

// ── 3. Payment before complete ───────────────────────────────────────────────────────────────
test('guard 3: completing with an unpaid balance is refused with a clear message and changes nothing', async () => {
  for (const state of ['balance_due', 'deposit_due', 'deposit_paid', 'not_required']) {
    const db = world({ state, total_amount: 40, amount_paid: state === 'deposit_paid' ? 10 : 0 });
    const r = await invoke(checkout, db, ADMIN, { booking_request_id: 'b1', action: 'complete' });
    assert.equal(r.status, 402, state);
    assert.match(r.json.error, /Payment is required before completing/);
    assert.ok(r.json.outstanding > 0);
    assert.equal(db.writes.filter((w) => w.entity === 'DayRoute' || w.entity === 'BookingRequest').length, 0, `${state} touched no route or booking`);
  }
});

test('guard 3: a payment link that has only been CREATED does not count as paid', async () => {
  const db = world({ state: 'balance_due', payment_link_url: 'https://sq.test/pay/1', provider_payment_id: 'ORD1', amount_paid: 0 });
  const r = await invoke(checkout, db, ADMIN, { booking_request_id: 'b1', action: 'complete' });
  assert.equal(r.status, 402);
});

test('guard 3: the payment check sits before any route or booking write in the server code', () => {
  const src = read('base44/functions/routeCheckout/entry.ts');
  const gate = src.indexOf('Payment is required before completing');
  assert.ok(gate > 0 && gate < src.indexOf('findRunnableRoute(admin'));
  assert.ok(gate < src.indexOf('finishCompletion(admin'));
});

// ── 4. Webhook ───────────────────────────────────────────────────────────────────────────────
const event = (id = 'evt-1') => JSON.stringify({ event_id: id, type: 'payment.updated', data: { object: { payment: { id: 'PAY1', order_id: 'ORD1', status: 'COMPLETED', amount_money: { amount: 4000, currency: 'AUD' } } } } });
const deliver = async (db, raw, { key = KEY, header, ip } = {}) => {
  globalThis.__b44Client = () => ({ entities: db.entities, asServiceRole: { entities: db.entities } });
  const headers = { ...(ip ? { 'x-forwarded-for': ip } : {}) };
  headers['x-square-hmacsha256-signature'] = header !== undefined ? header : await computeSquareSignature(key, WEBHOOK_URL, raw);
  const res = await webhook(new Request(WEBHOOK_URL, { method: 'POST', headers, body: raw }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const whDb = () => makeMemDb({
  BookingRequest: [{ id: 'b1', is_test: true, payment_status: 'Unpaid' }],
  BookingPayment: [{ id: 'p1', booking_request_id: 'b1', state: 'balance_due', total_amount: 40, amount_paid: 0, amount_refunded: 0, currency: 'AUD', payment_provider: 'square', provider_payment_id: 'ORD1' }],
});

test('guard 4: unsigned, tampered and wrongly-signed events get 401 and change nothing', async () => {
  globalThis.__secrets = liveSecrets();
  const db = whDb();
  const raw = event();
  const signed = await computeSquareSignature(KEY, WEBHOOK_URL, raw);
  for (const attempt of [
    await deliver(db, raw, { header: '' }),
    await deliver(db, raw, { header: 'AAAA' }),
    await deliver(db, raw.replace('4000', '1'), { header: signed }),
    await deliver(db, raw, { key: 'some-other-key' }),
  ]) assert.equal(attempt.status, 401);
  assert.equal(db.writes.filter((w) => w.entity !== 'RateLimitHit').length, 0);
  assert.equal(db.table('BookingPayment')[0].amount_paid, 0);
});

test('guard 4: a malformed or blank signing secret fails CLOSED, never open', async () => {
  for (const bad of ['', '   ', undefined]) {
    globalThis.__secrets = liveSecrets({ [SQUARE_SECRETS.webhookKey]: bad });
    const db = whDb();
    const raw = event();
    // A blank secret must never validate anything: not a made-up signature, not an empty one.
    const r = await deliver(db, raw, { key: 'x' });
    assert.ok([401, 503].includes((await deliver(db, raw, { header: '' })).status));
    assert.ok([401, 503].includes(r.status), `status ${r.status}`);
    assert.equal(db.writes.length, 0);
    assert.equal(db.table('BookingPayment')[0].amount_paid, 0);
  }
  // Odd but non-empty key: only a signature made with exactly that key passes.
  globalThis.__secrets = liveSecrets({ [SQUARE_SECRETS.webhookKey]: '\u0000\u0001 weird \uD800' });
  const db = whDb();
  assert.equal((await deliver(db, event(), { key: KEY })).status, 401);
});

test('guard 4: a genuine event is applied once; the same event id is answered as a duplicate and never double-counted', async () => {
  globalThis.__secrets = liveSecrets();
  const db = whDb();
  const raw = event('evt-dup');
  const first = await deliver(db, raw);
  assert.equal(first.status, 200);
  assert.equal(db.table('BookingPayment')[0].amount_paid, 40);
  for (let i = 0; i < 3; i++) {
    const again = await deliver(db, raw);
    assert.equal(again.status, 200);
    assert.equal(again.json.ignored, 'duplicate');
  }
  assert.equal(db.table('BookingPayment')[0].amount_paid, 40);
  assert.equal(db.table('PaymentEvent').filter((e) => e.provider_event_id === 'evt-dup').length, 1);
});

test('guard 4: the signature comparison is constant-time and the logs never carry payloads or secrets (source guard)', () => {
  const sig = read('base44/shared/squareSignature.ts');
  assert.match(sig, /safeEqual\(/);
  assert.doesNotMatch(sig, /computeSquareSignature\([^)]*\)\s*===\s*header/);
  const twilio = read('base44/shared/twilio.ts');
  assert.match(twilio, /diff \|= /);
  for (const f of ['functions/squareWebhook/entry.ts', 'shared/squareProvider.ts', 'shared/squareEvents.ts', 'shared/paymentService.ts', 'shared/paymentIntent.ts', 'shared/paymentLink.ts', 'shared/paymentMessages.ts', 'shared/offlinePayment.ts', 'functions/paymentAction/entry.ts']) {
    const lines = read(`base44/${f}`).split('\n').filter((l) => /console\.(log|warn|error|info|debug)/.test(l));
    for (const l of lines) assert.doesNotMatch(l, /\b(raw|body|headers|token|accessToken|signature|key|secret|authorization)\b/i, `${f}: ${l.trim()}`);
  }
});

test('guard 4: nothing sensitive reaches the console while handling good, forged and duplicate events', async () => {
  globalThis.__secrets = liveSecrets();
  const seen = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => seen.push(a.map(String).join(' '));
  try {
    const db = whDb();
    const raw = event('evt-log');
    await deliver(db, raw); await deliver(db, raw); await deliver(db, raw, { header: 'AAAA' });
  } finally { Object.assign(console, orig); }
  const out = seen.join('\n');
  for (const secret of [KEY, TOKEN, 'ORD1', 'PAY1', '"amount_money"']) assert.ok(!out.includes(secret), `console output contains ${secret}`);
});

// ── 5. Refund safety ─────────────────────────────────────────────────────────────────────────
const paid = { amount_paid: 40, state: 'paid_in_full' };

test('guard 5: a refund must carry the operation number; missing or stale numbers are refused and nothing is sent', async () => {
  let db = world(paid);
  let r = await invoke(action, db, ADMIN, { booking_request_id: 'b1', action: 'refund', outcome: 'keep', amount: 10, reason: 'no seq' });
  assert.equal(r.status, 400);
  assert.equal(db.table('BookingPayment')[0].amount_refunded, 0);
  db = world({ ...paid, op_seq: 3 });
  r = await invoke(action, db, ADMIN, { booking_request_id: 'b1', action: 'refund', outcome: 'keep', amount: 10, reason: 'stale seq', expected_op_seq: 1 });
  assert.ok([400, 409].includes(r.status), `status ${r.status}`);
  assert.equal(db.table('BookingPayment')[0].amount_refunded, 0);
});

test('guard 5: refund amounts of zero, negative, text or beyond the remaining balance are refused', async () => {
  for (const amount of [0, -5, 'abc', null, 40.01, 1000]) {
    const db = world(paid);
    const r = await invoke(action, db, ADMIN, { booking_request_id: 'b1', action: 'refund', outcome: 'keep', amount, reason: 'bad amount', expected_op_seq: 0 });
    assert.equal(r.status, 409, String(amount));
    assert.equal(db.table('BookingPayment')[0].amount_refunded, 0);
  }
});

test('guard 5: a refund needs a reason, and an unpaid booking cannot be refunded', async () => {
  let db = world(paid);
  assert.equal((await invoke(action, db, ADMIN, { booking_request_id: 'b1', action: 'refund', outcome: 'keep', amount: 5, reason: '', expected_op_seq: 0 })).status, 409);
  db = world({ state: 'balance_due', amount_paid: 0 });
  assert.equal((await invoke(action, db, ADMIN, { booking_request_id: 'b1', action: 'refund', outcome: 'keep', amount: 5, reason: 'nothing paid', expected_op_seq: 0 })).status, 409);
});

test('guard 5: the remaining balance shrinks with each refund, so refunds can never add up to more than was paid', async () => {
  const db = world(paid);
  let r = await invoke(action, db, ADMIN, { booking_request_id: 'b1', action: 'refund', outcome: 'keep', amount: 30, reason: 'first part', expected_op_seq: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const seq = db.table('BookingPayment')[0].op_seq;
  r = await invoke(action, db, ADMIN, { booking_request_id: 'b1', action: 'refund', outcome: 'keep', amount: 11, reason: 'second part', expected_op_seq: seq });
  assert.equal(r.status, 409);
  assert.equal(db.table('BookingPayment')[0].amount_refunded, 30);
});

test('guard 5: a refund for a booking that does not exist is refused', async () => {
  const db = world(paid);
  const r = await invoke(action, db, ADMIN, { booking_request_id: 'nope', action: 'refund', outcome: 'keep', amount: 5, reason: 'ghost', expected_op_seq: 0 });
  assert.equal(r.status, 404);
});

// ── 6. Rate limiting ─────────────────────────────────────────────────────────────────────────
test('guard 6: a burst of forged webhook calls is cut off with 429 and stops writing to the database', async () => {
  globalThis.__secrets = liveSecrets();
  const db = whDb();
  const raw = event();
  const statuses = [];
  for (let i = 0; i < 30; i++) statuses.push((await deliver(db, raw, { header: 'AAAA', ip: '203.0.113.9' })).status);
  assert.equal(statuses[0], 401);
  assert.ok(statuses.includes(429), 'burst was throttled');
  assert.equal(statuses.filter((s) => s === 401).length, 20);
  const writesAtLimit = db.writes.length;
  for (let i = 0; i < 20; i++) assert.equal((await deliver(db, raw, { header: 'AAAA', ip: '203.0.113.9' })).status, 429);
  assert.equal(db.writes.length, writesAtLimit, 'no further writes once throttled');
  assert.equal(db.table('BookingPayment')[0].amount_paid, 0);
});

test('guard 6: a throttled forger does not block Square\'s genuine, correctly signed delivery', async () => {
  globalThis.__secrets = liveSecrets();
  const db = whDb();
  for (let i = 0; i < 30; i++) await deliver(db, event(), { header: 'AAAA', ip: '203.0.113.9' });
  const ok = await deliver(db, event('evt-real'), { ip: '203.0.113.9' });
  assert.equal(ok.status, 200);
  assert.equal(db.table('BookingPayment')[0].amount_paid, 40);
});

test('guard 6: payment links are limited per booking, then refused with 429 and Retry-After', async () => {
  const db = world();
  const results = [];
  for (let i = 0; i < PAYMENT_LINK_LIMITS.perMinute + 3; i++) results.push((await takePaymentLinkSlot(db.asServiceRole, 'b1')).allowed);
  assert.equal(results.filter(Boolean).length, PAYMENT_LINK_LIMITS.perMinute);
  assert.equal((await takePaymentLinkSlot(db.asServiceRole, 'another-booking')).allowed, true, 'other bookings are unaffected');
  // And through the real endpoint:
  const db2 = world();
  const codes = [];
  for (let i = 0; i < 8; i++) codes.push(await invoke(checkout, db2, ADMIN, { booking_request_id: 'b1', action: 'pay_card' }));
  assert.ok(codes.some((c) => c.status === 429), 'endpoint throttles');
  assert.ok(codes.find((c) => c.status === 429).headers.get('Retry-After'));
});

// ── 7. Secrets ───────────────────────────────────────────────────────────────────────────────
test('guard 7: Admin > Payments status returns names and flags only, never a value', async () => {
  globalThis.__secrets = liveSecrets();
  const db = makeMemDb({ TeamMember: team });
  const r = await invoke(health, db, ADMIN, {});
  assert.equal(r.status, 200);
  const text = JSON.stringify(r.json);
  for (const name of NAMES) assert.ok(!text.includes(`invented-${name.toLowerCase()}`), `value of ${name} leaked`);
  assert.ok(!text.includes(KEY) && !text.includes(TOKEN));
  assert.equal((await invoke(health, makeMemDb({ TeamMember: team }), BARBER_A, {})).status, 403);
});

test('guard 7: a rejected webhook never echoes the signing key or any secret in its answer', async () => {
  globalThis.__secrets = liveSecrets();
  const r = await deliver(whDb(), event(), { header: 'AAAA' });
  const text = JSON.stringify(r.json);
  for (const v of [KEY, TOKEN, ...NAMES.map((n) => `invented-${n.toLowerCase()}`)]) assert.ok(!text.includes(v));
});

test('guard 7: no credential is hard-coded anywhere in the backend or the screens (source scan)', () => {
  const walk = (dir) => readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${dir}${e.name}/`) : [`${dir}${e.name}`]);
  const files = [...walk('base44/functions/'), ...walk('base44/shared/'), ...walk('src/')].filter((f) => /\.(ts|js|jsx)$/.test(f));
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /\bEAAA[A-Za-z0-9_-]{30,}/, `${f}: Square token`);
    assert.doesNotMatch(src, /\bsq0[a-z]{3}-[A-Za-z0-9_-]{20,}/, `${f}: Square credential`);
    assert.doesNotMatch(src, /sk_(live|test)_[A-Za-z0-9]{10,}/, `${f}: payment secret key`);
  }
  // Secrets are read only through the platform's secrets module.
  assert.doesNotMatch(read('base44/shared/squareConfig.ts'), /process\.env|Deno\.env/);
});

test('guard 7: the Payments admin screen only ever receives status fields', () => {
  const src = read('base44/functions/paymentsHealth/entry.ts');
  assert.doesNotMatch(src, /secrets\.get\([^)]*\)\s*[,}]/);
  assert.match(src, /missing: s\.missing/);
});

// ── 8. Test-data isolation ───────────────────────────────────────────────────────────────────
test('guard 8: a test booking\'s payment texts are flagged as test data and are never delivered', async () => {
  const { recipientBlock } = await import('../base44/shared/recipientGuard.ts');
  assert.equal(typeof recipientBlock, 'function');
  const src = read('base44/shared/outboxEnqueue.ts');
  assert.match(src, /is_test === true\) isTest = true/);
  assert.match(src, /is_test: isTest/);
  const guards = read('base44/functions/processMessageOutbox/guards.ts') + read('base44/shared/recipientGuard.ts');
  assert.match(guards, /test data/);
});

test('guard 8: real reports and the dashboard always exclude test bookings', () => {
  assert.match(read('src/lib/reports/loadReportData.js'), /is_test:\s*\{\s*\$ne:\s*true\s*\}/);
  // The Route tab is the day's execution list, so test stops are shown there (the Calendar
  // shows them too, labelled). They are still excluded from money: the revenue figure is
  // summed over real stops only.
  assert.match(read('src/pages/admin/AdminRoute.jsx'), /filter\(s => !s\.is_test\)/);
  assert.doesNotMatch(read('src/pages/admin/AdminRoute.jsx'), /is_test:\s*\{\s*\$ne:\s*true\s*\}/);
});