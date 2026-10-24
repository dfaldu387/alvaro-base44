// Square payments: the gate, the signed webhook, idempotency, ordering, refunds and the credential guard.
// Every key, token and id here is invented by this file. No network, no database, no real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { loadEntry } from './helpers/loadEntry.mjs';

// The platform's secrets module does not exist under Node: it reads whatever the test put in globalThis.__secrets.
const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: (k) => (globalThis.__secrets || {})[k] };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { getPaymentProvider, testDoubleProvider } = await import('../base44/shared/paymentProvider.ts');
const { SQUARE_SECRETS, LIVE_SWITCH, squareStatus, readSquareConfig } = await import('../base44/shared/squareConfig.ts');
const { computeSquareSignature } = await import('../base44/shared/squareSignature.ts');
const { createSquareProvider } = await import('../base44/shared/squareProvider.ts');

const root = fileURLToPath(new URL('../', import.meta.url));
const ALL_NAMES = Object.values(SQUARE_SECRETS);
const URL_ = 'https://app.test/functions/squareWebhook';
const KEY = `fake-signing-key-${ALL_NAMES.indexOf(SQUARE_SECRETS.webhookKey)}`;

// A complete, live, sandbox set made of invented values.
function secretsFor(over = {}) {
  const base = Object.fromEntries(ALL_NAMES.map((n) => [n, `fake-${n.toLowerCase()}`]));
  base[SQUARE_SECRETS.webhookKey] = KEY;
  base[SQUARE_SECRETS.environment] = 'sandbox';
  base[LIVE_SWITCH] = 'true';
  const out = { ...base, ...over };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}
const setSecrets = (s) => { globalThis.__secrets = s; };

// ── A small in-memory database with the calls the webhook makes ──────────────────────────────
function makeDb(seed = {}) {
  const tables = {}; const ops = []; let n = 0; let reads = 0;
  const table = (name) => (tables[name] ||= (seed[name] || []).map((r) => ({ ...r })));
  const match = (r, q = {}) => Object.entries(q).every(([k, c]) => (c && typeof c === 'object' && '$in' in c) ? c.$in.includes(r[k]) : r[k] === c);
  const entity = (name) => ({
    list: async () => { reads++; return [...table(name)]; },
    // Reads return copies, as the real SDK does, so a stored row only changes through a write.
    filter: async (q, _s, limit) => { reads++; return table(name).filter((r) => match(r, q)).slice(0, limit || 1000).map((r) => ({ ...r })); },
    get: async (id) => { reads++; const r = table(name).find((x) => x.id === id); if (!r) throw new Error('not found'); return { ...r }; },
    create: async (d) => { const r = { id: `${name}-${++n}`, ...d }; table(name).push(r); ops.push({ entity: name, op: 'create' }); return r; },
    update: async (id, d) => { Object.assign(table(name).find((x) => x.id === id), d); ops.push({ entity: name, op: 'update' }); },
    updateMany: async (q, u) => {
      for (const r of table(name).filter((x) => match(x, q))) {
        Object.assign(r, u.$set || {});
        for (const [k, v] of Object.entries(u.$inc || {})) r[k] = (r[k] || 0) + v;
      }
      ops.push({ entity: name, op: 'updateMany' });
    },
  });
  const entities = new Proxy({}, { get: (_t, name) => entity(name) });
  return { entities, asServiceRole: { entities }, table, ops, reads: () => reads, dataOps: () => ops.filter((o) => o.entity !== 'PaymentWebhookHealth') };
}

const pay = (over = {}) => ({
  id: 'bp1', booking_request_id: 'b1', state: 'deposit_due', total_amount: 80, deposit_amount: 20, amount_paid: 0,
  amount_refunded: 0, currency: 'AUD', payment_provider: 'square', provider_payment_id: 'ORD1', ...over,
});
const seedFor = (p = pay()) => ({ BookingPayment: [p], BookingRequest: [{ id: 'b1', payment_status: 'Unpaid', is_test: false }] });

const paymentEvent = (eventId, over = {}) => ({
  merchant_id: 'merchant-x', type: 'payment.updated', event_id: eventId,
  data: { type: 'payment', id: 'PAY1', object: { payment: { id: 'PAY1', order_id: 'ORD1', status: 'COMPLETED', amount_money: { amount: 2000, currency: 'AUD' }, ...over } } },
});
const refundEvent = (eventId, over = {}) => ({
  merchant_id: 'merchant-x', type: 'refund.updated', event_id: eventId,
  data: { type: 'refund', id: 'REF1', object: { refund: { id: 'REF1', payment_id: 'PAY1', order_id: 'ORD1', status: 'COMPLETED', amount_money: { amount: 1000, currency: 'AUD' }, ...over } } },
});

const handler = await loadEntry('squareWebhook');
async function deliver(db, event, { raw, sign = true, signWith = KEY, header } = {}) {
  globalThis.__b44Client = () => db;
  const body = raw ?? JSON.stringify(event);
  const headers = {};
  if (header !== undefined) headers['x-square-hmacsha256-signature'] = header;
  else if (sign) headers['x-square-hmacsha256-signature'] = await computeSquareSignature(signWith, URL_, body);
  const res = await handler(new Request(URL_, { method: 'POST', headers, body }));
  return { status: res.status, json: await res.json() };
}
const stored = (db) => db.table('BookingPayment')[0];

test.beforeEach(() => setSecrets(secretsFor()));

// ── 1-3. The gate ─────────────────────────────────────────────────────────────────────────────
test('secrets absent: the test double is active, ids say SIMULATED, and the webhook answers 503 touching nothing', async () => {
  setSecrets({});
  const p = getPaymentProvider();
  assert.equal(p, testDoubleProvider);
  assert.equal(p.simulated, true);
  const link = await p.createPaymentLink({ bookingId: 'b1', amount: 20, currency: 'AUD', description: 'Deposit', expiresInHours: 24 });
  assert.match(link.providerPaymentId, /^SIMULATED/);
  const db = makeDb(seedFor());
  const r = await deliver(db, paymentEvent('evt-1'));
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'Not configured.');
  assert.deepEqual(db.ops, []);
  assert.equal(db.reads(), 0);
});

test('live switch off with every secret present: still the test double, webhook inert', async () => {
  for (const off of [undefined, '', 'false', 'TRUE', 'yes', '1', ' false ']) {
    setSecrets(secretsFor({ [LIVE_SWITCH]: off }));
    assert.equal(getPaymentProvider(), testDoubleProvider, `switch ${JSON.stringify(off)}`);
    const db = makeDb(seedFor());
    assert.equal((await deliver(db, paymentEvent('evt-1'))).status, 503);
    assert.deepEqual(db.ops, []);
  }
});

test('a missing secret never half-configures Square, whichever one it is', () => {
  for (const name of ALL_NAMES) {
    setSecrets(secretsFor({ [name]: undefined }));
    assert.equal(getPaymentProvider(), testDoubleProvider, `without ${name}`);
    assert.deepEqual(squareStatus((k) => globalThis.__secrets[k]).missing, [name]);
    assert.equal(readSquareConfig((k) => globalThis.__secrets[k]), null);
  }
  setSecrets(secretsFor({ [SQUARE_SECRETS.accessToken]: '   ' }));
  assert.equal(getPaymentProvider(), testDoubleProvider, 'blank counts as missing');
});

test('the environment must be exactly sandbox or production', () => {
  for (const bad of ['live', 'Sandbox', 'prod', '']) {
    setSecrets(secretsFor({ [SQUARE_SECRETS.environment]: bad }));
    assert.equal(getPaymentProvider(), testDoubleProvider, bad);
  }
  for (const env of ['sandbox', 'production']) {
    setSecrets(secretsFor({ [SQUARE_SECRETS.environment]: env }));
    const p = getPaymentProvider();
    assert.equal(p.name, 'square');
    assert.equal(p.simulated, false);
    assert.equal(squareStatus((k) => globalThis.__secrets[k]).environment, env);
  }
});

// ── 4-5. A signed payment moves the booking once ──────────────────────────────────────────────
test('a correctly signed payment event drives the booking to deposit_paid through the state machine, audited as the webhook', async () => {
  const db = makeDb(seedFor());
  const r = await deliver(db, paymentEvent('evt-1'));
  assert.equal(r.status, 200);
  assert.equal(r.json.state, 'deposit_paid');
  const row = stored(db);
  assert.equal(row.state, 'deposit_paid');
  assert.equal(row.amount_paid, 20);
  assert.equal(row.provider_payment_id, 'PAY1', 'the real payment id replaces the order id');
  assert.equal(row.last_provider_event_id, 'evt-1');
  const ev = db.table('PaymentEvent')[0];
  assert.equal(ev.provider_event_id, 'evt-1');
  assert.equal(ev.actor, 'Square webhook');
  assert.equal(ev.from_state, 'deposit_due');
  assert.equal(ev.to_state, 'deposit_paid');
  const log = db.table('ActivityLog')[0];
  assert.equal(log.actor_name, 'Square webhook');
  assert.equal(log.actor_type, 'route_flow');
  assert.equal(log.details_json.ids.square_event_id, 'evt-1');
  assert.equal(db.table('BookingRequest')[0].payment_status, 'Unpaid', 'a deposit is not paid in full');
});

test('paying the full amount reaches paid_in_full and marks the booking Paid', async () => {
  const db = makeDb(seedFor(pay({ deposit_amount: 0, state: 'balance_due' })));
  const r = await deliver(db, paymentEvent('evt-1', { amount_money: { amount: 8000, currency: 'AUD' } }));
  assert.equal(r.json.state, 'paid_in_full');
  assert.equal(db.table('BookingRequest')[0].payment_status, 'Paid');
});

test('the same event delivered five times changes the booking once', async () => {
  const db = makeDb(seedFor());
  const first = await deliver(db, paymentEvent('evt-1'));
  assert.equal(first.status, 200);
  const opsAfterFirst = db.dataOps().length;
  for (let i = 0; i < 4; i++) {
    const again = await deliver(db, paymentEvent('evt-1'));
    assert.equal(again.status, 200);
    assert.equal(again.json.ignored, 'duplicate');
  }
  assert.equal(db.dataOps().length, opsAfterFirst, 'no data written by the repeats');
  assert.equal(stored(db).amount_paid, 20);
  assert.equal(db.table('PaymentEvent').length, 1);
  assert.equal(db.table('PaymentWebhookHealth')[0].duplicates_ignored, 4);
});

test('a second update of the same payment under a new event id is not counted again', async () => {
  const db = makeDb(seedFor());
  await deliver(db, paymentEvent('evt-1'));
  const again = await deliver(db, paymentEvent('evt-2'));
  assert.equal(again.status, 200);
  assert.equal(again.json.ignored, 'payment_already_applied');
  assert.equal(stored(db).amount_paid, 20);
});

// ── 6-7. Signatures ───────────────────────────────────────────────────────────────────────────
test('a wrong, missing or foreign signature answers 401 and touches nothing', async () => {
  for (const opts of [{ signWith: 'some-other-fake-key' }, { header: 'not-a-signature' }, { sign: false }]) {
    const db = makeDb(seedFor());
    const r = await deliver(db, paymentEvent('evt-1'), opts);
    assert.equal(r.status, 401);
    // Only the forged-request counter may be written (the burst limiter); no payment, booking or event data.
    assert.deepEqual(db.ops.filter((o) => o.entity !== 'RateLimitHit'), []);
    assert.ok(db.reads() <= 2, 'at most the two limiter counters are read, and only after the signature failed');
    assert.equal(stored(db).state, 'deposit_due');
  }
});

test('a tampered body with a signature that was valid for the original changes nothing', async () => {
  const db = makeDb(seedFor());
  const original = JSON.stringify(paymentEvent('evt-1'));
  const header = await computeSquareSignature(KEY, URL_, original);
  const tampered = original.replace('"amount":2000', '"amount":8000');
  assert.notEqual(tampered, original);
  const r = await deliver(db, null, { raw: tampered, header });
  assert.equal(r.status, 401);
  assert.deepEqual(db.ops.filter((o) => o.entity !== 'RateLimitHit'), []);
  assert.equal(stored(db).amount_paid, 0);
});

test('the signature covers the notification URL as well as the body', async () => {
  const db = makeDb(seedFor());
  const raw = JSON.stringify(paymentEvent('evt-1'));
  const header = await computeSquareSignature(KEY, 'https://elsewhere.test/functions/squareWebhook', raw);
  assert.equal((await deliver(db, null, { raw, header })).status, 401);
});

// ── 8. Ordering ───────────────────────────────────────────────────────────────────────────────
test('a late payment event never walks a settled booking backwards', async () => {
  for (const state of ['paid_in_full', 'refunded', 'partially_refunded', 'refund_pending', 'written_off']) {
    const db = makeDb(seedFor(pay({ state, amount_paid: 80, amount_refunded: state === 'paid_in_full' ? 0 : 10 })));
    const before = { ...stored(db) };
    const r = await deliver(db, paymentEvent('evt-late'));
    assert.equal(r.status, 200, state);
    assert.match(r.json.ignored, /not_applied/, state);
    assert.equal(stored(db).state, state, state);
    assert.equal(stored(db).amount_paid, before.amount_paid, state);
    assert.equal(stored(db).provider_payment_id, 'ORD1', state);
  }
});

test('a payment that is not completed changes nothing', async () => {
  const db = makeDb(seedFor());
  const r = await deliver(db, paymentEvent('evt-1', { status: 'APPROVED' }));
  assert.equal(r.json.ignored, 'payment_not_completed');
  assert.equal(stored(db).state, 'deposit_due');
  assert.deepEqual(db.dataOps(), []);
});

test('a payment in the wrong currency is not applied', async () => {
  const db = makeDb(seedFor());
  const r = await deliver(db, paymentEvent('evt-1', { amount_money: { amount: 2000, currency: 'USD' } }));
  assert.equal(r.json.ignored, 'currency_mismatch');
  assert.equal(stored(db).amount_paid, 0);
});

// ── 9. Unknown booking ────────────────────────────────────────────────────────────────────────
test('an event for an unknown booking answers 503 and writes nothing to any payment record', async () => {
  const db = makeDb(seedFor(pay({ provider_payment_id: 'SOMETHING-ELSE' })));
  const r = await deliver(db, paymentEvent('evt-1'));
  assert.equal(r.status, 503);
  assert.equal(r.json.retry, true);
  assert.deepEqual(db.dataOps(), [], 'only the health counter may be written');
  assert.equal(stored(db).amount_paid, 0);
  assert.equal(db.table('PaymentWebhookHealth')[0].unmatched_count, 1);
});

test('the booking is found by the id Square echoes, never by an amount', async () => {
  const other = pay({ id: 'bp2', booking_request_id: 'b2', provider_payment_id: 'ORD2' });
  const db = makeDb({ BookingPayment: [pay(), other], BookingRequest: [{ id: 'b1' }, { id: 'b2' }] });
  await deliver(db, paymentEvent('evt-1', { order_id: 'ORD2', id: 'PAY2' }));
  assert.equal(db.table('BookingPayment')[1].state, 'deposit_paid');
  assert.equal(db.table('BookingPayment')[0].state, 'deposit_due');
});

// ── 10. Refunds land on the existing refund states ────────────────────────────────────────────
test('a refund made in Square lands on refunded / partially_refunded / refund_pending', async () => {
  const paid = (over = {}) => pay({ state: 'paid_in_full', amount_paid: 80, provider_payment_id: 'PAY1', ...over });
  let db = makeDb(seedFor(paid()));
  assert.equal((await deliver(db, refundEvent('r1', { amount_money: { amount: 8000, currency: 'AUD' } }))).json.state, 'refunded');
  assert.deepEqual(stored(db).provider_refund_ids, ['REF1']);
  assert.equal(stored(db).amount_refunded, 80);

  db = makeDb(seedFor(paid()));
  assert.equal((await deliver(db, refundEvent('r1'))).json.state, 'partially_refunded');
  assert.equal(stored(db).amount_refunded, 10);

  db = makeDb(seedFor(paid()));
  assert.equal((await deliver(db, refundEvent('r1', { status: 'PENDING' }))).json.state, 'refund_pending');
});

test('Square confirming a refund this app started settles it; a refund already recorded is not counted twice', async () => {
  let db = makeDb(seedFor(pay({ state: 'refund_pending', amount_paid: 80, amount_refunded: 10, provider_payment_id: 'PAY1', provider_refund_ids: ['REF1'] })));
  const r = await deliver(db, refundEvent('r1'));
  assert.equal(r.json.state, 'partially_refunded');
  assert.equal(stored(db).amount_refunded, 10, 'amount was counted when the refund was requested');

  db = makeDb(seedFor(pay({ state: 'partially_refunded', amount_paid: 80, amount_refunded: 10, provider_payment_id: 'PAY1', provider_refund_ids: ['REF1'] })));
  const again = await deliver(db, refundEvent('r2'));
  assert.equal(again.json.ignored, 'refund_already_recorded');
  assert.equal(stored(db).amount_refunded, 10);
});

test('a refund event that arrives before its payment was recorded is retried, not lost and not applied', async () => {
  const db = makeDb(seedFor(pay({ state: 'deposit_due', provider_payment_id: 'ORD1' })));
  const r = await deliver(db, refundEvent('r1'));
  assert.equal(r.status, 503);
  assert.equal(stored(db).state, 'deposit_due');
  assert.deepEqual(db.dataOps(), []);
});

test('a failed refund and an unhandled event type are answered 200 with a reason', async () => {
  const db = makeDb(seedFor(pay({ state: 'paid_in_full', amount_paid: 80, provider_payment_id: 'PAY1' })));
  assert.equal((await deliver(db, refundEvent('r1', { status: 'FAILED' }))).json.ignored, 'refund_not_completed');
  assert.equal(stored(db).state, 'paid_in_full');
  const other = await deliver(db, { type: 'customer.created', event_id: 'evt-9', data: { type: 'customer', id: 'c', object: {} } });
  assert.equal(other.status, 200);
  assert.equal(other.json.ignored, 'unhandled_event_type');
});

test('a verified but malformed event is a 400, not a state change', async () => {
  const db = makeDb(seedFor());
  assert.equal((await deliver(db, { type: 'payment.updated', event_id: 'e', data: {} })).status, 400);
  assert.equal((await deliver(db, null, { raw: 'not json' })).status, 400);
  assert.deepEqual(db.ops, []);
});

// ── The adapter, with fetch replaced (still no network) ──────────────────────────────────────
test('the adapter names the booking on the link, stores the order id, and sends the credential only as a header', async () => {
  const cfg = readSquareConfig((k) => globalThis.__secrets[k]);
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, status: 200, json: async () => ({ payment_link: { id: 'LINK1', order_id: 'ORD9', url: 'https://pay.invalid/x' } }) };
  };
  try {
    const link = await createSquareProvider(cfg).createPaymentLink({ bookingId: 'b1', amount: 12.5, currency: 'AUD', description: 'Deposit', expiresInHours: 24, idempotencyKey: 'cd-link-test-1' });
    assert.equal(link.providerPaymentId, 'ORD9');
    assert.equal(link.simulated, false);
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.order.reference_id, 'b1');
    assert.equal(body.order.line_items[0].base_price_money.amount, 1250);
    assert.ok(calls[0].url.startsWith('https://connect.squareupsandbox.com/'));
    assert.ok(!calls[0].url.includes(cfg.accessToken) && !calls[0].init.body.includes(cfg.accessToken));
    await assert.rejects(() => createSquareProvider(cfg).refund({ providerPaymentId: 'SIMULATED-LINK-1', amount: 5, currency: 'AUD', reason: 'x' }), /test double/);
    assert.equal(calls.length, 1, 'a simulated id never reaches Square');
  } finally { globalThis.fetch = realFetch; }
});

// ── Source guards ────────────────────────────────────────────────────────────────────────────
const read = (p) => readFileSync(join(root, p), 'utf8');

test('the webhook verifies the signature before parsing or touching data, and queues no message', () => {
  const src = read('base44/functions/squareWebhook/entry.ts');
  assert.ok(src.indexOf('squareStatus(get).active') < src.indexOf('req.text()'));
  assert.ok(src.indexOf('verifySquareSignature(') < src.indexOf('JSON.parse'));
  assert.ok(src.indexOf('verifySquareSignature(') < src.indexOf('createClientFromRequest(req)'));
  assert.match(src, /status: 401/);
  assert.doesNotMatch(src, /req\.json\(\)/);
  assert.doesNotMatch(src, /enqueue/i, 'no customer message is queued');
});

test('payment state changes only through paymentState.ts', () => {
  const events = read('base44/shared/squareEvents.ts');
  assert.match(events, /from '\.\/paymentState\.ts'/);
  for (const fn of ['receivePayment', 'recordRefund', 'resolveRefund']) assert.match(events, new RegExp(`${fn}\\(`));
  assert.doesNotMatch(read('base44/functions/squareWebhook/entry.ts'), /state: '(deposit_paid|paid_in_full|refunded)/);
});

test('no Square credential, token or key appears anywhere in the repository', () => {
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vite', 'coverage']);
  const BINARY = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.woff', '.woff2', '.ttf', '.pdf', '.mp4']);
  const PATTERNS = [
    [/\bEAAA[A-Za-z0-9_-]{20,}/, 'Square access token'],
    [/\b(?:sandbox-)?sq0[a-z]{3}-[A-Za-z0-9_-]{10,}/, 'Square application or secret id'],
    [/\bSQ[A-Z0-9]{3}-[A-Za-z0-9_-]{20,}/, 'Square-style identifier'],
    [/\bSQUARE_(?:ACCESS_TOKEN|LOCATION_ID|APPLICATION_ID|WEBHOOK_SIGNATURE_KEY|ENVIRONMENT)['"]?\s*[:=]\s*['"][^'"\s]{6,}['"]/, 'a literal assigned to a Square secret name'],
    [/\bPAYMENTS_LIVE['"]?\s*[:=]\s*['"]true['"]/, 'the live switch set in code'],
  ];
  const hits = [];
  let scanned = 0;
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) { if (!SKIP_DIRS.has(name)) walk(full); continue; }
      if (BINARY.has(extname(name).toLowerCase()) || st.size > 2_000_000) continue;
      scanned++;
      const text = readFileSync(full, 'utf8');
      for (const [re, what] of PATTERNS) if (re.test(text)) hits.push(`${full.slice(root.length)}: ${what}`);
    }
  };
  walk(root);
  assert.ok(scanned > 100, 'the scan really walked the repository');
  assert.deepEqual(hits, []);
});

test('Square values are read from Secrets only, in the three files that need them', () => {
  const files = ['base44/shared/squareConfig.ts', 'base44/shared/paymentProvider.ts', 'base44/functions/squareWebhook/entry.ts', 'base44/functions/paymentsHealth/entry.ts'];
  for (const f of files) assert.doesNotMatch(read(f), /process\.env\.(SQUARE|PAYMENTS)/, f);
  assert.match(read('base44/shared/paymentProvider.ts'), /secrets\.get\(name\)/);
});