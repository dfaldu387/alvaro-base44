import { enqueueOutboxMessage } from './outboxEnqueue.ts';
import { normaliseAuPhone } from './auPhone.ts';
import { friendlyDate, firstName } from './bookingMessages.ts';
import { parseTimeStr, decimalToLabel } from './provisionalPlacement.ts';
import { bookingEditNotice } from './bookingEditNotice.ts';

/**
 * Customer messages for booking lifecycle events: a confirmed booking moved,
 * a booking cancelled/declined, a no-show. Called ONLY from the server-side
 * function that performs the state change. Everything is enqueued on the
 * MessageOutbox; the sweep applies test-data, opt-out and quiet-hours rules.
 * Nothing here talks to a provider, and nothing throws into the caller.
 */

const RESOLVED = ['declined', 'cancelled', 'completed', 'no_show', 'could_not_fit', 'blocked'];
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/** "2026-10-16" + "4:30pm" -> "2026-10-16T16:30". Null when either part is unusable. */
export function normaliseStart(date: unknown, time: unknown): string | null {
  const d = String(date || '').trim();
  const dec = parseTimeStr(String(time || ''));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(dec)) return null;
  const mins = Math.round(dec * 60);
  return `${d}T${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/**
 * Only a booking whose time has been CONFIRMED with the customer
 * (schedule_status = confirmed) generates a change message. Provisional and
 * locked appointments being moved during planning are internal.
 */
export function confirmedMoveStarts(
  before: any, newDate: unknown, newTime: unknown,
): { from: string; to: string } | null {
  if (!before || before.schedule_status !== 'confirmed' || RESOLVED.includes(String(before.status))) return null;
  const from = normaliseStart(before.requested_date, before.assigned_time);
  const to = normaliseStart(newDate, newTime);
  if (!from || !to || from === to) return null;
  return { from, to };
}

/** The window quoted to the customer: their own window, unless the new time sits outside it. */
export function windowFor(b: any, newTime: unknown): string {
  const own = String(b.availability_window || '').trim();
  if (own && own.toLowerCase() !== 'flexible' && b.availability_override !== true) return own;
  const start = parseTimeStr(String(newTime || ''));
  return Number.isFinite(start) ? `${decimalToLabel(start)} and ${decimalToLabel(start + 2)}`.replace(' and ', '–') : '';
}

async function enqueue(admin: any, booking: any, template: string, key: string, payload: Record<string, string>) {
  try {
    const to = normaliseAuPhone(booking?.phone) || String(booking?.phone || '').trim();
    if (!to) return { queued: false, reason: 'no phone number on the booking' };
    const r = await enqueueOutboxMessage(admin, {
      channel: 'sms', to_address: to, template_key: template, payload,
      booking_request_id: booking.id, idempotency_key: key,
    });
    return r.ok ? { queued: true, created: r.created } : { queued: false, reason: r.error };
  } catch (e) {
    console.error('lifecycle enqueue failed', template, (e as Error)?.message);
    return { queued: false, reason: 'could not enqueue' };
  }
}

/** A confirmed booking moved to a new date/time. Key: sms|<id>|booking_changed|<normalised new start>. */
export async function enqueueBookingChanged(admin: any, before: any, newDate: string, newTime: string) {
  const move = confirmedMoveStarts(before, newDate, newTime);
  if (!move) return { queued: false, reason: 'not a confirmed booking move' };
  return enqueue(admin, before, 'booking_changed', `sms|${before.id}|booking_changed|${move.to}`, {
    name: firstName(before.client_name),
    date: friendlyDate(newDate),
    window: windowFor(before, newTime),
  });
}

/**
 * A confirmed booking was edited and the customer would notice (service, price, window or address; see
 * bookingEditNotice). Nothing material changed -> nothing queued. Key: sms|<id>|booking_edited|<hash of the
 * resulting values>, so the same edit twice is one text and a different edit is a new one.
 */
export async function enqueueBookingEdited(admin: any, before: any, after: any) {
  const notice = bookingEditNotice(before, after);
  if (!notice) return { queued: false, reason: 'nothing the customer would notice changed' };
  return enqueue(admin, after, 'booking_edited', `sms|${after.id}|booking_edited|${notice.hash}`, {
    name: firstName(after.client_name),
    date: friendlyDate(after.requested_date),
    change: notice.change,
  });
}

/** Cancelled or declined by an admin. Key: sms|<id>|booking_cancelled. */
export async function enqueueBookingCancelled(admin: any, booking: any) {
  return enqueue(admin, booking, 'booking_cancelled', `sms|${booking.id}|booking_cancelled`, {
    name: firstName(booking.client_name),
    date: friendlyDate(booking.requested_date),
  });
}

/** Follow-up after a no-show. Key: sms|<id>|no_show_followup. */
export async function enqueueNoShowFollowup(admin: any, booking: any) {
  return enqueue(admin, booking, 'no_show_followup', `sms|${booking.id}|no_show_followup`, {
    name: firstName(booking.client_name),
  });
}

/**
 * Records a no-show once per booking and keeps the client's count equal to the
 * number of NoShowRecords. Every step is safe to repeat: a retry finds the record
 * and recomputes the same number, so the count never goes up twice.
 */
export async function recordNoShow(admin: any, booking: any, actorName: string) {
  let records = asList(await admin.entities.NoShowRecord.filter({ booking_request_id: booking.id }, 'created_date', 5));
  let created = false;
  if (records.length === 0) {
    const mine = await admin.entities.NoShowRecord.create({
      booking_request_id: booking.id,
      client_id: booking.client_id || undefined,
      service_date: booking.requested_date || undefined,
      recorded_by: actorName,
      recorded_at: new Date().toISOString(),
      is_test: booking.is_test === true,
    });
    // Two simultaneous calls: the oldest record survives, the other removes its own.
    records = asList(await admin.entities.NoShowRecord.filter({ booking_request_id: booking.id }, 'created_date', 5));
    const survivor = [...records].sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)) || String(a.id).localeCompare(String(b.id)))[0];
    if (survivor && survivor.id !== mine.id) {
      try { await admin.entities.NoShowRecord.delete(mine.id); } catch { /* survivor stays the only count */ }
    } else {
      created = true;
    }
  }

  let noShowCount: number | null = null;
  if (booking.client_id) {
    noShowCount = Number(await admin.entities.NoShowRecord.count({ client_id: booking.client_id })) || 0;
    await admin.entities.ReminderClient.update(booking.client_id, {
      no_show_count: noShowCount,
      ...(booking.requested_date ? { last_no_show_date: booking.requested_date } : {}),
    });
  }
  return { created, no_show_count: noShowCount };
}