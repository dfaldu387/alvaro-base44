// Test data must never reach real money.
//
// The outbox has always suppressed every message for a test booking before the sender is reached
// (processMessageOutbox). The money path had no equivalent: nothing in it looked at `is_test` at
// all, so with SQUARE_ENVIRONMENT=production a `TEST` surname would have been issued a REAL Square
// payment link. Sandbox stays allowed on purpose — running TEST bookings through sandbox cards is
// how the payment screens are proven (docs/QA-REFUND-CHOICE.md).
//
// Every key and id here is invented by this file. No network, no database, no real provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: (k) => (globalThis.__secrets || {})[k] };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { testDoubleProvider } = await import('../base44/shared/paymentProvider.ts');
const { testDataRefusal } = await import('../base44/shared/paymentState.ts');
const { createSquareProvider } = await import('../base44/shared/squareProvider.ts');
const { issuePaymentLink } = await import('../base44/shared/paymentLink.ts');
const { performRefund } = await import('../base44/shared/refundService.ts');

const cfg = (environment) => ({
  accessToken: 'fake-token', locationId: 'fake-location', applicationId: 'fake-app',
  webhookKey: 'fake-key', environment,
  baseUrl: environment === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com',
});
const sandbox = () => createSquareProvider(cfg('sandbox'));
const production = () => createSquareProvider(cfg('production'));

// ── The flag that makes the distinction possible ────────────────────────────────────────────────

test('only production Square is live; sandbox and the double are not', () => {
  assert.equal(production().live, true);
  assert.equal(sandbox().live, false);
  assert.equal(testDoubleProvider.live, false);
  // `simulated` cannot answer this question: sandbox is the real adapter against a fake bank.
  assert.equal(sandbox().simulated, false);
  assert.equal(production().simulated, false);
});

test('the refusal fires only for test data against a live provider', () => {
  assert.ok(testDataRefusal(production().live, true), 'test data + production must be refused');
  assert.equal(testDataRefusal(production().live, false), null, 'a real booking is never refused');
  assert.equal(testDataRefusal(sandbox().live, true), null, 'sandbox QA must keep working');
  assert.equal(testDataRefusal(testDoubleProvider.live, true), null);
});

test('the refusal names the cause and the way out, and leaks no credential', () => {
  const msg = testDataRefusal(production().live, true);
  assert.match(msg, /test data/i);
  assert.match(msg, /sandbox/i, 'it must say how to carry on testing');
  assert.doesNotMatch(msg, /fake-token|fake-location|fake-app|fake-key/, 'never echo a secret');
});

// ── The two places that actually reach the provider ─────────────────────────────────────────────

// Enough of the real entity layer for the claim in paymentIntent to work: `updateMany` applies
// $set to the rows that match, and `get` returns a copy, so the claim marker round-trips the way
// the real conditional write does. A caller stopped by the guard never reaches any of it.
function db(payment) {
  const writes = [];
  const rows = { BookingPayment: [{ ...payment }] };
  const matches = (r, q) => Object.entries(q).every(([k, c]) => {
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      if ('$in' in c) return c.$in.some((a) => (a === null ? r[k] == null : r[k] === a));
      return true;
    }
    return c === null ? r[k] == null : r[k] === c;
  });
  const entity = (name) => ({
    get: async (id) => {
      const r = (rows[name] || []).find((x) => x.id === id);
      if (!r) throw new Error('not found');
      return { ...r };
    },
    filter: async () => [],
    list: async () => (rows[name] || []).map((r) => ({ ...r })),
    create: async (d) => { const r = { id: `${name}-1`, ...d }; writes.push({ entity: name, op: 'create' }); return r; },
    update: async (id, d) => {
      const r = (rows[name] || []).find((x) => x.id === id);
      if (r) Object.assign(r, d);
      writes.push({ entity: name, op: 'update', id, data: d });
      return r ? { ...r } : null;
    },
    updateMany: async (q, u) => {
      let n = 0;
      for (const r of rows[name] || []) {
        if (!matches(r, q)) continue;
        Object.assign(r, u.$set || {});
        n += 1;
      }
      writes.push({ entity: name, op: 'updateMany', matched: n });
      return { modified_count: n };
    },
  });
  return { writes, entities: new Proxy({}, { get: (_t, name) => entity(name) }) };
}

const PAYMENT = {
  id: 'pay-1', booking_request_id: 'bk-1', state: 'deposit_due', currency: 'AUD',
  amount_total: 70, amount_paid: 0, deposit_amount: 20, amount_refunded: 0, op_seq: 0, is_test: true,
};

// A provider that records every call, so "no link was made" is proven rather than assumed.
function spy(base) {
  const calls = [];
  return {
    calls,
    provider: {
      ...base,
      createPaymentLink: async (req) => { calls.push(['link', req]); throw new Error('the real provider must never be reached'); },
      refund: async (req) => { calls.push(['refund', req]); throw new Error('the real provider must never be reached'); },
    },
  };
}

test('a test booking gets no production payment link, and Square is never called', async () => {
  const admin = db(PAYMENT);
  const s = spy(production());
  const res = await issuePaymentLink(admin, { paymentId: 'pay-1', provider: s.provider, actor: 'tester' });

  assert.equal(res.ok, false);
  assert.match(res.reason, /test data/i);
  assert.equal(res.retryable, false, 'retrying cannot help: it is the wrong booking, not a wrong moment');
  assert.deepEqual(s.calls, [], 'the provider must not be reached at all');
  assert.deepEqual(admin.writes, [], 'nothing is claimed or audited for a call that may not happen');
});

test('a real booking is unaffected — the guard is about test data, not about production', async () => {
  const admin = db({ ...PAYMENT, is_test: false });
  const s = spy(production());
  const res = await issuePaymentLink(admin, { paymentId: 'pay-1', provider: s.provider, actor: 'tester' });

  // It still fails, because the spy provider throws — but it fails AT Square, having been reached.
  assert.equal(res.ok, false);
  assert.doesNotMatch(res.reason, /test data/i);
  assert.equal(s.calls.length, 1, 'a real booking must still reach the provider');
  assert.equal(s.calls[0][0], 'link');
  assert.ok(admin.writes.some((w) => w.op === 'updateMany'), 'and it claims the operation first');
});

test('a test booking is still served by sandbox, so the QA script keeps working', async () => {
  const admin = db(PAYMENT);
  const s = spy(sandbox());
  const res = await issuePaymentLink(admin, { paymentId: 'pay-1', provider: s.provider, actor: 'tester' });

  assert.equal(res.ok, false, 'the spy throws, so the call fails');
  assert.doesNotMatch(res.reason, /test data/i, 'but never because it is test data');
  assert.equal(s.calls.length, 1, 'sandbox must be reached for a test booking');
});

test('a test refund is refused before anything is claimed or audited', async () => {
  const admin = db(PAYMENT);
  const s = spy(production());
  const res = await performRefund(admin, {
    booking: { id: 'bk-1', is_test: true }, payment: { ...PAYMENT, state: 'deposit_paid', amount_paid: 20 },
    provider: s.provider, actor: 'tester', amount: 20, reason: 'change of plan',
    outcome: 'keep', expectedSeq: 0,
  });

  assert.equal(res.ok, false);
  assert.match(res.error, /test data/i);
  assert.deepEqual(s.calls, [], 'the provider must not be reached');
  assert.deepEqual(admin.writes, [], 'no claim, no audit row');
});

test('a test booking is caught by either flag — the booking or its payment', async () => {
  for (const [booking, payment] of [[true, false], [false, true], [true, true]]) {
    const admin = db(PAYMENT);
    const s = spy(production());
    const res = await performRefund(admin, {
      booking: { id: 'bk-1', is_test: booking },
      payment: { ...PAYMENT, is_test: payment, state: 'deposit_paid', amount_paid: 20 },
      provider: s.provider, actor: 'tester', amount: 20, reason: 'change of plan',
      outcome: 'keep', expectedSeq: 0,
    });
    assert.equal(res.ok, false, `booking=${booking} payment=${payment}`);
    assert.match(res.error, /test data/i);
    assert.deepEqual(s.calls, []);
  }
});
