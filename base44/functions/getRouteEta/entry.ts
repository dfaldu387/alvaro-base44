import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { loadDayEta } from '../../shared/routeEtaLoader.ts';

/**
 * getRouteEta - the live ETA for a day, for the Route screen and the Calendar.
 *   body: { date: 'YYYY-MM-DD' }
 * Read-only. Staff only (same gate as getDayRouteState). For every stop it also
 * says whether a running_late message has been queued or sent, and for what
 * window, so nobody sends a second apology by hand.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const date = String(body?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Response.json({ error: 'A date (YYYY-MM-DD) is required.' }, { status: 400 });

    const day = await loadDayEta(admin, date, new Date());
    const ids = day.results.flatMap(r => r.stops.map(s => s.booking_request_id));

    // Newest running_late message per booking.
    const late: Record<string, any> = {};
    if (ids.length > 0) {
      const rows = asList(await admin.entities.MessageOutbox.filter(
        { template_key: 'running_late', booking_request_id: { $in: ids } }, '-created_date', 200));
      for (const r of rows) {
        if (late[r.booking_request_id]) continue;
        const sent = (r.history || []).find((h: any) => h?.result === 'sent');
        late[r.booking_request_id] = {
          status: r.status,
          window_label: r.payload?.window_label || null,
          queued_at: r.created_date,
          sent_at: sent?.at || null,
          reason: r.suppressed_reason || r.deferral_reason || r.last_error || null,
        };
      }
    }

    const nameOf = (id: string) => String(day.bookings.get(id)?.client_name || '');
    return Response.json({
      date,
      routes: day.results.map(r => ({
        route_id: r.route_id,
        team_member_name: r.team_member_name,
        is_test: r.is_test,
        status: r.status,
        reason: r.reason,
        reason_text: r.reason_text,
        delay_minutes: r.delay_minutes,
        anchor: r.anchor ? { ...r.anchor, client_name: nameOf(r.anchor.booking_request_id) } : null,
        stops: r.stops.map(s => ({ ...s, client_name: nameOf(s.booking_request_id), running_late: late[s.booking_request_id] || null })),
      })),
    });
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 500 });
  }
}