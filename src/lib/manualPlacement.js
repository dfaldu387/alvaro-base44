import { base44 } from '@/api/base44Client';

/**
 * Manual placement — the Calendar never writes an appointment time directly.
 *
 * Every manual move, manual booking creation, "add to calendar", Requests-page
 * time edit, Auto Sort move and "remove from calendar" ends here, so the backend
 * re-validates the placement against the shared Category 1 engine immediately
 * before saving and is the only thing that decides validity.
 *
 * An override is only ever sent for an explicit admin "Schedule Anyway"; the
 * backend refuses an override from anyone who is not an administrator.
 *
 * The backend answers a refusal with a 4xx body (schedule changed, override not
 * permitted, no permission). The SDK throws for those, so they are turned back
 * into the backend's own response body — callers always get `{ saved: false, … }`.
 */
async function invokeBackend(payload) {
  try {
    const res = await base44.functions.invoke('applyManualPlacement', payload);
    return res?.data || null;
  } catch (e) {
    const body = e?.response?.data;
    if (body && typeof body === 'object') return { saved: false, ...body };
    return { saved: false, error: e?.message || 'The schedule could not be saved.' };
  }
}

export async function applyManualPlacement({
  requestId, startDecimal, date, day, barberId, expectedUpdatedDate,
  override = false, overrideTravel = false, overrideReason = null, note = null, confirmRequest = false,
}) {
  if (!requestId) return null;
  return invokeBackend({
    booking_request_id: requestId,
    proposed_start_time: startDecimal,
    date: date || undefined,
    day: day || undefined,
    barber_id: barberId || null,
    expected_updated_date: expectedUpdatedDate || null,
    override: override === true,
    override_travel: overrideTravel === true,
    override_reason: overrideReason || null,
    note: note || null,
    confirm_request: confirmRequest === true,
  });
}

/** Removes a booking from the calendar (returned to requests) through the backend. */
export async function unscheduleBooking({ requestId, resetStatus = false }) {
  if (!requestId) return null;
  return invokeBackend({
    booking_request_id: requestId,
    action: 'unschedule',
    reset_status: resetStatus === true,
  });
}