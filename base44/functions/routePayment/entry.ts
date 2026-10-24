import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor, actorOwnsBooking } from '../../shared/schedulingAuth.ts';
import { getPaymentProvider } from '../../shared/paymentProvider.ts';
import { paymentOrLegacy } from '../../shared/ensurePayment.ts';
import { balanceEligible, queueLinkMessage } from '../../shared/paymentMessages.ts';
import { recordOfflinePayment } from '../../shared/offlinePayment.ts';
import { takePaymentLinkSlot, tooMany } from '../../shared/paymentRateLimit.ts';

/**
 * routePayment — the payment actions a barber needs at the end of a cut, from the Route tab.
 * Gated like the rest of the route: an admin, or the barber who owns the booking.
 *   send_link  make the link for what is owing and text it (the same text that goes out on completion; sent once)
 *   mark_cash  record the amount owing as received in person; stops any unsent payment text
 * body: { booking_request_id, action: 'send_link' | 'mark_cash', method?: Cash|Transfer|Card }
 */
export default async function (req: Request) {
  const fail = (status: number, error: string) => Response.json({ ok: false, error }, { status });
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }
    const id = String(body?.booking_request_id || '').trim();
    const action = String(body?.action || '');
    if (!id) return fail(400, 'booking_request_id required');
    if (!['send_link', 'mark_cash'].includes(action)) return fail(400, "action must be 'send_link' or 'mark_cash'");

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(id); } catch { booking = null; }
    if (!booking) return fail(404, 'Booking not found.');
    if (!actorOwnsBooking(actor, booking)) return fail(403, 'You can only change payments for appointments assigned to you.');

    const payment = await paymentOrLegacy(admin, booking, actor.name);

    if (action === 'mark_cash') {
      const method = ['Cash', 'Transfer', 'Card'].includes(String(body?.method)) ? String(body.method) : 'Cash';
      if (!balanceEligible(payment)) return fail(409, 'Nothing is owing on this booking right now.');
      const done = await recordOfflinePayment(admin, { booking, payment, method, actor: actor.name });
      if (!done.ok) return fail(done.status, done.error);
      return Response.json({ ok: true, action, payment: done.payment });
    }

    const slot = await takePaymentLinkSlot(admin, booking.id);
    if (!slot.allowed) return tooMany(slot.retryAfterSeconds, 'Too many payment link requests for this appointment. Wait a moment and try again.');
    const kind = payment.state === 'deposit_due' ? 'deposit' : 'balance';
    if (kind === 'balance' && !balanceEligible(payment)) return fail(409, 'Nothing is owing on this booking right now.');
    const result = await queueLinkMessage(admin, booking, kind, { provider: getPaymentProvider(), actor: actor.name, automation: false });
    if (result.needs_attention || result.reason) return fail(422, result.reason || 'The payment link could not be sent.');
    if (result.skipped) return fail(409, result.skipped);
    return Response.json({ ok: true, action, ...result });
  } catch (error: any) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
}