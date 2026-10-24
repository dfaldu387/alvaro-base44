import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { nextReminderFor } from '../../shared/routeCompletion.ts';

const TZ = 'Australia/Sydney';
const todayInSydney = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/**
 * reminderAdvanceDate — the next reminder date for a client counted from today, for the Client Workflow
 * page's manual actions (skip a cycle, remove from this week, not interested). It uses the very same rule as
 * completing a visit (nextReminderFor -> resolveCadence), so the winning cadence source decides the date
 * wherever it is set. Read-only: it returns the date and writes nothing. { date: null } = no fixed gap.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok || actor.tier === 'none') return Response.json({ error: actor.error || 'Permission required.' }, { status: actor.status || 403 });
    let body: any = {};
    try { body = await req.json(); } catch { /* no body */ }
    if (!body?.client_id) return Response.json({ error: 'client_id is required.' }, { status: 400 });
    const client = await base44.asServiceRole.entities.ReminderClient.get(String(body.client_id));
    if (!client) return Response.json({ error: 'Client not found.' }, { status: 404 });
    return Response.json({ ok: true, date: nextReminderFor(client, todayInSydney()) });
  } catch (e) {
    console.error('[reminderAdvanceDate] failed', (e as Error)?.message);
    return Response.json({ ok: false, error: 'The reminder date could not be worked out.' }, { status: 500 });
  }
}