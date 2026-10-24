import { base44 } from '@/api/base44Client';

/**
 * Stop progress for a day, read from the server (DayRoute.stop_execution), so a
 * refresh or a second device shows exactly the same thing. Returns
 * { [bookingRequestId]: { state, customer_state, ..., updatedDate } }.
 */
export async function loadRouteStops(date) {
  const res = await base44.entities.DayRoute.filter({ date }, '-created_date', 20);
  const rows = Array.isArray(res) ? res : (res?.items || []);
  const map = {};
  for (const rec of rows) {
    const execution = Object.fromEntries((rec.stop_execution || []).map((e) => [e.booking_request_id, e]));
    for (const stop of rec.stops || []) {
      const e = execution[stop.booking_request_id] || {};
      map[stop.booking_request_id] = { state: 'planned', customer_state: 'Confirmed', ...e, updatedDate: rec.updated_date };
    }
  }
  return map;
}

/** One step on a stop. Never throws: returns { ok, data } or { ok:false, code, message }. */
export async function advanceStop({ requestId, action, expectedUpdatedDate, reason }) {
  try {
    const res = await base44.functions.invoke('advanceRouteStop', {
      booking_request_id: requestId, action, expected_updated_date: expectedUpdatedDate, reason,
    });
    return { ok: true, data: res.data };
  } catch (e) {
    const d = e?.response?.data || {};
    return { ok: false, code: d.code, message: d.message || d.error || e?.message || 'Could not save that step.' };
  }
}

/** The next big button for a stop in this state. */
export function nextStep(state) {
  if (state === 'arrived') return { action: 'start', label: 'Start Haircut' };
  if (state === 'in_service') return { action: 'complete', label: 'Complete Haircut' };
  return { action: 'arrive', label: 'Arrived' };
}