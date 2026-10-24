import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { declineBooking } from '../../shared/bookingCancel.ts';
import { parseDepositDecision, refundableAmount, toMoney } from '../../shared/paymentState.ts';
import { performRefund } from '../../shared/refundService.ts';
import { getPaymentProvider } from '../../shared/paymentProvider.ts';
import { recordAudit, AUDIT_REFUSED } from '../../shared/auditLog.ts';

/**
 * Decline (cancel) a booking request — the third way out of a request Route Flow could
 * not place, alongside editing it and placing it manually.
 *
 * Admin-only, and never a deletion: the request keeps its history, the reason is
 * stored on the record, and the decision is written to the activity log.
 *
 * A booking that holds money cannot be cancelled until someone says what happens to it:
 *   deposit_decision: { kind: 'full' } | { kind: 'partial', amount } | { kind: 'retained', reason }
 * plus expected_op_seq (the payment as the page saw it) when money is to be refunded.
 * Retained is a decision, not a silence: it writes an audit row and a payment event carrying the reason.
 * The booking's status and its payment state stay independent: cancelling here never sets a payment state,
 * and a refund here never reads the booking's status.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const admin = base44.asServiceRole;

    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    // Cancelling can move money, so a person decides it: automation is refused.
    if (actor.automation) return Response.json({ error: 'Automation cannot cancel bookings or move money.' }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const bookingId = String(body.booking_request_id || '').trim();
    if (!bookingId) return Response.json({ error: 'booking_request_id required' }, { status: 400 });

    const reason = String(body.reason || '').trim().slice(0, 120) || 'No reason given';

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(bookingId); } catch { booking = null; }
    if (!booking) return Response.json({ error: 'booking request not found' }, { status: 404 });

    // Idempotent: declining an already-declined request is a no-op.
    if (booking.status === 'declined') {
      return Response.json({ saved: true, already_declined: true, status: 'declined', decline_reason: booking.decline_reason || reason });
    }

    // ── What happens to the money held? Answered before anything else changes. ─────────────
    let payment: any = null;
    try { payment = asList(await admin.entities.BookingPayment.filter({ booking_request_id: bookingId }, '-created_date', 1))[0] || null; } catch { payment = null; }
    const refundable = payment ? refundableAmount(toMoney(payment)) : 0;
    let deposit: any = null;
    if (refundable > 0) {
      const parsed = parseDepositDecision(body.deposit_decision, refundable);
      if (!parsed.ok) {
        return Response.json({ saved: false, code: 'DEPOSIT_DECISION_REQUIRED', error: parsed.error, refundable, op_seq: payment.op_seq || 0 }, { status: 409 });
      }
      const d = parsed.decision;
      if (d.kind === 'retained') {
        const logId = await recordAudit(admin, {
          action: 'payment_deposit_retained', who: actor.name, summary: 'Cancellation: deposit retained',
          note: `Reason: ${d.reason}`, counts: { amount: refundable },
          ids: { booking_request_id: bookingId, payment_id: payment.id }, related: { type: 'BookingRequest', id: bookingId },
        });
        if (!logId) return Response.json({ saved: false, ...AUDIT_REFUSED }, { status: 500 });
        await admin.entities.PaymentEvent.create({
          booking_request_id: bookingId, event_type: 'deposit_retained', from_state: payment.state, to_state: payment.state,
          amount: refundable, actor: actor.name, note: `Deposit retained on cancellation: ${d.reason}`, is_test: booking.is_test === true,
        });
        deposit = { kind: 'retained', amount: refundable };
      } else {
        const done = await performRefund(admin, {
          booking, payment, provider: getPaymentProvider(), actor: actor.name, amount: d.amount,
          reason: `Booking cancelled: ${d.kind} refund`, outcome: 'cancel', expectedSeq: body.expected_op_seq,
          context: 'Part of cancelling the booking.',
        });
        // The refund did not go through, so the booking is NOT cancelled.
        if (!done.ok) return Response.json({ saved: false, error: done.error }, { status: done.status });
        deposit = { kind: d.kind, amount: d.amount };
      }
    }

    const result = await declineBooking(admin, booking, { reason, actorName: actor.name });

    return Response.json({
      saved: true,
      status: 'declined',
      decline_reason: reason,
      message_queued: (result as any).message_queued === true,
      released_slot: (result as any).releaseProvisional === true,
      deposit,
      updated_date: null,
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}