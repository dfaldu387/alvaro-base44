import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { asList, loadSettings } from '../../shared/campaignRun.ts';
import { tzNow, isoWeek } from '../../shared/campaignRules.ts';
import { recordAudit } from '../../shared/auditLog.ts';
import { ensureSettingsRow } from '../../shared/settingsStore.ts';
import { OFF_PHRASE, APPROVAL_TTL_HOURS, previewRecorded, previewIds, checkApproval, isExpired, samePerson } from '../../shared/dryRunApproval.ts';

/**
 * setCampaignDryRun — the ONLY place campaign dry-run mode is changed.
 * A person (never automation) must call it. Authority is the authenticated admin.
 *
 *   turn_on      one admin, takes effect at once (the safe direction).
 *   request_off  admin 1: typed phrase + a recorded dry-run preview for BOTH stages
 *                this week. Creates a pending CampaignDryRunApproval (24h).
 *   approve_off  admin 2, a DIFFERENT person, while the request is unexpired and the
 *                preview is still the reviewed one. Applies the change ONLY if its
 *                audit record (CampaignDryRunChange) is written; otherwise it is
 *                rolled back to ON.
 *   cancel_off   withdraws a pending request.
 * Turning OFF directly (dry_run:false) is refused. Even with dry-run OFF, a run
 * still needs both campaign messages switched on.
 */
const fail = (status: number, code: string, message: string) => Response.json({ ok: false, code, message }, { status });
const who = (a: any) => ({ id: a.user?.id || null, email: a.user?.email || null });

async function latestPreview(admin: any, week: string) {
  const out: any = {};
  for (const stage of ['outreach', 'followup']) {
    out[stage] = asList(await admin.entities.CampaignRun.filter({ campaign_week: week, stage, mode: 'dry_run' }, { sort: '-created_date', limit: 1 }))[0] || null;
  }
  return out;
}

export default async function (req: Request) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) return fail(403, 'AUTOMATION_REFUSED', 'Dry-run mode can only be changed by a person.');
    const me = who(actor);
    if (!me.id && !me.email) return fail(403, 'IDENTITY_REQUIRED', 'Your identity could not be verified.');

    let body: any = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const action: string | null = typeof body?.action === 'string' ? body.action : (body?.dry_run === true ? 'turn_on' : null);
    if (!action && body?.dry_run === false) return fail(400, 'TWO_APPROVERS_REQUIRED', 'Dry-run cannot be turned off directly. One admin requests it and a different admin approves it.');
    if (!['turn_on', 'request_off', 'approve_off', 'cancel_off'].includes(action || '')) return fail(400, 'INVALID_INPUT', 'Unknown action.');

    const admin = base44.asServiceRole;
    const row = asList(await admin.entities.MessagingSettings.list('-created_date', 1))[0];
    const isOn = row ? row.campaign_dry_run !== false : true;
    const settings = await loadSettings(admin);
    const week = isoWeek(tzNow(settings.timezone).date);
    const now = new Date();

    const pendingList = asList(await admin.entities.CampaignDryRunApproval.filter({ status: 'pending' }, { sort: '-created_date', limit: 5 }));
    const pending = pendingList.find((p: any) => !isExpired(p, now)) || null;

    if (action === 'turn_on') {
      if (isOn) return Response.json({ ok: true, changed: false, dry_run: true, message: 'Dry-run mode was already ON.' });
      await admin.entities.MessagingSettings.update(row.id, { campaign_dry_run: true });
      try {
        await admin.entities.CampaignDryRunChange.create({ previous_value: false, new_value: true, changed_by: actor.name, changed_by_email: me.email || undefined, changed_at: now.toISOString() });
      } catch (e) {
        console.error('[setCampaignDryRun] audit failed (turned ON anyway: the safe direction)', (e as Error)?.message);
      }
      await recordAudit(admin, { action: 'campaign_dry_run_on', who: actor.name, summary: 'Campaign dry-run mode was turned ON', note: 'Reminders queue nothing while it is on.' });
      return Response.json({ ok: true, changed: true, dry_run: true, message: 'Dry-run mode is now ON.' });
    }

    if (action === 'cancel_off') {
      if (!pending) return Response.json({ ok: true, changed: false, message: 'There was no request to cancel.' });
      await admin.entities.CampaignDryRunApproval.update(pending.id, { status: 'cancelled' });
      return Response.json({ ok: true, changed: false, message: 'The request was cancelled. Dry-run stays ON.' });
    }

    if (!isOn) return Response.json({ ok: true, changed: false, dry_run: false, message: 'Dry-run mode was already OFF.' });
    const latest = await latestPreview(admin, week);

    if (action === 'request_off') {
      if (body?.confirm !== OFF_PHRASE) return fail(400, 'CONFIRM_REQUIRED', `Type "${OFF_PHRASE}" to confirm.`);
      const pv = previewRecorded(latest);
      if (!pv.ok) return fail(400, pv.code, pv.message);
      if (pending) return Response.json({ ok: true, changed: false, approval_id: pending.id, message: `${pending.requested_by} has already asked to turn dry-run off. A different admin must approve it.` });
      const created = await admin.entities.CampaignDryRunApproval.create({
        status: 'pending', requested_by: actor.name, requested_by_id: me.id || undefined, requested_by_email: me.email || undefined,
        requested_at: now.toISOString(), expires_at: new Date(now.getTime() + APPROVAL_TTL_HOURS * 3600_000).toISOString(),
        preview_week: week, preview_run_ids: previewIds(latest),
      });
      return Response.json({ ok: true, changed: false, approval_id: created.id, message: 'Requested. A different admin must now review the preview and approve. Dry-run is still ON.' });
    }

    // approve_off
    const approval = pending && (!body?.approval_id || body.approval_id === pending.id) ? pending : null;
    const check = checkApproval(approval, me, latest, now);
    if (!check.ok) return fail(check.code === 'SAME_APPROVER' ? 403 : 400, check.code, check.message);

    await admin.entities.CampaignDryRunApproval.update(approval.id, {
      status: 'approved', approved_by: actor.name, approved_by_id: me.id || undefined, approved_by_email: me.email || undefined, approved_at: now.toISOString(),
    });
    const claimed = await admin.entities.CampaignDryRunApproval.get(approval.id).catch(() => null);
    if (!claimed || claimed.status !== 'approved' || samePerson({ id: claimed.approved_by_id, email: claimed.approved_by_email }, { id: claimed.requested_by_id, email: claimed.requested_by_email })) {
      return fail(409, 'APPROVAL_CONFLICT', 'The approval could not be confirmed, so nothing changed.');
    }

    const settingsRow = row || await ensureSettingsRow(admin, 'MessagingSettings', { campaign_dry_run: true });
    await admin.entities.MessagingSettings.update(settingsRow.id, { campaign_dry_run: false });
    try {
      await admin.entities.CampaignDryRunChange.create({
        previous_value: true, new_value: false, changed_by: actor.name, changed_by_email: me.email || undefined,
        changed_at: now.toISOString(), approved_by: `${approval.requested_by} (requested) and ${actor.name} (approved)`,
      });
      // The ActivityLog row is part of the same record: if it cannot be written, the change is rolled back below.
      const logged = await recordAudit(admin, {
        action: 'campaign_dry_run_off', who: actor.name, summary: 'Campaign dry-run mode was turned OFF',
        note: `Requested by ${approval.requested_by}, approved by ${actor.name}. Live reminders are now allowed.`,
        ids: { approval_id: approval.id },
      });
      if (!logged) throw new Error('activity log write failed');
    } catch (e) {
      console.error('[setCampaignDryRun] audit failed', (e as Error)?.message);
      // Never leave live sending enabled without a record of who did it.
      await admin.entities.MessagingSettings.update(settingsRow.id, { campaign_dry_run: true });
      await admin.entities.CampaignDryRunApproval.update(approval.id, { status: 'cancelled' });
      return fail(500, 'AUDIT_FAILED', 'The change could not be recorded, so it was not applied. Dry-run stays ON.');
    }
    await admin.entities.CampaignDryRunApproval.update(approval.id, { status: 'applied', applied_at: new Date().toISOString() });
    return Response.json({ ok: true, changed: true, dry_run: false, message: 'Dry-run mode is now OFF. Both approvals are recorded.' });
  } catch (e) {
    console.error('[setCampaignDryRun] failed', (e as Error)?.message);
    return fail(500, 'ERROR', 'Could not change dry-run mode.');
  }
}