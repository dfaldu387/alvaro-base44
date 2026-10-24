import { asList, chunk, pageAll, loadSettings } from './campaignRun.ts';
import { explainCadence } from './cadence.ts';
import {
  WEEKDAYS, tzNow, isoWeek, weekStartYmd, ymdInTz, staticCheck, flagCheck, reachCheck, dynamicCheck,
  contactState, followupContactCheck, RESOLVED_BOOKING, REASON_TEXT, CAP_RULE,
} from './campaignRules.ts';

/**
 * The Reminders board, built only from stored records: ReminderClient (who),
 * CampaignEntry (what the campaign decided), MessageOutbox + Message (what really
 * happened to each message), incoming Messages (replies), BookingRequest (bookings).
 * Nothing here is stored as a separate "board state".
 */

export interface MsgStatus { state: string; label: string; reason: string }

/** The exact delivery state of one campaign message, from the outbox row and its Message. */
export function msgStatus(outbox: any | null, message: any | null): MsgStatus {
  if (!outbox) return { state: 'unknown', label: 'Message record missing', reason: 'The queued message could not be found' };
  const s = String(outbox.status);
  if (s === 'sent') {
    const d = message?.delivery_status;
    if (d === 'delivered' || d === 'read') return { state: 'delivered', label: 'Delivered', reason: '' };
    if (d === 'failed') return { state: 'failed', label: 'Failed (carrier)', reason: message.delivery_error ? `Carrier error ${message.delivery_error}` : 'The carrier reported the message failed' };
    if (message?.simulated === true || String(outbox.provider_message_id || '').startsWith('SIMULATED-')) return { state: 'sent', label: 'Sent (simulated, not delivered)', reason: '' };
    return { state: 'sent', label: 'Sent (delivery not confirmed)', reason: '' };
  }
  if (s === 'suppressed') return { state: 'suppressed', label: 'Suppressed (not sent)', reason: String(outbox.suppressed_reason || 'suppressed') };
  if (s === 'dead_letter') return { state: 'dead_letter', label: 'Dead-lettered (not sent)', reason: String(outbox.dead_letter_reason || outbox.last_error || 'gave up') };
  if (s === 'failed') return { state: 'failed', label: 'Failed (not sent)', reason: String(outbox.last_error || 'failed') };
  return { state: 'queued', label: 'Queued (not sent yet)', reason: String(outbox.deferral_reason || outbox.last_error || '') };
}

const FAILED_STATES = ['failed', 'dead_letter'];

export async function loadBoardFacts(admin: any, ids: string[]) {
  const facts = new Map<string, { bookings: any[]; incoming: any[]; attentionOpen: boolean }>();
  for (const id of ids) facts.set(id, { bookings: [], incoming: [], attentionOpen: false });
  for (const part of chunk(ids, 50)) {
    const [bookings, incoming, flags, unmatched] = await Promise.all([
      admin.entities.BookingRequest.filter({ client_id: { $in: part } }, { sort: '-created_date', limit: 1000 }),
      admin.entities.Message.filter({ client_id: { $in: part }, direction: 'incoming' }, { sort: '-created_date', limit: 1000 }),
      admin.entities.BookingReplyFlag.filter({ client_id: { $in: part }, kind: 'needs_attention', status: 'open' }, { limit: 500 }),
      admin.entities.UnmatchedReply.filter({ client_id: { $in: part }, status: 'open' }, { limit: 500 }),
    ]);
    for (const b of asList(bookings)) facts.get(b.client_id)?.bookings.push(b);
    for (const m of asList(incoming)) facts.get(m.client_id)?.incoming.push(m);
    for (const f of [...asList(flags), ...asList(unmatched)]) { const x = facts.get(f.client_id); if (x) x.attentionOpen = true; }
  }
  return facts;
}

const at = (m: any) => String(m.received_date || m.created_date || '');
const frequencyLabel = (c: any) => (c.frequency === 'Custom' && c.custom_frequency_days ? `Every ${c.custom_frequency_days} days` : c.frequency || '');

/** Plain-language warnings about whether the schedule is actually running. */
export function runHealth(settings: any, t: { weekday: string; hour: number }, weekRuns: any[], latest: any | null, now: Date) {
  const warnings: Array<{ level: 'error' | 'warn' | 'info'; text: string }> = [];
  if (!latest) warnings.push({ level: 'error', text: 'No campaign run has ever been recorded. The schedule has not run, so zero here does not mean nobody needed a reminder.' });
  const idx = (d: string) => (WEEKDAYS.indexOf(d) + 6) % 7; // Monday = 0
  for (const [stage, day, label] of [['outreach', settings.outreach_day, 'reminder'], ['followup', settings.followup_day, 'follow-up']] as const) {
    const due = idx(t.weekday) > idx(day) || (idx(t.weekday) === idx(day) && t.hour >= settings.run_hour);
    const ok = weekRuns.some(r => r.stage === stage && r.trigger === 'scheduled' && r.status === 'complete');
    if (due && !ok) warnings.push({ level: 'error', text: `The scheduled ${label} run for this week was due ${day} from ${settings.run_hour}:00 (${settings.timezone}) and has not completed.` });
  }
  if (latest?.status === 'failed') warnings.push({ level: 'error', text: `The last campaign run failed. ${latest.error || ''}`.trim() });
  if (latest?.status === 'running' && now.getTime() - Date.parse(latest.started_at) > 15 * 60_000) warnings.push({ level: 'error', text: 'The last campaign run started but never finished.' });
  const ended = Date.parse(latest?.finished_at || latest?.started_at || '');
  if (latest && !Number.isNaN(ended) && now.getTime() - ended > 8 * 86400_000) warnings.push({ level: 'warn', text: 'The last campaign run was more than 8 days ago.' });
  if (latest?.mode === 'dry_run') warnings.push({ level: 'info', text: 'The last run was a preview (dry run): it recorded who would be contacted and queued nothing.' });
  if (settings.dry_run) warnings.push({ level: 'info', text: 'Dry-run mode is ON, so scheduled runs only record a preview.' });
  return warnings;
}

export async function buildBoard(admin: any, now: Date = new Date()) {
  const settings = await loadSettings(admin);
  const t = tzNow(settings.timezone, now);
  const week = isoWeek(t.date);
  const weekStart = weekStartYmd(t.date);

  const [clients, entries, weekRuns, latestRows, templates] = await Promise.all([
    pageAll(c => admin.entities.ReminderClient.filter({ client_type: 'Regular' }, { sort: 'created_date', limit: 500, cursor: c })),
    pageAll(c => admin.entities.CampaignEntry.filter({ campaign_week: week }, { sort: 'created_date', limit: 500, cursor: c })),
    admin.entities.CampaignRun.filter({ campaign_week: week }, { sort: '-created_date', limit: 50 }).then(asList),
    admin.entities.CampaignRun.list('-created_date', 1).then(asList),
    admin.entities.MessageTemplate.filter({ template_key: { $in: ['rebooking_reminder', 'rebooking_followup'] } }, { limit: 20 }).then(asList),
  ]);

  const outboxIds = entries.map(e => e.outbox_id).filter(Boolean);
  const outbox = new Map<string, any>();
  const messages = new Map<string, any>();
  for (const part of chunk(outboxIds, 50)) {
    for (const o of asList(await admin.entities.MessageOutbox.filter({ id: { $in: part } }, { limit: 100 }))) outbox.set(o.id, o);
    for (const m of asList(await admin.entities.Message.filter({ outbox_id: { $in: part } }, { limit: 100 }))) messages.set(m.outbox_id, m);
  }
  const facts = await loadBoardFacts(admin, clients.map(c => c.id));
  const byClient = new Map<string, any[]>();
  for (const e of entries) { const l = byClient.get(e.client_id) || []; l.push(e); byClient.set(e.client_id, l); }

  const tpl = (key: string) => { const x = templates.find((r: any) => r.template_key === key); return { exists: !!x, active: !!x && x.is_active !== false }; };
  const templateState = { rebooking_reminder: tpl('rebooking_reminder'), rebooking_followup: tpl('rebooking_followup') };
  const approved = templateState.rebooking_reminder.active && templateState.rebooking_followup.active;

  const cards: any[] = [];
  const skipped: any[] = [];
  const excluded = { not_due: 0, no_cadence: 0 };

  for (const c of clients) {
    const f = facts.get(c.id)!;
    const ent = byClient.get(c.id) || [];
    const queued = ['outreach', 'followup'].map(s => ent.find(e => e.stage === s && e.outcome === 'queued')).filter(Boolean) as any[];
    const base = {
      id: c.id, client_id: c.id, name: c.client_name || 'Unnamed client', frequency: frequencyLabel(c), cadence: explainCadence(c),
      last_visit: c.last_visit_date || null, next_reminder_date: c.next_reminder_date || null,
      last_reply_at: f.incoming[0] ? at(f.incoming[0]) : null, last_reply_text: f.incoming[0] ? String(f.incoming[0].message_text || '').slice(0, 140) : null,
      paused: c.is_paused === true || c.reminder_status === 'Paused', opted_out: c.messaging_opted_out === true,
    };

    if (queued.length > 0) {
      const msgs = queued.map(e => ({ stage: e.stage, queued_at: e.queued_at, message: messages.get(e.outbox_id) || null, status: msgStatus(outbox.get(e.outbox_id) || null, messages.get(e.outbox_id) || null) }));
      const latest = msgs[msgs.length - 1];
      const first = queued[0];
      const since = String(first.queued_at || '');
      const replies = f.incoming.filter(m => at(m) >= since);
      const bookedNow = f.bookings.some(b => !RESOLVED_BOOKING.includes(String(b.status)) && String(b.created_date) >= since);
      const markedBooked = c.reminder_status === 'Booked';
      const fuSkipped = ent.some(e => e.stage === 'followup' && e.reason_code === 'admin_skipped');
      const firstOutbox = outbox.get(first.outbox_id) || null;
      const followUpOk = first.stage === 'outreach' && queued.length === 1 && !fuSkipped && !f.attentionOpen &&
        flagCheck(c).ok && reachCheck(c).ok && followupContactCheck(contactState(firstOutbox, messages.get(first.outbox_id) || null)).ok;
      const column = bookedNow || markedBooked ? 'booked' : replies.length ? 'replied' : followUpOk ? 'follow_up' : 'messaged';
      const note = column === 'booked' ? (bookedNow ? 'Booked after the reminder' : 'Marked as booked by an admin')
        : column === 'replied' ? `${replies.length} repl${replies.length === 1 ? 'y' : 'ies'} since the reminder`
        : fuSkipped ? 'Follow-up skipped by an admin' : '';
      cards.push({
        ...base, column, state: latest.status.state, state_label: latest.status.label, reason: latest.status.reason, note,
        last_message_at: latest.message?.sent_date || latest.queued_at || null,
        messages: msgs.map(m => ({ stage: m.stage, state: m.status.state, label: m.status.label, at: m.message?.sent_date || m.queued_at || null })),
        tags: [column, latest.status.state, ...(FAILED_STATES.includes(latest.status.state) ? ['failed'] : [])],
        can_send_now: false, send_blocked: '',
      });
      continue;
    }

    // Nobody has been messaged this cycle: due, or excluded with a reason.
    const adminSkip = ent.find(e => e.stage === 'outreach' && e.reason_code === 'admin_skipped');
    let reason = adminSkip ? 'admin_skipped' : '';
    let detail = '';
    if (!reason) {
      const s: any = staticCheck(c, { today: t.date, maxOverdueDays: settings.max_overdue_days });
      if (!s.ok) {
        if (s.aggregate) { excluded[s.aggregate as 'not_due' | 'no_cadence']++; continue; }
        reason = s.reason; detail = s.detail || '';
      }
    }
    if (!reason) {
      const d: any = dynamicCheck({ bookings: f.bookings, repliedYmds: f.incoming.map(m => ymdInTz(at(m), settings.timezone)).filter(Boolean) as string[], attentionOpen: f.attentionOpen, campaignMessagesThisWeek: 0 }, { today: t.date, weekStart });
      if (!d.ok) { reason = d.reason; detail = d.detail || ''; }
    }
    if (reason) {
      skipped.push({ ...base, reason_code: reason, reason_text: `${REASON_TEXT[reason] || reason}${detail ? ` (${detail})` : ''}` });
      continue;
    }
    const failedEntry = ent.find(e => e.outcome === 'enqueue_failed');
    const cappedEntry = ent.find(e => e.outcome === 'capped');
    cards.push({
      ...base, column: 'due', state: failedEntry ? 'enqueue_failed' : 'due',
      state_label: failedEntry ? 'Could not be queued' : 'Due', reason: failedEntry?.reason_text || '',
      note: cappedEntry ? 'Over the run limit; waits for the next run' : '', last_message_at: null, messages: [],
      tags: ['due', ...(failedEntry ? ['failed'] : [])],
      can_send_now: templateState.rebooking_reminder.active,
      send_blocked: templateState.rebooking_reminder.active ? '' : 'The reminder wording is not approved yet (template is switched off).',
    });
  }
  // Follow-up cards can be sent by hand too, once the follow-up wording is approved.
  for (const card of cards) {
    if (card.column !== 'follow_up') continue;
    card.can_send_now = templateState.rebooking_followup.active;
    card.send_blocked = card.can_send_now ? '' : 'The follow-up wording is not approved yet (template is switched off).';
  }

  const n = (pred: (c: any) => boolean) => cards.filter(pred).length;
  const msgCards = cards.filter(c => c.column !== 'due');
  const counts = {
    due: n(c => c.column === 'due'), messaged: n(c => c.column === 'messaged'), replied: n(c => c.column === 'replied'),
    booked: n(c => c.column === 'booked'), follow_up: n(c => c.column === 'follow_up'),
    queued: n(c => c.state === 'queued'), sent: n(c => c.state === 'sent'), delivered: n(c => c.state === 'delivered'),
    suppressed: n(c => c.state === 'suppressed'), failed: n(c => c.tags.includes('failed')),
    contacted: msgCards.length, skipped: skipped.length, cards: cards.length,
  };
  const skipReasons: Record<string, number> = {};
  for (const s of skipped) skipReasons[s.reason_code] = (skipReasons[s.reason_code] || 0) + 1;
  const statusSum = msgCards.filter(c => ['queued', 'sent', 'delivered', 'suppressed', 'failed', 'dead_letter', 'unknown'].includes(c.state)).length;

  const latest = latestRows[0] || null;
  return {
    ok: true, week, today: t.date, settings, cap_rule: CAP_RULE, templates: templateState,
    live_sending: !settings.dry_run && approved,
    live_blocked_reason: settings.dry_run ? 'Dry-run mode is ON.' : approved ? null : 'The reminder and follow-up wording is not approved yet (templates are switched off).',
    counts, skip_reasons: skipReasons, reason_labels: REASON_TEXT, excluded, reconciles: counts.contacted === counts.messaged + counts.replied + counts.booked + counts.follow_up && statusSum === counts.contacted,
    health: { warnings: runHealth(settings, t, weekRuns, latest, now), last_run: latest ? { stage: latest.stage, mode: latest.mode, status: latest.status, trigger: latest.trigger, started_at: latest.started_at, finished_at: latest.finished_at, week: latest.campaign_week } : null },
    cards, skipped,
  };
}