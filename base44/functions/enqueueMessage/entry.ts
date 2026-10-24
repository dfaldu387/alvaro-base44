import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { enqueueOutboxMessage } from '../../shared/outboxEnqueue.ts';

/**
 * enqueueMessage — admin-gated endpoint that puts an automated customer message
 * on the MessageOutbox. All logic (validation, test-data flagging, idempotency)
 * lives in shared/outboxEnqueue so server-side transitions use the same path.
 * It ONLY enqueues; nothing is rendered, sent or delivered here.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const result = await enqueueOutboxMessage(base44.asServiceRole, body || {});
    if (!result.ok) return Response.json({ ok: false, code: result.code, error: result.error }, { status: result.status });
    return Response.json({ ok: true, created: result.created, message_outbox: result.message_outbox });
  } catch (_error) {
    // Never echo customer data or payloads.
    return Response.json({ ok: false, code: 'INTERNAL_ERROR', error: 'Could not enqueue the message.' }, { status: 500 });
  }
}