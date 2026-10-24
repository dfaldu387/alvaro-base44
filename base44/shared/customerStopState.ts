import type { RouteEta, EtaStop } from './routeEta.ts';
import { labelToMinutes, sydneyClock } from './routeEta.ts';
import type { CustomerState } from './routeStopStates.ts';

/**
 * What the customer's tracking view calls a stop. PURE and DERIVED: it is worked out from numbers the page load has
 * already computed (the stop's stored state, the route's status and the live ETA). It reads nothing, looks nothing up
 * and writes nothing, so it costs nothing extra. The two derived labels are never stored (see StopState).
 *
 * "Barber preparing"
 *   - the stop is still `planned`, and the route is finalised with a usable ETA;
 *   - nobody is ahead of this customer (no earlier stop is still to be worked, so the barber is not mid-cut elsewhere);
 *   - the ETA is within PREPARING_LEAD_MINUTES.
 *   Why 30: it is the quiet gap between finishing the last job and pressing "On the way". Any earlier and it would
 *   claim the barber is getting ready hours before; the customer's own 15-minute window starts well after it.
 *
 * "Arriving soon"
 *   - the stop is `on_the_way`, the route is finalised, and the ETA is available and FRESH;
 *   - the ETA is within ARRIVING_SOON_MINUTES.
 *   Why 10: it is less than the 15-minute arrival window the customer is already shown, so it only appears when the
 *   barber is genuinely close enough for the customer to be at the door, and never earlier than the window itself.
 *
 * FRESH: the ETA is not more than STALE_AFTER_MINUTES in the past. The ETA does not move with the clock, so a stop
 * whose ETA has long passed without an Arrived tap is an estimate that has stopped being true. Then, and whenever the
 * ETA is unavailable, the customer sees the plain stored state ("On the way" / "Confirmed"). Never a guess.
 */
export const PREPARING_LEAD_MINUTES = 30;
export const ARRIVING_SOON_MINUTES = 10;
export const STALE_AFTER_MINUTES = 10;

const DONE = ['completed', 'skipped'];

export function deriveCustomerState(
  stop: Pick<EtaStop, 'state' | 'eta_start_label' | 'order'> | null | undefined,
  route: Pick<RouteEta, 'status' | 'stops'> | null | undefined,
  nowMs: number,
): CustomerState | null {
  if (!stop || !route || route.status !== 'ok') return null;
  const eta = labelToMinutes(stop.eta_start_label);
  if (!Number.isFinite(eta)) return null;
  const minutesToEta = eta - sydneyClock(nowMs).minutes;
  if (minutesToEta < -STALE_AFTER_MINUTES) return null; // stale

  if (stop.state === 'on_the_way') return minutesToEta <= ARRIVING_SOON_MINUTES ? 'arriving_soon' : null;

  if (stop.state === 'planned') {
    const someoneAhead = route.stops.some((s) => s.order < stop.order && !DONE.includes(s.state));
    return !someoneAhead && minutesToEta <= PREPARING_LEAD_MINUTES ? 'preparing' : null;
  }
  return null;
}