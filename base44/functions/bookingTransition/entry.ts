import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { runTransition } from '../../shared/bookingTransition.ts';

/**
 * bookingTransition — complete, set status, lock/unlock, confirm/clear an availability override.
 * body: { booking_request_id, action, status?, reason? }
 * Admin, or the barber who owns the booking (overrides: admin only). Audited. See shared/bookingTransition.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }
    const id = String(body?.booking_request_id || '').trim();
    if (!id) return Response.json({ saved: false, error: 'booking_request_id required' }, { status: 400 });
    const admin = base44.asServiceRole;
    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(id); } catch { booking = null; }
    if (!booking) return Response.json({ saved: false, error: 'Booking not found.' }, { status: 404 });
    const r = await runTransition(admin, actor, booking, String(body?.action || ''), body);
    return Response.json(r.body, { status: r.status });
  } catch (error: any) {
    return Response.json({ saved: false, error: error.message }, { status: 500 });
  }
}