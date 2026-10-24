import { enqueueOutboxMessage } from './outboxEnqueue.ts';
import { normaliseAuPhone } from './auPhone.ts';
import { trackingLinkVariable } from './bookingTracking.ts';
import { currentRouteStatus } from './currentRouteStatus.ts';
import { reminderBlocksArrival, reconcilePreAppointment } from './preAppointmentGuard.ts';

/**
 * Night-before arrival-time messages. New file — beside the scheduling core,
 * never inside it. It only READS finalised routes and ENQUEUES on the existing
 * outbox (shared/outboxEnqueue, the same path as the enqueueMessage endpoint);
 * the sweep applies template rendering, test-data, opt-out, consent and quiet
 * hours. Nothing here talks to a provider.
 *
 * One idempotency key per booking and service date:
 *   sms|<booking_request_id>|arrival_time|<YYYY-MM-DD, Australia/Sydney>
 * so the evening job, a re-run, and the "finalised after the job" path can all
 * call this freely — the second caller finds the first one's row.
 */

export const TZ = 'Australia/Sydney';
export const DEFAULT_SEND_HOUR = 18;
export const RESOLVED = ['cancelled', 'declined', 'completed', 'no_show', 'could_not_fit', 'blocked'];

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });

/** Today's date and hour on the Sydney wall clock. */
export function sydneyNow(now: Date = new Date()) {
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(now)) if (part.type !== 'literal') p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

export function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const sydneyTomorrow = (now: Date = new Date()) => addDays(sydneyNow(now).date, 1);

export const arrivalKey = (bookingId: string, date: string) => `sms|${bookingId}|arrival_time|${date}`;

const firstName = (full: unknown) => String(full || '').trim().split(/\s+/)[0] || '';

export async function getSendHour(admin: any): Promise<number> {
  try {
    const row = asList(await admin.entities.MessagingSettings.list('-created_date', 1))[0];
    const h = Number(row?.arrival_send_hour);
    return Number.isInteger(h) && h >= 0 && h <= 23 ? h : DEFAULT_SEND_HOUR;
  } catch {
    return DEFAULT_SEND_HOUR;
  }
}

const ROUTE_SKIP_REASON: Record<string, string> = {
  draft: 'The route is still a draft. Finalise it to send arrival times.',
  finalising: 'The route is being finalised right now.',
  needs_update: 'The route changed after it was finalised. Re-finalise it so the arrival times are right.',
};

type BookingResult = { booking_request_id: string; result: 'queued' | 'already_queued' | 'would_queue' | 'refreshed' | 'skipped'; reason?: string; time?: string };

/** Every arrival message for this booking and date, original first, then corrections in order. */
async function messagesFor(admin: any, id: string, date: string): Promise<any[]> {
  const rows = asList(await admin.entities.MessageOutbox.filter({ booking_request_id: id, template_key: 'arrival_time' }, 'created_date', 50));
  const order = (r: any) => {
    const parts = String(r.idempotency_key || '').split('|');
    if (parts[3] !== date) return -1;
    if (parts[2] === 'arrival_time') return 0;
    const m = /^arrival_time_fix(\d+)$/.exec(parts[2]);
    return m ? Number(m[1]) : -1;
  };
  return rows.filter(r => order(r) >= 0).sort((a, b) => order(a) - order(b));
}

async function planBooking(admin: any, stop: any, date: string, dryRun: boolean): Promise<BookingResult> {
  const id = String(stop?.booking_request_id || '');
  const skip = (reason: string): BookingResult => ({ booking_request_id: id, result: 'skipped', reason });
  let booking: any = null;
  try { booking = id ? await admin.entities.BookingRequest.get(id) : null; } catch { booking = null; }
  if (!booking) return skip('Booking not found');
  if (RESOLVED.includes(String(booking.status))) return skip(`Booking is ${String(booking.status).replace('_', ' ')}`);
  if (booking.requested_date !== date) return skip('Booking is no longer on this date');
  const to = normaliseAuPhone(booking.phone);
  if (!to) return skip('No valid mobile number');
  // The arrival time is the stop's scheduled time on the finalised route, never the availability window.
  const time = String(stop?.start_label || '').trim();
  if (!time) return skip('The route has no arrival time for this stop');

  const key = arrivalKey(id, date);
  if (dryRun) {
    const existing = asList(await admin.entities.MessageOutbox.filter({ idempotency_key: key }, 'created_date', 1));
    return { booking_request_id: id, result: existing.length ? 'already_queued' : 'would_queue', time };
  }
  // What the customer has been (or is about to be) told. A changed time never leaves a stale one standing:
  // an unsent message is rewritten in place; one already sent is followed by a single correction.
  const prior = await messagesFor(admin, id, date);
  const latest = prior[prior.length - 1];
  // One pre-appointment text per booking and day: if the night-before reminder has already gone out, this exact
  // time is not sent as a second one; if the reminder is still unsent, it is replaced by this message.
  if (!latest) {
    const gate = await reminderBlocksArrival(admin, id, date);
    if (gate.blocked) return skip(gate.reason || 'The night-before reminder has already gone out');
  }
  let sendKey = key;
  if (latest) {
    if (String(latest.payload?.time || '') === time) return { booking_request_id: id, result: 'already_queued', time };
    if (latest.status === 'pending') {
      await admin.entities.MessageOutbox.updateMany({ id: latest.id, status: 'pending' }, { $set: { payload: { ...(latest.payload || {}), time } } });
      return { booking_request_id: id, result: 'refreshed', time };
    }
    if (latest.status !== 'sent') return { booking_request_id: id, result: 'already_queued', time };
    sendKey = `sms|${id}|arrival_time_fix${prior.length}|${date}`;
  }
  const queued = await enqueueOutboxMessage(admin, {
    channel: 'sms',
    to_address: to,
    template_key: 'arrival_time',
    payload: {
      name: firstName(booking.client_name), time, address: String(booking.address || '').trim() || 'your address on file',
      tracking_link: await trackingLinkVariable(admin, booking),
    },
    booking_request_id: id,
    idempotency_key: sendKey,
  });
  if (!queued.ok) return skip(queued.error);
  if (queued.created && !latest && (await reconcilePreAppointment(admin, id, date)) === 'arrival_suppressed') {
    return skip('The night-before reminder had already gone out');
  }
  return { booking_request_id: id, result: queued.created ? 'queued' : 'already_queued', time };
}

/** One log row per date + route, updated on each run so repeated runs do not pile up rows. */
async function writeLog(admin: any, data: Record<string, any>) {
  const rows = asList(await admin.entities.ArrivalRunLog.filter({ service_date: data.service_date, route_id: data.route_id }, 'created_date', 1));
  const payload = { ...data, run_at: new Date().toISOString() };
  if (rows[0]) await admin.entities.ArrivalRunLog.update(rows[0].id, payload);
  else await admin.entities.ArrivalRunLog.create(payload);
}

export interface ArrivalRunOptions { date: string; dryRun?: boolean; trigger: 'scheduled' | 'finalise' | 'admin' }

export async function runArrivalTimes(admin: any, opts: ArrivalRunOptions) {
  const { date, dryRun = false, trigger } = opts;
  const routes = asList(await admin.entities.DayRoute.filter({ date }, 'created_date', 50));
  const summary: any = { date, dry_run: dryRun, routes: [], queued: 0, already_queued: 0, would_queue: 0, refreshed: 0, skipped_routes: 0, skipped_bookings: 0 };
  const coveredIds = new Set<string>();
  const day = asList(await admin.entities.BookingRequest.filter({ requested_date: date }, 'created_date', 300));

  for (const route of routes) {
    // Decided from the day as it stands now, not from a stored status someone has to have refreshed.
    const status = currentRouteStatus(route, day);
    const base = { service_date: date, route_id: route.id, team_member_name: route.team_member_name || '', route_status: status, trigger };
    if (status !== 'finalised') {
      const reason = ROUTE_SKIP_REASON[status] || 'The route is not finalised.';
      summary.skipped_routes++;
      for (const stop of asList(route.stops)) if (stop?.booking_request_id) coveredIds.add(String(stop.booking_request_id)); // already explained by this route's own reason
      summary.routes.push({ route_id: route.id, route_status: status, outcome: 'skipped', reason });
      if (!dryRun) await writeLog(admin, { ...base, outcome: 'skipped', reason, queued_count: 0, already_queued_count: 0, skipped_bookings: [] });
      continue;
    }
    const results: BookingResult[] = [];
    for (const stop of asList(route.stops)) {
      if (stop?.booking_request_id) coveredIds.add(String(stop.booking_request_id));
      results.push(await planBooking(admin, stop, date, dryRun));
    }
    const count = (r: string) => results.filter(x => x.result === r).length;
    const skipped = results.filter(x => x.result === 'skipped').map(x => ({ booking_request_id: x.booking_request_id, reason: x.reason || '' }));
    summary.queued += count('queued');
    summary.already_queued += count('already_queued');
    summary.refreshed += count('refreshed');
    summary.would_queue += count('would_queue');
    summary.skipped_bookings += skipped.length;
    summary.routes.push({ route_id: route.id, route_status: 'finalised', outcome: 'processed', results });
    if (!dryRun) {
      await writeLog(admin, {
        ...base,
        outcome: count('queued') > 0 ? 'queued' : skipped.length > 0 && count('already_queued') === 0 ? 'skipped' : 'nothing_new',
        reason: skipped.length > 0 ? `${skipped.length} booking${skipped.length === 1 ? ' was' : 's were'} left out.` : '',
        queued_count: count('queued'),
        already_queued_count: count('already_queued'),
        skipped_bookings: skipped,
      });
    }
  }

  // Scheduled bookings on this date that no finalised route covers: visible, never silent.
  const uncovered = day.filter(b =>
    !RESOLVED.includes(String(b.status)) && b.assigned_time &&
    ['provisional', 'locked', 'confirmed'].includes(String(b.schedule_status)) && !coveredIds.has(b.id));
  if (uncovered.length > 0) {
    const reason = `${uncovered.length} scheduled booking${uncovered.length === 1 ? ' is' : 's are'} not on a finalised route, so no arrival time was sent.`;
    summary.skipped_bookings += uncovered.length;
    summary.routes.push({ route_id: 'no-route', route_status: 'none', outcome: 'skipped', reason });
    if (!dryRun) {
      await writeLog(admin, {
        service_date: date, route_id: 'no-route', route_status: 'none', trigger, outcome: 'skipped', reason,
        queued_count: 0, already_queued_count: 0,
        skipped_bookings: uncovered.map(b => ({ booking_request_id: b.id, reason: 'Not on a finalised route' })),
      });
    }
  }
  return summary;
}

/**
 * Called when a route is finalised. If it is for tomorrow and the evening job's
 * send hour has already passed, queue now (same keys, so nothing is duplicated).
 * Otherwise the evening job will pick the route up, so nothing happens here.
 */
export async function runArrivalOnFinalise(admin: any, date: string) {
  const now = sydneyNow();
  if (date !== addDays(now.date, 1)) return { ran: false, reason: 'not tomorrow' };
  if (now.hour < await getSendHour(admin)) return { ran: false, reason: 'the evening job has not run yet' };
  return { ran: true, ...(await runArrivalTimes(admin, { date, trigger: 'finalise' })) };
}