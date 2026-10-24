import { enqueueOutboxMessage } from './outboxEnqueue.ts';
import { renderTemplate } from './messageRender.ts';
import { DEFAULT_TEMPLATES } from './messageTemplateDefaults.ts';
import { normaliseAuPhone } from './auPhone.ts';
import { rebookingContext } from './rebookingContext.ts';
import {
  readSettings, tzNow, isoWeek, weekStartYmd, addDaysYmd, ymdInTz, reminderKey, followupKey,
  staticCheck, dynamicCheck, flagCheck, reachCheck, RESOLVED_BOOKING, contactState, followupContactCheck, REASON_TEXT, CAP_RULE,
  type CampaignSettings, type ClientFacts,
} from './campaignRules.ts';

/**
 * Regular-client reminder campaign engine (IO layer; the rules are in campaignRules).
 *
 * It only ever ENQUEUES on the central MessageOutbox, through the same shared
 * path as the enqueueMessage endpoint. The sweep still applies test-data,
 * opt-out, template and quiet-hours rules, so nothing here replaces them.
 */

export type Stage = 'outreach' | 'followup';
const TEMPLATE_KEY: Record<Stage, string> = { outreach: 'rebooking_reminder', followup: 'rebooking_followup' };
export const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
export const chunk = <T,>(a: T[], n: number): T[][] => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
export const firstName = (full: unknown) => String(full || '').trim().split(/\s+/)[0] || '';

export async function loadSettings(admin: any): Promise<CampaignSettings> {
  const row = asList(await admin.entities.MessagingSettings.list('-created_date', 1))[0];
  return readSettings(row);
}

export async function pageAll(fetchPage: (cursor?: string) => Promise<any>, hardLimit = 5000): Promise<any[]> {
  const out: any[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50 && out.length < hardLimit; i++) {
    const page = await fetchPage(cursor);
    out.push(...asList(page));
    if (!page?.has_more || !page?.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

/** Live facts for a set of clients, fetched in a few batched queries (never one per client). */
async function loadFacts(admin: any, ids: string[], ctx: { week: string; weekStart: string; tz: string }) {
  const facts = new Map<string, ClientFacts>();
  for (const id of ids) facts.set(id, { bookings: [], repliedYmds: [], attentionOpen: false, campaignMessagesThisWeek: 0 });
  const lower = new Date(Date.parse(`${addDaysYmd(ctx.weekStart, -1)}T00:00:00Z`)).toISOString();
  for (const part of chunk(ids, 50)) {
    const [bookings, replies, flags, unmatched, sent] = await Promise.all([
      admin.entities.BookingRequest.filter({ client_id: { $in: part } }, { sort: '-created_date', limit: 1000 }),
      admin.entities.Message.filter({ client_id: { $in: part }, direction: 'incoming', created_date: { $gte: lower } }, { sort: '-created_date', limit: 1000 }),
      admin.entities.BookingReplyFlag.filter({ client_id: { $in: part }, kind: 'needs_attention', status: 'open' }, { limit: 500 }),
      admin.entities.UnmatchedReply.filter({ client_id: { $in: part }, status: 'open' }, { limit: 500 }),
      admin.entities.CampaignEntry.filter({ campaign_week: ctx.week, outcome: 'queued', client_id: { $in: part } }, { limit: 1000 }),
    ]);
    for (const b of asList(bookings)) facts.get(b.client_id)?.bookings.push(b);
    for (const m of asList(replies)) {
      const d = ymdInTz(m.received_date || m.created_date, ctx.tz);
      if (d) facts.get(m.client_id)?.repliedYmds.push(d);
    }
    for (const f of [...asList(flags), ...asList(unmatched)]) {
      const x = facts.get(f.client_id); if (x) x.attentionOpen = true;
    }
    for (const e of asList(sent)) {
      const x = facts.get(e.client_id); if (x) x.campaignMessagesThisWeek++;
    }
  }
  return facts;
}

interface Row { client: any; outcome: string; reason?: string; detail?: string; key?: string; outboxId?: string; preview?: string; queuedAt?: string; counted?: boolean }

export interface RunOptions {
  stage: Stage;
  trigger: 'scheduled' | 'manual';
  forceDryRun?: boolean;
  actorName: string;
  now?: Date;
}

/** Why a run meant to be live must run as a dry run, or null when live sending is genuinely allowed. */
async function liveBlock(admin: any, settings: CampaignSettings, forceDryRun: boolean): Promise<string | null> {
  if (forceDryRun) return 'A dry run was requested.';
  if (settings.dry_run) return 'Dry-run mode is ON.';
  const rows = asList(await admin.entities.MessageTemplate.filter({ template_key: { $in: ['rebooking_reminder', 'rebooking_followup'] } }, { limit: 20 }));
  for (const key of ['rebooking_reminder', 'rebooking_followup']) {
    const t = rows.find((r: any) => r.template_key === key);
    if (!t) return `The "${key}" template has not been created yet.`;
    if (t.is_active === false) return `The "${key}" wording is not approved yet (template is switched off).`;
  }
  return null;
}

export async function runCampaign(admin: any, opts: RunOptions) {
  const now = opts.now || new Date();
  const settings = await loadSettings(admin);
  const t = tzNow(settings.timezone, now);
  const week = isoWeek(t.date);
  const weekStart = weekStartYmd(t.date);
  const stage = opts.stage;
  const key = TEMPLATE_KEY[stage];

  // A scheduled run only acts on its configured day, from its configured hour, once per day.
  if (opts.trigger === 'scheduled') {
    const day = stage === 'outreach' ? settings.outreach_day : settings.followup_day;
    if (t.weekday !== day) return { ran: false, reason: `Today is ${t.weekday}; ${stage} runs on ${day}.`, week };
    if (t.hour < settings.run_hour) return { ran: false, reason: `Before the ${settings.run_hour}:00 run time (${settings.timezone}).`, week };
    const today = asList(await admin.entities.CampaignRun.filter({ campaign_week: week, stage, run_date: t.date, trigger: 'scheduled' }, { sort: '-created_date', limit: 5 }));
    const fresh = today.find((r: any) => r.status === 'complete' || (r.status === 'running' && now.getTime() - Date.parse(r.started_at) < 15 * 60_000));
    if (fresh) return { ran: false, reason: `The ${stage} run for today already ${fresh.status === 'complete' ? 'finished' : 'started'}.`, week };
  }

  const blocked = await liveBlock(admin, settings, opts.forceDryRun === true);
  const live = blocked === null;
  const dryReasonShown = settings.dry_run || opts.forceDryRun ? '' : (blocked || '');

  // Every message that goes through the outbox in a run counts, whether or not an
  // earlier crashed attempt had already created it. The candidate order is stable, so
  // a retry works through the same first N clients and can never exceed the limit.
  const allowance = settings.max_per_run;

  const run = await admin.entities.CampaignRun.create({
    campaign_week: week, stage, run_date: t.date, trigger: opts.trigger, mode: live ? 'live' : 'dry_run',
    live_blocked_reason: dryReasonShown || undefined, status: 'running', actor_name: opts.actorName,
    max_per_run: settings.max_per_run, started_at: now.toISOString(), cap_rule: CAP_RULE,
  });

  try {
    // Template body for the preview: the saved wording, else the default draft.
    const saved = asList(await admin.entities.MessageTemplate.filter({ template_key: key }, { sort: 'created_date', limit: 1 }))[0];
    const body = saved?.body || DEFAULT_TEMPLATES.find(d => d.template_key === key)?.body || '';

    const existing = asList(await admin.entities.CampaignEntry.filter({ campaign_week: week, stage }, { limit: 5000 }));
    // Queued clients and clients an admin chose to skip this cycle are never contacted again by a run.
    const processed = new Set(existing.filter((e: any) => e.outcome === 'queued' || e.reason_code === 'admin_skipped').map((e: any) => e.client_id));

    const rows: Row[] = [];
    const aggregates = { not_due: 0, no_cadence: 0, out_of_scope: 0 };
    const skip = (client: any, reason: string, detail?: string) => rows.push({ client, outcome: 'skipped', reason, detail });
    let candidates: Row[] = [];
    let alreadyProcessed = 0;

    if (stage === 'outreach') {
      const regulars = await pageAll(c => admin.entities.ReminderClient.filter({ client_type: 'Regular' }, { sort: 'created_date', limit: 500, cursor: c }));
      const total = Number(await admin.entities.ReminderClient.count({})) || regulars.length;
      aggregates.out_of_scope = Math.max(0, total - regulars.length);
      const due: any[] = [];
      for (const c of regulars) {
        const s = staticCheck(c, { today: t.date, maxOverdueDays: settings.max_overdue_days });
        if (s.ok) { due.push(c); continue; }
        if ('aggregate' in s) { aggregates[s.aggregate]++; continue; }
        skip(c, s.reason, s.detail);
      }
      due.sort((a, b) => String(a.next_reminder_date).localeCompare(String(b.next_reminder_date)) || String(a.client_name).localeCompare(String(b.client_name)));
      const fresh = due.filter(c => { if (processed.has(c.id)) { alreadyProcessed++; return false; } return true; });
      const facts = await loadFacts(admin, fresh.map(c => c.id), { week, weekStart, tz: settings.timezone });
      const phones = new Set<string>();
      for (const c of fresh) {
        const d = dynamicCheck(facts.get(c.id)!, { today: t.date, weekStart });
        if (!d.ok) { skip(c, d.reason, d.detail); continue; }
        const phone = normaliseAuPhone(c.phone)!;
        if (phones.has(phone)) { skip(c, 'duplicate_phone_in_run'); continue; }
        phones.add(phone);
        candidates.push({ client: c, outcome: 'candidate', key: reminderKey(c.id, week) });
      }
    } else {
      // A dry run has no queued reminders, so its follow-up preview is a projection: it assumes the
      // clients the reminder preview would contact were contacted. A live run only ever uses real queued ones.
      const outreach = asList(await admin.entities.CampaignEntry.filter({ campaign_week: week, stage: 'outreach', outcome: live ? 'queued' : { $in: ['queued', 'would_queue'] } }, { limit: 5000 }));
      const clients = new Map<string, any>();
      for (const part of chunk(outreach.map((e: any) => e.client_id), 50)) {
        for (const c of asList(await admin.entities.ReminderClient.filter({ id: { $in: part } }, { limit: 100 }))) clients.set(c.id, c);
      }
      const outbox = new Map<string, any>();
      const messages = new Map<string, any>();
      for (const part of chunk(outreach.map((e: any) => e.outbox_id).filter(Boolean), 50)) {
        for (const o of asList(await admin.entities.MessageOutbox.filter({ id: { $in: part } }, { limit: 100 }))) outbox.set(o.id, o);
        for (const m of asList(await admin.entities.Message.filter({ outbox_id: { $in: part } }, { limit: 100 }))) messages.set(m.outbox_id, m);
      }
      const facts = await loadFacts(admin, outreach.map((e: any) => e.client_id), { week, weekStart, tz: settings.timezone });
      for (const e of outreach.sort((a: any, b: any) => String(a.queued_at).localeCompare(String(b.queued_at)))) {
        if (processed.has(e.client_id)) { alreadyProcessed++; continue; }
        const c = clients.get(e.client_id);
        if (!c) { skip({ id: e.client_id, client_name: e.client_name }, 'client_not_found'); continue; }
        // The reminder date was already acted on, so only the contact flags matter here.
        const flag = flagCheck(c);
        if (!flag.ok) { skip(c, flag.reason); continue; }
        const reach = reachCheck(c);
        if (!reach.ok) { skip(c, reach.reason); continue; }
        const f = facts.get(c.id)!;
        // A booking made after the reminder was queued, even for a past or same day.
        const projected = e.outcome === 'would_queue';
        const bookedSince = !projected && f.bookings.some(b => !RESOLVED_BOOKING.includes(String(b.status)) && String(b.created_date) >= String(e.queued_at || ''));
        if (bookedSince) { skip(c, 'booked_since_reminder'); continue; }
        const d = dynamicCheck(f, { today: t.date, weekStart });
        if (!d.ok) { skip(c, d.reason, d.detail); continue; }
        if (!projected) {
          const contact = followupContactCheck(contactState(outbox.get(e.outbox_id) || null, messages.get(e.outbox_id) || null));
          if (!contact.ok) { skip(c, contact.reason); continue; }
        }
        candidates.push({ client: c, outcome: 'candidate', key: followupKey(c.id, week) });
      }
    }

    // ── The limit: messages newly queued in this run ─────────────────────────
    let counted = 0;
    const eligibleTotal = candidates.length;
    for (const row of candidates) {
      const c = row.client;
      if (counted >= allowance) { row.outcome = 'capped'; row.reason = 'capped'; continue; }

      // last_visit and frequency are included only when known; the approved wording does not use them yet.
      const payload = { name: firstName(c.client_name), booking_link: settings.booking_link, ...rebookingContext(c) };
      const rendered = renderTemplate(body, payload);
      if (!rendered.ok) { row.outcome = 'skipped'; row.reason = 'template_render_failed'; row.detail = rendered.reason; continue; }
      row.preview = rendered.text;

      if (!live) {
        row.outcome = 'would_queue';
        row.counted = true; counted++;
        continue;
      }
      const q = await enqueueOutboxMessage(admin, {
        channel: 'sms', to_address: String(normaliseAuPhone(c.phone)), template_key: key, payload,
        client_id: c.id, idempotency_key: row.key!,
      });
      if (!q.ok) { row.outcome = 'enqueue_failed'; row.reason = 'enqueue_failed'; row.detail = q.error; continue; }
      row.outcome = 'queued';
      row.outboxId = q.message_outbox?.id;
      row.queuedAt = new Date().toISOString();
      row.counted = true; counted++;

      // Stamp the existing reminder fields so the Client Workflow page agrees.
      const stamp = stage === 'outreach'
        ? { reminder_sent_date: row.queuedAt, workflow_stage: 'waiting_on_response', reminder_status: 'Waiting for Reply', workflow_updated_date: row.queuedAt, follow_up_due_date: addDaysYmd(t.date, 2) }
        : { follow_up_sent_date: row.queuedAt, workflow_updated_date: row.queuedAt };
      try { await admin.entities.ReminderClient.update(c.id, stamp); } catch (e) { console.error('campaign stamp failed', (e as Error)?.message); }
    }

    // ── Record every client, distinctly ──────────────────────────────────────
    const all = [...rows.filter(r => r.outcome === 'skipped'), ...candidates];
    const records = all.map(r => {
      const reason = r.reason || '';
      return {
        campaign_week: week, stage, client_id: r.client.id, client_name: r.client.client_name || '',
        outcome: r.outcome, reason_code: reason || undefined,
        reason_text: reason ? `${REASON_TEXT[reason] || reason}${r.detail ? ` (${r.detail})` : ''}`.slice(0, 300) : undefined,
        next_reminder_date: r.client.next_reminder_date || undefined,
        idempotency_key: r.key, outbox_id: r.outboxId, preview_text: r.preview, run_id: run.id,
        dry_run: !live, queued_at: r.queuedAt,
      };
    });
    for (const part of chunk(records, 200)) {
      await admin.entities.CampaignEntry.upsert(part, { key: ['campaign_week', 'stage', 'client_id'] });
    }

    const skipCounts: Record<string, number> = {};
    for (const r of rows.filter(x => x.outcome === 'skipped')) skipCounts[r.reason!] = (skipCounts[r.reason!] || 0) + 1;
    for (const r of candidates.filter(x => x.outcome === 'skipped')) skipCounts[r.reason!] = (skipCounts[r.reason!] || 0) + 1;
    const summary = {
      messages_counted: counted,
      unique_clients: new Set(candidates.filter(r => r.counted).map(r => r.client.id)).size,
      eligible_total: eligibleTotal,
      capped_count: candidates.filter(r => r.outcome === 'capped').length,
      skipped_count: Object.values(skipCounts).reduce((a, b) => a + b, 0),
      already_processed: alreadyProcessed,
      skip_reasons: skipCounts,
      aggregates,
    };
    await admin.entities.CampaignRun.update(run.id, { ...summary, status: 'complete', finished_at: new Date().toISOString() });
    return { ran: true, run_id: run.id, week, stage, mode: live ? 'live' : 'dry_run', live_blocked_reason: dryReasonShown || null, max_per_run: settings.max_per_run, allowance, cap_rule: CAP_RULE, ...summary };
  } catch (e) {
    console.error('campaign run failed', (e as Error)?.message);
    try { await admin.entities.CampaignRun.update(run.id, { status: 'failed', error: 'The run stopped before finishing. Nothing was sent twice; run it again.', finished_at: new Date().toISOString() }); } catch { /* the run stays "running" and is retried */ }
    return { ran: false, error: 'The campaign run failed.', week };
  }
}