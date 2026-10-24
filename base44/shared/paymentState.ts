/**
 * Payment state machine. Pure: each function takes the current amounts and
 * returns the fields to store, or an error. Only the paymentAction server
 * function applies the result; nothing in the browser can set a state.
 */
/**
 * Test data must never reach real money.
 *
 * The outbox has always suppressed every message for a test booking before the sender is reached
 * (processMessageOutbox). The money path had no equivalent — nothing in it looked at `is_test` at
 * all — so with SQUARE_ENVIRONMENT=production a `TEST` surname would have been issued a REAL
 * Square payment link.
 *
 * It refuses a LIVE provider only. Square sandbox stays allowed on purpose: running TEST bookings
 * through sandbox cards is how the payment screens are proven (docs/QA-REFUND-CHOICE.md), and
 * `provider.simulated` cannot make that distinction because sandbox is the real adapter against a
 * fake bank. Takes the two flags rather than the provider, so this module stays pure.
 *
 * Returns the refusal, or null when the call may proceed.
 */
export function testDataRefusal(providerIsLive: boolean, isTest: boolean): string | null {
  if (!isTest || !providerIsLive) return null;
  return 'This is test data and Square is in production, so no real payment can be made against it. '
    + 'Use a real booking, or switch SQUARE_ENVIRONMENT back to sandbox to exercise the payment screens.';
}

export type PaymentState =
  | 'not_required' | 'deposit_due' | 'deposit_paid' | 'balance_due' | 'paid_in_full'
  | 'refund_pending' | 'refunded' | 'partially_refunded' | 'written_off';

export interface Money {
  state: PaymentState;
  total_amount: number;
  deposit_amount: number;
  amount_paid: number;
  amount_refunded: number;
}
type Result = { ok: true; next: Partial<Money> & Record<string, any> } | { ok: false; error: string };

const r2 = (n: number) => Math.round(n * 100) / 100;
const err = (error: string): Result => ({ ok: false, error });

const RECEIVES: PaymentState[] = ['not_required', 'deposit_due', 'deposit_paid', 'balance_due'];
const LINKABLE: PaymentState[] = ['deposit_due', 'deposit_paid', 'balance_due', 'not_required'];
const REFUNDABLE: PaymentState[] = ['deposit_paid', 'balance_due', 'paid_in_full', 'partially_refunded', 'not_required'];

/** The money fields of a stored BookingPayment row, as the state machine reads them. */
export const toMoney = (p: any): Money => ({
  state: p.state, total_amount: p.total_amount || 0, deposit_amount: p.deposit_amount || 0,
  amount_paid: p.amount_paid || 0, amount_refunded: p.amount_refunded || 0,
});

/** Money the business is holding for this booking: received, less refunded. */
export const netPaid = (p: Money): number => r2(Math.max(0, p.amount_paid - p.amount_refunded));

/**
 * What the customer still owes right now. The ONE answer to that question: the server, the
 * messages and the screen all read it here, and it accounts for refunds. A deposit that has never
 * been refunded is the open ask (the deposit still to pay); once any of it has been refunded and the
 * booking kept, the whole of what is not held any more is owing.
 */
export function amountOwing(p: Money): number {
  if (p.state === 'deposit_due' && p.amount_refunded <= 0) return r2(Math.max(0, p.deposit_amount - p.amount_paid));
  if (RECEIVES.includes(p.state)) return r2(Math.max(0, p.total_amount - netPaid(p)));
  return 0;
}

/** What could still be refunded right now (0 in a state that cannot be refunded). */
export const refundableAmount = (p: Money): number =>
  REFUNDABLE.includes(p.state) ? Math.max(0, r2(p.amount_paid - p.amount_refunded)) : 0;

export function receivePayment(p: Money, amount: number): Result {
  if (!RECEIVES.includes(p.state)) return err(`A payment cannot be recorded while the booking is ${p.state.replace(/_/g, ' ')}.`);
  if (!(amount > 0)) return err('Enter an amount greater than $0.');
  // Judged on what is HELD (received less refunded); amount_paid keeps counting everything ever received.
  const held = r2(netPaid(p) + amount);
  if (held > p.total_amount + 0.001) return err('That is more than the booking total.');
  const state: PaymentState = held >= p.total_amount - 0.001
    ? 'paid_in_full'
    : p.deposit_amount > 0 && held >= p.deposit_amount - 0.001 ? 'deposit_paid'
    : p.deposit_amount > 0 ? 'deposit_due' : 'balance_due';
  return { ok: true, next: { state, amount_paid: r2(p.amount_paid + amount) } };
}

export function waiveDeposit(p: Money, reason: string, allowWaive: boolean): Result {
  if (!allowWaive) return err('Waiving deposits is switched off in Deposit Rules.');
  if (p.state !== 'deposit_due') return err('Only an outstanding deposit can be waived.');
  if (p.amount_paid > 0) return err('Part of the deposit is already paid, so it cannot be waived.');
  if (String(reason || '').trim().length < 3) return err('A reason is required to waive a deposit.');
  return { ok: true, next: { state: 'not_required', deposit_amount: 0, deposit_waived: true, waived_amount: p.deposit_amount } };
}

/** Gives up on money still owing. Needs a reason; only for a booking that owes something and has had no refund. */
export function writeOff(p: Money, reason: string): Result {
  if (!RECEIVES.includes(p.state)) return err(`A booking that is ${p.state.replace(/_/g, ' ')} cannot be written off.`);
  if (amountOwing(p) <= 0) return err('Nothing is owing on this booking.');
  if (String(reason || '').trim().length < 3) return err('A reason is required to write off a balance.');
  return { ok: true, next: { state: 'written_off' } };
}

/** Settles a pending refund once the provider confirms it (or the admin confirms it was paid out). */
export function resolveRefund(p: Money): Result {
  if (p.state !== 'refund_pending') return err('There is no pending refund on this booking.');
  const state: PaymentState = p.amount_refunded >= p.amount_paid - 0.001 ? 'refunded' : 'partially_refunded';
  return { ok: true, next: { state } };
}

export function canRequestLink(p: Money): Result {
  if (!LINKABLE.includes(p.state)) return err(`A payment link cannot be requested while the booking is ${p.state.replace(/_/g, ' ')}.`);
  if (amountOwing(p) <= 0) return err('Nothing is owing on this booking.');
  return { ok: true, next: {} };
}

export function recordRefund(p: Money, amount: number, providerStatus: 'succeeded' | 'pending', reason: string): Result {
  if (!REFUNDABLE.includes(p.state)) return err(`A refund cannot be recorded while the booking is ${p.state.replace(/_/g, ' ')}.`);
  if (String(reason || '').trim().length < 3) return err('A reason is required for a refund.');
  const refundable = r2(p.amount_paid - p.amount_refunded);
  if (!(amount > 0)) return err('Enter an amount greater than $0.');
  if (amount > refundable + 0.001) return err(`Only $${refundable.toFixed(2)} can still be refunded.`);
  const refunded = r2(p.amount_refunded + amount);
  const state: PaymentState = providerStatus === 'pending' ? 'refund_pending'
    : refunded >= p.amount_paid - 0.001 ? 'refunded' : 'partially_refunded';
  return { ok: true, next: { state, amount_refunded: refunded } };
}

/** What a refund means for the booking. Always chosen by the admin; there is no default. */
export type RefundOutcome = 'keep' | 'cancel';
export const REFUND_OUTCOMES: RefundOutcome[] = ['keep', 'cancel'];
export const REFUND_OUTCOME_LABELS: Record<RefundOutcome, string> = {
  keep: 'Refund only, the appointment still stands',
  cancel: 'Refund and cancel the booking',
};

/**
 * A refund with its meaning. When the appointment stands, the payment state returns to what is still owed
 * (deposit_due while a deposit is required and no longer held, otherwise balance_due), whatever the
 * provider's refund status is. When the booking is cancelled the refund settles exactly as recordRefund says.
 * This never reads or sets the booking's status: that is the caller's separate act.
 */
export function recordChosenRefund(p: Money, amount: number, providerStatus: 'succeeded' | 'pending', reason: string, outcome: string): Result {
  if (!REFUND_OUTCOMES.includes(outcome as RefundOutcome)) return err('Choose what this refund means: keep the appointment, or refund and cancel the booking.');
  const r = recordRefund(p, amount, providerStatus, reason);
  if (!r.ok || outcome === 'cancel') return r;
  const refunded = r2(p.amount_refunded + amount);
  const held = r2(p.amount_paid - refunded);
  const state: PaymentState = p.deposit_amount > 0 && held < p.deposit_amount - 0.001 ? 'deposit_due' : 'balance_due';
  return { ok: true, next: { state, amount_refunded: refunded } };
}

/** What happens to the money held when a booking is cancelled. Chosen by the admin, never assumed. */
export type DepositDecision =
  | { kind: 'full'; amount: number }
  | { kind: 'partial'; amount: number }
  | { kind: 'retained'; reason: string };

export function parseDepositDecision(raw: any, refundable: number): { ok: true; decision: DepositDecision } | { ok: false; error: string } {
  const kind = String(raw?.kind || '');
  if (kind === 'full') return { ok: true, decision: { kind, amount: r2(refundable) } };
  if (kind === 'partial') {
    const amount = r2(Number(raw?.amount));
    if (!(amount > 0)) return { ok: false, error: 'Enter the amount to refund.' };
    if (amount > refundable + 0.001) return { ok: false, error: `Only $${refundable.toFixed(2)} can still be refunded.` };
    return { ok: true, decision: { kind, amount } };
  }
  if (kind === 'retained') {
    const reason = String(raw?.reason || '').trim();
    if (reason.length < 3) return { ok: false, error: 'A reason is required to keep the deposit.' };
    return { ok: true, decision: { kind, reason } };
  }
  return { ok: false, error: `This booking holds $${refundable.toFixed(2)}. Choose what happens to it before cancelling: full refund, partial refund, or retained.` };
}