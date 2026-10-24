import { base44 } from '@/api/base44Client';

/** The newest reply flags, used to decorate calendar appointments. Never blocks the calendar. */
export function loadReplyFlags() {
  return base44.entities.BookingReplyFlag
    .filter({}, { sort: '-created_date', limit: 500 })
    .then((page) => page.items)
    .catch(() => []);
}

/**
 * Reply state for one booking. needs_attention (an open NO / CANCEL / RESCHEDULE)
 * outranks customer_confirmed, so a booking is never shown as confirmed while a
 * human still has to deal with a cancellation request.
 */
export function replyState(bookingId, flags) {
  const mine = flags.filter((f) => f.booking_request_id === bookingId);
  const attention = mine.find((f) => f.kind === 'needs_attention' && f.status !== 'resolved');
  const confirmed = mine.find((f) => f.kind === 'customer_confirmed');
  return {
    needs_attention: !!attention,
    attention_reply: attention?.reply_text || '',
    customer_confirmed: !attention && !!confirmed,
    customer_confirmed_at: confirmed?.created_date || null,
  };
}