import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { resolveSchedulingActor } from '../../shared/schedulingAuth.ts';
import { saveSettings } from '../../shared/settingsStore.ts';

/**
 * The only way the browser changes business settings (booking rules, deposits, discounts, capacity,
 * coverage, protection, campaign schedule, scheduling bot). Admins only: staff and automation are
 * refused. The person comes from the login, never the body.
 *
 * Body: { entity, screen, data }  - data holds only the fields that screen owns.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) return Response.json({ error: 'Automation cannot change settings.' }, { status: 403 });
    if (actor.tier !== 'admin') return Response.json({ error: 'Only an admin can change these settings.' }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const out = await saveSettings(base44.asServiceRole, {
      entity: String(body?.entity || ''), screen: String(body?.screen || ''), data: body?.data, who: actor.name,
    });
    return out.status ? Response.json(out.body, { status: out.status }) : Response.json(out.body);
  } catch (error) {
    console.error('[saveSettings]', (error as Error)?.message);
    return Response.json({ error: 'The settings could not be saved. Please try again.' }, { status: 500 });
  }
}