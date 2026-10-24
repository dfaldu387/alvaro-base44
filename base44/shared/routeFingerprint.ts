/**
 * The day-fingerprint helpers, split out of dayRoute.ts so anything that only
 * needs to know "does this finalised route still match the day?" (the ETA
 * loader, the tests) does not have to import the whole route optimiser.
 * dayRoute.ts re-exports all three, so existing importers are unchanged.
 */

/** Statuses that mean the record never occupied real time. */
const DEAD_STATUSES = ['declined', 'no_show', 'could_not_fit'];

function num(v: any): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/** A block is time, not an appointment — it shapes a route but is never a stop. */
export function isBlockRow(row: any): boolean {
  return String(row?.client_name || '').startsWith('[BLOCK]') || row?.status === 'blocked';
}

/**
 * Does this record take part in a route? It must hold a time and not be dead.
 * `completed` still belongs on the day's route (it happened); it is simply an
 * anchor the optimiser will not move.
 */
export function isRouteAppointment(row: any): boolean {
  if (!row) return false;
  if (!row.assigned_time) return false;
  if (DEAD_STATUSES.includes(row.status)) return false;
  return true;
}

/**
 * The scheduling data a route was built from: every appointment's identity, time,
 * protection state, duration and location.
 *
 * Execution-only changes (arrived, completed) deliberately play no part, so
 * working a route never marks it as out of date. Anything that changes the plan
 * — a new booking, a cancellation, a drag, a service change, an address change,
 * an unlock or a move — does.
 */
/**
 * The day a route is judged against — and the very same day it is stamped from.
 *
 * One route covers its barber's whole day, so a real route is compared with every
 * appointment that barber has that day. Only a route explicitly tagged as test data
 * is narrowed to the test universe.
 *
 * Stamping and comparing MUST both come through here. A stamp taken from a narrower
 * day than the comparison is exactly how a freshly finalised route marked itself out
 * of date seconds later, which then hid its drive legs from the calendar.
 */
export function routeDayRows(
  rows: any[],
  target: { team_member_id?: string | null; universe?: boolean | null },
): any[] {
  return (rows || []).filter((r: any) =>
    String(r?.team_member_id || '') === String(target?.team_member_id || '')
    && (target?.universe == null || (r?.is_test === true) === target.universe),
  );
}

export function routeFingerprint(rows: any[]): string {
  return (rows || [])
    .filter(isRouteAppointment)
    .map((r: any) => [
      r.id,
      String(r.assigned_time || ''),
      String(r.schedule_status || ''),
      String(num(r.duration_mins)),
      String(r.address_lat ?? ''),
      String(r.address_lng ?? ''),
      isBlockRow(r) ? 'block' : 'appt',
    ].join(':'))
    .sort()
    .join('|');
}