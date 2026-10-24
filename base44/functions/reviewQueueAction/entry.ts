import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { createPaymentForBooking } from '../../shared/paymentService.ts';

/**
 * reviewQueueAction — releases a held public booking. Admin only.
 * body: { action: 'approve', booking_request_id, place?: boolean }
 *
 * Declining a held request uses the existing declineBookingRequest function, so
 * the reason, audit entry and customer message follow the normal decline path.
 *
 * Approving clears the hold and creates the payment record the hold had
 * postponed. With place !== false it then runs Route Flow placement exactly as it
 * would have run at submission; with place === false the request is only
 * approved, and stays unplaced so it can be scheduled by hand.
 *
 * Approving never confirms the appointment and never messages the customer.
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
    // Approve only: the request is released but left for a person to place.
    const place = body?.place !== false;
    if (body?.action !== 'approve') return Response.json({ error: 'Unknown action.' }, { status: 400 });
    if (!id) return Response.json({ error: 'booking_request_id required' }, { status: 400 });

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(id); } catch { booking = null; }
    if (!booking) return Response.json({ error: 'Booking not found.' }, { status: 404 });

    // Idempotent: a second click on an already approved request does nothing.
    if (booking.protection_hold !== true) return Response.json({ ok: true, already_approved: true });
    if (booking.status !== 'pending') {
      return Response.json({ error: `This request is ${String(booking.status).replace(/_/g, ' ')}, so it cannot be approved.` }, { status: 409 });
    }

    const now = new Date().toISOString();
    const updated = await admin.entities.BookingRequest.update(id, {
      protection_hold: false,
      protection_decision: 'approved',
      protection_reviewed_by: actor.name,
      protection_reviewed_at: now,
      placement_status: place ? 'processing' : 'unscheduled',
      placement_reason: place ? '' : 'Approved — waiting to be placed',
    });

    // The deposit decision and text were postponed while the request was held.
    let deposit: any = null;
    try {
      const { payment } = await createPaymentForBooking(admin, { ...booking, ...updated });
      deposit = { required: payment.state === 'deposit_due', amount: payment.deposit_amount || 0 };
    } catch (e: any) { console.error('[reviewQueueAction] payment record failed', e?.message); }

    // Placement runs as it would have at submission. A failure here leaves the
    // request visible as Processing/Needs Action for the normal tools, never lost.
    let placement: any = null;
    if (place) {
      try {
        const res = await base44.functions.invoke('routeFlowAutoPlaceV2', { booking_request_id: id });
        placement = res?.data || null;
      } catch (e: any) { placement = { error: e?.message || 'Placement did not run.' }; }
    }

    try {
      await admin.entities.ActivityLog.create({
        action: 'booking_hold_approved', actor: 'barber',
        summary: 'Held booking request approved into the schedule',
        detail: `Reasons held: ${(booking.protection_reasons || []).join(' | ')} · by ${actor.name}`.slice(0, 400),
        related_record_id: id, related_record_type: 'BookingRequest', timestamp: now,
      });
    } catch { /* an audit failure never changes the approval */ }

    return Response.json({ ok: true, approved_only: place === false, deposit, placement });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}