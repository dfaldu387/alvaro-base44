/**
 * Recording one step on a day's finalised route — the part every screen that runs a
 * route shares:
 *   - find the day's route record that holds this stop and may be run
 *   - move the stop through the state machine (routeStopStates.ts, never re-implemented)
 *   - store the new stop_execution on that record, clean up after the step and audit it
 *
 * Shared by:
 *   - advanceRouteStop   the Route tab's own step buttons (on the way, arrive, start, complete, skip)
 *   - routeCheckout      the Execution flow, where one Checkout tap arrives, does the cut and finishes
 */

import { CUSTOMER_LABEL, transition, type StopAction, type StopState } from './routeStopStates.ts';
import { afterStepCleanup } from './liveLocation.ts';

export const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/** Two record versions are the same moment. Falls back to plain equality when either is not a time. */
export const sameStamp = (a: unknown, b: unknown) => {
  const x = Date.parse(String(a || '')); const y = Date.parse(String(b || ''));
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : String(a) === String(b);
};

export interface RouteFailure {
  ok: false;
  status: number;
  code: string;
  message: string;
  extra?: Record<string, unknown>;
}

const no = (status: number, code: string, message: string, extra?: Record<string, unknown>): RouteFailure =>
  ({ ok: false, status, code, message, ...(extra ? { extra } : {}) });

/**
 * The day's route record that holds this stop and can be run. A route finalised for one
 * Friday is never run on another, and a draft day cannot be run at all.
 */
export async function findRunnableRoute(
  admin: any,
  booking: any,
  bookingId: string,
  expectedUpdatedDate?: unknown,
): Promise<{ ok: true; record: any } | RouteFailure> {
  const records = asList(await admin.entities.DayRoute.filter({ date: booking.requested_date }, '-created_date', 50));
  const record = records.find((r: any) => (r.stops || []).some((s: any) => s.booking_request_id === bookingId));
  if (!record || !['finalised', 'needs_update'].includes(String(record.route_status))) {
    return no(409, 'ROUTE_NOT_FINALISED', "Finalise this day's route on the Calendar before running it.");
  }
  if (expectedUpdatedDate && !sameStamp(record.updated_date, expectedUpdatedDate)) {
    return no(409, 'SCHEDULE_CHANGED', 'This route was just changed on another screen or device. It has been reloaded, so check it and try again.', { current_updated_date: record.updated_date });
  }
  return { ok: true, record };
}

/** Where a stop ends up after `steps`, according to the state machine. Changes nothing. */
export function planStopStep(
  record: any,
  bookingId: string,
  steps: StopAction[],
  reason?: unknown,
): { ok: true; prev: any; state: StopState; already: boolean } | RouteFailure {
  const exec: any[] = Array.isArray(record?.stop_execution) ? record.stop_execution : [];
  const prev = exec.find((e) => e.booking_request_id === bookingId) || { booking_request_id: bookingId, state: 'planned' };
  let state = (prev.state || 'planned') as StopState;
  let already = true;
  for (const step of steps) {
    const t = transition(state, step, reason);
    if (!t.ok) return no(t.status, t.code, t.message);
    if (!t.already) { state = t.state; already = false; }
  }
  return { ok: true, prev, state, already };
}

export interface WriteStepArgs {
  record: any;
  booking: any;
  bookingId: string;
  prev: any;
  state: StopState;
  action: string;
  actor: string;
  reason?: string;
  summary: string;
  detail?: string;
}

/**
 * Stores one step on the route record, then cleans up after it and audits it.
 * The cleanup never runs before the write, and an audit failure never undoes the step.
 */
export async function writeStopStep(admin: any, args: WriteStepArgs): Promise<{ updatedDate: string; stop: any }> {
  const { record, booking, prev, action } = args;
  const now = new Date().toISOString();
  const exec: any[] = Array.isArray(record.stop_execution) ? record.stop_execution : [];

  const stop: Record<string, any> = {
    ...prev, state: args.state,
    customer_state: CUSTOMER_LABEL[args.state] || prev.customer_state || 'Confirmed',
    updated_by: args.actor,
  };
  if (action === 'on_the_way') stop.on_the_way_at = now;
  if (action === 'arrive') stop.arrived_at = now;
  if (action === 'start') stop.started_at = now;
  if (action === 'complete') {
    stop.arrived_at = prev.arrived_at || now;
    stop.started_at = prev.started_at || now;
    stop.completed_at = now;
    const began = Date.parse(String(prev.started_at || ''));
    stop.actual_duration_minutes = Number.isFinite(began) ? Math.max(0, Math.round((Date.parse(now) - began) / 60000)) : 0;
  }
  if (action === 'skip') stop.skip_reason = args.reason;

  const patch: Record<string, any> = {
    stop_execution: exec.some((e) => e.booking_request_id === args.bookingId)
      ? exec.map((e) => (e.booking_request_id === args.bookingId ? stop : e))
      : [...exec, stop],
  };
  if (action === 'skip') {
    // A skip never silently re-plans the day: it marks the route as needing an update.
    // The fingerprint gets a marker so the day no longer matches the stored route.
    const marker = `skipped:${args.bookingId}`;
    const fp = String(record.fingerprint || '');
    patch.route_status = 'needs_update';
    patch.needs_update_at = now;
    patch.needs_update_reason = `A stop was skipped: ${args.reason}`;
    if (!fp.includes(marker)) patch.fingerprint = fp ? `${fp}|${marker}` : marker;
  }

  const saved = await admin.entities.DayRoute.update(record.id, patch);
  const updatedDate = saved?.updated_date || (await admin.entities.DayRoute.get(record.id))?.updated_date || record.updated_date;

  // Arriving ends transit, so the barber's one stored position is forgotten; when the
  // last stop is completed or skipped the live-location switch goes off for the day.
  await afterStepCleanup(admin, {
    memberId: String(record.team_member_id || booking.team_member_id || ''), action,
    stops: record.stops || [], execution: patch.stop_execution, who: args.actor,
  });

  try {
    await admin.entities.ActivityLog.create({
      action: `route_stop_${action}`,
      actor: 'barber',
      summary: args.summary,
      detail: (args.detail || '').slice(0, 400),
      related_record_id: args.bookingId,
      related_record_type: 'BookingRequest',
      client_id: booking.client_id || undefined,
      schedule_date: booking.requested_date,
      previous_value: prev.state || 'planned',
      new_value: args.state,
      timestamp: now,
    });
  } catch { /* an audit failure must never undo the step */ }

  return { updatedDate, stop };
}