import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { secrets } from 'base44:runtime';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { squareStatus } from '../../shared/squareConfig.ts';
import { squareWebhookUrl } from '../../shared/squareSignature.ts';

/**
 * paymentsHealth — read-only, admin only. Which payment provider is active, sandbox or production,
 * and the webhook counts. Returns names of missing secrets, never any value.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const s = squareStatus(name => secrets.get(name));
    const row = asList(await base44.asServiceRole.entities.PaymentWebhookHealth.list('created_date', 1))[0] || {};
    return Response.json({
      provider: s.active ? 'square' : 'test_double',
      environment: s.active ? s.environment : null,
      live_switch: s.live,
      missing: s.missing,
      invalid_environment: s.invalidEnvironment,
      webhook_url: squareWebhookUrl(),
      last_event_at: row.last_event_at || null,
      last_event_type: row.last_event_type || null,
      handled_count: row.handled_count || 0,
      duplicates_ignored: row.duplicates_ignored || 0,
      ignored_count: row.ignored_count || 0,
      unmatched_count: row.unmatched_count || 0,
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}