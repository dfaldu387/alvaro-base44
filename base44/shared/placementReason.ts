/**
 * Placement outcome reporting — the one place that decides how an unplaced
 * booking request is described to the admin.
 *
 * Responsibilities:
 *   - turn validator / Route Flow reason codes into a short, human label
 *   - decide whether an unplaced request is simply Unscheduled (Route Flow
 *     finished, no slot fitted) or Needs Review (a human decision is required)
 *   - build the patch written onto the BookingRequest itself, so the state and
 *     reason stay visible in the admin UI without reading the audit trail
 *
 * Nothing here ever exposes a raw internal error — only these labels reach the UI.
 */

export type PlacementStatus = 'processing' | 'placed' | 'unscheduled' | 'needs_review';

/** The single cause behind a blocked placement, keyed by the engine's codes. */
const CODE_CATEGORY: Record<string, string> = {
  APPOINTMENT_OVERLAP: 'overlap',
  PROTECTED_APPOINTMENT: 'overlap',
  BREAK_CONFLICT: 'overlap',
  INSUFFICIENT_TRAVEL: 'travel',
  TRAVEL_UNVERIFIED: 'travel',
  OUTSIDE_WORKING_HOURS: 'hours',
  OUTSIDE_CUSTOMER_AVAILABILITY: 'window',
  BOOKING_TOO_SOON: 'notice',
  BOOKING_TOO_FAR_AHEAD: 'horizon',
  // Legacy code — kept so historical audit rows and stored reasons still render.
  BOOKING_LEAD_TIME: 'notice',
  MISSING_REQUIRED_DATA: 'data',
  COVERAGE_RESTRICTION: 'data',
  INVALID_SERVICE_DURATION: 'data',
};

const CATEGORY_LABELS: Record<string, string> = {
  overlap: 'Availability fully occupied',
  travel: 'Travel time could not fit',
  hours: 'Outside working hours',
  window: 'No slot inside the customer window',
  notice: 'Inside the booking notice period',
  horizon: 'Beyond the booking horizon',
  data: 'Missing scheduling information',
};

/** Codes that need a human decision rather than just another slot. */
const REVIEW_CODES: Record<string, string> = {
  MISSING_REQUIRED_DATA: 'Missing scheduling information',
  COVERAGE_RESTRICTION: 'Coverage requires review',
  TRAVEL_UNVERIFIED: 'Travel time could not be verified',
  INVALID_SERVICE_DURATION: 'Service duration missing',
};

export const NO_VALID_SLOT_REASON = 'No valid slot found inside availability';

/**
 * The concise label for a set of blocking codes.
 *
 * One cause → that cause, named. Several different causes → the honest generic
 * label, so the admin is never told a single reason that isn't the whole story.
 */
export function reasonFromCodes(codes: string[] = []): string {
  const categories = new Set((codes || []).map((c) => CODE_CATEGORY[c]).filter(Boolean));
  if (categories.size === 1) {
    const only = Array.from(categories)[0];
    return CATEGORY_LABELS[only] || NO_VALID_SLOT_REASON;
  }
  return NO_VALID_SLOT_REASON;
}

/**
 * What the request's visible state becomes after an automatic placement attempt
 * that did not put the booking on the calendar.
 */
export function placementOutcomeForCodes(codes: string[] = []): { status: PlacementStatus; reason: string } {
  const review = (codes || []).find((c) => c in REVIEW_CODES);
  if (review) return { status: 'needs_review', reason: REVIEW_CODES[review] };
  return { status: 'unscheduled', reason: reasonFromCodes(codes) };
}

/** The fields written onto the BookingRequest for any placement outcome. */
export function placementPatch(status: PlacementStatus, reason?: string | null): Record<string, unknown> {
  return {
    placement_status: status,
    placement_reason: reason ? String(reason).slice(0, 120) : '',
    placement_checked_at: new Date().toISOString(),
  };
}

/** Labels used when placement cannot even be attempted (Route Flow inactive). */
export const ROUTE_FLOW_OFF_REASON = 'Route Flow is off — needs manual placement';
export const AUTO_PLACE_OFF_REASON = 'Auto-placement is off — needs manual placement';
/** Shown when no placement outcome was ever recorded for an older request. */
export const NOT_PLACED_REASON = 'Not yet placed — needs manual scheduling';