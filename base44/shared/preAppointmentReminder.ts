import { enqueueOutboxMessage } from './outboxEnqueue.ts';
import { normaliseAuPhone } from './auPhone.ts';
import { friendlyDate, firstName } from './bookingMessages.ts';
import { currentRouteStatus } from './currentRouteStatus.ts';
import { preAppointmentRows, reminderKey, reconcilePreAppointment, isLive } from './preAppointmentGuard.ts';

/**
 * The night-before reminder for a confirmed booking whose day has NO finalised route (never finalised, or
 * changed since). It commits only to facts: the date, the customer's own agreed window and the address.
 * It never contains an arrival time, because none has been produced by the scheduling engine for it.
 *
 * A booking on a currently finalised route is left to the arrival-time job, which sends the exact window.
 * Idempotent: key sms|<booking>|booking_reminder|<date>.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/** "between 2pm–7pm", or an honest "sometime during the day" when the window is open or was overridden. */
export function reminderWindowPhrase(b: any): string {
  const own = String(b?.availability_window || '').trim();
  if (own && own.toLowerCase() !== 'flexible' && b?.availability_override !== true) return `between ${own}`;
  return 'sometime during the day';
}

export function reminderPayload(b: any): Record<string, string> {
  return {
    name: firstName(b.client_name),
    date: friendlyDate(b.requested_date),
    service: (Array.isArray(b.services) ? b.services : []).filter(Boolean).join(', ') || 'your service',
    window_phrase: reminderWindowPhrase(b),
    address: String(b.address || '').trim() || 'your address on file',
  };
}

export interface ReminderRunOptions { date: string; dryRun?: boolean }

export async function runPreAppointmentReminders(admin: any, opts: ReminderRunOptions) {
  const { date, dryRun = false } = opts;
  const routes = asList(await admin.entities.DayRoute.filter({ date }, 'created_date', 50));
  const day = asList(await admin.entities.BookingRequest.filter({ requested_date: date }, 'created_date', 300));
  const onFinalised = new Set<string>();
  for (const route of routes) {
    if (currentRouteStatus(route, day) !== 'finalised') continue;
    for (const s of asList(route.stops)) if (s?.booking_request_id) onFinalised.add(String(s.booking_request_id));
  }
  const out = { date, dry_run: dryRun, queued: 0, already_queued: 0, would_queue: 0, left_to_arrival_time: 0, skipped: 0, suppressed_by_arrival: 0, skipped_reasons: [] as Array<{ booking_request_id: string; reason: string }> };

  for (const b of day) {
    if (b.status !== 'confirmed' || b.protection_hold === true) continue;
    const id = String(b.id);
    const to = normaliseAuPhone(b.phone);
    if (!to) { out.skipped++; out.skipped_reasons.push({ booking_request_id: id, reason: 'No valid mobile number' }); continue; }
    if (onFinalised.has(id)) { out.left_to_arrival_time++; continue; }
    const { arrivals, reminder } = await preAppointmentRows(admin, id, date);
    if (arrivals.some(isLive)) { out.left_to_arrival_time++; continue; }
    if (reminder) { out.already_queued++; continue; }
    if (dryRun) { out.would_queue++; continue; }
    const q = await enqueueOutboxMessage(admin, {
      channel: 'sms', to_address: to, template_key: 'booking_reminder', payload: reminderPayload(b),
      booking_request_id: id, idempotency_key: reminderKey(id, date),
    });
    if (!q.ok) { out.skipped++; out.skipped_reasons.push({ booking_request_id: id, reason: q.error }); continue; }
    if (q.created) out.queued++; else out.already_queued++;
    if ((await reconcilePreAppointment(admin, id, date)) === 'reminder_suppressed') { out.suppressed_by_arrival++; if (q.created) out.queued--; }
  }
  return out;
}