import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor, actorOwnsBooking } from '../../shared/schedulingAuth.ts';
import { STOP_ACTIONS } from '../../shared/routeStopStates.ts';
import { ensureRouteTemplates } from '../../shared/routeMessageTemplates.ts';
import { friendlyDate, firstName } from '../../shared/bookingMessages.ts';
import { queueMessage, finishCompletion } from '../../shared/routeCompletion.ts';
import { etaForBooking, etaVariable } from '../../shared/routeEtaLoader.ts';
import { trackingLinkVariable } from '../../shared/bookingTracking.ts';
import { findRunnableRoute, planStopStep, writeStopStep } from '../../shared/routeStopStep.ts';

/**
 * advanceRouteStop — the one server-side path that moves a stop through the day:
 * on_the_way, arrive, start, complete, skip. The progress is stored on the
 * finalised DayRoute (stop_execution), never on the booking's own status.
 *
 * Gated (admin or the barber who owns the booking), ordered (you cannot complete a
 * stop that was never started; a skip with a reason is always allowed), version
 * checked (409 SCHEDULE_CHANGED), and audited. Repeating a step changes nothing.
 *
 * The day's route lookup, the state machine and the step write are shared with
 * routeCheckout (see shared/routeStopStep.ts).
 *
 * body: { booking_request_id, action, expected_updated_date, reason? }
 */
const DEAD = ['declined', 'cancelled', 'no_show', 'could_not_fit', 'blocked'];

export default async function (req: Request) {
  const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
    Response.json({ saved: false, error: message, code, message, ...extra }, { status });
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const id = String(body?.booking_request_id || '').trim();
    const action = String(body?.action || '');
    const reason = String(body?.reason || '').trim().slice(0, 300);
    if (!id) return fail(400, 'INVALID_INPUT', 'booking_request_id required');
    if (!STOP_ACTIONS.includes(action as any)) return fail(400, 'INVALID_INPUT', "action must be 'on_the_way', 'arrive', 'start', 'complete' or 'skip'");
    if (!body?.expected_updated_date) return fail(400, 'VERSION_REQUIRED', 'expected_updated_date required');

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(id); } catch { booking = null; }
    if (!booking) return fail(404, 'NOT_FOUND', 'booking request not found');
    if (!actorOwnsBooking(actor, booking)) return fail(403, 'FORBIDDEN', 'You can only change appointments assigned to you.');
    if (DEAD.includes(String(booking.status))) return fail(409, 'BOOKING_CLOSED', `A ${String(booking.status).replace('_', ' ')} booking cannot be run on the route.`);

    const found = await findRunnableRoute(admin, booking, id, body?.expected_updated_date);
    if (!found.ok) return fail(found.status, found.code, found.message, found.extra || {});
    const record = found.record;

    const plan = planStopStep(record, id, [action as any], reason);
    if (!plan.ok) return fail(plan.status, plan.code, plan.message, plan.extra || {});
    const prev = plan.prev;

    let messageQueued: boolean | null = null;
    let balanceRequest: unknown = null;

    if (action === 'on_the_way' && !plan.already) {
      await ensureRouteTemplates(admin);
      // The arrival window and tracking link are optional: if either cannot be made the
      // message still goes out with its plain wording (same idempotency key as before).
      const eta_window = etaVariable(await etaForBooking(admin, booking));
      const tracking_link = await trackingLinkVariable(admin, booking);
      const m = await queueMessage(admin, booking, 'on_the_way', `sms|${id}|on_the_way|${booking.requested_date}`, { name: firstName(booking.client_name), eta_window, tracking_link });
      if (!m.queued) return fail(422, 'MESSAGE_NOT_QUEUED', `The on-the-way message could not be queued. ${(m as any).reason || ''}`.trim());
      messageQueued = true;
    }

    if (action === 'complete') {
      await ensureRouteTemplates(admin);
      // Safe to repeat: a retry after a half-finished completion finishes the rest.
      const done = await finishCompletion(admin, booking, new Date().toISOString());
      messageQueued = done.message_queued;
      balanceRequest = done.balance_request;
    }

    let stop = prev;
    let updatedDate = record.updated_date;
    if (!plan.already) {
      const written = await writeStopStep(admin, {
        record, booking, bookingId: id, prev, state: plan.state, action, actor: actor.name, reason,
        summary: `Route stop ${action.replace(/_/g, ' ')} · ${friendlyDate(booking.requested_date)}`,
        detail: [
          `by ${actor.name}`,
          action === 'skip' ? `reason: ${reason}` : '',
          action === 'complete' && written.stop.actual_duration_minutes != null ? `${written.stop.actual_duration_minutes} min` : '',
        ].filter(Boolean).join(' · '),
      });
      stop = written.stop;
      updatedDate = written.updatedDate;
    }

    return Response.json({
      saved: true, already_recorded: plan.already, state: plan.state, stop, updated_date: updatedDate,
      message_queued: messageQueued, balance_request: balanceRequest, route_needs_update: action === 'skip' && !plan.already ? true : undefined,
    });
  } catch (error: any) {
    return Response.json({ saved: false, error: error.message, code: 'SERVER_ERROR', message: 'Something went wrong saving that step.' }, { status: 500 });
  }
}