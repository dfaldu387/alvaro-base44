import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { mergeClients } from '../../shared/clientMerge.ts';

/**
 * Merge a duplicate client into the one being kept: one server call, matched by
 * client id, audited, all-or-nothing. See shared/clientMerge for the rules.
 * Body: { survivor_id, duplicate_id }. Administrators only.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) return Response.json({ error: 'Automation cannot merge clients.' }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const survivorId = String(body.survivor_id || '').trim();
    const duplicateId = String(body.duplicate_id || '').trim();
    if (!survivorId || !duplicateId) {
      return Response.json({ merged: false, error: 'survivor_id and duplicate_id are required.' }, { status: 400 });
    }

    const out = await mergeClients(base44.asServiceRole, { survivorId, duplicateId, who: actor.name });
    return Response.json(out.body, { status: out.status });
  } catch (error) {
    console.error('[mergeClients]', (error as Error)?.message);
    return Response.json({ merged: false, error: 'The merge could not be completed. Please try again.' }, { status: 500 });
  }
}