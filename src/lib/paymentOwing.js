// Frontend copy of the owing rules in base44/shared/paymentState.ts (the frontend cannot import from
// base44/). The server's amountOwing() is the only source of truth; tests/refundChoice.test.mjs runs both
// over every state and fails if they ever disagree. Screens call these and do no owing arithmetic of their own.
const r2 = (n) => Math.round(n * 100) / 100;
const RECEIVES = ['not_required', 'deposit_due', 'deposit_paid', 'balance_due'];
const REFUNDABLE = ['deposit_paid', 'balance_due', 'paid_in_full', 'partially_refunded', 'not_required'];

export const toMoney = (p) => ({
  state: p.state, total_amount: p.total_amount || 0, deposit_amount: p.deposit_amount || 0,
  amount_paid: p.amount_paid || 0, amount_refunded: p.amount_refunded || 0,
});

export const netPaid = (p) => r2(Math.max(0, p.amount_paid - p.amount_refunded));

export function amountOwing(p) {
  if (p.state === 'deposit_due' && p.amount_refunded <= 0) return r2(Math.max(0, p.deposit_amount - p.amount_paid));
  if (RECEIVES.includes(p.state)) return r2(Math.max(0, p.total_amount - netPaid(p)));
  return 0;
}

/**
 * What is owed once the service has been delivered. At the door an unpaid deposit is no longer a
 * separate ask, so the whole unpaid amount is owed. The twin of owedAfterService() in
 * base44/shared/paymentMessages.ts, and compared against it by the parity test.
 */
export const owedAfterService = (p) =>
  amountOwing(toMoney({ ...p, state: p.state === 'deposit_due' ? 'balance_due' : p.state }));

export const refundableAmount = (p) =>
  REFUNDABLE.includes(p.state) ? Math.max(0, r2(p.amount_paid - p.amount_refunded)) : 0;

export const REFUND_OUTCOME_LABELS = {
  keep: 'Refund only — the appointment still stands',
  cancel: 'Refund and cancel the booking',
};

const BALANCE_STATES = ['not_required', 'deposit_paid', 'balance_due'];

/**
 * Summary figures from per-state totals (see PaymentSummary). These follow the same rule as
 * amountOwing(): what is owed is measured against what is still HELD (paid less refunded), never
 * against everything ever received.
 *
 * `refundedRows` is the same aggregate restricted to payments that have been refunded at all. It is
 * needed because a refund that kept the appointment leaves the payment in `deposit_due` with the
 * whole amount owed, not a deposit — and a per-state sum alone cannot tell those rows apart from
 * ordinary unpaid deposits. Passing nothing keeps the old behaviour for callers that have no
 * refunds to account for.
 */
export function summarise(rows, refundedRows = []) {
  const refundedByState = new Map((refundedRows || []).map((r) => [r.state, r]));
  const s = { expected: 0, collected: 0, outstandingDeposits: 0, outstandingBalances: 0 };
  for (const r of rows) {
    const total = r.sum_total_amount || 0, dep = r.sum_deposit_amount || 0, paid = r.sum_amount_paid || 0, ref = r.sum_amount_refunded || 0;
    s.collected += paid - ref;
    if (!['refunded', 'written_off'].includes(r.state)) s.expected += total;
    // A balance is what is left of the total after what is still held, so a refund puts money back
    // on the bill. `total - paid` forgot the refund and under-counted.
    if (BALANCE_STATES.includes(r.state)) s.outstandingBalances += Math.max(0, total - (paid - ref));
    if (r.state === 'deposit_due') {
      const q = refundedByState.get('deposit_due') || {};
      const qTotal = q.sum_total_amount || 0, qDep = q.sum_deposit_amount || 0;
      const qPaid = q.sum_amount_paid || 0, qRef = q.sum_amount_refunded || 0;
      // Only the rows with no refund are still a deposit ask.
      s.outstandingDeposits += Math.max(0, (dep - qDep) - (paid - qPaid));
      // The rest had their deposit refunded with the appointment kept: the whole amount is owed.
      s.outstandingBalances += Math.max(0, qTotal - (qPaid - qRef));
    }
  }
  return s;
}
