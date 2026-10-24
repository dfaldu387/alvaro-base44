import { base44 } from '@/api/base44Client';

/**
 * Admin actions on an unresolved booking request.
 *
 * Every call goes through a backend endpoint, so the record is only ever changed
 * by the server that owns the rules:
 *   updateBookingRequest  — edit, recalculate, then Route Flow re-runs
 *   declineBookingRequest — decline with a reason, keeping the request in history
 *   suggestPlacementSlots — read-only: the valid times Route Flow would accept
 *
 * The endpoints answer a refusal with a 4xx body (validation refused, coverage,
 * permission). The SDK throws for those, so they are turned back into the
 * backend's own response body — callers always get `{ saved: false, … }`.
 */
async function invoke(name, payload) {
  try {
    const res = await base44.functions.invoke(name, payload);
    return res?.data || null;
  } catch (e) {
    const body = e?.response?.data;
    if (body && typeof body === 'object') return { saved: false, ...body };
    return { saved: false, error: e?.message || 'That change could not be saved.' };
  }
}

/** Correct a request's availability, services, address, contact details or notes. */
export async function updateBookingRequest(payload) {
  return invoke('updateBookingRequest', payload);
}

/** Decline a request. It stays in history with its reason and audit trail. */
export async function declineBookingRequest(payload) {
  return invoke('declineBookingRequest', payload);
}

/**
 * Complete, set status, lock/unlock or confirm/clear an override. The only way the browser changes these:
 * actions: complete | set_status {status} | lock | unlock | confirm_override | clear_override.
 */
export async function bookingTransition(action, bookingRequestId, extra = {}) {
  return invoke('bookingTransition', { action, booking_request_id: bookingRequestId, ...extra });
}

/** The valid times for a request — the same slots Route Flow would choose from. */
export async function suggestPlacementSlots(payload) {
  return invoke('suggestPlacementSlots', payload);
}

/** The decline reasons offered to the admin. */
export const DECLINE_REASONS = [
  'No availability',
  'Outside service area',
  'Customer cancelled',
  'Duplicate request',
  'Unable to accommodate',
  'Other',
];