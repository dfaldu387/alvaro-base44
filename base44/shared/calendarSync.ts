/**
 * Google Calendar sync for finalised routes.
 *
 * ONE place that writes a finalised day's appointment blocks into the Google
 * Calendar of the barber who finalised it. It is a one-way copy OUT of the app:
 * nothing here reads the calendar back, and nothing here can change a booking, a
 * route or a message.
 *
 * Rules built in, so callers cannot get them wrong:
 *  - One block per appointment per person. Every written event is remembered in a
 *    CalendarSync row keyed by appointment and app user, so re-finalising a day
 *    updates its blocks instead of adding a second copy, and an appointment that
 *    moves to another day keeps its single event.
 *  - Only the FINALISED route of the requested date is read, and only the barber
 *    in scope — a barber can never push another barber's day into their calendar.
 *  - Blocks carry the business timezone, so a block lands on the right wall-clock
 *    time whatever the server's own timezone is.
 *  - A failure is counted, never thrown: the route is already finalised by the
 *    time this runs, and a calendar problem must not undo that.
 */

import { parseTimeStr } from './provisionalPlacement.ts';

export const CALENDAR_TZ = 'Australia/Sydney';
export const PRIMARY_CALENDAR = 'primary';
const API = 'https://www.googleapis.com/calendar/v3';
const pad = (n: number) => String(n).padStart(2, '0');

/** 13.5 → "13:30". */
export function hhmm(dec: number): string {
  const total = Math.round(Number(dec) * 60);
  const wrapped = ((total % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

/** The calendar day after a YYYY-MM-DD label (an after-hours block can run past midnight). */
export function nextDateLabel(date: string): string {
  const [y, m, d] = String(date).split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + 1)).toISOString().slice(0, 10);
}

/** The appointment's start as a decimal hour: the route stop first, then the booking's own time. */
export function startDecimal(stop: any, booking: any): number | null {
  const fromStop = Number(stop?.start_decimal);
  if (isFinite(fromStop)) return fromStop;
  const parsed = parseTimeStr(String(booking?.assigned_time || ''));
  return isFinite(parsed) ? parsed : null;
}

/** The Google Calendar event for one route stop, or null when its time cannot be read. */
export function calendarEventFor({ booking, stop, date }: { booking: any; stop: any; date: string }) {
  if (!booking) return null;
  const start = startDecimal(stop, booking);
  if (start == null) return null;

  const minutes = Number(booking.duration_mins) || 30;
  const endTotal = Math.round((start + minutes / 60) * 60);
  const endDate = endTotal >= 1440 ? nextDateLabel(date) : String(date);
  const services = Array.isArray(booking.services)
    ? booking.services.filter(Boolean).join(', ')
    : String(booking.services || '');
  const name = booking.client_name || 'Appointment';

  const details = [
    services ? `Service: ${services}` : null,
    booking.price != null && booking.price !== '' ? `Price: $${booking.price}` : null,
    Number(booking.people_count) > 1 ? `People: ${booking.people_count}` : null,
    booking.notes ? `Notes: ${booking.notes}` : null,
    booking.phone ? `Phone: ${booking.phone}` : null,
  ].filter(Boolean);

  return {
    summary: services ? `${name} · ${services}` : name,
    location: booking.address || undefined,
    description: details.join('\n') || undefined,
    // Private marker: lets the Google busy-time import recognise events the app wrote,
    // as a second check beside the CalendarSync event id.
    extendedProperties: { private: { cutdeluxe: 'route-block' } },
    start: { dateTime: `${date}T${hhmm(start)}:00`, timeZone: CALENDAR_TZ },
    end: { dateTime: `${endDate}T${hhmm(endTotal / 60)}:00`, timeZone: CALENDAR_TZ },
  };
}

/** One Google Calendar API call with the barber's own token. */
function google(accessToken: string, path: string, method: string, body?: any) {
  return fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const rowsOf = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/**
 * Writes the finalised route's appointment blocks into one barber's calendar.
 * Returns counts plus a plain sentence for the admin to read; never throws.
 */
export async function syncRouteCalendar({ admin, accessToken, appUserId, teamMemberId = null, date }: {
  admin: any;
  accessToken: string;
  appUserId: string;
  teamMemberId?: string | null;
  date: string;
}) {
  const day = String(date);
  const routes = rowsOf(await admin.entities.DayRoute.filter({ date: day, route_status: 'finalised' }))
    .filter((r: any) => !teamMemberId || String(r.team_member_id || '') === String(teamMemberId));

  const stops: any[] = [];
  for (const route of routes) {
    for (const stop of route.stops || []) {
      if (stop?.booking_request_id) stops.push({ stop, route });
    }
  }
  if (!stops.length) {
    return { created: 0, updated: 0, failed: 0, total: 0, message: 'no appointments on this route' };
  }

  const ids = [...new Set(stops.map((s) => String(s.stop.booking_request_id)))];
  const bookings = new Map(rowsOf(await admin.entities.BookingRequest.filter({ id: { $in: ids } })).map((b: any) => [b.id, b]));
  // Matched on appointment alone (not the date), so a moved appointment updates its
  // existing block instead of leaving a stale one on the old day.
  const links = new Map(
    rowsOf(await admin.entities.CalendarSync.filter({ app_user_id: appUserId, booking_request_id: { $in: ids } }))
      .map((l: any) => [l.booking_request_id, l]),
  );

  let created = 0;
  let updated = 0;
  let failed = 0;

  for (const { stop, route } of stops) {
    const bookingId = String(stop.booking_request_id);
    const event = calendarEventFor({ booking: bookings.get(bookingId), stop, date: day });
    if (!event) {
      failed++;
      continue;
    }
    const link = links.get(bookingId);
    const record = {
      booking_request_id: bookingId,
      app_user_id: appUserId,
      team_member_id: route.team_member_id || null,
      service_date: day,
      calendar_id: PRIMARY_CALENDAR,
      synced_at: new Date().toISOString(),
    };
    try {
      if (link?.event_id) {
        const patched = await google(accessToken, `/calendars/${PRIMARY_CALENDAR}/events/${encodeURIComponent(link.event_id)}`, 'PATCH', event);
        if (patched.ok) {
          updated++;
          await admin.entities.CalendarSync.update(link.id, { ...record, event_id: link.event_id });
          continue;
        }
        // 404/410 means the block was deleted in Google: put it back, don't lose it.
        if (patched.status !== 404 && patched.status !== 410) {
          failed++;
          continue;
        }
      }

      const written = await google(accessToken, `/calendars/${PRIMARY_CALENDAR}/events`, 'POST', event);
      if (!written.ok) {
        failed++;
        continue;
      }
      const saved = await written.json();
      created++;
      if (link) await admin.entities.CalendarSync.update(link.id, { ...record, event_id: saved.id });
      else await admin.entities.CalendarSync.create({ ...record, event_id: saved.id });
    } catch (err) {
      console.error('[calendarSync] block write failed', bookingId, (err as Error)?.message);
      failed++;
    }
  }

  const parts: string[] = [];
  if (created) parts.push(`${created} block${created === 1 ? '' : 's'} added`);
  if (updated) parts.push(`${updated} updated`);
  if (failed) parts.push(`${failed} could not be written`);
  return { created, updated, failed, total: stops.length, message: parts.join(' · ') || 'nothing to sync' };
}