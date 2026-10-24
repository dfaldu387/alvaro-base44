import { enqueueOutboxMessage } from './outboxEnqueue.ts';
import { normaliseAuPhone } from './auPhone.ts';
import { sydneyNow, RESOLVED } from './arrivalTimes.ts';
import { loadDayEta } from './routeEtaLoader.ts';
import { windowPhrase, type EtaStop } from './routeEta.ts';
import { trackingLinkVariable } from './bookingTracking.ts';
import { purgeExpired } from './liveLocation.ts';

/**
 * "We're running late" messages. Runs inside the existing message sweep
 * (processMessageOutbox, every 5 minutes) - no extra scheduled workflow. It only
 * QUEUES onto the outbox; quiet hours, consent, STOP, messaging_mode and test
 * data are all applied by the sweep exactly as for every other message, and a
 * suppressed message shows its reason in the outbox.
 *
 * THRESHOLD BUCKETS (minutes past the booked time):
 *     over 20  ->  bucket "l20"   (first apology)
 *     over 45  ->  bucket "l45"   (materially worse: one more message)
 *   At most TWO running_late messages per booking per day, and never a message
 *   for a bucket at or below one already sent - a day that drifts 25 -> 28 -> 31
 *   sends once; a day that recovers to 30 after a 50-minute message sends nothing.
 *
 * Idempotency key: sms|<booking>|running_late_<bucket>|<date>
 *   (fits the outbox's channel|target|event|date shape; the bucket is part of the
 *   event, so each crossing is its own key).
 */
export const LATE_BUCKETS = [
  { key: 'l20', over: 20 },
  { key: 'l45', over: 45 },
] as const;
export const LATE_THRESHOLD_MINUTES = LATE_BUCKETS[0].over;

/** A stop in any of these states has been reached: it never gets a running-late message. */
export const NO_LATE_STATES = ['arrived', 'in_service', 'completed', 'skipped'];

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/** Index of the highest bucket the delay is strictly past, or -1. */
export function bucketIndexFor(delayMinutes: number | null | undefined): number {
  const d = Number(delayMinutes);
  if (!Number.isFinite(d)) return -1;
  let idx = -1;
  LATE_BUCKETS.forEach((b, i) => { if (d > b.over) idx = i; });
  return idx;
}

export const lateKey = (bookingId: string, bucket: string, date: string) => `sms|${bookingId}|running_late_${bucket}|${date}`;

/** Which buckets an outbox key says were already queued for this booking and date. */
export function bucketOfKey(key: string, bookingId: string, date: string): number {
  const m = new RegExp(`^sms\\|${bookingId}\\|running_late_(l\\d+)\\|${date}$`).exec(String(key || ''));
  return m ? LATE_BUCKETS.findIndex(b => b.key === m[1]) : -1;
}

export interface LateCandidate { stop: EtaStop; bucketIndex: number }

/**
 * Pure: which stops need a message right now? `sentIndex` is the highest bucket
 * already queued per booking (-1 / missing = none).
 */
export function planRunningLate(stops: EtaStop[], sentIndex: Record<string, number>): LateCandidate[] {
  const out: LateCandidate[] = [];
  for (const stop of stops) {
    if (NO_LATE_STATES.includes(stop.state)) continue;
    if (!stop.window_label) continue; // no ETA, no message
    const idx = bucketIndexFor(stop.delay_minutes);
    if (idx < 0) continue;
    if ((sentIndex[stop.booking_request_id] ?? -1) >= idx) continue;
    out.push({ stop, bucketIndex: idx });
  }
  return out;
}

export interface RunningLateSummary { date: string; queued: number; already: number; skipped: number; dry_run: boolean; items: any[] }

export async function runRunningLate(admin: any, opts: { now?: Date; dryRun?: boolean } = {}): Promise<RunningLateSummary> {
  const now = opts.now || new Date();
  const date = sydneyNow(now).date;
  const summary: RunningLateSummary = { date, queued: 0, already: 0, skipped: 0, dry_run: opts.dryRun === true, items: [] };

  // Housekeeping first: yesterday's live-location switches go, an expired position is cleared.
  if (!opts.dryRun) { try { await purgeExpired(admin, now); } catch { /* never blocks a late message */ } }

  const day = await loadDayEta(admin, date, now);
  for (const route of day.results) {
    if (route.status !== 'ok' || (route.delay_minutes ?? 0) <= LATE_THRESHOLD_MINUTES) continue;

    // What has already gone out for the stops that could need a message.
    const sentIndex: Record<string, number> = {};
    const maybe = route.stops.filter(s => !NO_LATE_STATES.includes(s.state) && bucketIndexFor(s.delay_minutes) >= 0);
    for (const s of maybe) {
      const rows = asList(await admin.entities.MessageOutbox.filter(
        { booking_request_id: s.booking_request_id, template_key: 'running_late' }, 'created_date', 20));
      for (const r of rows) sentIndex[s.booking_request_id] = Math.max(sentIndex[s.booking_request_id] ?? -1, bucketOfKey(r.idempotency_key, s.booking_request_id, date));
    }

    for (const { stop, bucketIndex } of planRunningLate(route.stops, sentIndex)) {
      const booking = day.bookings.get(stop.booking_request_id);
      const skip = (reason: string) => { summary.skipped++; summary.items.push({ booking_request_id: stop.booking_request_id, result: 'skipped', reason }); };
      if (!booking) { skip('booking not found'); continue; }
      if (RESOLVED.includes(String(booking.status))) { skip(`booking is ${booking.status}`); continue; }
      const to = normaliseAuPhone(booking.phone);
      if (!to) { skip('no valid mobile number'); continue; }

      const bucket = LATE_BUCKETS[bucketIndex].key;
      if (opts.dryRun) { summary.items.push({ booking_request_id: stop.booking_request_id, result: 'would_queue', bucket }); continue; }

      const queued = await enqueueOutboxMessage(admin, {
        channel: 'sms',
        to_address: to,
        template_key: 'running_late',
        payload: {
          name: String(booking.client_name || '').trim().split(/\s+/)[0] || '',
          time: stop.planned_start_label || '',
          eta_window: windowPhrase(stop),
          tracking_link: await trackingLinkVariable(admin, booking),
          // Shown to the barber and admin so nobody sends a second apology by hand.
          window_label: stop.window_label || '',
          delay_minutes: String(stop.delay_minutes ?? ''),
        },
        booking_request_id: booking.id,
        client_id: booking.client_id || undefined,
        idempotency_key: lateKey(booking.id, bucket, date),
      });
      if (!queued.ok) { skip(queued.error); continue; }
      if (queued.created) summary.queued++; else summary.already++;
      summary.items.push({ booking_request_id: stop.booking_request_id, result: queued.created ? 'queued' : 'already_queued', bucket });
    }
  }
  return summary;
}

/**
 * Checked by the sweep just before a running_late message is sent. Returns the
 * suppression reason, or null when it is still right to send. This is what makes
 * "never for a stop the barber has already arrived at" true even when the message
 * waited in the queue (retry, quiet hours).
 */
export async function runningLateStale(admin: any, item: any, now: Date = new Date()): Promise<string | null> {
  let booking: any = null;
  try { booking = item.booking_request_id ? await admin.entities.BookingRequest.get(item.booking_request_id) : null; } catch { booking = null; }
  if (!booking) return 'booking no longer exists';
  if (RESOLVED.includes(String(booking.status))) return `booking is ${String(booking.status).replace('_', ' ')}`;
  if (booking.requested_date !== sydneyNow(now).date) return 'the appointment day has passed';

  const day = await loadDayEta(admin, booking.requested_date, now);
  for (const r of day.results) {
    const stop = r.stops.find(s => s.booking_request_id === String(booking.id));
    if (stop && NO_LATE_STATES.includes(stop.state)) return 'barber has already arrived';
  }
  return null;
}