import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { getPaymentProvider } from '../../shared/paymentProvider.ts';
import { amountOwing, canRequestLink, receivePayment, resolveRefund, toMoney, waiveDeposit, writeOff } from '../../shared/paymentState.ts';
import { performRefund } from '../../shared/refundService.ts';
import { declineBooking } from '../../shared/bookingCancel.ts';
import { createPaymentForBooking, legacyPaymentFields, loadDepositRules, recordEvent } from '../../shared/paymentService.ts';
import { recordAudit, finishAudit, AUDIT_REFUSED } from '../../shared/auditLog.ts';
import { claimIntent, settleIntent, markIntentUnknown, releaseIntent } from '../../shared/paymentIntent.ts';
import { settlePendingLinkMessages } from '../../shared/paymentMessages.ts';
import { takePaymentLinkSlot, tooMany } from '../../shared/paymentRateLimit.ts';

/**
 * paymentAction — the ONLY writer of payment state. Admin only.
 * body: { action, booking_request_id, ... }
 *   mark_received { amount?, method: Cash|Transfer|Card }   offline payment received
 *   waive         { reason }                                waive an outstanding deposit
 *   request_link  {}                                        payment link (test double: simulated)
 *   refund        { amount, reason, outcome }               record a refund; outcome is REQUIRED, no default:
 *                                                           'keep' (the appointment stands, the booking stays payable) or
 *                                                           'cancel' (refund and cancel the booking)
 *   simulate_provider_payment { amount? }                   test double only: provider says "paid"
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const money = toMoney;

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }
    const action = String(body?.action || '');
    const id = String(body?.booking_request_id || '').trim();
    if (!id) return Response.json({ error: 'booking_request_id required' }, { status: 400 });
    if (!['mark_received', 'waive', 'request_link', 'refund', 'simulate_provider_payment', 'write_off', 'resolve_refund'].includes(action)) {
      return Response.json({ error: 'Unknown action.' }, { status: 400 });
    }

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(id); } catch { booking = null; }
    if (!booking) return Response.json({ error: 'Booking not found.' }, { status: 404 });

    // A booking from before payment state existed gets its record from its legacy status.
    let payment = asList(await admin.entities.BookingPayment.filter({ booking_request_id: id }, '-created_date', 1))[0];
    if (!payment) {
      payment = await admin.entities.BookingPayment.create(legacyPaymentFields(booking));
      await recordEvent(admin, { booking_request_id: id, event_type: 'migrated', to_state: payment.state, amount: payment.amount_paid, actor: 'system', note: 'Payment record created from the booking\'s earlier payment status.', is_test: booking.is_test === true });
    }
    const rules = await loadDepositRules(admin);
    const provider = getPaymentProvider();
    const cur = money(payment);
    const fail = (error: string) => Response.json({ error }, { status: 409 });

    // A refund asks what it means, every time. It has its own path (shared with cancelling a booking).
    if (action === 'refund') {
      if (actor.automation) return Response.json({ error: 'Automation cannot refund. A person decides what a refund means.' }, { status: 403 });
      const outcome = String(body?.outcome || '');
      const done = await performRefund(admin, {
        booking, payment, provider, actor: actor.name, amount: Number(body?.amount),
        reason: String(body?.reason || '').trim(), outcome, expectedSeq: body?.expected_op_seq,
      });
      if (!done.ok) return Response.json({ error: done.error }, { status: done.status });
      // "Refund and cancel" is the admin's own choice, made on this request: the booking is cancelled
      // because they said so, never because of the payment's state.
      let cancelled = false;
      let cancelError: string | null = null;
      if (outcome === 'cancel') {
        try { await declineBooking(admin, booking, { reason: 'Cancelled with a refund', actorName: actor.name }); cancelled = true; } catch (e: any) { cancelError = e?.message || 'The booking could not be cancelled.'; }
      }
      return Response.json({ ok: true, action, outcome, payment: done.payment, cancelled, ...(cancelError ? { cancel_error: cancelError } : {}) });
    }

    // One activity-log row per action, written BEFORE money state changes or the provider
    // is called; if it cannot be written, nothing happens. Ids, states and the amount only:
    // no reason text, no card or contact details.
    let logId: string | null = null;
    const auditBase = {
      action: `payment_${action}`, who: actor.name, summary: `Payment: ${action.replace(/_/g, ' ')}`,
      ids: { booking_request_id: id, payment_id: payment.id }, related: { type: 'BookingRequest' as const, id },
    };
    const audit = async () => {
      if (!logId) logId = await recordAudit(admin, { ...auditBase, note: `State was ${cur.state}` });
      return !!logId;
    };
    const refused = () => Response.json(AUDIT_REFUSED, { status: 500 });

    // A provider operation (payment link, refund) is CLAIMED with one conditional write before Square is
    // called, and Square's idempotency key is built from that claim (see shared/paymentIntent).
    let claimKey: string | null = null;
    const claim = async (kind: 'link' | 'refund', params: Record<string, unknown>) => {
      const c = await claimIntent(admin, payment, { kind, params, expectedSeq: body?.expected_op_seq });
      if (!c.ok) return Response.json({ error: c.error }, { status: c.status });
      claimKey = c.key;
      return null;
    };
    // Square failed: drop the claim if it clearly refused; keep it (retryable, same key) if it gave no clear answer.
    const providerFailed = async (e: any) => {
      if (e?.definite === true) {
        await releaseIntent(admin, payment.id, claimKey!);
        return Response.json({ error: e.message }, { status: 409 });
      }
      await markIntentUnknown(admin, payment.id, claimKey!);
      return Response.json({ error: `${e?.message || 'Square did not answer.'} Nothing has been recorded. Try the same request again: it is safe and will not be sent twice.` }, { status: 502 });
    };

    let fields: Record<string, any> = {};
    let event: Record<string, any> = {};

    if (action === 'mark_received') {
      const method = String(body?.method || '');
      if (!['Cash', 'Transfer', 'Card'].includes(method)) return Response.json({ error: 'Choose Cash, Transfer or Card.' }, { status: 400 });
      const amount = body?.amount != null ? Number(body.amount) : amountOwing(cur);
      const r = receivePayment(cur, amount);
      if (!r.ok) return fail(r.error);
      fields = { ...r.next, payment_method: method };
      event = { event_type: 'payment_received', amount, note: `Offline payment received (${method}).` };
    } else if (action === 'waive') {
      const reason = String(body?.reason || '').trim();
      const r = waiveDeposit(cur, reason, rules?.allow_waive !== false);
      if (!r.ok) return fail(r.error);
      fields = { ...r.next, waive_reason: reason, waived_by: actor.name, payment_link_url: '', payment_link_expires_at: null };
      event = { event_type: 'deposit_waived', amount: cur.deposit_amount, note: `Deposit waived: ${reason}` };
    } else if (action === 'write_off') {
      const reason = String(body?.reason || '').trim();
      const r = writeOff(cur, reason);
      if (!r.ok) return fail(r.error);
      fields = { ...r.next };
      event = { event_type: 'written_off', amount: amountOwing(cur), note: `Written off: ${reason}` };
    } else if (action === 'resolve_refund') {
      const r = resolveRefund(cur);
      if (!r.ok) return fail(r.error);
      fields = { ...r.next };
      event = { event_type: 'refund_resolved', amount: cur.amount_refunded, note: 'Pending refund confirmed as paid out.' };
    } else if (action === 'request_link') {
      const r = canRequestLink(cur);
      if (!r.ok) return fail(r.error);
      const owing = amountOwing(cur);
      const slot = await takePaymentLinkSlot(admin, id);
      if (!slot.allowed) return tooMany(slot.retryAfterSeconds, 'Too many payment link requests for this booking. Wait a moment and try again.');
      const stop = await claim('link', { amount: owing });
      if (stop) return stop;
      if (!(await audit())) { await releaseIntent(admin, payment.id, claimKey!); return refused(); }
      let link: any;
      try {
        link = await provider.createPaymentLink({
          bookingId: id, amount: owing, currency: payment.currency || 'AUD',
          description: cur.state === 'deposit_due' && cur.amount_refunded <= 0 ? 'Deposit' : 'Balance',
          expiresInHours: Number(rules?.link_expiry_hours) > 0 ? Number(rules.link_expiry_hours) : 24,
          idempotencyKey: claimKey!,
        });
      } catch (e) { return await providerFailed(e); }
      // A new link must not discard the id of the one it replaces: a late event for the old order can still be traced.
      const replaced = payment.provider_payment_id && payment.provider_payment_id !== link.providerPaymentId ? String(payment.provider_payment_id) : null;
      fields = {
        payment_provider: link.providerName, provider_payment_id: link.providerPaymentId,
        payment_link_url: link.url, payment_link_expires_at: link.expiresAt,
        ...(replaced ? { replaced_provider_payment_ids: [...(payment.replaced_provider_payment_ids || []), replaced] } : {}),
        ...(link.simulated ? { is_simulated: true } : {}),
      };
      event = { event_type: 'link_requested', amount: owing, note: `${link.wouldHaveDone}${replaced ? ` Replaced the earlier link (${replaced}); that id is kept on the record.` : ''}`, is_simulated: link.simulated };
    } else {
      if (!provider.simulated) return fail('Simulating a provider payment is only available with the test double.');
      if (!payment.provider_payment_id) return fail('Request a payment link first.');
      const amount = body?.amount != null ? Number(body.amount) : amountOwing(cur);
      const status = await provider.fetchPaymentStatus(payment.provider_payment_id, { simulatePaidAmount: amount });
      if (status.status !== 'paid') return fail('The provider has not confirmed a payment.');
      const r = receivePayment(cur, status.amountPaid);
      if (!r.ok) return fail(r.error);
      fields = { ...r.next, payment_method: 'Provider', is_simulated: true, payment_link_url: '', payment_link_expires_at: null };
      event = { event_type: 'provider_payment', amount: status.amountPaid, note: `${status.wouldHaveDone} SIMULATED payment confirmed by the test double; no money moved.`, is_simulated: true };
    }

    if (!(await audit())) return refused();
    // A claimed provider operation is settled by ONE write that also releases the claim.
    const updated = claimKey
      ? await settleIntent(admin, payment.id, claimKey, { ...fields, updated_by: actor.name })
      : await admin.entities.BookingPayment.update(payment.id, { ...fields, updated_by: actor.name });
    if (!updated) return fail('Square answered, but the payment record could not be updated. Refresh before trying again.');
    await finishAudit(admin, logId, { ...auditBase, note: `${cur.state} → ${fields.state || cur.state}`, counts: { amount: Number(event.amount) || 0 } });
    await recordEvent(admin, {
      booking_request_id: id, from_state: cur.state, to_state: fields.state || cur.state,
      actor: actor.name, is_test: booking.is_test === true, ...event,
    });

    // Money that is no longer owed must not be asked for: stop any unsent deposit or balance text now. The receipt
    // follows from the PaymentEvent just written (paymentFollowUp), and the sweep re-checks at send time as well.
    if (['mark_received', 'waive', 'write_off', 'simulate_provider_payment'].includes(action)) {
      try { await settlePendingLinkMessages(admin, id); } catch (e) { console.error('settle pending payment texts failed', (e as Error)?.message); }
    }

    // Keep the earlier display field in step (the completion text reads it).
    const nextState = fields.state || cur.state;
    const legacy = nextState === 'paid_in_full' ? 'Paid' : 'Unpaid';
    if (booking.payment_status !== legacy || (fields.payment_method && fields.payment_method !== booking.payment_method)) {
      const upd: Record<string, any> = { payment_status: legacy };
      if (['Cash', 'Transfer', 'Card'].includes(fields.payment_method)) upd.payment_method = fields.payment_method;
      await admin.entities.BookingRequest.update(id, upd);
    }

    return Response.json({ ok: true, action, payment: updated });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}