// What the Route tab shows about the money still owing at a completed stop. Pure.
// Every amount here comes from the shared owing rules; this file does no arithmetic of its own,
// so a refund that kept the appointment is counted the same way the server counts it.
import { amountOwing, owedAfterService, toMoney } from './paymentOwing.js';

const BALANCE_STATES = ['not_required', 'deposit_paid', 'balance_due'];

export const owingOf = (p) => amountOwing(toMoney(p));

/**
 * A balance can be collected here: something is owing and no unpaid deposit is the open ask.
 * A refund that kept the appointment leaves the state at deposit_due with money already refunded;
 * that is not an unpaid deposit, it is the whole amount owed again, so it belongs here too.
 */
export const collectable = (p) => !!p
  && (BALANCE_STATES.includes(p.state) || (p.state === 'deposit_due' && (p.amount_refunded || 0) > 0))
  && owingOf(p) > 0;

// At the door the service has been delivered, so an unpaid deposit is no longer a separate
// ask: the whole unpaid amount is owed. Mirrors what the checkout endpoint collects.
const CHECKOUT_PAYABLE = ['not_required', 'deposit_due', 'deposit_paid', 'balance_due'];

export const owedAtCheckout = (p) => (p && CHECKOUT_PAYABLE.includes(p.state)) ? owedAfterService(toMoney(p)) : 0;

/** Nothing left to collect, so the checkout flow can move on. */
export const settledAtCheckout = (p) => !!p && owedAtCheckout(p) <= 0;

/** One plain sentence about the balance text: sent, waiting, held back, failed, or not made. */
export function linkStatusLine(pay, msg) {
  if (msg?.status === 'sent') return 'Payment link texted to the customer.';
  if (msg?.status === 'pending' || msg?.status === 'claimed') return 'Payment link text is queued.';
  if (msg?.status === 'suppressed') return `Payment link text was not sent: ${msg.suppressed_reason || 'held back'}.`;
  if (msg?.status === 'dead_letter') return 'The payment link text failed. Check Messages.';
  if (pay?.needs_attention) return pay.attention_reason || 'The payment link could not be made.';
  return 'No payment link has been texted yet.';
}
