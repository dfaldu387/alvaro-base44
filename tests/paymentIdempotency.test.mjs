// Fix 1: Square idempotency keys come from the operation, the operation is claimed with a conditional
// write before Square is called, and a replaced payment link keeps the id it replaced.
// Every key, id and secret here is invented. Square itself is a stub counting calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { loadEntry } from './helpers/loadEntry.mjs';
import { makeMemDb } from './helpers/memDb.mjs';

const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: (k) => (globalThis.__secrets || {})[k] };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { SQUARE_SECRETS, LIVE_SWITCH } = await import('../base44/shared/squareConfig.ts');
const handler = await loadEntry('paymentAction');
const root = new URL('../', import.meta.url);

const names = Object.values(SQUARE_SECRETS);
globalThis.__secrets = { ...Object.fromEntries(names.map((n) => [n, `fake-${n.toLowerCase()}`])), [SQUARE_SECRETS.environment]: 'sandbox', [LIVE_SWITCH]: 'true' };

// ── Square stub ──────────────────────────────────────────────────────────────────────────────
let square;
const realFetch = globalThis.fetch;
test.beforeEach(() => {
  square = { calls: [], orders: 0, refunds: 0, failNext: null, byKey: new Map() };
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const body = init.body ? JSON.parse(init.body) : {};
    square.calls.push({ path, method: init.method, key: body.idempotency_key, body });
    await new Promise((r) => setTimeout(r, 5)); // a real network hop, so two taps genuinely overlap
    if (square.failNext) { const f = square.failNext; square.failNext = null; if (f === 'network') throw new TypeError('socket hang up'); return { ok: false, status: f, json: async () => ({ errors: [{ code: 'X' }] }) }; }
    // Like Square: the same idempotency key returns the SAME object again.
    if (body.idempotency_key && square.byKey.has(body.idempotency_key)) return square.byKey.get(body.idempotency_key);
    let res;
    if (path.endsWith('/payment-links')) { const n = ++square.orders; res = { ok: true, status: 200, json: async () => ({ payment_link: { order_id: `ORD${n}`, url: `https://sq.test/pay/${n}` } }) }; }
    else if (path.endsWith('/refunds')) { const n = ++square.refunds; res = { ok: true, status: 200, json: async () => ({ refund: { id: `RF${n}`, status: 'COMPLETED' } }) }; }
    else res = { ok: false, status: 404, json: async () => ({}) };
    if (body.idempotency_key) square.byKey.set(body.idempotency_key, res);
    return res;
  };
});
test.after(() => { globalThis.fetch = realFetch; });

const linkCalls = () => square.calls.filter((c) => c.path.endsWith('/payment-links'));
const refundCalls = () => square.calls.filter((c) => c.path.endsWith('/refunds'));

function seed(over = {}) {
  return makeMemDb({
    BookingRequest: [{ id: 'b1', client_name: 'Sam', status: 'confirmed', payment_status: 'Unpaid' }],
    BookingPayment: [{
      id: 'p1', booking_request_id: 'b1', state: 'balance_due', total_amount: 100, deposit_amount: 0, amount_paid: 0, amount_refunded: 0,
      currency: 'AUD', payment_provider: 'square', provider_payment_id: '', ...over,
    }],
  }, { tick: 1 });
}
let db;
const call = async (body, who = { id: 'u1', email: 'a@x.test', role: 'admin' }) => {
  globalThis.__b44Client = () => ({ auth: { me: async () => who }, entities: db.entities, asServiceRole: { entities: db.entities } });
  const res = await handler(new Request('https://app.test/functions/paymentAction', { method: 'POST', headers: { authorization: 'Bearer t' }, body: JSON.stringify({ booking_request_id: 'b1', ...body }) }));
  return { status: res.status, json: await res.json() };
};
const pay = () => db.tables.BookingPayment[0];
const paid = (over = {}) => ({ state: 'paid_in_full', amount_paid: 100, provider_payment_id: 'PAY1', ...over });

test('a second identical refund request reaches Square once, and the second tap is refused clearly', async () => {
  db = seed(paid());
  const first = await call({ action: 'refund', outcome: 'keep', amount: 10, reason: 'Unhappy', expected_op_seq: 0 });
  const second = await call({ action: 'refund', outcome: 'keep', amount: 10, reason: 'Unhappy', expected_op_seq: 0 });
  assert.equal(first.status, 200);
  assert.equal(second.status, 409);
  assert.match(second.json.error, /changed|already|refresh/i);
  assert.equal(refundCalls().length, 1, 'Square was asked once');
  assert.equal(pay().amount_refunded, 10, 'the refund was recorded once');
});

test('two refund taps at the same moment reach Square once', async () => {
  db = seed(paid());
  const body = { action: 'refund', outcome: 'keep', amount: 10, reason: 'Unhappy', expected_op_seq: 0 };
  const [a, b] = await Promise.all([call(body), call(body)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(refundCalls().length, 1);
  assert.equal(pay().amount_refunded, 10);
  assert.equal(pay().provider_refund_ids.length, 1);
});

test('two payment-link requests at the same moment make one Square order, and no payment id is orphaned', async () => {
  db = seed({ state: 'deposit_due', deposit_amount: 30 });
  const body = { action: 'request_link', expected_op_seq: 0 };
  const [a, b] = await Promise.all([call(body), call(body)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(linkCalls().length, 1, 'one order');
  assert.equal(square.orders, 1);
  assert.equal(pay().provider_payment_id, 'ORD1');
  assert.deepEqual(pay().replaced_provider_payment_ids || [], []);
});

test('the key comes from the operation: a retry of the same intention carries the same key, a new decision a different one', async () => {
  db = seed(paid());
  square.failNext = 'network';               // Square may or may not have acted: the outcome is unknown
  const lost = await call({ action: 'refund', outcome: 'keep', amount: 10, reason: 'Unhappy', expected_op_seq: 0 });
  assert.notEqual(lost.status, 200);
  assert.equal(pay().amount_refunded, 0, 'nothing is recorded until Square answers');

  const retry = await call({ action: 'refund', outcome: 'keep', amount: 10, reason: 'Unhappy', expected_op_seq: 0 });
  assert.equal(retry.status, 200, 'the same request, retried, completes');
  const keys = refundCalls().map((c) => c.key);
  assert.equal(keys.length, 2);
  assert.ok(keys[0] && keys[0] === keys[1], 'the retry carries the SAME key');
  assert.equal(square.refunds, 1, 'and Square, seeing the same key, refunded once');
  assert.equal(pay().amount_refunded, 10);

  // A genuinely new partial refund, from a fresh view of the payment, is a different operation.
  const next = await call({ action: 'refund', outcome: 'keep', amount: 5, reason: 'Second item', expected_op_seq: pay().op_seq });
  assert.equal(next.status, 200);
  assert.notEqual(refundCalls().at(-1).key, keys[0]);
  assert.equal(pay().amount_refunded, 15);
  assert.equal(square.refunds, 2);
});

test('a replacement link after an expired one is allowed, and keeps the id it replaced', async () => {
  db = seed({ state: 'deposit_due', deposit_amount: 30 });
  assert.equal((await call({ action: 'request_link', expected_op_seq: 0 })).status, 200);
  const firstId = pay().provider_payment_id;
  assert.equal(firstId, 'ORD1');
  const again = await call({ action: 'request_link', expected_op_seq: pay().op_seq });
  assert.equal(again.status, 200);
  assert.equal(pay().provider_payment_id, 'ORD2');
  assert.deepEqual(pay().replaced_provider_payment_ids, ['ORD1'], 'the old order id is kept, not discarded');
  assert.notEqual(linkCalls()[0].key, linkCalls()[1].key);
});

test('a definite refusal from Square releases the claim; nothing is left stuck', async () => {
  db = seed(paid());
  square.failNext = 400;
  const refused = await call({ action: 'refund', outcome: 'keep', amount: 10, reason: 'Unhappy', expected_op_seq: 0 });
  assert.notEqual(refused.status, 200);
  assert.ok(!pay().intent_key, 'no claim left behind');
  const ok = await call({ action: 'refund', outcome: 'keep', amount: 10, reason: 'Unhappy', expected_op_seq: pay().op_seq });
  assert.equal(ok.status, 200);
});

test('source guards: no random key, a key is required, and the claim is a conditional write', () => {
  const provider = readFileSync(new URL('base44/shared/squareProvider.ts', root), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(provider, /randomUUID|Math\.random/);
  assert.equal((provider.match(/idempotency_key: req\.idempotencyKey/g) || []).length, 2, 'both Square writes use the operation key');
  const entry = readFileSync(new URL('base44/functions/paymentAction/entry.ts', root), 'utf8');
  assert.match(entry, /claimIntent\(/);
});