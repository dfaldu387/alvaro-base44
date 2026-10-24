import { base44 } from '@/api/base44Client';

// Every payment change goes through the gated server function. Nothing here writes payment state directly.
export async function paymentAction(action, bookingRequestId, extra = {}) {
  try {
    const res = await base44.functions.invoke('paymentAction', { action, booking_request_id: bookingRequestId, ...extra });
    return { ok: true, payment: res.data?.payment };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.error || e?.message || 'Could not complete that.' };
  }
}

// Payment actions a barber can take from the Route tab (and an admin from a payment card): text the payment link, or record cash.
export async function routePayment(action, bookingRequestId) {
  try {
    const res = await base44.functions.invoke('routePayment', { action, booking_request_id: bookingRequestId });
    return { ok: true, ...res.data };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.error || e?.message || 'Could not complete that.' };
  }
}

export const STATE_LABELS = {
  not_required: 'No deposit', deposit_due: 'Deposit due', deposit_paid: 'Deposit paid', balance_due: 'Balance due',
  paid_in_full: 'Paid in full', refund_pending: 'Refund pending', refunded: 'Refunded',
  partially_refunded: 'Partly refunded', written_off: 'Written off',
};

export const money = (n) => `$${(Number(n) || 0).toFixed(2)}`;
