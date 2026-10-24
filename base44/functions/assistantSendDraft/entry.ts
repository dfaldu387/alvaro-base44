import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { enqueueOutboxMessage } from '../../shared/outboxEnqueue.ts';
import { recordAudit } from '../../shared/auditLog.ts';
import { sendDraft } from '../../shared/assistantFlow.ts';

/**
 * assistantSendDraft — Alvaro taps Send on a draft the assistant wrote.
 *
 * It only puts the text on the MessageOutbox as a MANUAL message (so the thread
 * shows who sent it); the sweep still applies opt-out, test data and the
 * messaging mode, and sends. The draft is re-checked by the hard guard against
 * the booking as it is now. A person must call it: automation is refused.
 *
 * body: { event_id: string }
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) return Response.json({ error: 'A person must send assistant drafts.' }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const eventId = typeof body?.event_id === 'string' ? body.event_id.trim() : '';
    if (!eventId) return Response.json({ error: 'event_id is required.' }, { status: 400 });

    const res = await sendDraft(base44.asServiceRole, eventId, actor.name, { enqueue: enqueueOutboxMessage });
    if (!res.ok) return Response.json({ ok: false, code: res.code, error: res.error }, { status: res.status });
    // Who approved an assistant draft. Ids only: never the draft text or the customer's number.
    await recordAudit(base44.asServiceRole, {
      action: 'assistant_draft_sent', who: actor.name, summary: 'An assistant draft was approved and queued',
      ids: { event_id: eventId, outbox_id: res.outbox_id },
    });
    return Response.json({ ok: true, outbox_id: res.outbox_id });
  } catch (_e) {
    return Response.json({ error: 'Could not send the draft.' }, { status: 500 });
  }
}