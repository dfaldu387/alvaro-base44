import { normaliseAuPhone } from './auPhone.ts';

/**
 * Regular-client reminder campaign: the pure rules. No database access here, so
 * every rule can be tested without touching a record (campaignSelfTest).
 *
 * Population: ReminderClient rows with client_type = "Regular".
 * Due: the stored next_reminder_date is today (campaign timezone) or earlier.
 * A due date is NEVER computed or guessed: a client without a usable one is
 * skipped with a reason so the data gap is visible.
 */

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MAX_MESSAGES_PER_CLIENT_PER_WEEK = 2;
export const RESOLVED_BOOKING = ['declined', 'cancelled', 'could_not_fit', 'no_show', 'blocked'];

export interface CampaignSettings {
  outreach_day: string;
  followup_day: string;
  run_hour: number;
  timezone: string;
  max_per_run: number;
  dry_run: boolean;
  max_overdue_days: number;
  booking_link: string;
}

export const DEFAULT_SETTINGS: CampaignSettings = {
  outreach_day: 'Tuesday',
  followup_day: 'Thursday',
  run_hour: 10,
  timezone: 'Australia/Sydney',
  max_per_run: 50,
  dry_run: true,
  max_overdue_days: 180,
  // Taken from APP_BASE_URL; empty when it is not set. The saved Campaign setting overrides it.
  booking_link: (process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '') ? `${(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '')}/book` : '',
};

function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** Saved MessagingSettings -> effective settings. Anything missing or invalid falls back to the safe default. */
export function readSettings(row: any): CampaignSettings {
  const d = DEFAULT_SETTINGS;
  const int = (v: unknown, lo: number, hi: number, fb: number) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= lo && n <= hi ? n : fb;
  };
  return {
    outreach_day: WEEKDAYS.includes(row?.campaign_outreach_day) ? row.campaign_outreach_day : d.outreach_day,
    followup_day: WEEKDAYS.includes(row?.campaign_followup_day) ? row.campaign_followup_day : d.followup_day,
    run_hour: int(row?.campaign_run_hour, 0, 23, d.run_hour),
    timezone: validTz(row?.campaign_timezone) ? row.campaign_timezone : d.timezone,
    max_per_run: int(row?.campaign_max_per_run, 1, 500, d.max_per_run),
    // Only an explicit false turns live sending on; a missing record means dry-run.
    dry_run: row?.campaign_dry_run !== false,
    max_overdue_days: int(row?.campaign_max_overdue_days, 1, 3650, d.max_overdue_days),
    booking_link: /^https:\/\/\S+$/.test(String(row?.campaign_booking_link || '')) ? String(row.campaign_booking_link).trim() : d.booking_link,
  };
}

// ── Time in the campaign timezone ────────────────────────────────────────────
export function tzNow(tz: string, now: Date = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(now)) if (part.type !== 'literal') p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), weekday: p.weekday };
}

/** The calendar date (YYYY-MM-DD) an instant falls on in the campaign timezone. */
export function ymdInTz(iso: unknown, tz: string): string | null {
  const t = new Date(String(iso || ''));
  return Number.isNaN(t.getTime()) ? null : tzNow(tz, t).date;
}

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(fromYmd: string, toYmd: string): number {
  const a = fromYmd.split('-').map(Number);
  const b = toYmd.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000);
}

/** ISO 8601 week, e.g. "2026-W42" (weeks start Monday, week 1 holds the first Thursday). */
export function isoWeek(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 4 - (dt.getUTCDay() || 7));
  const week = Math.ceil(((dt.getTime() - Date.UTC(dt.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The Monday of the ISO week containing ymd. */
export function weekStartYmd(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
  return addDaysYmd(ymd, -(dow - 1));
}

export const reminderKey = (clientId: string, week: string) => `sms|${clientId}|rebooking_reminder|${week}`;
export const followupKey = (clientId: string, week: string) => `sms|${clientId}|rebooking_followup|${week}`;

// ── Skip reasons (shown to admins; every excluded client gets one) ───────────
export const REASON_TEXT: Record<string, string> = {
  archived: 'Client is archived',
  test_client: 'Test client',
  opted_out: 'Client has opted out of messages',
  reminders_paused: 'Reminders are paused for this client',
  marked_booked: 'Reminder status says already booked',
  not_this_week: 'Marked "Not This Week"',
  manual_follow_up: 'Marked for manual follow-up',
  missing_next_reminder_date: 'No next reminder date on the client record',
  invalid_next_reminder_date: 'Next reminder date is not a valid date',
  reminder_date_stale: 'Reminder date is further overdue than the allowed limit, so it needs checking',
  visited_since_due: 'Last visit is on or after the reminder date, so the date looks out of date',
  missing_name: 'Client has no name to put in the message',
  no_valid_mobile: 'No valid Australian mobile number',
  has_booking: 'Already has a booking or upcoming appointment',
  replied_this_week: 'Replied this week',
  needs_attention: 'Has an unresolved conversation needing human attention',
  weekly_limit_reached: 'Already received the maximum campaign messages this week',
  duplicate_phone_in_run: 'Another client with the same phone number is already in this run',
  template_render_failed: 'The message could not be rendered with this client\'s details',
  enqueue_failed: 'The message could not be queued',
  capped: 'Run limit reached. Left for the next run',
  reminder_failed: 'The reminder failed to send, so it does not count as contact',
  reminder_suppressed: 'The reminder was suppressed (opt-out, test data, or similar), so it does not count as contact',
  reminder_not_found: 'The reminder message could not be found',
  client_not_found: 'The client record no longer exists',
  booked_since_reminder: 'Booked since the reminder',
  admin_skipped: 'Skipped for this cycle by an admin',
};

export type Decision = { ok: true } | { ok: false; reason: string; detail?: string };
const no = (reason: string, detail?: string): Decision => ({ ok: false, reason, detail });
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type StaticOutcome = Decision | { ok: false; aggregate: 'not_due' | 'no_cadence' };

/**
 * Checks that need only the client row. Order is fixed and is the order reasons
 * are reported in. "Not due" and "no cadence" are aggregates, not exclusions:
 * those clients are simply not candidates this week.
 */
export function flagCheck(c: any): Decision {
  if (c.archived === true) return no('archived');
  if (c.is_test === true) return no('test_client');
  if (c.messaging_opted_out === true) return no('opted_out');
  if (c.is_paused === true || c.reminder_status === 'Paused') return no('reminders_paused');
  return { ok: true };
}

/** Can the message actually be written and delivered to this client? */
export function reachCheck(c: any): Decision {
  if (!String(c.client_name || '').trim()) return no('missing_name');
  if (!normaliseAuPhone(c.phone)) return no('no_valid_mobile');
  return { ok: true };
}

export function staticCheck(c: any, ctx: { today: string; maxOverdueDays: number }): StaticOutcome {
  const flag = flagCheck(c);
  if (!flag.ok) return flag;

  const next = c.next_reminder_date;
  if (!next) {
    if (c.frequency === 'Whenever') return { ok: false, aggregate: 'no_cadence' };
    const have = [c.last_visit_date ? 'last visit' : '', c.frequency ? `frequency ${c.frequency}` : ''].filter(Boolean).join(', ');
    return no('missing_next_reminder_date', have ? `Has ${have}, but no reminder date` : 'No reminder date, last visit or frequency');
  }
  if (!YMD.test(String(next))) return no('invalid_next_reminder_date', String(next).slice(0, 30));
  if (String(next) > ctx.today) return { ok: false, aggregate: 'not_due' };
  const overdue = daysBetween(String(next), ctx.today);
  if (overdue > ctx.maxOverdueDays) return no('reminder_date_stale', `${overdue} days overdue`);
  if (c.last_visit_date && YMD.test(String(c.last_visit_date)) && String(c.last_visit_date) >= String(next)) return no('visited_since_due');

  if (c.reminder_status === 'Booked') return no('marked_booked');
  if (c.reminder_status === 'Not This Week') return no('not_this_week');
  if (c.reminder_status === 'Manual Follow-up') return no('manual_follow_up');

  return reachCheck(c);
}

export interface ClientFacts {
  bookings: any[];        // this client's BookingRequests
  repliedYmds: string[];  // dates (campaign tz) of incoming messages in the lookback window
  attentionOpen: boolean; // open needs_attention flag or open unmatched reply
  campaignMessagesThisWeek: number;
}

/** A booking that is still live and either upcoming or undated. */
export function hasLiveBooking(bookings: any[], today: string): boolean {
  return bookings.some(b =>
    !RESOLVED_BOOKING.includes(String(b.status)) && String(b.status) !== 'completed' &&
    (!b.requested_date || String(b.requested_date) >= today));
}

/** Checks that need live facts about the client. Same for both stages, plus the weekly cap of two. */
export function dynamicCheck(f: ClientFacts, ctx: { today: string; weekStart: string }): Decision {
  if (hasLiveBooking(f.bookings, ctx.today)) return no('has_booking');
  if (f.repliedYmds.some(d => d >= ctx.weekStart)) return no('replied_this_week');
  if (f.attentionOpen) return no('needs_attention');
  if (f.campaignMessagesThisWeek >= MAX_MESSAGES_PER_CLIENT_PER_WEEK) return no('weekly_limit_reached');
  return { ok: true };
}

/**
 * How the first message's delivery status affects follow-up eligibility. Uses the
 * existing MessageOutbox status (and the Message row the status webhook updates);
 * no separate campaign delivery field exists.
 *
 *   sent                   -> contacted      (follow-up allowed)
 *   pending / claimed      -> in_flight      (queued successfully, possibly held for quiet
 *                                             hours or retrying; follow-up allowed)
 *   sent but Message failed-> failed         (carrier reported failure; no follow-up)
 *   failed / dead_letter   -> failed         (no follow-up)
 *   suppressed             -> suppressed     (opt-out, test data, template off; no follow-up)
 *   no outbox row          -> missing        (no follow-up)
 */
export type ContactState = 'contacted' | 'in_flight' | 'failed' | 'suppressed' | 'missing';

export function contactState(outbox: any | null, message?: any | null): ContactState {
  if (!outbox) return 'missing';
  const s = String(outbox.status);
  if (s === 'sent') return message && message.delivery_status === 'failed' ? 'failed' : 'contacted';
  if (s === 'pending' || s === 'claimed') return 'in_flight';
  if (s === 'suppressed') return 'suppressed';
  return 'failed';
}

export function followupContactCheck(state: ContactState): Decision {
  if (state === 'contacted' || state === 'in_flight') return { ok: true };
  if (state === 'failed') return no('reminder_failed');
  if (state === 'suppressed') return no('reminder_suppressed');
  return no('reminder_not_found');
}

/** Display outcome for a queued entry, from the live outbox row (never stored separately). */
export function deliveryOutcome(outbox: any | null): { state: 'pending' | 'sent' | 'failed' | 'suppressed' | 'unknown'; reason: string } {
  if (!outbox) return { state: 'unknown', reason: 'Message not found' };
  const s = String(outbox.status);
  if (s === 'sent') return { state: 'sent', reason: '' };
  if (s === 'suppressed') return { state: 'suppressed', reason: String(outbox.suppressed_reason || 'suppressed') };
  if (s === 'failed' || s === 'dead_letter') return { state: 'failed', reason: String(outbox.dead_letter_reason || outbox.last_error || 'failed') };
  return { state: 'pending', reason: String(outbox.deferral_reason || outbox.last_error || '') };
}

export const CAP_RULE =
  'The limit counts messages newly queued in one run (one message per client per stage). ' +
  'A run does one stage; if both days are the same, follow-ups are processed first and share the same limit. ' +
  'Clients beyond the limit are recorded as "capped" and wait for the next run. A scheduled run happens once per stage per day, so a retry never gets a second allowance.';