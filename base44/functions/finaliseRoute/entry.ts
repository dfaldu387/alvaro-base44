import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { finaliseDayRoute } from '../../shared/dayRoute.ts';

/**
 * Connect Appointments — the admin's one press that chains a day's appointments
 * into an executable route, in the order they are already arranged.
 *
 * The work itself lives in the shared day-route engine (shared/dayRoute), which
 * composes the shared connected-scheduling chain (connectedSchedule), the shared
 * hard-constraint validator (schedulingValidator), the shared Stage 2 day loader
 * (routeFlowOptimiser.loadDay), Mapbox road travel and the placement audit trail.
 *
 * It is deliberately NOT the confirmation step: connecting changes times only, so
 * every booking stays exactly as confirmed as it was and no message is queued.
 *
 * body:
 *   date            (required)  YYYY-MM-DD
 *   team_member_id  (optional)  finalise one barber; omitted = every barber on the day
 *   is_test         (optional)  finalise only the test universe (QA)
 *   dry_run         (required for the confirmation dialog) estimate only — writes nothing
 *
 * Authority is resolved BEFORE any day read, Mapbox call or write.
 * The result is always reported: ok, the plan (or the applied route), the
 * before/after drive and idle minutes, the drive legs created and — when it
 * cannot be done — one plain sentence explaining why nothing was changed.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const admin = base44.asServiceRole;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* empty body */
    }

    if (!body?.date) {
      return Response.json({ error: 'A date is required to finalise a route.' }, { status: 400 });
    }

    const result = await finaliseDayRoute(admin, {
      date: String(body.date),
      teamMemberId: body.team_member_id ? String(body.team_member_id) : null,
      isTest: typeof body.is_test === 'boolean' ? body.is_test : undefined,
      dryRun: body.dry_run === true,
      actorName: actor.automation ? 'Route Flow workflow' : actor.name,
      actorRole: actor.automation ? 'automation' : 'admin',
      trigger: actor.automation ? 'automation' : 'admin_panel',
    });

    // Connecting is planning, not a promise. It never confirms a booking, never
    // changes a booking's status and never queues a message: the times stay
    // editable until the admin presses Confirm Appointments, which is the only
    // step that fixes them and reaches the client.
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}