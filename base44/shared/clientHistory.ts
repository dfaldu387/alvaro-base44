/**
 * Per-client booking history: no-shows, cancellations, late cancellations and
 * completed bookings. One owner of these counts, used by the client profile, the
 * review queue and anything else (deposit rules included) that needs them.
 *
 * No-shows come from NoShowRecord (one per booking, so a retry never counts
 * twice). Cancellations are bookings an admin declined with the reason
 * "Customer cancelled". A cancellation is late when it was made less than
 * `lateHours` before the appointment. A booking cancelled before any time was
 * assigned is not late: no time had been committed to the customer.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export interface ClientHistory {
  no_shows: number;
  cancellations: number;
  late_cancellations: number;
  completed: number;
  late_cancel_hours: number;
}

const TZ = 'Australia/Sydney';

/** Minutes on a "Sydney wall clock" timeline for an instant. */
function sydneyMinutes(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(instant));
  const g = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute')) / 60000;
}

/** "10:30am" on "2026-10-16" as minutes on the same Sydney wall-clock timeline, or null. */
function appointmentMinutes(ymd: unknown, time: unknown): number | null {
  const d = String(ymd || '').split('-').map(Number);
  const m = String(time || '').trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (d.length !== 3 || !d[0] || !m) return null;
  let h = Number(m[1]) % 12;
  if (m[3] === 'pm') h += 12;
  return Date.UTC(d[0], d[1] - 1, d[2], h, Number(m[2] || 0)) / 60000;
}

export function isLateCancellation(booking: any, lateHours: number): boolean {
  if (!(lateHours > 0) || !booking.declined_at) return false;
  const appt = appointmentMinutes(booking.requested_date, booking.assigned_time);
  if (appt === null) return false;
  return appt - sydneyMinutes(Date.parse(booking.declined_at)) < lateHours * 60;
}

export async function getClientHistory(admin: any, clientId: string, lateHours: number): Promise<ClientHistory> {
  const [noShows, completed, cancelled] = await Promise.all([
    admin.entities.NoShowRecord.filter({ client_id: clientId }, '-created_date', 200).then(asList),
    admin.entities.BookingRequest.filter({ client_id: clientId, status: 'completed' }, '-created_date', 200).then(asList),
    admin.entities.BookingRequest.filter({ client_id: clientId, decline_reason: 'Customer cancelled' }, '-created_date', 200).then(asList),
  ]);
  return {
    no_shows: noShows.length,
    cancellations: cancelled.length,
    late_cancellations: cancelled.filter((b: any) => isLateCancellation(b, lateHours)).length,
    completed: completed.length,
    late_cancel_hours: lateHours,
  };
}