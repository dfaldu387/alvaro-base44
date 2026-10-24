import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { renderTemplate } from '../../shared/messageRender.ts';
import { DEFAULT_TEMPLATES } from '../../shared/messageTemplateDefaults.ts';
import {
  readSettings, isoWeek, weekStartYmd, tzNow, staticCheck, dynamicCheck, contactState, followupContactCheck,
  deliveryOutcome, reminderKey, followupKey, hasLiveBooking,
} from '../../shared/campaignRules.ts';

/** Admin-only check of the pure campaign rules on made-up clients. Reads and writes nothing. */
export default async function (req: Request) {
  const base44 = createClientFromRequest(req);
  const actor = await requireAdminActor(base44, req);
  if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

  const cases: Array<[string, boolean]> = [];
  const is = (name: string, ok: boolean) => cases.push([name, ok]);
  const ctx = { today: '2026-10-13', maxOverdueDays: 180 };
  const base = { client_name: 'Sam Test', phone: '0412 345 678', next_reminder_date: '2026-10-12', frequency: 'Monthly', client_type: 'Regular' };
  const reason = (c: any) => { const r: any = staticCheck(c, ctx); return r.ok ? 'ok' : (r.reason || r.aggregate); };

  // Settings
  const d = readSettings(undefined);
  is('defaults: Tuesday/Thursday/50/dry-run on/Sydney', d.outreach_day === 'Tuesday' && d.followup_day === 'Thursday' && d.max_per_run === 50 && d.dry_run && d.timezone === 'Australia/Sydney');
  is('only explicit false turns dry-run off', readSettings({ campaign_dry_run: false }).dry_run === false && readSettings({ campaign_dry_run: 'no' }).dry_run === true);
  is('bad settings fall back', readSettings({ campaign_outreach_day: 'Funday', campaign_max_per_run: -3, campaign_timezone: 'Mars/Base' }).max_per_run === 50);
  is('custom settings honoured', readSettings({ campaign_outreach_day: 'Monday', campaign_max_per_run: 10 }).outreach_day === 'Monday');

  // ISO week and timezone
  is('iso week 2026-10-13', isoWeek('2026-10-13') === '2026-W42');
  is('iso week year edge', isoWeek('2026-12-31') === '2026-W53' && isoWeek('2027-01-01') === '2026-W53');
  is('iso week 2025-12-29 belongs to 2026-W01', isoWeek('2025-12-29') === '2026-W01');
  is('week starts Monday', weekStartYmd('2026-10-13') === '2026-10-12' && weekStartYmd('2026-10-11') === '2026-10-05');
  is('sydney date ahead of UTC', tzNow('Australia/Sydney', new Date('2026-10-13T13:30:00Z')).date === '2026-10-14');
  is('keys', reminderKey('c1', '2026-W42') === 'sms|c1|rebooking_reminder|2026-W42' && followupKey('c1', '2026-W42') === 'sms|c1|rebooking_followup|2026-W42');

  // Eligibility
  is('due client is a candidate', reason(base) === 'ok');
  is('due today is a candidate', reason({ ...base, next_reminder_date: '2026-10-13' }) === 'ok');
  is('future date is not due (aggregate)', reason({ ...base, next_reminder_date: '2026-10-14' }) === 'not_due');
  is('missing date skipped with reason', reason({ ...base, next_reminder_date: undefined }) === 'missing_next_reminder_date');
  is('Whenever with no date is no cadence', reason({ ...base, next_reminder_date: undefined, frequency: 'Whenever' }) === 'no_cadence');
  is('garbage date', reason({ ...base, next_reminder_date: 'next week' }) === 'invalid_next_reminder_date');
  is('stale date', reason({ ...base, next_reminder_date: '2025-01-01' }) === 'reminder_date_stale');
  is('visited since due', reason({ ...base, last_visit_date: '2026-10-12' }) === 'visited_since_due');
  is('archived', reason({ ...base, archived: true }) === 'archived');
  is('test', reason({ ...base, is_test: true }) === 'test_client');
  is('opted out', reason({ ...base, messaging_opted_out: true }) === 'opted_out');
  is('paused flag', reason({ ...base, is_paused: true }) === 'reminders_paused');
  is('paused status', reason({ ...base, reminder_status: 'Paused' }) === 'reminders_paused');
  is('no name', reason({ ...base, client_name: '  ' }) === 'missing_name');
  is('bad phone', reason({ ...base, phone: '123' }) === 'no_valid_mobile');
  is('flags outrank date problems', reason({ ...base, archived: true, next_reminder_date: undefined }) === 'archived');

  // Live facts
  const facts = { bookings: [], repliedYmds: [], attentionOpen: false, campaignMessagesThisWeek: 0 };
  const dctx = { today: '2026-10-13', weekStart: '2026-10-12' };
  const dyn = (f: any) => { const r: any = dynamicCheck({ ...facts, ...f }, dctx); return r.ok ? 'ok' : r.reason; };
  is('clean client passes', dyn({}) === 'ok');
  is('upcoming booking', dyn({ bookings: [{ status: 'confirmed', requested_date: '2026-10-20' }] }) === 'has_booking');
  is('pending undated booking', dyn({ bookings: [{ status: 'pending' }] }) === 'has_booking');
  is('declined booking ignored', dyn({ bookings: [{ status: 'declined', requested_date: '2026-10-20' }] }) === 'ok');
  is('past completed booking ignored', !hasLiveBooking([{ status: 'completed', requested_date: '2026-09-01' }], '2026-10-13'));
  is('reply this week', dyn({ repliedYmds: ['2026-10-13'] }) === 'replied_this_week');
  is('reply last week ignored', dyn({ repliedYmds: ['2026-10-05'] }) === 'ok');
  is('attention open', dyn({ attentionOpen: true }) === 'needs_attention');
  is('two messages already this week', dyn({ campaignMessagesThisWeek: 2 }) === 'weekly_limit_reached');
  is('one message this week still allows the second', dyn({ campaignMessagesThisWeek: 1 }) === 'ok');

  // Delivery state -> follow-up eligibility
  const fu = (o: any, m?: any) => followupContactCheck(contactState(o, m)).ok;
  is('sent -> follow-up allowed', fu({ status: 'sent' }));
  is('pending/quiet-hours deferred -> allowed', fu({ status: 'pending', deferral_reason: 'quiet hours' }) && fu({ status: 'claimed' }));
  is('sent but carrier failed -> not allowed', !fu({ status: 'sent' }, { delivery_status: 'failed' }));
  is('dead letter -> not allowed', !fu({ status: 'dead_letter' }));
  is('suppressed -> not allowed', !fu({ status: 'suppressed' }));
  is('missing -> not allowed', !fu(null));
  is('display states distinct', deliveryOutcome({ status: 'pending' }).state === 'pending' && deliveryOutcome({ status: 'sent' }).state === 'sent' &&
    deliveryOutcome({ status: 'dead_letter', last_error: 'x' }).state === 'failed' && deliveryOutcome({ status: 'suppressed', suppressed_reason: 'opt-out' }).state === 'suppressed');

  // Templates: drafts are off, render safely
  for (const key of ['rebooking_reminder', 'rebooking_followup']) {
    const t = DEFAULT_TEMPLATES.find(x => x.template_key === key);
    is(`${key} exists, is a draft and is switched off`, !!t && t.is_active === false && /DRAFT/.test(t.body));
    is(`${key} renders with name and link`, t ? renderTemplate(t.body, { name: 'Sam', booking_link: 'https://x.test/book' }).ok : false);
    is(`${key} refuses a blank name`, t ? !renderTemplate(t.body, { name: ' ', booking_link: 'https://x.test/book' }).ok : false);
    is(`${key} refuses a missing link`, t ? !renderTemplate(t.body, { name: 'Sam' }).ok : false);
  }

  return Response.json({ ok: cases.every(c => c[1]), passed: cases.filter(c => c[1]).length, total: cases.length, failed: cases.filter(c => !c[1]).map(c => c[0]) });
}