import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { loadSettings } from '../../shared/campaignRun.ts';
import { ACTIONS, runAction, type ActionName } from '../../shared/campaignActions.ts';

/**
 * campaignAction — admin actions on one reminder card: send_now, skip_cycle,
 * pause, mark_booked. Administrator only. The result says what really happened;
 * a send is only ever queued on the outbox, never delivered from here.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const action = body?.action as ActionName;
    const clientId = typeof body?.client_id === 'string' ? body.client_id.trim() : '';
    if (!ACTIONS.includes(action) || !clientId) {
      return Response.json({ ok: false, code: 'INVALID_INPUT', message: 'An action and a client are required.' }, { status: 400 });
    }
    // Send now may never bypass dry-run mode: refuse before anything is queued.
    if (action === 'send_now' && (await loadSettings(base44.asServiceRole)).dry_run !== false) {
      return Response.json({ ok: false, code: 'DRY_RUN', message: 'Dry-run mode is ON, so nothing can be sent. Turn dry-run off first.' });
    }
    return Response.json(await runAction(base44.asServiceRole, actor, action, clientId));
  } catch (e) {
    console.error('[campaignAction] failed', (e as Error)?.message);
    return Response.json({ ok: false, code: 'ERROR', message: 'The action failed and nothing was confirmed.' }, { status: 500 });
  }
}