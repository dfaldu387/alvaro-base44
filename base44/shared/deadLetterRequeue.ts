import { recordAudit, AUDIT_REFUSED } from './auditLog.ts';

/**
 * Put a dead-lettered outbox item back in the queue. The ONLY way a dead letter
 * returns to the sweep, and it never sends anything itself: it sets the item back to
 * pending, and the same sweep then applies every existing guard (messaging mode,
 * opt-out, consent, quiet hours, test data) before anything leaves.
 *
 * Refuses, and changes nothing, when:
 *  - the item is not dead-lettered;
 *  - its booking was deleted or cancelled/declined, so the message is out of date;
 *  - the recipient check (the sweep's own `recipientBlock`, injected so there is one
 *    consent check, not a copy) says the customer must not be messaged any more.
 * The audit row is written first; if it cannot be, the item is not touched.
 */
export interface RequeueResult { ok: boolean; status: number; code?: string; error?: string }

const asBlockText = (b: string) => ({
  'opted out': 'This customer has opted out of messages.',
  'no messaging consent': 'This customer did not agree to messages when they booked.',
  'test data': 'This is test data, which is never delivered.',
} as Record<string, string>)[b] || `Blocked: ${b}.`;

export async function requeueDeadLetter(
  admin: any, outboxId: string, who: string,
  deps: { recipientBlock: (admin: any, item: any) => Promise<string | null> },
  now: Date = new Date(),
): Promise<RequeueResult> {
  let item: any = null;
  try { item = await admin.entities.MessageOutbox.get(outboxId); } catch { item = null; }
  if (!item) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'That message was not found.' };
  if (item.status !== 'dead_letter') return { ok: false, status: 409, code: 'NOT_DEAD_LETTER', error: 'Only dead-lettered messages can be re-queued.' };

  if (item.booking_request_id) {
    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(item.booking_request_id); } catch { booking = null; }
    if (!booking) return { ok: false, status: 409, code: 'BOOKING_GONE', error: 'The booking this message was about no longer exists, so it was not re-queued.' };
    if (booking.request_outcome === 'Cancelled' || booking.status === 'declined') {
      return { ok: false, status: 409, code: 'BOOKING_CANCELLED', error: 'The booking was cancelled or declined, so the message is out of date and was not re-queued.' };
    }
  }

  const block = await deps.recipientBlock(admin, item);
  if (block) return { ok: false, status: 409, code: 'RECIPIENT_BLOCKED', error: `${asBlockText(block)} It was not re-queued.` };

  const logId = await recordAudit(admin, {
    action: 'outbox_requeued', who, summary: 'A dead-lettered message was put back in the queue',
    counts: { previous_attempts: Number(item.attempt_count) || 0 },
    ids: { outbox_id: item.id, booking_request_id: item.booking_request_id, client_id: item.client_id },
    related: item.booking_request_id ? { type: 'BookingRequest', id: item.booking_request_id } : undefined,
  });
  if (!logId) return { ok: false, status: 500, code: AUDIT_REFUSED.code, error: AUDIT_REFUSED.error };

  const at = now.toISOString();
  await admin.entities.MessageOutbox.update(item.id, {
    status: 'pending',
    attempt_count: 0,
    next_attempt_at: at,
    claimed_at: null,
    claim_token: null,
    last_error: '',
    dead_letter_reason: '',
    deferral_reason: '',
    history: [...(Array.isArray(item.history) ? item.history : []), { at, result: 'requeued', note: `Re-queued by ${who}.` }],
  });
  return { ok: true, status: 200 };
}