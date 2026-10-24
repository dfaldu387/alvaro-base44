import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { withHeartbeat } from '../../shared/jobHeartbeat.ts';
import { processBookingRequest } from '../../shared/routeFlowEngine.ts';
import { holdIfFinalised } from '../../shared/finalisedDayGate.ts';

/**
 * Route Flow Auto-Place (V2) — the server-side entry point for automatic
 * placement of a new booking request.
 *
 * Triggered by the Route Flow workflow when a BookingRequest is created, so it
 * runs with no browser, no calendar page and no admin click. May also be invoked
 * by an administrator.
 *
 * This function is only the gateway: authority is resolved BEFORE any settings
 * read, booking read, Mapbox call or write, and the actual work lives in the
 * Stage 1 engine (shared/routeFlowEngine), which composes:
 *
 *   routeFlowCandidates  — which start times to test (5-minute steps)
 *   schedulingValidator  — whether each one is allowed (Stage 0 rules)
 *   routeFlowScoring     — driving + idle cost, lowest waste wins
 *   placementAudit       — the decision trail
 *
 * Route Flow only ever writes 'provisional'. It never moves existing
 * appointments, never confirms, never locks and never creates an override.
 *
 * Two holds sit in front of the engine, both read from the booking itself:
 * a request held by booking protection, and a day whose route is already
 * finalised (the customers hold those arrival times). Both apply to automatic
 * runs only; an administrator invoking this function is never held.
 */
// Records a heartbeat for each workflow-triggered run (jobHeartbeat: 'autoplace').
export default async function (req: Request) {
  return withHeartbeat(req, 'autoplace', handle, (r: Request) => createClientFromRequest(r).asServiceRole);
}

async function handle(req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const admin = base44.asServiceRole;

    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const { booking_request_id } = body;
    if (!booking_request_id) {
      return Response.json({ error: 'booking_request_id required' }, { status: 400 });
    }

    // The guards below decide whether this request may be placed at all, so a
    // failed read is refused rather than treated as "nothing to check" — reading
    // no booking must never let a held request onto the schedule.
    let booking: any;
    try {
      booking = await admin.entities.BookingRequest.get(booking_request_id);
    } catch {
      return Response.json({ error: 'Could not read the booking request.' }, { status: 503 });
    }
    if (!booking) return Response.json({ error: 'Booking request not found.' }, { status: 404 });

    // A request held by booking protection stays off the schedule until an admin
    // approves it (reviewQueueAction clears the hold and calls this again).
    if (booking.protection_hold === true) {
      return Response.json({ skipped: true, reason: 'Held for review by booking protection.' });
    }

    // A finalised route is the arrival times the customers already hold. Automatic
    // placement does not add a stop to that day: it leaves the day exactly as it
    // is and marks the route as needing an update, so a person rebuilds it when
    // they choose. An admin placing a request by hand is never held — same rule
    // the reshuffle (optimiseProvisionalDay) and the automatic fit
    // (routeFlowFit) already follow.
    if (actor.automation && booking.requested_date) {
      const gate = await holdIfFinalised(admin, {
        date: String(booking.requested_date),
        teamMemberId: booking.team_member_id,
        isTest: booking.is_test === true,
      });
      if (gate) return Response.json({ skipped: true, reason: gate.message, code: gate.reason });
    }

    // The audit trail names the trusted workflow runner, never a person, when the
    // call came from automation.
    const outcome = await processBookingRequest(admin, {
      bookingId: booking_request_id,
      actorName: actor.automation ? 'Route Flow workflow' : actor.name,
      actorRole: actor.automation ? 'automation' : 'admin',
      trigger: actor.automation ? 'automation' : 'admin_panel',
    });

    return Response.json(outcome.body, { status: outcome.http });
  } catch (error) {
    return Response.json({ error: (error as Error)?.message || 'Auto-place failed.' }, { status: 500 });
  }
}