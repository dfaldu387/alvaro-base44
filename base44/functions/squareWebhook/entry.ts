import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { squareStatus, SQUARE_SECRETS } from '../../shared/squareConfig.ts';
import { SQUARE_SIGNATURE_HEADER, squareNotificationUrls, verifySquareSignature } from '../../shared/squareSignature.ts';
import { HANDLED_EVENT_TYPES, WEBHOOK_ACTOR, lookupIds, parseSquareEvent, planPaymentEvent, planRefundEvent } from '../../shared/squareEvents.ts';
import { bumpWebhookHealth } from '../../shared/paymentWebhookHealth.ts';
import { recordEvent } from '../../shared/paymentService.ts';
import { recordAudit, finishAudit } from '../../shared/auditLog.ts';
import { takeBadSignatureSlot, tooMany } from '../../shared/paymentRateLimit.ts';

/**
 * squareWebhook — PUBLIC endpoint Square calls with payment and refund events. Like
 * twilioStatusWebhook it is an exception to the admin-gate rule: Square cannot sign in, so
 * authenticity is proven by the x-square-hmacsha256-signature header over the notification URL
 * and the RAW body. Verification happens before the body is parsed and before any database read.
 *
 *  - Square not active (any secret missing, or PAYMENTS_LIVE not "true"): 503, nothing read or written.
 *  - Bad signature: 401, nothing touched.
 *  - Idempotent on Square's event id; a repeat is answered 200 "duplicate" and changes nothing.
 *  - Out-of-order safe: the write is conditional on the row's current state, and every state
 *    change goes through paymentState.ts (via squareEvents.ts). A settled booking never moves back.
 *  - A booking that cannot be found is answered 503, never 200, so Square retries.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const legacyStatus = (state: string) => (state === 'paid_in_full' ? 'Paid' : 'Unpaid');

export default async function (req: Request) {
  try {
    const get = (name: string) => secrets.get(name);
    if (!squareStatus(get).active) return Response.json({ error: 'Not configured.' }, { status: 503 });

    const raw = await req.text();
    const key = String(get(SQUARE_SECRETS.webhookKey) || '').trim();
    // Fail closed: anything that goes wrong while checking the signature counts as "not verified".
    let ok = false;
    try { ok = await verifySquareSignature(key, req.headers.get(SQUARE_SIGNATURE_HEADER), squareNotificationUrls(req.url), raw); } catch { ok = false; }
    if (!ok) {
      // Only forged / tampered requests are counted, so a burst of them stops writing to the database.
      try {
        const slot = await takeBadSignatureSlot(createClientFromRequest(req).asServiceRole, req);
        if (!slot.allowed) return tooMany(slot.retryAfterSeconds);
      } catch { /* the limiter must never turn a rejection into an acceptance */ }
      return Response.json({ error: 'Invalid signature.' }, { status: 401 });
    }

    let body: any = null;
    try { body = JSON.parse(raw); } catch { /* handled below */ }
    const ev = parseSquareEvent(body);
    if (!ev) return Response.json({ error: 'Malformed event.' }, { status: 400 });

    const admin = createClientFromRequest(req).asServiceRole;

    if (!(HANDLED_EVENT_TYPES as readonly string[]).includes(ev.type)) {
      await bumpWebhookHealth(admin, 'ignored_count', ev.type);
      return Response.json({ ok: true, ignored: 'unhandled_event_type', type: ev.type });
    }

    // Idempotency: an event id already handled changes nothing.
    const seen = asList(await admin.entities.PaymentEvent.filter({ provider_event_id: ev.eventId }, '-created_date', 1))[0];
    if (seen) {
      await bumpWebhookHealth(admin, 'duplicates_ignored', ev.type);
      return Response.json({ ok: true, ignored: 'duplicate' });
    }

    // Find the booking by the id Square echoes (order id, then payment id). Never by amount.
    let pay: any = null;
    for (const id of lookupIds(ev)) {
      pay = asList(await admin.entities.BookingPayment.filter({ provider_payment_id: id }, '-created_date', 1))[0];
      if (pay) break;
    }
    if (!pay) {
      console.warn(JSON.stringify({ event: 'square_event_unmatched', type: ev.type }));
      await bumpWebhookHealth(admin, 'unmatched_count', ev.type);
      return Response.json({ ok: false, matched: false, retry: true }, { status: 503 });
    }

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(pay.booking_request_id); } catch { booking = null; }
    const isTest = booking?.is_test === true;

    const plan = ev.payment ? planPaymentEvent(ev, pay) : planRefundEvent(ev, pay);

    if (plan.kind === 'retry') {
      await bumpWebhookHealth(admin, null, ev.type);
      return Response.json({ ok: false, retry: true, reason: plan.reason }, { status: 503 });
    }

    if (plan.kind === 'ignore') {
      if (plan.record) {
        await recordEvent(admin, {
          booking_request_id: pay.booking_request_id, event_type: 'provider_webhook_ignored', from_state: pay.state, to_state: pay.state,
          actor: WEBHOOK_ACTOR, note: `Not applied: ${plan.reason}`, provider_event_id: ev.eventId, is_test: isTest,
        });
      }
      await bumpWebhookHealth(admin, 'ignored_count', ev.type);
      return Response.json({ ok: true, ignored: plan.reason });
    }

    // The activity-log row is written BEFORE money state changes; if it cannot be, nothing changes and Square retries.
    const auditBase = {
      action: ev.payment ? 'payment_webhook_payment' : 'payment_webhook_refund', who: WEBHOOK_ACTOR, automation: true,
      summary: `Square ${ev.type}`, ids: { booking_request_id: pay.booking_request_id, payment_id: pay.id, square_event_id: ev.eventId },
      related: { type: 'BookingRequest' as const, id: pay.booking_request_id },
    };
    const logId = await recordAudit(admin, { ...auditBase, note: `State was ${pay.state}` });
    if (!logId) return Response.json({ ok: false, retry: true, reason: 'audit_unavailable' }, { status: 503 });

    // Conditional write: only applies if the row is still exactly as it was read. The marker proves which event did it.
    await admin.entities.BookingPayment.updateMany(plan.filter, { $set: { ...plan.fields, last_provider_event_id: ev.eventId } });
    const after = await admin.entities.BookingPayment.get(pay.id);
    if (after?.last_provider_event_id !== ev.eventId) {
      await finishAudit(admin, logId, { ...auditBase, outcome: 'aborted', note: 'The payment changed while this event was being applied; Square will retry.' });
      return Response.json({ ok: false, retry: true, reason: 'changed_concurrently' }, { status: 503 });
    }

    await finishAudit(admin, logId, { ...auditBase, note: `${pay.state} → ${after.state}`, counts: { amount: plan.amount } });
    await recordEvent(admin, {
      booking_request_id: pay.booking_request_id, event_type: plan.eventType, from_state: pay.state, to_state: after.state,
      amount: plan.amount, actor: WEBHOOK_ACTOR, note: plan.note, provider_event_id: ev.eventId, is_test: isTest,
    });

    // Keep the earlier display field in step, as paymentAction does.
    if (booking && booking.payment_status !== legacyStatus(after.state)) {
      await admin.entities.BookingRequest.update(pay.booking_request_id, { payment_status: legacyStatus(after.state) });
    }

    await bumpWebhookHealth(admin, 'handled_count', ev.type);
    return Response.json({ ok: true, applied: true, state: after.state });
  } catch (e) {
    console.error('squareWebhook failed', (e as Error)?.message);
    return Response.json({ error: 'Webhook failed.' }, { status: 500 });
  }
}