// Bulk-deletion primitives + protected-history rules shared by the admin client
// delete (deleteClients) and the test-data cleanup (deleteTestData), so both
// paths follow exactly the same safety rules and neither duplicates the
// chunked-delete logic.

export const PAGE = 1000;
export const CHUNK = 100;

export function uniqueIds(records: any[]): string[] {
  return [...new Set((records || []).filter(Boolean).map((r) => r.id).filter(Boolean))];
}

export async function deleteByIds(entity: any, ids: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    if (slice.length === 0) continue;
    await entity.deleteMany({ id: { $in: slice } });
    deleted += slice.length;
  }
  return deleted;
}

// Operational history: an appointment that was actually placed or delivered.
// Drafts and cancellations are not history and can be removed with the client.
const PROTECTED_APPOINTMENT_STATUSES = ['scheduled', 'completed', 'rescheduled'];

// A booking that was committed to the customer (the calendar's source of truth).
const PROTECTED_BOOKING_STATUSES = ['confirmed', 'completed'];

export function isProtectedAppointment(appointment: any): boolean {
  return PROTECTED_APPOINTMENT_STATUSES.includes(appointment?.appointment_status);
}

export function isProtectedBooking(booking: any): boolean {
  return PROTECTED_BOOKING_STATUSES.includes(booking?.status);
}