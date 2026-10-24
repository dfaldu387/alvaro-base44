import { markRouteNeedsUpdate } from './dayRoute.ts';

/**
 * A finalised route is a promise: the arrival times the customers were given. Automatic Route Flow work
 * (the reshuffle workflow, automatic fitting of a new request) must not move appointments on a day that
 * has been finalised. It leaves the day exactly as it is, and marks the route as needing an update so a
 * person sees that something arrived and rebuilds the route when they choose.
 *
 * This sits IN FRONT of the automatic paths. The scheduling engines are not touched, and a person moving
 * an appointment (calendar, Auto Sort, Apply Changes) is never held by it.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export const FINALISED_HOLD_REASON = 'route_finalised';
export const FINALISED_HOLD_MESSAGE = 'This day has a finalised route, so Route Flow left the appointments exactly as they are. The route is marked as needing an update.';
const NEEDS_UPDATE_NOTE = 'Route Flow did not move any appointments on this finalised day, because the customers already hold their arrival times. Something arrived that it left unplaced; rebuild the route when you are ready.';

export async function holdIfFinalised(
  admin: any,
  target: { date: string; teamMemberId?: string; isTest?: boolean },
): Promise<{ reason: string; message: string } | null> {
  const routes = asList(await admin.entities.DayRoute.filter({ date: target.date }, 'created_date', 50));
  const mine = routes.find((r: any) =>
    String(r.team_member_id || '') === String(target.teamMemberId || '') &&
    (r.is_test === true) === (target.isTest === true) &&
    (r.route_status === 'finalised' || r.route_status === 'needs_update'));
  if (!mine) return null;
  if (mine.route_status === 'finalised') {
    await markRouteNeedsUpdate(admin, { record: mine, reason: NEEDS_UPDATE_NOTE, actorName: 'Route Flow' });
  }
  return { reason: FINALISED_HOLD_REASON, message: FINALISED_HOLD_MESSAGE };
}