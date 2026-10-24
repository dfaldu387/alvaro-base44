import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { getClientHistory } from '../../shared/clientHistory.ts';
import { resolveProtectionRules } from '../../shared/bookingProtection.ts';

/**
 * clientHistory — a client's no-shows, cancellations, late cancellations and
 * completed bookings, counted on the server. Read-only, admin only.
 * body: { client_id }
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty */ }
    const clientId = String(body?.client_id || '').trim();
    if (!clientId) return Response.json({ error: 'client_id required' }, { status: 400 });

    const admin = base44.asServiceRole;
    const ruleRows = await admin.entities.BookingProtectionRules.list('-created_date', 1);
    const rules = resolveProtectionRules((Array.isArray(ruleRows) ? ruleRows : ruleRows?.items || [])[0]);
    const history = await getClientHistory(admin, clientId, rules.late_cancel_hours);
    return Response.json({ history });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}