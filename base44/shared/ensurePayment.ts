import { createPaymentForBooking, createPaymentRowOnce, legacyPaymentFields, recordEvent } from './paymentService.ts';
import type { PaymentProvider } from './paymentProvider.ts';

/**
 * Every booking gets a payment record, whichever path created it (public form, assistant, the Schedule
 * tab, an import). The new-booking workflow and the repair action both come through here, so a booking
 * is treated the same wherever it came from.
 *
 *   skip     time blocks and held requests: no payment, a held request gets one when an admin approves it
 *   legacy   not an open, upcoming booking (completed, imported, in the past): a plain record, no deposit asked
 *   evaluate an open, upcoming booking: the deposit rules decide, exactly as for a public booking
 */
export const OPEN_STATUSES = ['pending', 'confirmed', 'waitlist', 'rescheduled'];
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const sydneyDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' });

export type PaymentKind = 'skip' | 'legacy' | 'evaluate';

export function paymentKindFor(b: any, today: string = sydneyDay.format(new Date())): PaymentKind {
  if (!b) return 'skip';
  if (String(b.client_name || '').startsWith('[BLOCK]') || b.block_source || b.status === 'blocked') return 'skip';
  if (b.protection_hold === true) return 'skip';
  if (!OPEN_STATUSES.includes(String(b.status))) return 'legacy';
  if (b.booking_source === 'Imported Booking') return 'legacy';
  if (b.requested_date && String(b.requested_date) < today) return 'legacy';
  return 'evaluate';
}

export async function paymentRowFor(admin: any, bookingId: string) {
  return asList(await admin.entities.BookingPayment.filter({ booking_request_id: bookingId }, '-created_date', 1))[0] || null;
}

/** The booking's payment row, made from its earlier status if it never had one. Never evaluates a deposit and never texts anyone. */
export async function paymentOrLegacy(admin: any, booking: any, actor = 'system') {
  const existing = await paymentRowFor(admin, booking.id);
  if (existing) return existing;
  const { payment, mine } = await createPaymentRowOnce(admin, legacyPaymentFields(booking));
  if (mine) {
    await recordEvent(admin, { booking_request_id: booking.id, event_type: 'migrated', to_state: payment.state, amount: payment.amount_paid, actor, note: "Payment record created from the booking's earlier payment status.", is_test: booking.is_test === true });
  }
  return payment;
}

export async function ensurePaymentForBooking(admin: any, booking: any, opts: { provider?: PaymentProvider; actor?: string } = {}) {
  const kind = paymentKindFor(booking);
  if (kind === 'skip') return { created: false, kind, reason: 'A time block or a held request has no payment record yet.' };
  if (await paymentRowFor(admin, booking.id)) return { created: false, kind, existing: true };
  if (kind === 'legacy') {
    const p = await paymentOrLegacy(admin, booking, opts.actor || 'system');
    return { created: true, kind, state: p.state };
  }
  const r = await createPaymentForBooking(admin, booking, { provider: opts.provider });
  return { created: !r.existing, kind, state: r.payment?.state, deposit_message: r.message };
}