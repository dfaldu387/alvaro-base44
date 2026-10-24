import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { EXPIRED_RESPONSE, isTokenShape, trackingIsLive, buildTrackingView } from '../../shared/bookingTracking.ts';
import { loadDayEta } from '../../shared/routeEtaLoader.ts';
import { sydneyNow } from '../../shared/arrivalTimes.ts';

/**
 * getBookingTracking - PUBLIC. Takes only { token }.
 *
 * Returns ONLY: first_name, service, booked_time, arrival_window, state,
 * stops_away (see buildTrackingView). No address, phone, other booking, barber
 * position or route.
 *
 * An unknown token, a token for another date, a closed booking, a malformed
 * token and an internal failure all return the SAME neutral response with HTTP
 * 200, so the endpoint cannot be used to tell the cases apart.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const expired = () => Response.json(EXPIRED_RESPONSE);

export default async function (req: Request) {
  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    if (!isTokenShape(token)) return expired();

    const admin = createClientFromRequest(req).asServiceRole;
    const booking = asList(await admin.entities.BookingRequest.filter({ tracking_token: token }, '-created_date', 2))[0];
    if (!trackingIsLive(booking, token, sydneyNow().date)) return expired();

    const now = new Date();
    const day = await loadDayEta(admin, booking.requested_date, now);
    return Response.json(buildTrackingView(booking, day.results, now));
  } catch (error) {
    console.error('[getBookingTracking]', (error as Error)?.message);
    return expired();
  }
}