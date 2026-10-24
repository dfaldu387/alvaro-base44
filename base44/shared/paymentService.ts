import { evaluateDeposit, type DepositDecision } from './depositRules.ts';
import { queueLinkMessage } from './paymentMessages.ts';
import { byAge } from './outboxCanonical.ts';
import type { PaymentProvider } from './paymentProvider.ts';

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const r2 = (n: number) => Math.round(n * 100) / 100;

export async function loadDepositRules(admin: any): Promise<any | null> {
  return asList(await admin.entities.DepositRules.list('-created_date', 1))[0] || null;
}

/** The real risk inputs for a booking: new client, after-hours, group size, no-shows from NoShowRecord. */
export async function evaluateForBooking(admin: any, booking: any, rules: any): Promise<DepositDecision> {
  let isNewClient = true;
  let noShowCount = 0;
  if (booking.client_id) {
    const earlier = asList(await admin.entities.BookingRequest.filter({ client_id: booking.client_id, status: 'completed' }, '-created_date', 1));
    isNewClient = earlier.length === 0;
    noShowCount = asList(await admin.entities.NoShowRecord.filter({ client_id: booking.client_id }, '-created_date', 200)).length;
  }
  return evaluateDeposit({
    price: booking.price || 0,
    people: booking.people_count || 1,
    isNewClient,
    noShowCount,
    isAfterHours: !!(booking.after_hours_mode || booking.after_hours_slot),
    isTest: booking.is_test === true,
  }, rules);
}

export async function recordEvent(admin: any, e: Record<string, any>) {
  await admin.entities.PaymentEvent.create(e);
}

/**
 * Creates the one BookingPayment row of a booking. The entity layer has no unique constraint and a booking
 * can reach this from two places at once (the public path and the new-booking workflow), so after creating
 * its row each writer reads every row for the booking: the OLDEST is the row, any other is removed by the
 * writer that made it. `mine` says whether the returned row is the caller's own.
 */
export async function createPaymentRowOnce(admin: any, data: Record<string, any>) {
  const mine = await admin.entities.BookingPayment.create(data);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const rows = asList(await admin.entities.BookingPayment.filter({ booking_request_id: data.booking_request_id }, 'created_date', 20));
  const survivor = rows.length ? [...rows].sort(byAge)[0] : mine;
  if (survivor.id === mine.id) return { payment: mine, mine: true };
  try { await admin.entities.BookingPayment.delete(mine.id); } catch { /* the survivor is still the only live row */ }
  return { payment: survivor, mine: false };
}

/**
 * Creates the BookingPayment row for a booking, evaluating the deposit rules. When a deposit is required
 * and `enqueue` is not false, the payment link is made and the deposit text queued (see paymentMessages).
 * Idempotent: a booking that already has a row is returned untouched.
 */
export async function createPaymentForBooking(admin: any, booking: any, opts: { enqueue?: boolean; provider?: PaymentProvider } = {}) {
  const existing = asList(await admin.entities.BookingPayment.filter({ booking_request_id: booking.id }, '-created_date', 1))[0];
  if (existing) return { payment: existing, decision: null, message: null, existing: true };

  const rules = await loadDepositRules(admin);
  const decision = await evaluateForBooking(admin, booking, rules);
  const total = r2(booking.price || 0);
  const { payment, mine } = await createPaymentRowOnce(admin, {
    booking_request_id: booking.id,
    client_id: booking.client_id || '',
    is_test: booking.is_test === true,
    state: decision.required ? 'deposit_due' : 'not_required',
    total_amount: total,
    deposit_amount: decision.required ? decision.amount : 0,
    amount_paid: 0,
    amount_refunded: 0,
    currency: 'AUD',
    rule_fired: decision.rules.join(','),
    deposit_reason: decision.required ? decision.reason_text : '',
    updated_by: 'system',
  });
  if (!mine) return { payment, decision: null, message: null, existing: true };
  await recordEvent(admin, {
    booking_request_id: booking.id, event_type: 'evaluated', to_state: payment.state,
    amount: decision.amount, actor: 'system', note: decision.required ? decision.reason_text : decision.note,
    is_test: booking.is_test === true,
  });
  const message = decision.required && opts.enqueue !== false
    ? await queueLinkMessage(admin, booking, 'deposit', { rules, provider: opts.provider, actor: 'System', automation: true })
    : null;
  return { payment, decision, message, existing: false };
}

/** Fields for a booking that predates payment state: Paid -> paid_in_full, Unpaid -> not_required. */
export function legacyPaymentFields(booking: any) {
  const total = r2(booking.price || 0);
  const paid = booking.payment_status === 'Paid';
  return {
    booking_request_id: booking.id,
    client_id: booking.client_id || '',
    is_test: booking.is_test === true,
    state: paid ? 'paid_in_full' : 'not_required',
    total_amount: total,
    deposit_amount: 0,
    amount_paid: paid ? total : 0,
    amount_refunded: 0,
    currency: 'AUD',
    payment_method: paid ? (booking.payment_method || '') : '',
    updated_by: 'migration',
  };
}