import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { parseAssistantMode } from '../../shared/assistantFlow.ts';
import { ensureSettingsRow } from '../../shared/settingsStore.ts';

/**
 * setAssistantMode — the ONLY place the AI assistant's mode is changed. A person
 * (never automation) must call it. It is a separate decision from
 * messaging_mode (setMessagingMode) and from the campaign dry run.
 *
 *   body.mode  'off' | 'draft' | 'live'
 *
 * Every change writes an ActivityLog row with who and when.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) return Response.json({ ok: false, message: 'The assistant mode can only be changed by a person.' }, { status: 403 });

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    if (!['off', 'draft', 'live'].includes(body?.mode)) {
      return Response.json({ ok: false, message: 'mode must be off, draft or live.' }, { status: 400 });
    }
    const admin = base44.asServiceRole;
    // A missing settings row is created with the assistant mode only: messaging_mode stays unset, which the sweep treats as allowlist.
    const row = await ensureSettingsRow(admin, 'MessagingSettings', { assistant_mode: body.mode });

    const before = parseAssistantMode(row.assistant_mode);
    if (before === body.mode) return Response.json({ ok: true, assistant_mode: before });
    await admin.entities.MessagingSettings.update(row.id, { assistant_mode: body.mode });
    await admin.entities.ActivityLog.create({
      action: 'assistant_mode_changed', actor: 'barber', actor_type: 'admin', actor_name: actor.name, outcome: 'applied',
      summary: `AI assistant: ${before} → ${body.mode}`, detail: `${actor.name} changed the AI assistant from ${before} to ${body.mode}.`,
      previous_value: before, new_value: body.mode, timestamp: new Date().toISOString(),
    });
    return Response.json({ ok: true, assistant_mode: body.mode });
  } catch (_e) {
    return Response.json({ ok: false, message: 'Could not change the assistant mode.' }, { status: 500 });
  }
}