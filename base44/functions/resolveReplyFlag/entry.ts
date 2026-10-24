import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';

/**
 * resolveReplyFlag — an administrator marks a customer-reply flag as handled.
 * kind 'flag' = BookingReplyFlag (NO / CANCEL / RESCHEDULE), 'unmatched' = UnmatchedReply.
 * It never touches the booking itself. The action is written to ActivityLog.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const kind = body?.kind;
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id || (kind !== 'flag' && kind !== 'unmatched')) {
      return Response.json({ ok: false, code: 'INVALID_INPUT', message: 'A reply and its type are required.' }, { status: 400 });
    }

    const admin = base44.asServiceRole;
    const now = new Date().toISOString();
    const entity = kind === 'flag' ? admin.entities.BookingReplyFlag : admin.entities.UnmatchedReply;
    const row = await entity.get(id).catch(() => null);
    if (!row) return Response.json({ ok: false, code: 'NOT_FOUND', message: 'That reply no longer exists.' }, { status: 404 });
    const done = kind === 'flag' ? row.status === 'resolved' : row.status === 'reviewed';
    if (done) return Response.json({ ok: true, already: true });

    await entity.update(id, kind === 'flag'
      ? { status: 'resolved', resolved_by: actor.name, resolved_at: now }
      : { status: 'reviewed', reviewed_by: actor.name, reviewed_at: now });

    try {
      await admin.entities.ActivityLog.create({
        action: kind === 'flag' ? 'reply_attention_resolved' : 'unmatched_reply_reviewed',
        actor: 'barber',
        summary: kind === 'flag' ? 'Customer reply marked as handled' : 'Unmatched customer reply marked as reviewed',
        detail: `by ${actor.name}. The booking was not changed.`,
        related_record_id: kind === 'flag' ? row.booking_request_id : id,
        related_record_type: kind === 'flag' ? 'BookingRequest' : 'Message',
        client_id: row.client_id || undefined,
        previous_value: 'open',
        new_value: kind === 'flag' ? 'resolved' : 'reviewed',
        timestamp: now,
      });
    } catch { /* an audit failure must never undo the resolve */ }

    return Response.json({ ok: true });
  } catch (e) {
    console.error('[resolveReplyFlag] failed', (e as Error)?.message);
    return Response.json({ ok: false, code: 'ERROR', message: 'Could not update the reply.' }, { status: 500 });
  }
}