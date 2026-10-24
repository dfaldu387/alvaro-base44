import { enqueueOutboxMessage } from './outboxEnqueue.ts';
import { renderTemplate } from './messageRender.ts';
import { normaliseAuPhone } from './auPhone.ts';
import { asList, loadSettings, firstName } from './campaignRun.ts';
import { loadBoardFacts } from './campaignBoard.ts';
import {
  tzNow, isoWeek, weekStartYmd, addDaysYmd, ymdInTz, flagCheck, reachCheck, dynamicCheck, contactState,
  followupContactCheck, reminderKey, followupKey, RESOLVED_BOOKING, REASON_TEXT,
} from './campaignRules.ts';

/**
 * Admin actions on a reminder card. Each one is authorised by the caller (the
 * function entry), runs the same rules the campaign uses, changes data only on the
 * server, and writes one ActivityLog row with who did it and how it ended.
 * A send goes ONLY through enqueueOutboxMessage (the outbox); opt-out, test-data
 * and quiet-hours rules are applied by the sweep exactly as for scheduled messages,
 * so the row is NOT marked manual (manual rows skip quiet hours).
 */

export type ActionName = 'send_now' | 'skip_cycle' | 'pause' | 'mark_booked';
export const ACTIONS: ActionName[] = ['send_now', 'skip_cycle', 'pause', 'mark_booked'];

interface Result { ok: boolean; code: string; message: string; audit_recorded?: boolean; outbox_status?: string }
const done = (message: string): Result => ({ ok: true, code: 'DONE', message });
const refuse = (code: string, message: string): Result => ({ ok: false, code, message });

async function audit(admin: any, actor: any, client: any, action: string, r: Result): Promise<boolean> {
  try {
    await admin.entities.ActivityLog.create({
      client_id: client.id, related_record_id: client.id, related_record_type: 'Client',
      action: `campaign_${action}`, actor: 'barber', actor_type: 'admin', actor_name: actor.name,
      outcome: r.ok ? 'applied' : r.code === 'ERROR' ? 'failed' : 'skipped',
      summary: `${action.replace('_', ' ')}: ${r.ok ? 'done' : 'not done'}`, detail: r.message.slice(0, 300),
      timestamp: new Date().toISOString(),
    });
    return true;
  } catch (e) {
    console.error('[campaignActions] audit write failed', (e as Error)?.message);
    return false;
  }
}

async function upsertEntry(admin: any, entry: Record<string, unknown>) {
  await admin.entities.CampaignEntry.upsert([entry], { key: ['campaign_week', 'stage', 'client_id'] });
}

async function perform(admin: any, actor: any, action: ActionName, client: any): Promise<Result> {
  const settings = await loadSettings(admin);
  const t = tzNow(settings.timezone);
  const week = isoWeek(t.date);
  const weekStart = weekStartYmd(t.date);
  const entries = asList(await admin.entities.CampaignEntry.filter({ campaign_week: week, client_id: client.id }, { limit: 20 }));
  const first = entries.find((e: any) => e.stage === 'outreach' && e.outcome === 'queued');
  const second = entries.find((e: any) => e.stage === 'followup' && e.outcome === 'queued');
  const stage = first ? 'followup' : 'outreach';

  if (action === 'pause') {
    if (client.is_paused === true) return done('Reminders were already paused for this client.');
    await admin.entities.ReminderClient.update(client.id, { is_paused: true, reminder_status: 'Paused', workflow_updated_date: new Date().toISOString() });
    return done('Reminders paused for this client.');
  }

  if (action === 'mark_booked') {
    if (client.reminder_status === 'Booked') return done('This client was already marked as booked.');
    await admin.entities.ReminderClient.update(client.id, { reminder_status: 'Booked', workflow_updated_date: new Date().toISOString() });
    return done('Marked as booked. No more reminders will be sent for this booking.');
  }

  if (second) return refuse('ALREADY_DONE', 'Both campaign messages have already been sent to this client this week.');

  if (action === 'skip_cycle') {
    await upsertEntry(admin, {
      campaign_week: week, stage, client_id: client.id, client_name: client.client_name || '', outcome: 'skipped',
      reason_code: 'admin_skipped', reason_text: `${REASON_TEXT.admin_skipped} (${actor.name})`, dry_run: false,
    });
    return done(stage === 'outreach' ? 'Skipped. This client will not get a reminder this week.' : 'Skipped. This client will not get a follow-up this week.');
  }

  // ── send_now ───────────────────────────────────────────────────────────────
  const flag = flagCheck(client); if (!flag.ok) return refuse(flag.reason, REASON_TEXT[flag.reason] || flag.reason);
  const reach = reachCheck(client); if (!reach.ok) return refuse(reach.reason, REASON_TEXT[reach.reason] || reach.reason);
  const facts = (await loadBoardFacts(admin, [client.id])).get(client.id)!;
  const since = String(first?.queued_at || weekStart);
  const dyn = dynamicCheck({
    bookings: facts.bookings, attentionOpen: facts.attentionOpen, campaignMessagesThisWeek: first ? 1 : 0,
    repliedYmds: facts.incoming.map((m: any) => ymdInTz(m.received_date || m.created_date, settings.timezone)).filter(Boolean) as string[],
  }, { today: t.date, weekStart });
  if (!dyn.ok) return refuse(dyn.reason, REASON_TEXT[dyn.reason] || dyn.reason);
  if (first) {
    const o = asList(await admin.entities.MessageOutbox.filter({ id: first.outbox_id }, { limit: 1 }))[0] || null;
    const m = o ? asList(await admin.entities.Message.filter({ outbox_id: o.id }, { limit: 1 }))[0] || null : null;
    const fc = followupContactCheck(contactState(o, m)); if (!fc.ok) return refuse(fc.reason, REASON_TEXT[fc.reason] || fc.reason);
    if (facts.bookings.some((b: any) => !RESOLVED_BOOKING.includes(String(b.status)) && String(b.created_date) >= since)) return refuse('booked_since_reminder', REASON_TEXT.booked_since_reminder);
  }

  const templateKey = stage === 'outreach' ? 'rebooking_reminder' : 'rebooking_followup';
  const template = asList(await admin.entities.MessageTemplate.filter({ template_key: templateKey }, { limit: 1 }))[0];
  if (!template) return refuse('TEMPLATE_MISSING', 'The message wording has not been created yet.');
  if (template.is_active === false) return refuse('TEMPLATE_OFF', 'The message wording is not approved yet (template is switched off), so nothing can be sent.');
  const payload = { name: firstName(client.client_name), booking_link: settings.booking_link };
  const rendered = renderTemplate(template.body, payload);
  if (!rendered.ok) return refuse('RENDER_FAILED', `The message could not be written for this client: ${rendered.reason}`);

  const key = stage === 'outreach' ? reminderKey(client.id, week) : followupKey(client.id, week);
  const q = await enqueueOutboxMessage(admin, {
    channel: 'sms', to_address: String(normaliseAuPhone(client.phone)), template_key: templateKey, payload,
    client_id: client.id, idempotency_key: key, manual: false,
  });
  if (!q.ok) return { ok: false, code: 'ERROR', message: `The outbox refused the message: ${q.error}` };

  const queuedAt = new Date().toISOString();
  await upsertEntry(admin, {
    campaign_week: week, stage, client_id: client.id, client_name: client.client_name || '', outcome: 'queued',
    reason_code: 'manual_send', reason_text: `Sent now by ${actor.name}`, idempotency_key: key, outbox_id: q.message_outbox.id,
    preview_text: rendered.text, dry_run: false, queued_at: q.created ? queuedAt : q.message_outbox.created_date || queuedAt,
  });
  const stamp = stage === 'outreach'
    ? { reminder_sent_date: queuedAt, workflow_stage: 'waiting_on_response', reminder_status: 'Waiting for Reply', workflow_updated_date: queuedAt, follow_up_due_date: addDaysYmd(t.date, 2) }
    : { follow_up_sent_date: queuedAt, workflow_updated_date: queuedAt };
  await admin.entities.ReminderClient.update(client.id, stamp);
  return {
    ok: true, code: q.created ? 'QUEUED' : 'ALREADY_QUEUED', outbox_status: q.message_outbox.status,
    message: q.created
      ? 'Queued on the outbox. It is not sent yet: the outbox checks opt-out and test data, and holds it until 08:00 to 20:00 Sydney time.'
      : 'This message was already queued earlier this week, so nothing new was added.',
  };
}

export async function runAction(admin: any, actor: any, action: ActionName, clientId: string): Promise<Result> {
  let client: any = null;
  try { client = await admin.entities.ReminderClient.get(clientId); } catch { client = null; }
  if (!client) return refuse('CLIENT_NOT_FOUND', 'That client no longer exists.');
  let result: Result;
  try {
    result = await perform(admin, actor, action, client);
  } catch (e) {
    console.error('[campaignActions] failed', action, (e as Error)?.message);
    result = { ok: false, code: 'ERROR', message: 'The action failed and nothing was confirmed. Please try again.' };
  }
  result.audit_recorded = await audit(admin, actor, client, action, result);
  return result;
}