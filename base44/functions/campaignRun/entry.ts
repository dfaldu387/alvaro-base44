import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { runCampaign, loadSettings, type Stage } from '../../shared/campaignRun.ts';
import { tzNow } from '../../shared/campaignRules.ts';
import { recordJobRun } from '../../shared/jobHeartbeat.ts';

/**
 * campaignRun — runs the regular-client reminder campaign.
 *
 * Scheduled use (the workflow's service identity): body { stage: "auto" }. The
 * workflow fires HOURLY and this function decides from the saved settings whether
 * it is the right weekday and hour to act, so changing the send hour or days in the
 * UI needs no workflow edit. A run outside the configured day or hour does nothing
 * and returns ran:false with the reason (also recorded on the job's heartbeat).
 * It acts at most once per stage per day.
 *
 * Admin use (a person): body { stage: "outreach" | "followup" }. This ALWAYS runs as
 * a dry run (a preview that queues nothing) unless the body also says live: true,
 * and even then dry-run mode and the template approval still apply.
 *
 * It only enqueues on the central outbox. It never contacts a provider.
 */
export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    const admin = base44.asServiceRole;

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const scheduled = actor.automation === true;
    const common = { trigger: scheduled ? 'scheduled' as const : 'manual' as const, actorName: scheduled ? 'Campaign schedule' : actor.name, forceDryRun: !scheduled && body?.live !== true };

    if (body?.stage === 'outreach' || body?.stage === 'followup') {
      return Response.json({ ok: true, ...(await runCampaign(admin, { ...common, stage: body.stage as Stage })) });
    }
    if (body?.stage === 'auto' && scheduled) {
      const settings = await loadSettings(admin);
      const today = tzNow(settings.timezone).weekday;
      const results: any[] = [];
      // Follow-up first: if both days are the same, the follow-up must not see this run's own reminders.
      if (today === settings.followup_day) results.push(await runCampaign(admin, { ...common, stage: 'followup' }));
      if (today === settings.outreach_day) results.push(await runCampaign(admin, { ...common, stage: 'outreach' }));

      const acted = results.filter(r => r.ran);
      const errors = results.filter(r => r.error).map(r => String(r.error));
      const reasons = results.length === 0
        ? [`Today is ${today}; reminders go out on ${settings.outreach_day} and follow-ups on ${settings.followup_day} (${settings.timezone}).`]
        : results.filter(r => !r.ran && !r.error).map(r => String(r.reason));
      const sum = (k: string) => results.reduce((n, r) => n + (Number(r[k]) || 0), 0);
      const live = acted.some(r => r.mode === 'live');
      const reason = acted.length > 0 ? '' : reasons.join(' ');

      await recordJobRun(admin, 'campaign', {
        outcome: errors.length > 0 ? 'failed' : acted.length > 0 ? 'acted' : 'no_op',
        reason,
        detail: acted.length > 0
          ? `${acted.map(r => `${r.stage}: ${r.mode === 'live' ? 'live' : 'dry run'}`).join(', ')}${live ? '' : ` · ${sum('messages_counted')} would be queued`}`
          : '',
        processed: sum('eligible_total'),
        sent: live ? sum('messages_counted') : 0,
        suppressed: sum('skipped_count'),
        failed: errors.length,
        error: errors.join(' '),
      });

      return Response.json(
        { ok: errors.length === 0, weekday: today, ran: acted.length > 0, reason: reason || undefined, error: errors.join(' ') || undefined, results },
        { status: errors.length > 0 ? 500 : 200 },
      );
    }
    return Response.json({ error: 'stage must be "outreach" or "followup" (or "auto" for the schedule).' }, { status: 400 });
  } catch (_e) {
    console.error('[campaignRun] failed', (_e as Error)?.message);
    return Response.json({ ok: false, error: 'Could not run the campaign.' }, { status: 500 });
  }
}