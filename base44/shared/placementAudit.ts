/**
 * Placement audit trail — ONE place that writes scheduling decisions.
 *
 * Every surface that can place, refuse or move an appointment records what it
 * decided and under whose authority: the manual calendar, the admin validation
 * panel, Route Flow auto-placement and reshuffle apply.
 *
 * Deliberately minimal: the decision, the engine codes, the authority and the
 * timestamp. Client names, addresses, phone numbers and coordinates are never
 * copied into the log — the booking request id is the link back.
 *
 * Never throws: an audit failure must not change a scheduling decision that has
 * already been taken, so failures are swallowed (the caller's outcome stands).
 */

/**
 * Generic, name-free wording for a refused placement. The full message (which
 * names the appointment it collided with) is returned to the admin's screen;
 * only this summary is written to the log, so the audit trail never accumulates
 * client names or other people's booking details.
 */
const VIOLATION_SUMMARY: Record<string, string> = {
  MISSING_REQUIRED_DATA: 'Scheduling information incomplete',
  INVALID_SERVICE_DURATION: 'Service duration not usable',
  OUTSIDE_CUSTOMER_AVAILABILITY: 'Outside the customer availability window',
  OUTSIDE_WORKING_HOURS: 'Outside working hours',
  BOOKING_LEAD_TIME: 'Inside the booking lead time',
  BOOKING_TOO_SOON: 'Inside the booking notice period',
  BOOKING_TOO_FAR_AHEAD: 'Beyond the booking horizon',
  APPOINTMENT_OVERLAP: 'Would overlap another appointment',
  PROTECTED_APPOINTMENT: 'Would overlap a locked or confirmed appointment',
  BREAK_CONFLICT: 'Would overlap blocked time',
  INSUFFICIENT_TRAVEL: 'Not enough travel time',
  TRAVEL_UNVERIFIED: 'Travel time could not be verified',
  COVERAGE_RESTRICTION: 'Outside service coverage',
};

/** Name-free explanation of why a placement was refused (never a client's details). */
export function redactViolationDetail(violations: any[]): string | null {
  const parts = (violations || [])
    .map(v => VIOLATION_SUMMARY[v?.code] || v?.code || '')
    .filter(Boolean);
  const unique = Array.from(new Set(parts));
  return unique.join('; ').slice(0, 300) || null;
}

export type PlacementOutcome =
  | 'saved'
  | 'override_saved'
  | 'validated'
  | 'rejected'
  | 'skipped'
  | 'no_valid_slot';

export type PlacementTrigger =
  | 'manual_calendar'
  | 'admin_panel'
  | 'automation'
  | 'reshuffle_apply';

export interface PlacementDecision {
  booking_request_id: string;
  booking_date?: string | null;
  barber_id?: string | null;
  barber_name?: string | null;
  proposed_time?: string | null;
  /** The time this decision replaced, so history shows before as well as after. */
  previous_time?: string | null;
  proposed_start_decimal?: number | null;
  /**
   * Structured event behind the decision, so the Route Flow Activity view can
   * group it without reading prose. One of: auto_placement, unscheduled,
   * skipped, fit, reshuffle, reshuffle_applied, manual, override.
   */
  event_type?: string | null;
  /** Non-sensitive expanded detail (counts, day metrics, codes) for the UI. */
  details_json?: Record<string, any> | null;
  outcome: PlacementOutcome;
  valid: boolean;
  codes?: string[];
  override_used?: boolean;
  override_reason?: string | null;
  trigger: PlacementTrigger;
  source: 'manual' | 'route_flow';
  actor_name?: string | null;
  actor_role: 'admin' | 'staff' | 'automation';
  detail?: string | null;
}

/** Persist one scheduling decision. Service-role client required. */
export async function recordPlacementDecision(admin: any, entry: PlacementDecision): Promise<void> {
  try {
    await admin.entities.PlacementValidationLog.create({
      booking_request_id: entry.booking_request_id,
      booking_date: entry.booking_date || null,
      barber_id: entry.barber_id || null,
      barber_name: entry.barber_name || null,
      proposed_time: entry.proposed_time || null,
      previous_time: entry.previous_time || null,
      proposed_start_decimal: entry.proposed_start_decimal ?? null,
      event_type: entry.event_type || null,
      details_json: entry.details_json || null,
      outcome: entry.outcome,
      valid: entry.valid === true,
      codes: Array.isArray(entry.codes) ? entry.codes.filter(Boolean) : [],
      override_used: entry.override_used === true,
      override_reason: entry.override_reason || null,
      trigger: entry.trigger,
      source: entry.source,
      actor_name: entry.actor_name || null,
      actor_role: entry.actor_role,
      detail: entry.detail || null,
      decided_at: new Date().toISOString(),
    });
  } catch {
    /* auditing is best-effort — never block or alter a scheduling decision */
  }
}