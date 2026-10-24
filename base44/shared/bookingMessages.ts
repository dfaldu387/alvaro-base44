import { enqueueOutboxMessage } from './outboxEnqueue.ts';
import { normaliseAuPhone } from './auPhone.ts';
import { trackingTokenFields } from './bookingTracking.ts';
import { loadPaymentLine } from './bookingPaymentLine.ts';

/**
 * Server-side booking transitions that produce customer messages.
 * Nothing here sends anything: it enqueues on the MessageOutbox, and the sweep
 * applies test-data suppression, opt-out, quiet hours, template rules and
 * retries.
 */

export type BookingMessageKey = 'booking_received' | 'booking_confirmed';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "2026-10-16" -> "Friday 16 October". Anything unparseable is returned as-is. */
export function friendlyDate(ymd: unknown): string {
  const [y, m, d] = String(ymd || '').split('-').map(Number);
  if (!y || !m || !d) return String(ymd || '');
  return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

export function firstName(full: unknown): string {
  return String(full || '').trim().split(/\s+/)[0] || '';
}

/**
 * The variables each booking text is given. Service is on both; the confirmed text also carries the address and
 * one line about payment. A missing service or address gets a plain stand-in rather than a blank, because the
 * renderer refuses to send a text with a gap in it.
 */
export function bookingPayload(b: any, key: BookingMessageKey, paymentLine?: string): Record<string, string> {
  const base = {
    name: firstName(b.client_name),
    date: friendlyDate(b.requested_date),
    window: String(b.availability_window || '').trim(),
    service: (Array.isArray(b.services) ? b.services : []).filter(Boolean).join(', ') || 'your service',
  };
  if (key === 'booking_received') return base;
  return {
    ...base,
    address: String(b.address || '').trim() || 'your address on file',
    payment_line: paymentLine || 'Payment is due after your service.',
  };
}

/**
 * Enqueues one booking message. Idempotent on sms|<booking id>|<key>.
 * Never throws: a messaging problem must never undo or block a booking change.
 */
export async function enqueueBookingMessage(admin: any, booking: any, key: BookingMessageKey) {
  try {
    const to = normaliseAuPhone(booking?.phone) || String(booking?.phone || '').trim();
    if (!to) return { queued: false, reason: 'no phone number on the booking' };
    let paymentLine: string | undefined;
    if (key === 'booking_confirmed') {
      try { paymentLine = await loadPaymentLine(admin, booking); } catch { paymentLine = undefined; }
    }
    const result = await enqueueOutboxMessage(admin, {
      channel: 'sms',
      to_address: to,
      template_key: key,
      payload: bookingPayload(booking, key, paymentLine),
      booking_request_id: booking.id,
      idempotency_key: `sms|${booking.id}|${key}`,
    });
    if (!result.ok) return { queued: false, reason: result.error };
    return { queued: true, created: result.created, outbox_id: result.message_outbox?.id };
  } catch (e) {
    console.error('enqueueBookingMessage failed', key, (e as Error)?.message);
    return { queued: false, reason: 'could not enqueue' };
  }
}

const NOT_CONFIRMABLE = ['declined', 'completed', 'no_show', 'could_not_fit', 'blocked'];

/**
 * The authoritative confirm transition: status -> confirmed, who/when recorded,
 * then the booking_confirmed message enqueued (idempotent, so calling this twice
 * for the same booking — or finalising a day twice — queues exactly one message).
 */
export async function confirmBookingCore(
  admin: any,
  bookingId: string,
  opts: { actorName: string; confirmTime?: boolean },
) {
  let booking: any = null;
  try { booking = await admin.entities.BookingRequest.get(bookingId); } catch { booking = null; }
  if (!booking) return { ok: false, status: 404, error: 'Booking request not found.' };
  if (NOT_CONFIRMABLE.includes(String(booking.status))) {
    return { ok: false, status: 409, error: `A ${String(booking.status).replace('_', ' ')} booking cannot be confirmed.` };
  }

  const alreadyConfirmed = booking.status === 'confirmed';
  const updates: Record<string, any> = {};
  if (!alreadyConfirmed || (opts.confirmTime && booking.schedule_status !== 'confirmed')) {
    updates.status = 'confirmed';
    updates.confirmed_at = new Date().toISOString();
    updates.confirmed_by = opts.actorName;
  }
  if (opts.confirmTime) updates.schedule_status = 'confirmed';
  // The tracking token is minted when the booking is confirmed (valid only on its own date).
  Object.assign(updates, trackingTokenFields(booking) || {});
  if (Object.keys(updates).length > 0) {
    await admin.entities.BookingRequest.update(booking.id, updates);
    booking = { ...booking, ...updates };
  }

  const message = await enqueueBookingMessage(admin, booking, 'booking_confirmed');
  return { ok: true, status: 200, booking_id: booking.id, was_already_confirmed: alreadyConfirmed, message };
}