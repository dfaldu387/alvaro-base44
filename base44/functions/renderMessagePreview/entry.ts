import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { renderTemplate } from '../../shared/messageRender.ts';

/**
 * renderMessagePreview — admin-only. Runs the exact renderer the sweep uses on
 * a body + sample payload, so the editor preview can never drift from what is
 * sent. Reads and writes nothing.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let input: any = {};
    try { input = await req.json(); } catch { /* empty body */ }

    const result = renderTemplate(input?.body, input?.payload);
    return Response.json(result.ok
      ? { ok: true, text: result.text }
      : { ok: false, reason: result.reason, missing: result.missing });
  } catch {
    return Response.json({ error: 'Could not render the preview.' }, { status: 500 });
  }
}