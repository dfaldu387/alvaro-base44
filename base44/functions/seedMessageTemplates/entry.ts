import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { DEFAULT_TEMPLATES } from '../../shared/messageTemplateDefaults.ts';
import { ensureRouteTemplates } from '../../shared/routeMessageTemplates.ts';

/**
 * seedMessageTemplates — admin-only, idempotent. Creates any of the six default
 * templates that are missing. A template that already exists (even if the
 * business has edited it, deactivated it or emptied it) is NEVER touched.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const admin = base44.asServiceRole;
    const existing = asList(await admin.entities.MessageTemplate.list('created_date', 200));
    const have = new Set(existing.map((t: any) => t.template_key));
    const missing = DEFAULT_TEMPLATES.filter(t => !have.has(t.template_key));

    if (missing.length > 0) {
      await admin.entities.MessageTemplate.bulkCreate(missing.map(t => ({ ...t, is_active: t.is_active ?? true })));
    }
    const routeCreated = await ensureRouteTemplates(admin);
    return Response.json({ ok: true, created: [...missing.map(t => t.template_key), ...routeCreated], already_present: DEFAULT_TEMPLATES.length - missing.length });
  } catch {
    return Response.json({ ok: false, error: 'Could not add the default templates.' }, { status: 500 });
  }
}