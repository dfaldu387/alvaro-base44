import { base44 } from '@/api/base44Client';

/**
 * Category 1 placement validation — the calendar asks the backend; it never
 * decides validity itself. This is the same shared engine Route Flow uses
 * (validateBookingPlacement → shared/schedulingValidator).
 *
 * The returned result is only valid for the schedule as it stood when
 * evaluated, so a placement must be validated immediately before it is written.
 */
export async function validatePlacement({ requestId, startDecimal, date, barberId, options }) {
  if (!requestId) return null;
  const res = await base44.functions.invoke('validateBookingPlacementV2', {
    booking_request_id: requestId,
    proposed_start_time: startDecimal,
    date,
    barber_id: barberId || null,
    options: options || {},
  });
  return res?.data || null;
}

/** Human-readable explanation for a rejected placement. */
export function placementErrorMessage(result) {
  if (!result) return 'This placement could not be verified.';
  const first = (result.violations || [])[0];
  return first?.message || 'This placement is not valid.';
}

/**
 * Why a placement was refused, explained.
 *
 * The customer's availability is a SOFT rule: when it is the only thing in the way,
 * the barber is offered the override instead of a refusal. So when explaining a
 * refusal, a hard violation is always the reason worth showing — it is the one that
 * cannot be scheduled at all.
 */
export function refusalMessage(result) {
  if (!result) return 'This placement could not be verified.';
  const list = result.violations || [];
  const hard = list.find(v => v.code !== 'OUTSIDE_CUSTOMER_AVAILABILITY') || list[0];
  if (!hard) return 'This placement is not valid.';
  return hard.message || VIOLATION_CODES[hard.code] || 'This placement is not valid.';
}

/**
 * The reason to show when a placement was refused.
 *
 * The customer's availability is a preference, not a lock, so it is never the
 * reason a drop is refused — a hard conflict is. Falls back to the backend's own
 * sentence about the violation that actually stopped it.
 */
export function placementRefusalMessage(data) {
  return refusalMessage(data?.result) || data?.message || data?.error || null;
}

export const VIOLATION_CODES = {
  OUTSIDE_CUSTOMER_AVAILABILITY: 'Outside customer availability',
  OUTSIDE_WORKING_HOURS: 'Outside working hours',
  BOOKING_TOO_SOON: 'Inside the minimum notice period',
  BOOKING_TOO_FAR_AHEAD: 'Beyond the booking horizon',
  BOOKING_LEAD_TIME: 'Booking lead time',
  APPOINTMENT_OVERLAP: 'Appointment overlap',
  PROTECTED_APPOINTMENT: 'Protected appointment',
  INSUFFICIENT_TRAVEL: 'Insufficient travel time',
  TRAVEL_UNVERIFIED: 'Travel could not be verified',
  BREAK_CONFLICT: 'Break / blocked time conflict',
  COVERAGE_RESTRICTION: 'Service coverage',
  INVALID_SERVICE_DURATION: 'Invalid service duration',
  MISSING_REQUIRED_DATA: 'Missing scheduling information',
};