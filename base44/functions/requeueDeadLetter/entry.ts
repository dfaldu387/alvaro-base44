import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { requeueDeadLetter } from '../../shared/deadLetterRequeue.ts';
import { recipientBlock } from '../../shared/recipientGuard.ts';

/**
 * requeueDeadLetter — an admin puts one dead-lettered message back in the queue.
 * body: { outbox_id: string }
 * A person must call it (automation is refused). It sends nothing itself: the item
 * becomes pending with its attempts cleared, and the normal sweep applies every
 * guard before anything leaves. It refuses when the booking is cancelled or gone, or
 * when the sweep's own recipient check says the customer must not be messaged.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) return Response.json({ error: 'A person must re-queue a message.' }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const id = typeof body?.outbox_id === 'string' ? body.outbox_id.trim() : '';
    if (!id) return Response.json({ error: 'outbox_id is required.' }, { status: 400 });

    const res = await requeueDeadLetter(base44.asServiceRole, id, actor.name, { recipientBlock });
    if (!res.ok) return Response.json({ ok: false, code: res.code, error: res.error }, { status: res.status });
    return Response.json({ ok: true });
  } catch (_e) {
    return Response.json({ error: 'Could not re-queue the message.' }, { status: 500 });
  }
}