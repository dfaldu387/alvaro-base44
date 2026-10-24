import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { handlePaymentEvent } from '../../shared/paymentMessages.ts';

/**
 * paymentFollowUp — what follows a recorded payment event: unsent payment texts that are no longer owed are
 * stopped, and the receipt is queued for money that really arrived (one per payment). Run by the "Payment
 * Follow-up" workflow for each PaymentEvent, so the Square webhook, an admin marking a payment received and a
 * barber taking cash all lead to the same place. Safe to repeat. Admin or workflow only.
 * body: { payment_event_id }
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }
    const id = String(body?.payment_event_id || '').trim();
    if (!id) return Response.json({ error: 'payment_event_id required' }, { status: 400 });

    return Response.json({ ok: true, ...(await handlePaymentEvent(base44.asServiceRole, id)) });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}