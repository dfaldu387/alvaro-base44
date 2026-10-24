/**
 * ONE pre-appointment text per booking and service date: either the exact arrival time (finalised route)
 * or the night-before reminder (anything else). Never both.
 *
 * How it is guaranteed (three layers, all on the existing outbox, none of it in the sender):
 *  1. The reminder is only queued when no live arrival_time row exists and the booking is not on a
 *     currently finalised route. The arrival job refuses to queue when a reminder has already reached
 *     (or may still reach) the customer.
 *  2. An arrival time always wins over a reminder that has not gone out yet: the unsent reminder is
 *     switched to "suppressed" with a plain reason, using a conditional write that only succeeds while
 *     the row is still pending.
 *  3. After EITHER side queues, reconcile() re-reads both rows. If the two writers raced, the loser that
 *     has not gone out is suppressed. Only if both had already gone out in the same instant can nothing be
 *     undone, and the result says so ('both_reached') rather than hiding it.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export const reminderKey = (bookingId: string, date: string) => `sms|${bookingId}|booking_reminder|${date}`;
// The format arrivalTimes.arrivalKey produces (a test keeps the two identical; importing it here would be a cycle).
const arrivalParts = (r: any) => String(r?.idempotency_key || '').split('|');

const DEAD = ['suppressed', 'dead_letter'];
/** May reach, or already has reached, the customer. 'failed' is a retrying item. */
const REACHED = ['sent', 'claimed', 'failed'];
export const isLive = (r: any) => !!r && !DEAD.includes(String(r.status));
export const hasReached = (r: any) => !!r && REACHED.includes(String(r.status));

export async function preAppointmentRows(admin: any, bookingId: string, date: string) {
  const arrivals = asList(await admin.entities.MessageOutbox.filter({ booking_request_id: bookingId, template_key: 'arrival_time' }, 'created_date', 50))
    .filter((r: any) => arrivalParts(r)[3] === date);
  const reminder = asList(await admin.entities.MessageOutbox.filter({ idempotency_key: reminderKey(bookingId, date) }, 'created_date', 5))[0] || null;
  return { arrivals, reminder };
}

/** Switch an unsent row off. True only if it really is suppressed afterwards. */
async function suppressPending(admin: any, row: any, reason: string): Promise<boolean> {
  await admin.entities.MessageOutbox.updateMany({ id: row.id, status: 'pending' }, { $set: { status: 'suppressed', suppressed_reason: reason } });
  const now = await admin.entities.MessageOutbox.get(row.id).catch(() => null);
  return now?.status === 'suppressed';
}

/** Called by the arrival job before it queues the FIRST arrival message for a booking and date. */
export async function reminderBlocksArrival(admin: any, bookingId: string, date: string): Promise<{ blocked: boolean; reason?: string }> {
  const { reminder } = await preAppointmentRows(admin, bookingId, date);
  if (!isLive(reminder)) return { blocked: false };
  const stop = { blocked: true, reason: 'The night-before reminder has already gone out, so a second pre-appointment text is not sent.' };
  if (hasReached(reminder)) return stop;
  return (await suppressPending(admin, reminder, 'Replaced by the exact arrival time')) ? { blocked: false } : stop;
}

export type Reconciled = 'none' | 'reminder_suppressed' | 'arrival_suppressed' | 'both_reached';

/** Re-read both rows after a queue and remove whichever one lost. */
export async function reconcilePreAppointment(admin: any, bookingId: string, date: string): Promise<Reconciled> {
  const { arrivals, reminder } = await preAppointmentRows(admin, bookingId, date);
  const live = arrivals.filter(isLive);
  if (!isLive(reminder) || live.length === 0) return 'none';
  const arrivalOut = live.some(hasReached);
  if (!hasReached(reminder)) {
    return (await suppressPending(admin, reminder, 'Replaced by the exact arrival time')) ? 'reminder_suppressed' : 'both_reached';
  }
  if (arrivalOut) return 'both_reached';
  let all = true;
  for (const a of live) if (!(await suppressPending(admin, a, 'The night-before reminder had already gone out'))) all = false;
  return all ? 'arrival_suppressed' : 'both_reached';
}