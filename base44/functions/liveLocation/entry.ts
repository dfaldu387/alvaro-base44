import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { mapboxDriveMatrix } from '../../shared/mapboxTravel.ts';
import {
  LOOKUP_INTERVAL_SECONDS, MAX_STRAIGHT_KM, sydneyToday, checkFix, straightKm, lookupThrottled,
  ownRow, clearFix, switchOff, logSwitch, countLookup, lookupsToday,
} from '../../shared/liveLocation.ts';

/**
 * liveLocation - the barber's own "Share my location for today" switch and the one
 * current position behind it.
 *
 *   body: { action: 'status' }
 *         { action: 'on' }  { action: 'off' }
 *         { action: 'update', lat, lng, accuracy_m, taken_at }
 *
 * The barber is always the signed-in caller's own profile (never taken from the body),
 * and automation / a workflow can never use it, so nobody switches it on for someone
 * else. 'update' stores a position only when the switch is on AND that barber's stop
 * is on_the_way right now; it overwrites the one row. A bad, missing or throttled
 * position answers 200 { stored: false, reason } - that is normal, not an error.
 *
 * Billing: at most one travel-time lookup per LOOKUP_INTERVAL_SECONDS per barber, by
 * the same shared Mapbox helper the scheduling validator uses. (mapboxDriveMatrix the
 * endpoint is admin-only and stays that way; a barber cannot call it, so this
 * function is the barber-gated path, and it only ever measures to the stop in transit.)
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const no = (reason: string, extra: Record<string, unknown> = {}) => Response.json({ stored: false, reason, ...extra });

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) return Response.json({ error: 'Live location is switched by the barber only.' }, { status: 403 });
    if (!actor.member_id) return Response.json({ error: 'No barber profile is linked to this login.' }, { status: 403 });
    const admin = base44.asServiceRole;
    const me = actor.member_id;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const action = String(body?.action || '');
    const now = new Date();
    const today = sydneyToday(now);

    // Today's route for this barber, and the stop (if any) that is on the way.
    const todaysRoute = async () => {
      const routes = asList(await admin.entities.DayRoute.filter({ date: today, team_member_id: me }, '-created_date', 10))
        .filter((r: any) => r.is_test !== true);
      return routes.find((r: any) => r.route_status === 'finalised') || routes[0] || null;
    };
    const stateOf = (route: any, id: string) => String((route?.stop_execution || []).find((e: any) => e.booking_request_id === id)?.state || 'planned');

    let row = await ownRow(admin, me);
    // Sharing never carries over to another day.
    if (row && (row.service_date !== today || row.sharing_on !== true)) {
      await switchOff(admin, me, actor.name, 'new day');
      row = null;
    }

    if (action === 'status') {
      return Response.json({
        sharing: !!row,
        lookups_today: await lookupsToday(admin, me, today),
        lookup_interval_seconds: LOOKUP_INTERVAL_SECONDS,
      });
    }

    if (action === 'off') {
      await switchOff(admin, me, actor.name, 'switched off');
      return Response.json({ sharing: false });
    }

    if (action === 'on') {
      const route = await todaysRoute();
      const unfinished = (route?.stops || []).some((s: any) => !['completed', 'skipped'].includes(stateOf(route, s.booking_request_id)));
      if (!route || !unfinished) return Response.json({ sharing: false, reason: 'no_stops_left_today' }, { status: 409 });
      if (row) return Response.json({ sharing: true });
      await admin.entities.BarberLiveLocation.create({ team_member_id: me, user_id: String(actor.user?.id || ''), service_date: today, sharing_on: true });
      await logSwitch(admin, true, actor.name, today);
      return Response.json({ sharing: true });
    }

    if (action !== 'update') return Response.json({ error: "action must be 'status', 'on', 'off' or 'update'" }, { status: 400 });

    // ── update: one position, only while it is useful ──
    if (!row) return no('switch_off');
    const checked = checkFix(body, now);
    if (!checked.ok) return no(checked.reason);

    const route = await todaysRoute();
    const stop = route?.route_status === 'finalised'
      ? (route.stops || []).find((s: any) => stateOf(route, s.booking_request_id) === 'on_the_way')
      : null;
    if (!stop) { await clearFix(admin, me); return no('not_in_transit'); }

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(stop.booking_request_id); } catch { booking = null; }
    const dest = { lat: Number(booking?.address_lat), lng: Number(booking?.address_lng) };
    if (!booking || booking.team_member_id !== me || !Number.isFinite(dest.lat) || !Number.isFinite(dest.lng)) return no('stop_not_measurable');
    if (straightKm(checked.fix, dest) > MAX_STRAIGHT_KM) return no('implausible');

    // The throttle is claimed BEFORE the paid call, so a second request inside the interval pays nothing.
    if (lookupThrottled(row, stop.booking_request_id, now)) return no('throttled', { lookups_made: 0 });
    await admin.entities.BarberLiveLocation.update(row.id, { travel_stop_id: stop.booking_request_id, travel_checked_at: now.toISOString() });

    const m = await mapboxDriveMatrix([{ lat: checked.fix.lat, lng: checked.fix.lng }, dest]);
    const seconds = m.ok ? Number(m.durations?.[0]?.[1]) : NaN;
    const driveOk = Number.isFinite(seconds) && seconds >= 0;
    await countLookup(admin, me, today, driveOk);

    await admin.entities.BarberLiveLocation.update(row.id, {
      ...checked.fix,
      travel_stop_id: stop.booking_request_id,
      travel_drive_minutes: driveOk ? Math.ceil(seconds / 60) : null,
      travel_measured_at: driveOk ? new Date().toISOString() : null,
    });
    return Response.json({ stored: true, lookup: driveOk ? 'ok' : 'failed', lookups_made: 1 });
  } catch (error) {
    // A position that cannot be stored is not a problem for the barber: say nothing is wrong.
    console.error('[liveLocation]', (error as Error)?.message);
    return Response.json({ stored: false, reason: 'unavailable' });
  }
}