import { routeDayRows, routeFingerprint } from './routeFingerprint.ts';

/**
 * Is this route still what its stored status says? ONE answer, used by every reader (the ETA loader and
 * the arrival-time job). A route stored as 'finalised' is re-checked against the day as it stands now: if
 * any appointment changed since it was finalised, it is 'needs_update' whether or not anyone has opened the
 * calendar to record that. Any other stored status is returned as it is.
 */
export function currentRouteStatus(route: any, dayRows: any[]): string {
  const stored = String(route?.route_status || '');
  if (stored !== 'finalised') return stored;
  // A route covers its barber's whole day. Only a route tagged as test data is
  // narrowed to the test universe; a real route is compared with every appointment
  // on the day, because every one of them is a stop on it. This is the same set the
  // route was stamped from (routeDayRows), so a fresh route reads as finalised.
  const mine = routeDayRows(dayRows, {
    team_member_id: route.team_member_id,
    universe: route.is_test === true ? true : null,
  });
  return String(route.fingerprint || '') === routeFingerprint(mine) ? 'finalised' : 'needs_update';
}