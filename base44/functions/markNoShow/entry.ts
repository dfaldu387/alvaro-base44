import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor, actorOwnsBooking } from '../../shared/schedulingAuth.ts';
import { recordNoShow, enqueueNoShowFollowup } from '../../shared/bookingLifecycle.ts';

/**
 * markNoShow — the one server-side path that turns a booking into a no-show.
 * Sets the status, records the no-show once (NoShowRecord), keeps the client's
 * no_show_count in step, and enqueues one follow-up on the outbox. It is safe to
 * call again: every step is idempotent, so a retry changes nothing.
 * It never sends anything itself.
 *
 * body: { booking_request_id }
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const id = String(body?.booking_request_id || '').trim();
    if (!id) return Response.json({ error: 'booking_request_id required' }, { status: 400 });

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(id); } catch { booking = null; }
    if (!booking) return Response.json({ error: 'booking request not found' }, { status: 404 });
    if (!actorOwnsBooking(actor, booking)) {
      return Response.json({ error: 'You can only change appointments assigned to you.' }, { status: 403 });
    }
    if (['declined', 'cancelled', 'completed', 'could_not_fit', 'blocked'].includes(String(booking.status))) {
      return Response.json({ error: `A ${String(booking.status).replace('_', ' ')} booking cannot be marked as a no-show.` }, { status: 409 });
    }

    const wasNoShow = booking.status === 'no_show';
    const record = await recordNoShow(admin, booking, actor.name);
    if (!wasNoShow) {
      await admin.entities.BookingRequest.update(booking.id, { status: 'no_show', closed_date: new Date().toISOString() });
      try {
        await admin.entities.ActivityLog.create({
          action: 'booking_no_show',
          actor: 'barber',
          summary: 'Booking marked as no-show',
          detail: `by ${actor.name}`.slice(0, 400),
          related_record_id: booking.id,
          related_record_type: 'BookingRequest',
          previous_value: booking.status || null,
          new_value: 'no_show',
          timestamp: new Date().toISOString(),
        });
      } catch { /* an audit failure must never undo the no-show */ }
    }

    const message = await enqueueNoShowFollowup(admin, booking);
    return Response.json({
      saved: true,
      status: 'no_show',
      already_recorded: wasNoShow && !record.created,
      no_show_count: record.no_show_count,
      message_queued: message.queued === true,
      message_created: message.created === true,
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}