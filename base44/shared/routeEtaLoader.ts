import { computeRouteEta, windowPhrase, sydneyClock, type RouteEta, type EtaStop, type LivePositionInput } from './routeEta.ts';
import { currentRouteStatus } from './currentRouteStatus.ts';

/**
 * The thin, read-only wrapper around the pure ETA model: it reads the day's
 * DayRoute records and bookings and hands them to computeRouteEta. It writes
 * nothing.
 *
 * A route whose stored status is 'finalised' but whose fingerprint no longer
 * matches the day is treated as needs_update here too, without waiting for
 * getDayRouteState to record it - an ETA built on a stale route would be a guess.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export interface DayEta {
  date: string;
  results: Array<RouteEta & { is_test: boolean }>;
  bookings: Map<string, any>;
}

/**
 * The barber's one stored position, handed to the pure model as an argument. READ
 * only, and only when a stop is on the way today with sharing on; otherwise there is
 * no read at all and the result is exactly the tap-based one. Any problem -> null.
 */
async function livePositionFor(admin: any, route: any, date: string, now: Date): Promise<LivePositionInput | null> {
  try {
    if (!route.team_member_id || route.is_test === true) return null;
    if (!(route.stop_execution || []).some((e: any) => e?.state === 'on_the_way')) return null;
    if (sydneyClock(now.getTime()).date !== date) return null;
    const row = asList(await admin.entities.BarberLiveLocation.filter({ team_member_id: route.team_member_id, service_date: date }, '-updated_date', 1))[0];
    if (!row || row.sharing_on !== true || row.lat == null) return null;
    return {
      lat: Number(row.lat), lng: Number(row.lng), accuracy_m: Number(row.accuracy_m), taken_at: row.taken_at,
      stop_id: String(row.travel_stop_id || ''), drive_minutes: Number(row.travel_drive_minutes), measured_at: row.travel_measured_at,
    };
  } catch {
    return null;
  }
}

export async function loadDayEta(admin: any, date: string, now: Date = new Date()): Promise<DayEta> {
  const routes = asList(await admin.entities.DayRoute.filter({ date }, 'created_date', 50));
  const rows = asList(await admin.entities.BookingRequest.filter({ requested_date: date }, 'created_date', 400));
  const bookings = new Map<string, any>(rows.map((r: any) => [String(r.id), r]));

  const results = await Promise.all(routes.map(async (route: any) => {
    const status = currentRouteStatus(route, rows);

    const service_minutes: Record<string, number> = {};
    for (const s of route.stops || []) {
      service_minutes[s.booking_request_id] = Number(bookings.get(String(s.booking_request_id))?.duration_mins);
    }
    const live = status === 'finalised' ? await livePositionFor(admin, route, date, now) : null;
    const eta = computeRouteEta({ date, route: { ...route, route_status: status }, service_minutes, now, live });
    return { ...eta, is_test: route.is_test === true };
  }));
  return { date, results, bookings };
}

/** The ETA stop for one booking (from whichever route holds it), or null. Never throws. */
export async function etaForBooking(admin: any, booking: any, now: Date = new Date()): Promise<{ route: RouteEta; stop: EtaStop } | null> {
  try {
    const day = await loadDayEta(admin, String(booking?.requested_date || ''), now);
    for (const r of day.results) {
      const stop = r.stops.find(s => s.booking_request_id === String(booking.id));
      if (stop) return { route: r, stop };
    }
  } catch (e) {
    console.error('etaForBooking failed', (e as Error)?.message);
  }
  return null;
}

/** The template variable for a booking: the window sentence, or '' when no ETA exists. */
export function etaVariable(found: { route: RouteEta; stop: EtaStop } | null): string {
  return found && found.route.status === 'ok' ? windowPhrase(found.stop) : '';
}