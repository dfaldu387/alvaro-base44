/**
 * The one sentence about money in the booking-confirmed text. Reads only; never writes.
 * Uses the booking's real payment record when it exists, otherwise the deposit decision the
 * deposit rules would make, otherwise the booking's own price. Never invents an amount.
 */
import { amountOwing, toMoney } from './paymentState.ts';

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const d = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export function paymentLineFor(booking: any, payment: any | null, decision: { required: boolean; amount: number } | null): string {
  if (payment) {
    const total = Number(payment.total_amount) || Number(booking?.price) || 0;
    const owing = amountOwing(toMoney({ ...payment, total_amount: total, state: payment.state === 'deposit_due' ? 'balance_due' : payment.state }));
    if (payment.state === 'paid_in_full') return 'Paid in full.';
    // A deposit is only still the open ask while none of it has been refunded. After a refund that
    // kept the appointment the state is deposit_due again, but the whole amount is owed, not a deposit.
    if (payment.state === 'deposit_due' && Number(payment.amount_refunded || 0) <= 0) {
      return `A ${d(Number(payment.deposit_amount) || 0)} deposit is needed to lock it in, sent in a separate text.`;
    }
    if (payment.state === 'deposit_paid') return owing > 0 ? `Deposit paid, ${d(owing)} due after your service.` : 'Paid in full.';
    return owing > 0 ? `${d(owing)} due after your service.` : 'Payment is due after your service.';
  }
  if (decision?.required) return `A ${d(decision.amount)} deposit is needed to lock it in, sent in a separate text.`;
  if (booking?.payment_status === 'Paid') return 'Paid in full.';
  const price = Number(booking?.price) || 0;
  return price > 0 ? `${d(price)} due after your service.` : 'Payment is due after your service.';
}

export async function loadPaymentLine(admin: any, booking: any): Promise<string> {
  const pay = asList(await admin.entities.BookingPayment.filter({ booking_request_id: booking.id }, 'created_date', 1))[0] || null;
  if (pay) return paymentLineFor(booking, pay, null);
  let decision: any = null;
  try {
    // Loaded on demand: the payment service pulls in the message code, so a top-level import would be a cycle.
    const svc = await import('./paymentService.ts');
    const rules = await svc.loadDepositRules(admin);
    if (rules?.enabled === true) decision = await svc.evaluateForBooking(admin, booking, rules);
  } catch { /* no decision: fall back to the booking's own price */ }
  return paymentLineFor(booking, null, decision);
}