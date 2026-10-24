import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { confirmBookingCore } from '../../shared/bookingMessages.ts';
import { recordAudit } from '../../shared/auditLog.ts';
import { overlapRefusal } from '../../shared/scheduleOverlap.ts';

/**
 * confirmBooking — the server-side confirm transition.
 *
 * body: { booking_request_id: string, confirm_time?: boolean }
 *   confirm_time: also set schedule_status to "confirmed" (the calendar's
 *   "confirm time" action, which protects the slot from Auto Sort).
 *
 * Admin-gated. Sets status "confirmed", records who/when (from the verified
 * identity, never the request body), then enqueues booking_confirmed on the
 * outbox with key sms|<booking id>|booking_confirmed. Calling it again for the
 * same booking never queues a second message. Nothing is sent from here.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const id = typeof body?.booking_request_id === 'string' ? body.booking_request_id.trim() : '';
    if (!id) return Response.json({ error: 'booking_request_id is required.' }, { status: 400 });

    let held: any = null;
    try { held = await base44.asServiceRole.entities.BookingRequest.get(id); } catch { held = null; }
    if (held?.protection_hold === true) {
      return Response.json({ error: 'This request is held for review. Approve it on the Requests page first.' }, { status: 409 });
    }

    // Fixing a time is the moment a promise is made to the client, so an impossible
    // day is refused here: two appointments cannot share one barber's time. The
    // Calendar and the Route tab apply the same rule before they even ask.
    if (body?.confirm_time === true && held) {
      const refusal = await overlapRefusal(base44.asServiceRole, held);
      if (refusal) return Response.json({ error: refusal, code: 'TIME_CONFLICT' }, { status: 409 });
    }

    const result = await confirmBookingCore(base44.asServiceRole, id, {
      actorName: actor.automation ? 'Route Flow workflow' : (actor.name || 'Admin'),
      confirmTime: body?.confirm_time === true,
    });
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    // One row per real confirmation; confirming again with nothing new to apply writes none.
    if (!(result.was_already_confirmed && body?.confirm_time !== true)) {
      await recordAudit(base44.asServiceRole, {
        action: 'booking_confirmed', who: actor.name || 'Admin', automation: actor.automation,
        summary: body?.confirm_time === true ? 'A booking and its time were confirmed' : 'A booking was confirmed',
        ids: { booking_request_id: id }, related: { type: 'BookingRequest', id },
      });
    }
    return Response.json(result);
  } catch (_error) {
    return Response.json({ error: 'Could not confirm the booking.' }, { status: 500 });
  }
}