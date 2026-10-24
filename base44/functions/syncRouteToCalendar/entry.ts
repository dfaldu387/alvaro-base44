import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { syncRouteCalendar } from '../../shared/calendarSync.ts';

/**
 * Copy a finalised route into the barber's own Google Calendar.
 *
 * Called by the app right after a route is finalised, and only then: this writes
 * one calendar block per appointment through the signed-in person's OWN Google
 * connection (app-user connector — each barber connects their own account).
 *
 * body:
 *   date            (required)  YYYY-MM-DD
 *   team_member_id  (optional)  the scope that was finalised
 *
 * Whose calendar is written is decided HERE, from the signed-in identity, never
 * from the request body: the signed-in person's own barber profile wins, so a
 * barber can never push another barber's day into their calendar. Only when the
 * login has no barber profile linked yet (the usual state for the owner) does the
 * requested scope apply, because that person owns the day they just finalised.
 *
 * Nothing about the app's data changes here — the schedule, the bookings and the
 * messages are untouched. An unconnected calendar is answered, not failed: the
 * route is already finalised and that must stand.
 */
const CONNECTOR_ID = '6acfeb0637dedce6cedcd553';

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) {
      return Response.json({ error: 'Only a signed-in person can sync a route to a calendar.' }, { status: 403 });
    }

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* empty body */
    }
    if (!body?.date) {
      return Response.json({ error: 'A date is required to sync a route.' }, { status: 400 });
    }

    const admin = base44.asServiceRole;

    let connection: any = null;
    try {
      connection = await admin.connectors.getCurrentAppUserConnection(CONNECTOR_ID);
    } catch {
      return Response.json({
        connected: false,
        created: 0,
        updated: 0,
        failed: 0,
        total: 0,
        message: 'your Google Calendar is not connected',
      });
    }

    const scopeMemberId = actor.member_id || (body.team_member_id ? String(body.team_member_id) : null);

    const result = await syncRouteCalendar({
      admin,
      accessToken: connection.accessToken,
      appUserId: actor.user.id,
      teamMemberId: scopeMemberId,
      date: String(body.date),
    });

    return Response.json({ connected: true, ...result });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}