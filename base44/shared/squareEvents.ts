import { receivePayment, recordRefund, resolveRefund, toMoney } from './paymentState.ts';

/**
 * What a verified Square event means for one booking's payment. Pure: it reads the stored row and
 * returns a plan. It never decides what a payment STATE becomes; every transition comes from
 * paymentState.ts (receivePayment, recordRefund, resolveRefund). The webhook applies the plan.
 */
export const HANDLED_EVENT_TYPES = ['payment.updated', 'refund.updated'] as const;
export const WEBHOOK_ACTOR = 'Square webhook';

export interface ParsedSquareEvent {
  eventId: string;
  type: string;
  payment?: { id: string; orderId: string; status: string; cents: number; currency: string };
  refund?: { id: string; paymentId: string; orderId: string; status: string; cents: number; currency: string };
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** null = malformed (missing event id, or a handled type without its payment / refund object). */
export function parseSquareEvent(body: any): ParsedSquareEvent | null {
  const eventId = str(body?.event_id);
  const type = str(body?.type);
  if (!eventId || !type) return null;
  const obj = body?.data?.object;
  if (type === 'payment.updated') {
    const p = obj?.payment;
    if (!str(p?.id)) return null;
    return { eventId, type, payment: { id: str(p.id), orderId: str(p.order_id), status: str(p.status), cents: Number(p.amount_money?.amount), currency: str(p.amount_money?.currency) } };
  }
  if (type === 'refund.updated') {
    const r = obj?.refund;
    if (!str(r?.id)) return null;
    return { eventId, type, refund: { id: str(r.id), paymentId: str(r.payment_id), orderId: str(r.order_id), status: str(r.status), cents: Number(r.amount_money?.amount), currency: str(r.amount_money?.currency) } };
  }
  return { eventId, type };
}

/** The ids Square echoes that a stored provider_payment_id may equal. */
export function lookupIds(e: ParsedSquareEvent): string[] {
  const ids = e.payment ? [e.payment.orderId, e.payment.id] : e.refund ? [e.refund.paymentId, e.refund.orderId] : [];
  return [...new Set(ids.filter(Boolean))];
}

export type Plan =
  | { kind: 'ignore'; reason: string; record: boolean }
  | { kind: 'retry'; reason: string }
  | { kind: 'apply'; eventType: 'provider_webhook_payment' | 'provider_webhook_refund'; filter: Record<string, any>; fields: Record<string, any>; amount: number; note: string };

const ignore = (reason: string, record = false): Plan => ({ kind: 'ignore', reason, record });
const dollars = (cents: number) => Math.round(cents) / 100;

export function planPaymentEvent(e: ParsedSquareEvent, pay: any): Plan {
  const p = e.payment!;
  if (p.status !== 'COMPLETED') return ignore('payment_not_completed');
  // Already applied: the stored id has been replaced by the real payment id. Square sends several
  // updates for one payment, each with its own event id, so this is what stops a double count.
  if (pay.provider_payment_id === p.id) return ignore('payment_already_applied');
  if (!p.orderId || pay.provider_payment_id !== p.orderId) return ignore('no_open_payment_link');
  if (p.currency !== (pay.currency || 'AUD')) return ignore('currency_mismatch', true);
  if (!(p.cents > 0)) return ignore('no_amount', true);
  const amount = dollars(p.cents);
  const r = receivePayment(toMoney(pay), amount);
  // Out of order or already settled (paid in full, refunded, written off...): never walk it backwards.
  if (!r.ok) return ignore(`not_applied: ${r.error}`, true);
  return {
    kind: 'apply',
    eventType: 'provider_webhook_payment',
    filter: { id: pay.id, provider_payment_id: p.orderId, state: pay.state, amount_paid: pay.amount_paid || 0 },
    fields: { ...r.next, provider_payment_id: p.id, payment_method: 'Provider', payment_link_url: '', payment_link_expires_at: null, updated_by: WEBHOOK_ACTOR },
    amount,
    note: `Square payment completed: $${amount.toFixed(2)} received.`,
  };
}

export function planRefundEvent(e: ParsedSquareEvent, pay: any): Plan {
  const rf = e.refund!;
  // Matched only by order id: the payment itself has not been recorded yet. Ask Square to retry later.
  // (A payment link made after a kept-appointment refund replaces the stored id, so replaced ids count too.)
  if (pay.provider_payment_id !== rf.paymentId && !(pay.replaced_provider_payment_ids || []).includes(rf.paymentId)) return { kind: 'retry', reason: 'payment_not_recorded_yet' };
  if (rf.status !== 'COMPLETED' && rf.status !== 'PENDING') return ignore('refund_not_completed', true);
  const cur = toMoney(pay);
  const known: string[] = pay.provider_refund_ids || [];
  const filter = { id: pay.id, state: pay.state, amount_refunded: pay.amount_refunded || 0 };

  if (known.includes(rf.id)) {
    // A refund this app started: only a pending one needs settling.
    if (rf.status !== 'COMPLETED' || pay.state !== 'refund_pending') return ignore('refund_already_recorded');
    const r = resolveRefund(cur);
    if (!r.ok) return ignore(`not_applied: ${r.error}`, true);
    return { kind: 'apply', eventType: 'provider_webhook_refund', filter, fields: { ...r.next, updated_by: WEBHOOK_ACTOR }, amount: dollars(rf.cents), note: 'Square confirmed the pending refund as paid out.' };
  }

  // A refund made outside this app (for example in the Square dashboard).
  if (rf.currency !== (pay.currency || 'AUD')) return ignore('currency_mismatch', true);
  const amount = dollars(rf.cents);
  const r = recordRefund(cur, amount, rf.status === 'COMPLETED' ? 'succeeded' : 'pending', 'Refund made in Square');
  if (!r.ok) {
    // Another refund is still settling: try again once it has.
    if (pay.state === 'refund_pending') return { kind: 'retry', reason: 'another_refund_pending' };
    return ignore(`not_applied: ${r.error}`, true);
  }
  return {
    kind: 'apply',
    eventType: 'provider_webhook_refund',
    filter,
    fields: { ...r.next, provider_refund_ids: [...known, rf.id], updated_by: WEBHOOK_ACTOR },
    amount,
    note: `Square refund ${rf.status === 'COMPLETED' ? 'completed' : 'pending'}: $${amount.toFixed(2)}.`,
  };
}