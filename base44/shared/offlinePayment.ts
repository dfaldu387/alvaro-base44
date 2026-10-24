import { amountOwing, receivePayment, toMoney } from './paymentState.ts';
import { recordAudit, finishAudit, AUDIT_REFUSED } from './auditLog.ts';
import { settlePendingLinkMessages } from './paymentMessages.ts';

/**
 * Money handed over in person (cash, a transfer, a card on the day), recorded for what is owing right now.
 * The state comes from paymentState.receivePayment and from nowhere else.
 *
 * It is ONE conditional write: it only lands if the payment is exactly as it was read and no Square
 * operation is in flight, and the request that wrote it proves it by the token it left behind. Two taps
 * therefore record the money once. The receipt and the stopping of any unsent payment text follow from the
 * PaymentEvent written here (see paymentMessages.handlePaymentEvent); the unsent text is also stopped
 * straight away.
 */
const orMissing = (v: number) => (v === 0 ? { $in: [0, null] } : v);

export async function recordOfflinePayment(
  admin: any,
  p: { booking: any; payment: any; method: string; actor: string },
): Promise<{ ok: true; payment: any } | { ok: false; status: number; error: string }> {
  const { booking, payment } = p;
  const cur = toMoney(payment);
  const amount = amountOwing(cur);
  const r = receivePayment(cur, amount);
  if (!r.ok) return { ok: false, status: 409, error: r.error };

  const auditBase = {
    action: 'payment_mark_received', who: p.actor, summary: 'Payment: payment received in person',
    ids: { booking_request_id: booking.id, payment_id: payment.id }, related: { type: 'BookingRequest' as const, id: booking.id },
  };
  const logId = await recordAudit(admin, { ...auditBase, note: `State was ${cur.state}` });
  if (!logId) return { ok: false, status: 500, error: AUDIT_REFUSED.error };

  const token = crypto.randomUUID();
  await admin.entities.BookingPayment.updateMany(
    { id: payment.id, state: payment.state, amount_paid: orMissing(Number(payment.amount_paid) || 0), intent_key: null },
    { $set: { ...r.next, payment_method: p.method, updated_by: p.actor, write_token: token, payment_link_url: '', payment_link_expires_at: null, needs_attention: false, attention_reason: '' } },
  );
  const after = await admin.entities.BookingPayment.get(payment.id);
  if (!after || after.write_token !== token) {
    await finishAudit(admin, logId, { ...auditBase, outcome: 'aborted', note: 'The payment changed at the same moment; nothing was recorded.' });
    return { ok: false, status: 409, error: 'This payment changed at the same moment, so nothing was recorded. Refresh and check before trying again.' };
  }
  await finishAudit(admin, logId, { ...auditBase, note: `${cur.state} → ${after.state}`, counts: { amount } });
  await admin.entities.PaymentEvent.create({
    booking_request_id: booking.id, event_type: 'payment_received', from_state: cur.state, to_state: after.state, amount,
    actor: p.actor, note: `Offline payment received (${p.method}).`, is_test: booking.is_test === true,
  });
  // Keep the earlier display field in step, as paymentAction does.
  const upd: Record<string, any> = { payment_status: after.state === 'paid_in_full' ? 'Paid' : 'Unpaid' };
  if (['Cash', 'Transfer', 'Card'].includes(p.method)) upd.payment_method = p.method;
  await admin.entities.BookingRequest.update(booking.id, upd);
  try { await settlePendingLinkMessages(admin, booking.id); } catch (e) { console.error('settle pending payment texts failed', (e as Error)?.message); }
  return { ok: true, payment: after };
}