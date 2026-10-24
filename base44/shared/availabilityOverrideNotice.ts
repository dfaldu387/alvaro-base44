import { enqueueOutboxMessage } from './outboxEnqueue.ts';
import { ensureRouteTemplates } from './routeMessageTemplates.ts';
import { friendlyDate, firstName } from './bookingMessages.ts';
import { decimalToLabel, parseTimeStr } from './provisionalPlacement.ts';
import { normaliseAuPhone } from './auPhone.ts';

/**
 * The one text that asks a customer about a time we placed OUTSIDE the availability
 * they chose. An administrator may always override the customer's window (it is a
 * soft constraint), but the customer is then asked whether it actually suits them,
 * so an override never becomes a silent "normal" placement.
 *
 * It is queued by the server-side placement that performed the override
 * (applyManualPlacement). The sweep applies every protection as usual: test data,
 * opt-out and quiet hours. Nothing is sent from here.
 */
export const OVERRIDE_CHECK_KEY = 'availability_override_check';

/** One message per booking per offered time, so re-placing at the same time never texts twice. */
export function overrideCheckKey(bookingId: string, date: string, label: string): string {
  return `sms|${bookingId}|${OVERRIDE_CHECK_KEY}|${date}T${label}`;
}

export interface OverrideNoticeResult {
  queued: boolean;
  reason?: string;
}

export async function enqueueAvailabilityOverrideCheck(
  admin: any,
  booking: any,
  time: unknown,
): Promise<OverrideNoticeResult> {
  const id = String(booking?.id || '').trim();
  const date = String(booking?.requested_date || '').trim();
  const dec = typeof time === 'number' ? time : parseTimeStr(String(time || ''));
  const phone = normaliseAuPhone(booking?.phone) || String(booking?.phone || '').trim();
  if (!id || !date) return { queued: false, reason: 'the booking has no date' };
  if (!isFinite(dec)) return { queued: false, reason: 'the offered time is unusable' };
  if (!phone) return { queued: false, reason: 'the booking has no phone number' };

  const label = decimalToLabel(dec);
  // The wording must exist as a template row or the sweep dead-letters the message.
  await ensureRouteTemplates(admin);

  const res = await enqueueOutboxMessage(admin, {
    channel: 'sms',
    to_address: phone,
    template_key: OVERRIDE_CHECK_KEY,
    payload: { name: firstName(booking.client_name), date: friendlyDate(date), time: label },
    booking_request_id: id,
    client_id: booking.client_id || undefined,
    idempotency_key: overrideCheckKey(id, date, label),
  });
  return res.ok ? { queued: true } : { queued: false, reason: res.error };
}