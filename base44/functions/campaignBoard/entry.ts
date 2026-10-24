import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { buildBoard } from '../../shared/campaignBoard.ts';

/** Read-only data for the admin Reminders board. Admin only. */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    return Response.json(await buildBoard(base44.asServiceRole));
  } catch (e) {
    console.error('[campaignBoard] failed', (e as Error)?.message);
    return Response.json({ ok: false, error: 'Could not load the reminders board.' }, { status: 500 });
  }
}