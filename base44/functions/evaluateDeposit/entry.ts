import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { evaluateForBooking, loadDepositRules } from '../../shared/paymentService.ts';

/**
 * evaluateDeposit — read-only. Says whether a booking would need a deposit under
 * the saved DepositRules, using the real risk inputs. Writes nothing.
 * body: { booking_request_id }
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const id = String(body?.booking_request_id || '').trim();
    if (!id) return Response.json({ error: 'booking_request_id required' }, { status: 400 });

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(id); } catch { booking = null; }
    if (!booking) return Response.json({ error: 'booking request not found' }, { status: 404 });

    const decision = await evaluateForBooking(admin, booking, await loadDepositRules(admin));
    return Response.json({ booking_request_id: id, ...decision });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}