/**
 * Which bookings the public booking page may treat as busy time.
 *
 * Rule (deliberate): a booking blocks a time slot only when it has a calendar DATE,
 * a time, and a status that really holds the slot (confirmed or completed).
 * A booking with no requested_date never blocks anything, whatever its status or
 * time: it belongs to no particular day, and matching it by weekday name would
 * block that weekday on every date.
 */
export const BLOCKING_STATUSES = ['confirmed', 'completed'];

export function blocksTimeSlot(b: any): boolean {
  return !!(b && b.requested_date && b.assigned_time && BLOCKING_STATUSES.includes(b.status));
}

export function busyBookings<T = any>(bookings: T[]): T[] {
  return (bookings || []).filter(blocksTimeSlot);
}