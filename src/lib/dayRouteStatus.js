import { base44 } from '@/api/base44Client';

/**
 * Day-level route state — the Calendar plans, the Route tab executes.
 *
 * One place for the four states, their wording, and the two backend calls that
 * drive them, so the Calendar and the Route tab can never drift apart.
 */

export const ROUTE_STATUS_LABELS = {
  draft: 'Draft Schedule',
  finalising: 'Finalising route…',
  finalised: 'Route Finalised',
  needs_update: 'Route needs updating',
};

export const ROUTE_CHANGED_REASON = 'The day changed after the route was finalised';

/** "45m", "1h 20m" — compact minutes for the route bars. */
export function fmtRouteMins(mins) {
  const m = Math.round(Number(mins) || 0);
  if (m <= 0) return '0m';
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${m}m`;
  if (!rest) return `${h}h`;
  return `${h}h ${rest}m`;
}

/** "4 stops · 38m driving · 10m idle" */
export function routeMetricsLine(state) {
  if (!state) return '';
  const parts = [`${state.appointments || 0} stop${state.appointments === 1 ? '' : 's'}`];
  parts.push(`${fmtRouteMins(state.drive_minutes)} driving`);
  parts.push(`${fmtRouteMins(state.idle_minutes)} idle`);
  if (state.drive_legs_created) parts.push(`${state.drive_legs_created} drive leg${state.drive_legs_created === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * The day's route state, as the backend sees it. Comparing the returned status
 * with the day as it stands is the backend's job — this only asks.
 */
export async function loadDayRouteState(date, teamMemberId) {
  try {
    const res = await base44.functions.invoke('getDayRouteState', {
      date,
      team_member_id: teamMemberId || undefined,
    });
    return res?.data || null;
  } catch {
    return null;
  }
}

/**
 * Connect (or reconnect) the day in the barber's current order. The Calendar
 * calls this to save directly, then reloads the stored times and legs for review.
 * `dryRun` remains available for callers needing an estimate without a write.
 *
 * The real press also copies the finalised route's appointment blocks into the
 * signed-in barber's own Google Calendar, and the outcome rides along on the
 * result as `calendar`. A calendar problem never changes the answer: the route is
 * finalised either way.
 */
export async function finishDayRoute({ date, teamMemberId, dryRun = false }) {
  let data = null;
  try {
    const res = await base44.functions.invoke('finaliseRoute', {
      date,
      team_member_id: teamMemberId || undefined,
      dry_run: dryRun,
    });
    data = res?.data || null;
  } catch (error) {
    data = error?.response?.data || { ok: false, message: error?.message || 'The route could not be finalised.' };
  }
  if (data?.ok && !dryRun) data = { ...data, calendar: await syncRouteBlocks({ date, teamMemberId }) };
  return data;
}

/**
 * Copy the finalised route into the signed-in barber's own Google Calendar. The
 * backend decides whose calendar from the signed-in identity, so a barber never
 * writes another barber's day into their own. An unconnected calendar answers with
 * `connected: false` rather than an error.
 */
/**
 * Disconnect the day's route — the reverse of connecting it. The day's drive legs
 * and its route record are removed, so the day reads as a flexible draft again. No
 * appointment is moved, cancelled or unconfirmed, and no message is queued.
 *
 * Refused with a reason once the route is being executed: the day's progress lives
 * on that record.
 */
export async function disconnectDayRoute({ date, teamMemberId }) {
  try {
    const res = await base44.functions.invoke('disconnectDayRoute', {
      date,
      team_member_id: teamMemberId || undefined,
    });
    return res?.data || { ok: false, message: 'The route could not be disconnected.' };
  } catch (error) {
    return error?.response?.data || { ok: false, message: error?.message || 'The route could not be disconnected.' };
  }
}

/**
 * Confirm every appointment of a connected route: each booking's time is fixed, so
 * Route Flow can no longer move it, and the confirmation message is queued through
 * the same idempotent path as a single confirm — a client is never texted twice.
 */
export async function confirmDayAppointments(bookingIds = []) {
  let confirmed = 0;
  let failed = 0;
  let firstError = null;
  for (const id of bookingIds) {
    try {
      const res = await base44.functions.invoke('confirmBooking', { booking_request_id: id, confirm_time: true });
      if (res?.data?.ok) confirmed += 1;
      else {
        failed += 1;
        // The server's own reason (for example an overlap) is the useful one.
        if (!firstError) firstError = res?.data?.error || null;
      }
    } catch (error) {
      failed += 1;
      if (!firstError) firstError = error?.response?.data?.error || error?.message || null;
    }
  }
  return { confirmed, failed, firstError };
}

/**
 * The key a drive leg is stored under: the pair of appointments it joins, exactly
 * as the server writes it (`db-<from>_db-<to>`). The calendar uses it to ask
 * whether two adjacent cards have a connected leg between them.
 */
export function legKey(fromRequestId, toRequestId) {
  return fromRequestId && toRequestId ? `db-${fromRequestId}_db-${toRequestId}` : '';
}

/**
 * The day's stored drive legs, keyed by the pair of appointments they join.
 *
 * Legs are real records: they exist only while the day is connected, so a draft
 * day has none and disconnecting a day removes them. A stale leg is explicitly
 * marked unverified by the gap display, never trusted as a current estimate.
 *
 * Every other leg is drawn in the state it is in: travel that could not be
 * estimated ('unavailable') and travel that does not fit the gap ('conflict') are
 * shown on the calendar rather than dropped, so a route segment never disappears
 * silently.
 */
export async function loadDayDriveLegs(date, endDate = date) {
  try {
    const query = endDate === date ? { date } : { date: { $gte: date, $lte: endDate } };
    const res = await base44.entities.RouteConnection.filter(query, '-created_date', 200);
    const rows = Array.isArray(res) ? res : (res?.items || []);
    const map = {};
    for (const leg of rows) {
      if (!leg.from_appointment_id || !leg.to_appointment_id) continue;
      const known = leg.availability !== 'unavailable' && leg.duration_minutes != null;
      const pair = `${leg.from_appointment_id}_${leg.to_appointment_id}`;
      if (map[pair]) continue; // newest saved leg wins
      map[pair] = {
        mins: known ? Math.max(0, Math.round(Number(leg.duration_minutes) || 0)) : null,
        km: leg.distance_km ?? null,
        state: !known ? 'unavailable' : leg.fits_gap === false ? 'conflict' : 'ok',
        gap: leg.gap_minutes ?? null,
        earliest: leg.earliest_feasible_start || null,
        stale: leg.status === 'stale',
      };
    }
    return map;
  } catch {
    return {};
  }
}

export async function syncRouteBlocks({ date, teamMemberId }) {
  try {
    const res = await base44.functions.invoke('syncRouteToCalendar', {
      date,
      team_member_id: teamMemberId || undefined,
    });
    return res?.data || null;
  } catch (error) {
    return error?.response?.data || { connected: false, message: 'the calendar sync could not run' };
  }
}