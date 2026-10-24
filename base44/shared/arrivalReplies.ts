import { addDays, sydneyNow, RESOLVED } from './arrivalTimes.ts';
import { awaitingOverrideBookings } from './overrideReply.ts';

/**
 * Customer replies to the arrival-time message. New file; used by the existing
 * twilioInboundWebhook (no second webhook). It never changes a booking: a YES
 * records "customer confirmed", NO / CANCEL / RESCHEDULE flags "needs attention"
 * with the original text. A reply that cannot be tied to exactly one booking is
 * stored as an UnmatchedReply for a human — never guessed.
 */
export const CONFIRM_WORDS = ['YES', 'Y', 'YEP', 'CONFIRM'];
export const ATTENTION_WORDS = ['NO', 'CANCEL', 'RESCHEDULE'];
export type ArrivalReplyKind = 'customer_confirmed' | 'needs_attention' | 'other';

const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/** Whole message, trimmed and case-insensitive. "yes please" is left for a human. */
export function classifyArrivalReply(body: unknown): ArrivalReplyKind {
  const t = typeof body === 'string' ? body.trim().toUpperCase() : '';
  if (CONFIRM_WORDS.includes(t)) return 'customer_confirmed';
  if (ATTENTION_WORDS.includes(t)) return 'needs_attention';
  return 'other';
}

export interface ReplyInput { kind: ArrivalReplyKind; clients: any[]; primaryClientId: string | null; from: string; body: string; sid: string }
export interface ReplyOutcome { outcome: 'customer_confirmed' | 'needs_attention' | 'unmatched'; bookingId: string | null }

async function storeUnmatched(admin: any, i: ReplyInput, reason: string): Promise<ReplyOutcome> {
  await admin.entities.UnmatchedReply.create({
    from_phone: i.from, reply_text: i.body, reason, kind: i.kind,
    client_id: i.primaryClientId || undefined, provider_message_id: i.sid, status: 'open',
  });
  return { outcome: 'unmatched', bookingId: null };
}

export async function recordArrivalReply(admin: any, i: ReplyInput): Promise<ReplyOutcome> {
  // A Twilio retry finds what the first attempt stored.
  const flagged = asList(await admin.entities.BookingReplyFlag.filter({ provider_message_id: i.sid }, 'created_date', 1))[0];
  if (flagged) return { outcome: flagged.kind, bookingId: flagged.booking_request_id };
  const stored = asList(await admin.entities.UnmatchedReply.filter({ provider_message_id: i.sid }, 'created_date', 1))[0];
  if (stored) return { outcome: 'unmatched', bookingId: null };

  if (i.clients.length === 0) return storeUnmatched(admin, i, 'No client has this phone number');

  const today = sydneyNow().date;
  const ids = i.clients.map(c => c.id);
  let candidates = asList(await admin.entities.BookingRequest.filter(
    { client_id: { $in: ids }, requested_date: { $in: [today, addDays(today, 1)] } }, 'created_date', 20,
  )).filter(b => !RESOLVED.includes(String(b.status)) && !String(b.client_name || '').startsWith('[BLOCK]'));

  // A YES may be answering a time we offered OUTSIDE the customer's availability.
  // That question is asked the moment the time is placed, which can be weeks before
  // the service date, so those bookings are candidates however far out they are —
  // otherwise a YES could not be matched to the booking it is answering.
  if (i.kind === 'customer_confirmed') {
    const awaiting = await awaitingOverrideBookings(admin, ids);
    for (const b of awaiting) {
      if (RESOLVED.includes(String(b.status))) continue;
      if (!candidates.some(c => c.id === b.id)) candidates.push(b);
    }
  }

  if (candidates.length === 0) return storeUnmatched(admin, i, 'No booking today or tomorrow for this number');
  if (candidates.length > 1) {
    // Prefer the booking this reply is actually answering: the one we sent an arrival time for.
    const sent = asList(await admin.entities.MessageOutbox.filter(
      { booking_request_id: { $in: candidates.map(b => b.id) }, template_key: 'arrival_time' }, 'created_date', 50,
    ));
    const answered = new Set(sent.map(o => o.booking_request_id));
    const narrowed = candidates.filter(b => answered.has(b.id));
    if (narrowed.length !== 1) return storeUnmatched(admin, i, 'More than one booking could match this reply');
    candidates = narrowed;
  }

  const booking = candidates[0];
  await admin.entities.BookingReplyFlag.create({
    booking_request_id: booking.id,
    client_id: booking.client_id || i.primaryClientId || undefined,
    kind: i.kind,
    reply_text: i.body,
    service_date: booking.requested_date,
    provider_message_id: i.sid,
    status: 'open',
  });
  return { outcome: i.kind as 'customer_confirmed' | 'needs_attention', bookingId: booking.id };
}