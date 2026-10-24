import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { getPaymentProvider } from '../../shared/paymentProvider.ts';
import { ensurePaymentForBooking } from '../../shared/ensurePayment.ts';

/**
 * ensureBookingPayment — gives a booking its payment record, with the deposit rules applied exactly as for
 * a public booking. Run by the "Booking Payment Record" workflow for EVERY new BookingRequest, so a booking
 * created from the Schedule tab (or any other path) is never left without one. Safe to repeat.
 * Admin or workflow only.
 * body: { booking_request_id }
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }
    const id = String(body?.booking_request_id || '').trim();
    if (!id) return Response.json({ error: 'booking_request_id required' }, { status: 400 });

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(id); } catch { booking = null; }
    if (!booking) return Response.json({ error: 'Booking not found.' }, { status: 404 });

    const result = await ensurePaymentForBooking(admin, booking, { provider: getPaymentProvider(), actor: actor.name });
    return Response.json({ ok: true, ...result });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}