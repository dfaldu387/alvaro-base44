// A refund asks what it means. Refund only (the appointment stands, the booking stays payable) or refund
// and cancel. A cancellation asks what happens to the deposit. Booking status and payment state stay
// independent, and "what is owing" has one answer. Every key and id here is invented; Square is a stub.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { loadEntry } from './helpers/loadEntry.mjs';
import { makeMemDb } from './helpers/memDb.mjs';

const hook = `export async function resolve(s, c, n) { if (s === 'base44:runtime') return { url: 'data:text/javascript,export const secrets = { get: (k) => (globalThis.__secrets || {})[k] };', shortCircuit: true }; return n(s, c); }`;
register('data:text/javascript,' + encodeURIComponent(hook));

const { SQUARE_SECRETS, LIVE_SWITCH } = await import('../base44/shared/squareConfig.ts');
const state = await import('../base44/shared/paymentState.ts');
const events = await import('../base44/shared/squareEvents.ts');
const owingCopy = await import('../src/lib/paymentOwing.js');
const msgs = await import('../base44/shared/paymentMessages.ts');
const stop = await import('../src/lib/stopPayment.js');
const line = await import('../base44/shared/bookingPaymentLine.ts');

const action = await loadEntry('paymentAction');
const decline = await loadEntry('declineBookingRequest');
const checkout = await loadEntry('routeCheckout');
const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const walk = (dir) => readdirSync(new URL(dir, root), { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? walk(`${dir}${d.name}/`) : [`${dir}${d.name}`]));

globalThis.__secrets = {
  ...Object.fromEntries(Object.values(SQUARE_SECRETS).map((n) => [n, `fake-${n.toLowerCase()}`])),
  [SQUARE_SECRETS.environment]: 'sandbox', [LIVE_SWITCH]: 'true',
};

// ── Square stub ──────────────────────────────────────────────────────────────────────────────
let square; let db;
const realFetch = globalThis.fetch;
test.beforeEach(() => {
  square = { calls: [], orders: 0, refunds: 0, refundStatus: 'COMPLETED', auditRowsAtRefund: null };
  globalThis.fetch = async (url, init = {}) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '');
    const body = init.body ? JSON.parse(init.body) : {};
    square.calls.push({ path, key: body.idempotency_key, body });
    if (path.endsWith('/payment-links')) { const n = ++square.orders; return { ok: true, status: 200, json: async () => ({ payment_link: { order_id: `ORD${n}`, url: `https://sq.test/pay/${n}` } }) }; }
    if (path.endsWith('/refunds')) {
      // What the activity log held at the moment the money was about to move.
      square.auditRowsAtRefund = db.table('ActivityLog').filter((r) => r.action === 'payment_refund').length;
      const n = ++square.refunds;
      return { ok: true, status: 200, json: async () => ({ refund: { id: `RF${n}`, status: square.refundStatus } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
});
test.after(() => { globalThis.fetch = realFetch; });
const refundCalls = () => square.calls.filter((c) => c.path.endsWith('/refunds'));

const ADMIN = { id: 'u1', email: 'a@x.test', role: 'admin' };
const USER = { id: 'u2', email: 'u@x.test', role: 'user' };

/** $70 booking, $20 deposit paid through Square. */
function seed(over = {}, bookingOver = {}) {
  return makeMemDb({
    TeamMember: [{ id: 'tm1', user_id: 'u1', email: 'a@x.test', name: 'Alvaro', role: 'owner', status: 'Active' }],
    BookingRequest: [{ id: 'b1', client_name: 'Sam', status: 'confirmed', payment_status: 'Unpaid', price: 70, requested_date: '2026-10-23', team_member_id: 'tm1', is_test: true, ...bookingOver }],
    BookingPayment: [{
      id: 'p1', booking_request_id: 'b1', state: 'deposit_paid', total_amount: 70, deposit_amount: 20, amount_paid: 20, amount_refunded: 0,
      currency: 'AUD', payment_provider: 'square', provider_payment_id: 'PAY1', op_seq: 0, is_test: true, ...over,
    }],
  }, { tick: 1 });
}
const call = async (handler, body, who = ADMIN, headers = {}) => {
  globalThis.__b44Client = () => ({ auth: { me: async () => who }, entities: db.entities, asServiceRole: { entities: db.entities } });
  const res = await handler(new Request('https://app.test/functions/x', { method: 'POST', headers: { authorization: 'Bearer ******', ...headers }, body: JSON.stringify({ booking_request_id: 'b1', ...body }) }));
  return { status: res.status, json: await res.json().catch(() => ({})) };
};
const pay = () => db.table('BookingPayment')[0];
const booking = () => db.table('BookingRequest')[0];
const owing = () => state.amountOwing(state.toMoney(pay()));
const refund = (extra = {}) => call(action, { action: 'refund', amount: 20, reason: 'Customer asked', expected_op_seq: pay().op_seq || 0, ...extra });

// ── 1. Keep the appointment ──────────────────────────────────────────────────────────────────
test('a refund must say what it means: no choice, no refund, nothing sent to Square', async () => {
  db = seed();
  for (const outcome of [undefined, '', 'maybe']) {
    const r = await refund({ outcome });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /Choose what this refund means/);
  }
  assert.equal(refundCalls().length, 0);
  assert.equal(pay().amount_refunded, 0);
});

test('refund only: the booking stays active and the card shows $70 owing', async () => {
  db = seed();
  const r = await refund({ outcome: 'keep' });
  assert.equal(r.status, 200);
  assert.equal(r.json.cancelled, false);
  assert.equal(booking().status, 'confirmed', 'the appointment still stands');
  assert.equal(pay().state, 'deposit_due', 'a deposit is still required, so the booking is payable again');
  assert.equal(pay().amount_refunded, 20);
  assert.equal(owing(), 70);
  assert.equal(owingCopy.amountOwing(owingCopy.toMoney(pay())), 70, 'and the screen says the same');
});

test('the choice is stored on the payment event and named in the audit row, which exists before the money moves', async () => {
  db = seed();
  await refund({ outcome: 'keep' });
  const ev = db.table('PaymentEvent').find((e) => e.event_type === 'refund_recorded');
  assert.equal(ev.refund_outcome, 'keep');
  const rows = db.table('ActivityLog').filter((r) => r.action === 'payment_refund');
  assert.equal(rows.length, 1, 'one audit row');
  assert.match(rows[0].summary + rows[0].detail, /appointment still stands/i);
  assert.equal(square.auditRowsAtRefund, 1, 'it was written before Square was asked');

  db = seed();
  await refund({ outcome: 'cancel' });
  assert.equal(db.table('PaymentEvent').find((e) => e.event_type === 'refund_recorded').refund_outcome, 'cancel');
  assert.match(db.table('ActivityLog').find((r) => r.action === 'payment_refund').summary, /cancel the booking/i);
});

test('after a refund that keeps the appointment, $70 is accepted: by Received · Cash, by Checkout and by a Square webhook', async () => {
  // Received · Cash
  db = seed();
  await refund({ outcome: 'keep' });
  let cash = await call(action, { action: 'mark_received', method: 'Cash' });
  assert.equal(cash.status, 200);
  assert.equal(pay().state, 'paid_in_full');
  assert.equal(pay().amount_paid, 90, 'everything ever received still counts');
  assert.equal(owing(), 0);

  // Checkout (the Route tab): the offline payment takes exactly what is owing, then the visit can complete.
  db = seed();
  await refund({ outcome: 'keep' });
  const co = await call(checkout, { action: 'pay_offline', method: 'Cash' });
  assert.equal(co.status, 200);
  assert.equal(pay().state, 'paid_in_full');
  assert.equal(db.table('PaymentEvent').find((e) => e.event_type === 'payment_received').amount, 70);

  // A new payment link, and the Square webhook that settles it.
  db = seed();
  await refund({ outcome: 'keep' });
  const link = await call(action, { action: 'request_link', expected_op_seq: pay().op_seq });
  assert.equal(link.status, 200);
  const orderId = pay().provider_payment_id;
  const parsed = events.parseSquareEvent({ event_id: 'e1', type: 'payment.updated', data: { object: { payment: { id: 'PAY2', order_id: orderId, status: 'COMPLETED', amount_money: { amount: 7000, currency: 'AUD' } } } } });
  const plan = events.planPaymentEvent(parsed, pay());
  assert.equal(plan.kind, 'apply');
  assert.equal(plan.amount, 70);
  assert.equal(plan.fields.state, 'paid_in_full');
});

test('a refund that keeps the appointment cannot be paid twice: an over-payment is refused', async () => {
  db = seed();
  await refund({ outcome: 'keep' });
  const over = await call(action, { action: 'mark_received', method: 'Cash', amount: 70.01 });
  assert.equal(over.status, 409);
});

test('a partial refund that keeps the appointment leaves the right amount owing, not the full price', async () => {
  db = seed();
  await refund({ outcome: 'keep', amount: 5 });
  assert.equal(pay().state, 'deposit_due');
  assert.equal(owing(), 55, '$70 less the $15 still held');

  // Paid in full, then $10 back: only $10 is owing.
  db = seed({ state: 'paid_in_full', amount_paid: 70 });
  await refund({ outcome: 'keep', amount: 10 });
  assert.equal(pay().state, 'balance_due');
  assert.equal(owing(), 10);
  assert.equal(booking().status, 'confirmed');
});

// ── 2. Refund and cancel ─────────────────────────────────────────────────────────────────────
test('refund and cancel: the booking is cancelled, the payment is settled, nothing is owing, no further payment is accepted', async () => {
  db = seed();
  const r = await refund({ outcome: 'cancel' });
  assert.equal(r.status, 200);
  assert.equal(r.json.cancelled, true);
  assert.equal(booking().status, 'declined');
  assert.equal(pay().state, 'refunded');
  assert.equal(owing(), 0);
  assert.equal((await call(action, { action: 'mark_received', method: 'Cash' })).status, 409);
  assert.equal((await call(action, { action: 'request_link', expected_op_seq: pay().op_seq })).status, 409);
  assert.equal((await call(checkout, { action: 'pay_offline', method: 'Cash' })).status === 200, false);
});

// ── 3. A cancellation asks what happens to the deposit ───────────────────────────────────────
test('cancelling a booking that holds a deposit refuses to complete until the question is answered', async () => {
  db = seed();
  const r = await call(decline, { reason: 'Customer cancelled' });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, 'DEPOSIT_DECISION_REQUIRED');
  assert.equal(r.json.refundable, 20);
  assert.notEqual(booking().status, 'declined');
  assert.equal(refundCalls().length, 0);
  // An answer that is not one of the three is no answer.
  assert.equal((await call(decline, { reason: 'x', deposit_decision: { kind: 'maybe' } })).status, 409);
  assert.equal((await call(decline, { reason: 'x', deposit_decision: { kind: 'partial' } })).status, 409);
  assert.equal((await call(decline, { reason: 'x', deposit_decision: { kind: 'partial', amount: 21 }, expected_op_seq: 0 })).status, 409);
  assert.equal((await call(decline, { reason: 'x', deposit_decision: { kind: 'retained' } })).status, 409);
  assert.notEqual(booking().status, 'declined');
});

test('cancelling with a FULL refund refunds what is held, settles the payment and cancels', async () => {
  db = seed();
  const r = await call(decline, { reason: 'Customer cancelled', deposit_decision: { kind: 'full' }, expected_op_seq: 0 });
  assert.equal(r.status, 200);
  assert.equal(booking().status, 'declined');
  assert.equal(refundCalls().length, 1);
  assert.equal(refundCalls()[0].body.amount_money.amount, 2000);
  assert.equal(pay().state, 'refunded');
  assert.equal(owing(), 0);
});

test('cancelling with a PARTIAL refund refunds only that amount', async () => {
  db = seed();
  const r = await call(decline, { reason: 'Customer cancelled', deposit_decision: { kind: 'partial', amount: 5 }, expected_op_seq: 0 });
  assert.equal(r.status, 200);
  assert.equal(booking().status, 'declined');
  assert.equal(refundCalls()[0].body.amount_money.amount, 500);
  assert.equal(pay().state, 'partially_refunded');
  assert.equal(pay().amount_refunded, 5);
});

test('cancelling with the deposit RETAINED is a decision: it needs a reason, writes an audit row and an event, and refunds nothing', async () => {
  db = seed();
  const r = await call(decline, { reason: 'Customer cancelled', deposit_decision: { kind: 'retained', reason: 'Late cancellation, inside 24 hours' } });
  assert.equal(r.status, 200);
  assert.equal(booking().status, 'declined');
  assert.equal(refundCalls().length, 0);
  assert.equal(pay().state, 'deposit_paid', 'the payment is untouched');
  assert.equal(pay().amount_refunded, 0);
  const audit = db.table('ActivityLog').find((x) => x.action === 'payment_deposit_retained');
  assert.ok(audit, 'an audit row names the decision');
  assert.match(audit.detail, /Late cancellation/);
  const ev = db.table('PaymentEvent').find((e) => e.event_type === 'deposit_retained');
  assert.match(ev.note, /Late cancellation/);
});

test('if the refund is refused, the booking is NOT cancelled', async () => {
  db = seed();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (String(url).endsWith('/refunds') ? { ok: false, status: 400, json: async () => ({ errors: [{ code: 'REFUND_DECLINED', detail: 'no' }] }) } : real(url, init));
  const r = await call(decline, { reason: 'Customer cancelled', deposit_decision: { kind: 'full' }, expected_op_seq: 0 });
  assert.notEqual(r.status, 200);
  assert.notEqual(booking().status, 'declined');
  assert.equal(pay().amount_refunded, 0);
  globalThis.fetch = real;
});

test('a booking that holds nothing is cancelled without a question', async () => {
  db = seed({ state: 'deposit_due', amount_paid: 0 });
  const r = await call(decline, { reason: 'Customer cancelled' });
  assert.equal(r.status, 200);
  assert.equal(booking().status, 'declined');
});

// ── 4. Status and payment state are independent ──────────────────────────────────────────────
test('a cancelled booking can hold any payment state, and a refunded payment can sit on an active booking', async () => {
  // A cancelled booking whose deposit was retained still holds deposit_paid.
  db = seed();
  await call(decline, { reason: 'Customer cancelled', deposit_decision: { kind: 'retained', reason: 'Policy applies' } });
  assert.equal(booking().status, 'declined');
  assert.equal(pay().state, 'deposit_paid');

  // A refund made in Square's own dashboard settles the payment and leaves the booking exactly as it was.
  db = seed({ provider_payment_id: 'PAY1' });
  const parsed = events.parseSquareEvent({ event_id: 'e2', type: 'refund.updated', data: { object: { refund: { id: 'RFX', payment_id: 'PAY1', order_id: 'O', status: 'COMPLETED', amount_money: { amount: 2000, currency: 'AUD' } } } } });
  const plan = events.planRefundEvent(parsed, pay());
  assert.equal(plan.kind, 'apply');
  assert.equal(plan.fields.state, 'refunded');
  assert.equal(booking().status, 'confirmed', 'an active booking with a refunded payment');
  assert.equal(Object.hasOwn(plan.fields, 'status'), false);

  // Every payment state can be reached with the booking either way: the pure rules never mention a booking.
  for (const st of ['not_required', 'deposit_due', 'deposit_paid', 'balance_due', 'paid_in_full', 'refund_pending', 'refunded', 'partially_refunded', 'written_off']) {
    assert.doesNotThrow(() => state.amountOwing({ state: st, total_amount: 70, deposit_amount: 20, amount_paid: 20, amount_refunded: 0 }));
  }
});

test('source guard: no payment code sets a booking status, and the cancel code never reads a payment state', () => {
  for (const f of ['paymentState', 'refundService', 'squareEvents', 'offlinePayment', 'paymentLink']) {
    const src = read(`base44/shared/${f}.ts`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.doesNotMatch(src, /BookingRequest\.update\([^)]*\bstatus\s*:/s, `${f} does not write a booking status`);
    assert.doesNotMatch(src, /declineBooking|bookingCancel/, `${f} does not cancel a booking`);
  }
  assert.doesNotMatch(read('base44/shared/bookingCancel.ts'), /paymentState|BookingPayment|amount_paid/, 'cancelling a booking does not look at payment');
  // The one place a refund and a cancellation meet is an explicit choice made on the request.
  assert.match(read('base44/functions/paymentAction/entry.ts'), /if \(outcome === 'cancel'\)/);
});

// ── 5. One answer to "what is owing" ─────────────────────────────────────────────────────────
test('the screen\'s owing equals amountOwing() in every state, refunds included', () => {
  const states = ['not_required', 'deposit_due', 'deposit_paid', 'balance_due', 'paid_in_full', 'refund_pending', 'refunded', 'partially_refunded', 'written_off'];
  let compared = 0;
  for (const st of states) for (const deposit of [0, 20]) for (const paid of [0, 20, 70]) for (const refunded of [0, 5, 20]) {
    if (refunded > paid) continue;
    const m = { state: st, total_amount: 70, deposit_amount: deposit, amount_paid: paid, amount_refunded: refunded };
    assert.equal(owingCopy.amountOwing(owingCopy.toMoney(m)), state.amountOwing(state.toMoney(m)), JSON.stringify(m));
    assert.equal(owingCopy.refundableAmount(owingCopy.toMoney(m)), state.refundableAmount(state.toMoney(m)), `refundable ${JSON.stringify(m)}`);
    assert.equal(owingCopy.owedAfterService(owingCopy.toMoney(m)), msgs.owedAfterService(m), `owedAfterService ${JSON.stringify(m)}`);
    compared += 1;
  }
  assert.ok(compared > 100);
});

test('source guard: no screen does owing arithmetic of its own', () => {
  const card = read('src/components/payments/PaymentCard.jsx');
  const actions = read('src/components/payments/PaymentActions.jsx');
  assert.match(card, /amountOwing\(toMoney\(pay\)\)/);
  assert.doesNotMatch(card + actions, /total_amount\s*-|deposit_amount\s*-|amount_paid\s*-|-\s*pay\.amount_paid/);
  assert.doesNotMatch(read('base44/functions/routeCheckout/entry.ts'), /total_amount \|\| 0\) - \(payment\.amount_paid/);
  // The Route tab tells the barber what to collect at the door, so it must not subtract either.
  const stopSrc = read('src/lib/stopPayment.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(stopSrc, /total_amount \|\| 0\) - \(/, 'stopPayment does not subtract');
  assert.match(stopSrc, /from '\.\/paymentOwing\.js'/);
  // The summary tiles are an aggregate, so they cannot call amountOwing per row — but they must
  // still measure against what is held, never against everything ever received.
  const owingSrc = read('src/lib/paymentOwing.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(owingSrc, /total - paid|dep - paid/, 'the tiles account for refunds');
  assert.doesNotMatch(read('src/lib/paymentApi.js'), /outstandingBalances/, 'the tiles live with the money rules');
});

test('the Route tab asks for the right money after a refund that kept the appointment', () => {
  // $70 booking, $20 deposit paid then refunded with the appointment kept: the whole $70 is owed.
  const kept = { state: 'deposit_due', total_amount: 70, deposit_amount: 20, amount_paid: 20, amount_refunded: 20 };
  assert.equal(stop.owedAtCheckout(kept), 70, 'checkout collects $70, not $50');
  assert.equal(msgs.owedAfterService(kept), stop.owedAtCheckout(kept), 'the screen matches what the server charges');
  assert.equal(stop.settledAtCheckout(kept), false);
  assert.equal(stop.collectable(kept), true, 'a refunded deposit is not an unpaid deposit: the balance is collectable');
  assert.equal(stop.owingOf(kept), 70);

  // A partial refund that kept the appointment leaves exactly that amount owing, not nothing.
  const partial = { state: 'balance_due', total_amount: 70, deposit_amount: 20, amount_paid: 70, amount_refunded: 10 };
  assert.equal(stop.owedAtCheckout(partial), 10);
  assert.equal(stop.owingOf(partial), 10);
  assert.equal(stop.collectable(partial), true);

  // An ordinary unpaid deposit is unchanged: the door asks for the whole price, the panel does not.
  const unpaid = { state: 'deposit_due', total_amount: 70, deposit_amount: 20, amount_paid: 0, amount_refunded: 0 };
  assert.equal(stop.owedAtCheckout(unpaid), 70);
  assert.equal(stop.collectable(unpaid), false, 'an unpaid deposit is the open ask, not a balance');
});

test('the payments tiles still count money owed after a refund that kept the appointment', () => {
  // Exactly what the live screen showed on 20 Oct: one $130 booking with a $20 deposit paid, and
  // one $70 booking whose $20 deposit was refunded with the appointment kept, so $70 is owed.
  const all = [
    { state: 'deposit_paid', sum_total_amount: 130, sum_deposit_amount: 20, sum_amount_paid: 20, sum_amount_refunded: 0 },
    { state: 'deposit_due', sum_total_amount: 70, sum_deposit_amount: 20, sum_amount_paid: 20, sum_amount_refunded: 20 },
  ];
  const refunded = [
    { state: 'deposit_due', sum_total_amount: 70, sum_deposit_amount: 20, sum_amount_paid: 20, sum_amount_refunded: 20 },
  ];
  const s = owingCopy.summarise(all, refunded);
  assert.equal(s.collected, 20, 'the refunded $20 is no longer collected');
  assert.equal(s.outstandingDeposits, 0, 'no deposit is still being asked for');
  assert.equal(s.outstandingBalances, 180, '$110 on the first booking plus the $70 now owed on the second');
  // The old rule lost the $70 entirely: deposit_due contributed 20-20=0 and was excluded from balances.
  assert.notEqual(s.outstandingBalances, 110);
});

test('the tiles keep ordinary unpaid deposits as deposits, and count partial refunds on a balance', () => {
  // An ordinary unpaid deposit is untouched.
  const plain = owingCopy.summarise([
    { state: 'deposit_due', sum_total_amount: 70, sum_deposit_amount: 20, sum_amount_paid: 0, sum_amount_refunded: 0 },
  ], []);
  assert.equal(plain.outstandingDeposits, 20);
  assert.equal(plain.outstandingBalances, 0);

  // Two deposit_due bookings, only one of them refunded: they must not be averaged together.
  const mixed = owingCopy.summarise([
    { state: 'deposit_due', sum_total_amount: 140, sum_deposit_amount: 40, sum_amount_paid: 20, sum_amount_refunded: 20 },
  ], [
    { state: 'deposit_due', sum_total_amount: 70, sum_deposit_amount: 20, sum_amount_paid: 20, sum_amount_refunded: 20 },
  ]);
  assert.equal(mixed.outstandingDeposits, 20, 'the unrefunded booking still owes its $20 deposit');
  assert.equal(mixed.outstandingBalances, 70, 'the refunded one owes its whole $70');

  // A partial refund that kept the appointment leaves the rest on the balance.
  const partial = owingCopy.summarise([
    { state: 'balance_due', sum_total_amount: 70, sum_deposit_amount: 20, sum_amount_paid: 70, sum_amount_refunded: 10 },
  ], []);
  assert.equal(partial.outstandingBalances, 10, 'total - (paid - refunded), not total - paid');
  assert.equal(partial.collected, 60);
});

test('the customer is not told a deposit is needed when their deposit has just been refunded', () => {
  const booking = { price: 70 };
  const kept = { state: 'deposit_due', total_amount: 70, deposit_amount: 20, amount_paid: 20, amount_refunded: 20 };
  assert.equal(line.paymentLineFor(booking, kept, null), '$70.00 due after your service.');
  // An ordinary unpaid deposit still reads as a deposit.
  const unpaid = { state: 'deposit_due', total_amount: 70, deposit_amount: 20, amount_paid: 0, amount_refunded: 0 };
  assert.match(line.paymentLineFor(booking, unpaid, null), /\$20\.00 deposit is needed/);
});

test('every screen that can cancel a booking asks what happens to the deposit', () => {
  // Derived, not listed: a hand-written list silently stops guarding anything when a screen is
  // deleted or renamed. The Needs Review page was removed on 21 Oct and its card left orphaned,
  // which an entry in a list would have kept "passing" forever.
  const screens = walk('src/').filter((f) => /\.jsx$/.test(f) && /declineBookingRequest\s*\(/.test(read(f)));
  assert.ok(screens.length >= 2, `found ${screens.length} screens that decline`);
  for (const f of screens) {
    const src = read(f);
    const asks = /CancelDepositChoice|deposit_decision/.test(src);
    // Or it hands over to a dialog that asks, rather than declining blind.
    const handsOver = /DeclineRequestModal/.test(src) || /setShowDecline\(true\)/.test(src);
    // Or it is the page that only passes on a decision a child collected (the Calendar does this:
    // AppointmentDetailPanel shows the chooser and hands the answer up).
    const forwards = /\.\.\.deposit\b/.test(src);
    assert.ok(asks || handsOver || forwards, `${f} declines without asking what happens to the deposit`);
  }
  // Orphaned screens are covered by tests/heldBookingApproval.test.mjs, which is where the
  // Needs Review page's removal actually bites.
  // The Requests status dropdown must not fire a blind decline: it hands over to the dialog that asks.
  const rc = read('src/components/requests/RequestCard.jsx');
  assert.doesNotMatch(rc, /declineBookingRequest\(/, 'RequestCard does not decline without asking');
  assert.match(rc, /setShowDecline\(true\)/);
});

// ── 6. The 18 October refund path still works end to end ─────────────────────────────────────
test('refund and cancel with Square answering PENDING: claimed, one audit row first, then PENDING and COMPLETED webhooks, each applied once', async () => {
  db = seed();
  square.refundStatus = 'PENDING';
  const r = await refund({ outcome: 'cancel' });
  assert.equal(r.status, 200);
  assert.equal(pay().state, 'refund_pending');
  assert.equal(pay().op_seq, 1, 'the intent was claimed');
  assert.equal(pay().intent_key ?? null, null, 'and released by the single settling write');
  assert.ok(refundCalls()[0].key, 'Square got the idempotency key from the claim');
  assert.equal(square.auditRowsAtRefund, 1);
  assert.equal(db.table('ActivityLog').filter((x) => x.action === 'payment_refund').length, 1);
  assert.deepEqual(pay().provider_refund_ids, ['RF1']);

  const ev = (id, status) => events.parseSquareEvent({ event_id: id, type: 'refund.updated', data: { object: { refund: { id: 'RF1', payment_id: 'PAY1', order_id: 'O', status, amount_money: { amount: 2000, currency: 'AUD' } } } } });
  const pending = events.planRefundEvent(ev('w1', 'PENDING'), pay());
  assert.equal(pending.kind, 'ignore', 'PENDING changes nothing: it was already recorded');
  const done = events.planRefundEvent(ev('w2', 'COMPLETED'), pay());
  assert.equal(done.kind, 'apply');
  assert.equal(done.fields.state, 'refunded');
  const again = events.planRefundEvent(ev('w3', 'COMPLETED'), { ...pay(), ...done.fields });
  assert.equal(again.kind, 'ignore', 'applied once');
});

// ── 7. Who may refund or cancel ──────────────────────────────────────────────────────────────
test('only an admin can refund or cancel, and automation is refused', async () => {
  db = seed();
  assert.equal((await call(action, { action: 'refund', outcome: 'keep', amount: 5, reason: 'abc', expected_op_seq: 0 }, USER)).status, 403);
  assert.equal((await call(decline, { reason: 'x', deposit_decision: { kind: 'full' }, expected_op_seq: 0 }, USER)).status, 403);
  assert.equal((await call(action, { action: 'refund', outcome: 'keep', amount: 5, reason: 'abc', expected_op_seq: 0 }, ADMIN, { 'x-workflow-run': 'run-1' })).status, 403);
  assert.equal((await call(decline, { reason: 'x', deposit_decision: { kind: 'full' }, expected_op_seq: 0 }, ADMIN, { 'x-workflow-run': 'run-1' })).status, 403);
  assert.equal(refundCalls().length, 0);
  assert.equal(pay().amount_refunded, 0);
  assert.notEqual(booking().status, 'declined');
});