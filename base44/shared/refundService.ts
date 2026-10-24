import { claimIntent, settleIntent, markIntentUnknown, releaseIntent } from './paymentIntent.ts';
import { recordAudit, finishAudit, AUDIT_REFUSED } from './auditLog.ts';
import { recordChosenRefund, testDataRefusal, toMoney, REFUND_OUTCOMES, REFUND_OUTCOME_LABELS, type RefundOutcome } from './paymentState.ts';
import { recordEvent } from './paymentService.ts';

/**
 * A refund, from claim to record. Used by paymentAction (the Refund button) and by declineBookingRequest
 * (the answer to "what happens to the deposit?"), so there is ONE refund path with every guarantee:
 *   1. the choice (keep the appointment / refund and cancel) is required, with no default;
 *   2. the operation is CLAIMED with one conditional write before Square is called, and the key sent to
 *      Square comes from that claim;
 *   3. ONE audit row, naming the choice, is written BEFORE the money moves (no row, no refund);
 *   4. the result is recorded in one write that also releases the claim, and the PaymentEvent stores the choice.
 * It changes the PAYMENT only. Whether the booking is cancelled is the caller's separate act.
 */
export type RefundResult = { ok: true; payment: any } | { ok: false; status: number; error: string };

export async function performRefund(
  admin: any,
  p: { booking: any; payment: any; provider: any; actor: string; amount: number; reason: string; outcome: string; expectedSeq: unknown; context?: string },
): Promise<RefundResult> {
  const { booking, payment, provider, amount, reason } = p;
  if (!REFUND_OUTCOMES.includes(p.outcome as RefundOutcome)) {
    return { ok: false, status: 400, error: 'Choose what this refund means: keep the appointment, or refund and cancel the booking.' };
  }
  const outcome = p.outcome as RefundOutcome;
  const choice = REFUND_OUTCOME_LABELS[outcome];
  // Test data never reaches real money — the same rule as the link path (paymentProvider).
  const testRefusal = testDataRefusal(provider?.live === true, booking.is_test === true || payment.is_test === true);
  if (testRefusal) return { ok: false, status: 409, error: testRefusal };

  const cur = toMoney(payment);
  const check = recordChosenRefund(cur, amount, 'succeeded', reason, outcome);
  if (!check.ok) return { ok: false, status: 409, error: check.error };

  const c = await claimIntent(admin, payment, { kind: 'refund', params: { amount, outcome }, expectedSeq: p.expectedSeq });
  if (!c.ok) return { ok: false, status: c.status, error: c.error };

  const auditBase = {
    action: 'payment_refund', who: p.actor, summary: `Payment: refund (${choice})`,
    ids: { booking_request_id: booking.id, payment_id: payment.id }, related: { type: 'BookingRequest' as const, id: booking.id },
  };
  const logId = await recordAudit(admin, { ...auditBase, note: `State was ${cur.state}. Choice: ${choice}.${p.context ? ` ${p.context}` : ''}`, counts: { amount } });
  if (!logId) { await releaseIntent(admin, payment.id, c.key); return { ok: false, status: 500, error: AUDIT_REFUSED.error }; }

  let res: any;
  try {
    res = await provider.refund({ providerPaymentId: payment.provider_payment_id || '', amount, currency: payment.currency || 'AUD', reason, idempotencyKey: c.key });
  } catch (e: any) {
    // Square clearly refused: drop the claim. No clear answer: keep it, so the same request retries with the same key.
    if (e?.definite === true) {
      await releaseIntent(admin, payment.id, c.key);
      return { ok: false, status: 409, error: e.message };
    }
    await markIntentUnknown(admin, payment.id, c.key);
    return { ok: false, status: 502, error: `${e?.message || 'Square did not answer.'} Nothing has been recorded. Try the same request again: it is safe and will not be sent twice.` };
  }

  const r = recordChosenRefund(cur, amount, res.status, reason, outcome);
  if (!r.ok) return { ok: false, status: 409, error: r.error };
  // A real provider's refund id is kept so its later webhook is recognised as this refund, not a new one.
  const refundIds = res.simulated ? null : [...(payment.provider_refund_ids || []), res.providerRefundId];
  const fields = { ...r.next, ...(res.simulated ? { is_simulated: true } : {}), ...(refundIds ? { provider_refund_ids: refundIds } : {}) };
  const updated = await settleIntent(admin, payment.id, c.key, { ...fields, updated_by: p.actor });
  if (!updated) return { ok: false, status: 409, error: 'Square answered, but the payment record could not be updated. Refresh before trying again.' };

  await finishAudit(admin, logId, { ...auditBase, note: `${cur.state} → ${fields.state}. Choice: ${choice}.${p.context ? ` ${p.context}` : ''}`, counts: { amount } });
  await recordEvent(admin, {
    booking_request_id: booking.id, event_type: 'refund_recorded', from_state: cur.state, to_state: fields.state, amount,
    actor: p.actor, refund_outcome: outcome, is_test: booking.is_test === true, is_simulated: res.simulated,
    note: `${res.wouldHaveDone} Reason: ${reason}. Choice: ${choice}.`,
  });

  // Keep the earlier display field in step (nothing refunded is "Paid").
  if (booking.payment_status !== 'Unpaid') {
    try { await admin.entities.BookingRequest.update(booking.id, { payment_status: 'Unpaid' }); } catch { /* display only */ }
  }
  return { ok: true, payment: updated };
}