import { base44 } from '@/api/base44Client';

// Held public bookings: protection flagged them, they are off the schedule until approved.
export const HELD_QUERY = { protection_hold: true, status: 'pending' };

async function call(name, payload) {
  try {
    const res = await base44.functions.invoke(name, payload);
    return { ok: true, ...(res?.data || {}) };
  } catch (e) {
    return { ok: false, error: e?.response?.data?.error || e?.message || 'That did not work. Please try again.' };
  }
}

// Approving releases the hold. `place: false` only approves — the request stays
// unplaced and ready to be put on the calendar by hand.
export const approveHeld = (bookingId, { place = true } = {}) =>
  call('reviewQueueAction', { action: 'approve', booking_request_id: bookingId, place: place === true });
export const fetchClientHistory = (clientId) => call('clientHistory', { client_id: clientId });