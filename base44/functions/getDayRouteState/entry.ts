import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { dayRouteOverview } from '../../shared/dayRoute.ts';

/**
 * The day-level route state the Calendar and the Route tab read.
 *
 *   body: { date, team_member_id? }
 *
 * Returns the day's route_status (draft / finalising / finalised /
 * needs_update), the metrics of the finalised route, its execution order, and —
 * when a finalised day no longer matches the route built from it — the reason it
 * needs rebuilding. The outdated route is returned for reference rather than
 * silently replaced.
 *
 * Reconciliation is part of this read because a change can arrive from any
 * direction: a new booking, a cancellation, an admin drag, a service edit, an
 * address change. Comparing the route's stored fingerprint with the day as it
 * stands is the one check no writer can bypass, and the transition is recorded
 * in the Route Flow activity trail.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const admin = base44.asServiceRole;

    let body: any = {};
    try {
      body = await req.json();
    } catch {
      /* empty body */
    }

    if (!body?.date) {
      return Response.json({ error: 'A date is required.' }, { status: 400 });
    }

    const overview = await dayRouteOverview(admin, {
      date: String(body.date),
      teamMemberId: body.team_member_id ? String(body.team_member_id) : null,
      actorName: actor.name,
    });

    return Response.json(overview);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}