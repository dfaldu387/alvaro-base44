import { parseStartTime } from './schedulingValidator.ts';

/**
 * Double-booking detection for the server.
 *
 * The front end draws the same conclusion from the appointments it has loaded
 * (src/lib/scheduleConflicts.js); this copy exists so a confirmation can never be
 * saved for a time the barber physically cannot serve, whatever the client sends.
 *
 * The rule: two appointments on the same date, for the same barber, whose SERVICE
 * time overlaps. Pack-down buffers are not part of it — a buffer may run past the
 * next client's start, a haircut may not.
 */
const NOT_OCCUPYING = ['cancelled', 'no_show', 'declined', 'could_not_fit'];

export function serviceSpan(booking: any): { start: number; end: number } | null {
  const start = parseStartTime(booking?.assigned_time);
  const mins = Number(booking?.duration_mins);
  if (!isFinite(start) || !isFinite(mins) || mins <= 0) return null;
  return { start, end: start + mins / 60 };
}

/** Every booking on the same day and barber this one clashes with, soonest first. */
export async function findServiceOverlaps(admin: any, booking: any): Promise<any[]> {
  const date = booking?.requested_date;
  const span = serviceSpan(booking);
  if (!date || !span) return [];

  let rows: any[] = [];
  try {
    rows = await admin.entities.BookingRequest.filter({ requested_date: date }, '-created_date', 500);
  } catch {
    return [];
  }
  const list = Array.isArray(rows) ? rows : rows?.items || [];

  const hits: any[] = [];
  for (const other of list) {
    if (!other || other.id === booking.id) continue;
    if (other.protection_hold === true) continue;
    if (NOT_OCCUPYING.includes(other.status)) continue;
    // Blocked time and imported busy time are the barber's own day, not a second client.
    if (other.block_source === 'google_calendar') continue;
    if (String(other.client_name || '').startsWith('[BLOCK]')) continue;
    if ((other.team_member_id || null) !== (booking.team_member_id || null)) continue;
    const otherSpan = serviceSpan(other);
    if (!otherSpan) continue;
    if (span.start < otherSpan.end && span.end > otherSpan.start) {
      hits.push({
        id: other.id,
        client_name: other.client_name,
        assigned_time: other.assigned_time,
        duration_mins: other.duration_mins,
      });
    }
  }
  return hits.sort((a, b) => (parseStartTime(a.assigned_time) || 0) - (parseStartTime(b.assigned_time) || 0));
}

/** One plain sentence naming the clash, or null when the time is clear. */
export async function overlapRefusal(admin: any, booking: any): Promise<string | null> {
  const hits = await findServiceOverlaps(admin, booking);
  if (!hits.length) return null;
  const first = hits[0];
  return `That time overlaps ${first.client_name || 'another appointment'} at ${first.assigned_time}. Move one of them before confirming.`;
}