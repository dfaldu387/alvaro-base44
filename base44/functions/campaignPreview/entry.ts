import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { asList, pageAll, loadSettings } from '../../shared/campaignRun.ts';
import { DEFAULT_TEMPLATES } from '../../shared/messageTemplateDefaults.ts';
import { tzNow, isoWeek, REASON_TEXT, CAP_RULE } from '../../shared/campaignRules.ts';

/**
 * campaignPreview — read-only. Returns the latest DRY-RUN result for each stage this
 * week, read from CampaignEntry/CampaignRun (preview records, never Message or
 * MessageOutbox). Writes nothing and contacts nobody.
 */
const KEYS = { outreach: 'rebooking_reminder', followup: 'rebooking_followup' } as const;
const KNOWN_VARS = ['name', 'booking_link'];
const MISSING = ['missing_name', 'no_valid_mobile', 'missing_next_reminder_date', 'invalid_next_reminder_date', 'template_render_failed'];

const eligibility = (o: string) => o === 'would_queue' ? 'Eligible: would be sent' : o === 'capped' ? 'Eligible, but over the run limit' : o === 'skipped' ? 'Excluded' : o;

export default async function (req: Request) {
  // Where the request got to, so a failure names its step (never customer data).
  let step = 'start';
  const t0 = Date.now();
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    step = 'settings';
    const settings = await loadSettings(admin);
    const week = isoWeek(tzNow(settings.timezone).date);
    step = 'templates';
    const templates = asList(await admin.entities.MessageTemplate.filter({ template_key: { $in: Object.values(KEYS) } }, { limit: 20 }));

    const stages: any = {};
    for (const stage of ['outreach', 'followup'] as const) {
      const saved = templates.find((t: any) => t.template_key === KEYS[stage]);
      const draft = DEFAULT_TEMPLATES.find(d => d.template_key === KEYS[stage]);
      const body = saved?.body || draft?.body || '';
      const vars = [...body.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map(m => m[1]);
      step = `run:${stage}`;
      const run = asList(await admin.entities.CampaignRun.filter({ campaign_week: week, stage, mode: 'dry_run' }, { sort: '-created_date', limit: 1 }))[0] || null;
      step = `entries:${stage}`;
      const entries = run ? await pageAll(c => admin.entities.CampaignEntry.filter({ run_id: run.id }, { sort: 'created_date', limit: 500, cursor: c })) : [];
      const items = entries.map((e: any) => ({
        client_id: e.client_id, client_name: e.client_name || 'Unnamed client', stage, channel: 'sms',
        outcome: e.outcome, eligibility: eligibility(e.outcome), reason_code: e.reason_code || null,
        reason_text: e.reason_text || null, message: e.preview_text || null, idempotency_key: e.idempotency_key || null,
        capped: e.outcome === 'capped', has_outbox: !!e.outbox_id, next_reminder_date: e.next_reminder_date || null,
      }));
      stages[stage] = {
        run: run && { id: run.id, status: run.status, started_at: run.started_at, finished_at: run.finished_at, trigger: run.trigger, actor_name: run.actor_name, max_per_run: run.max_per_run, eligible_total: run.eligible_total, messages_counted: run.messages_counted, capped_count: run.capped_count, skipped_count: run.skipped_count, already_processed: run.already_processed, aggregates: run.aggregates },
        template: { source: saved ? 'saved' : 'draft', active: !!saved && saved.is_active !== false, body, unknown_variables: vars.filter(v => !KNOWN_VARS.includes(v)) },
        would_send: items.filter(i => i.outcome === 'would_queue'),
        capped: items.filter(i => i.outcome === 'capped'),
        excluded: items.filter(i => i.outcome === 'skipped'),
        other: items.filter(i => !['would_queue', 'capped', 'skipped'].includes(i.outcome)),
        missing_data: items.filter(i => i.reason_code && MISSING.includes(i.reason_code)),
        queued_in_outbox: items.filter(i => i.has_outbox).length,
        projection: stage === 'followup',
      };
    }
    step = 'changes';
    const changes = asList(await admin.entities.CampaignDryRunChange.list('-created_date', 10));
    step = 'approval';
    const waiting = asList(await admin.entities.CampaignDryRunApproval.filter({ status: 'pending' }, { sort: '-created_date', limit: 5 }))
      .find((p: any) => p.expires_at && new Date(p.expires_at).getTime() > Date.now()) || null;
    console.log(JSON.stringify({ event: 'campaign_preview_ok', ms: Date.now() - t0 }));
    return Response.json({
      ok: true, label: 'Dry run — nothing sent', week, dry_run: settings.dry_run,
      viewer_id: actor.user?.id || null,
      pending_off_request: waiting && { id: waiting.id, requested_by: waiting.requested_by, requested_by_id: waiting.requested_by_id, requested_at: waiting.requested_at, expires_at: waiting.expires_at },
      schedule: { outreach_day: settings.outreach_day, followup_day: settings.followup_day, run_hour: settings.run_hour, timezone: settings.timezone, max_per_run: settings.max_per_run, booking_link: settings.booking_link },
      cap_rule: CAP_RULE, reason_labels: REASON_TEXT, stages,
      changes: changes.map((c: any) => ({ previous_value: c.previous_value, new_value: c.new_value, changed_by: c.changed_by, changed_at: c.changed_at, approved_by: c.approved_by || null })),
    });
  } catch (e) {
    console.error(JSON.stringify({ event: 'campaign_preview_failed', step, ms: Date.now() - t0, name: (e as Error)?.name, message: String((e as Error)?.message || '').slice(0, 300) }));
    return Response.json({ ok: false, error: 'Could not load the preview.', step }, { status: 500 });
  }
}