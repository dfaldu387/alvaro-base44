/**
 * Route Flow activity — ONE writer for the ActivityLog entries that describe
 * what Route Flow did on its own, why it did it, and what it deliberately left
 * alone.
 *
 * This is not a second logging system: it writes the same ActivityLog records
 * the Activity view reads, with the structured fields that view needs instead
 * of free text alone. The legacy `action`/`summary`/`detail` fields are still
 * written, so existing readers keep working.
 *
 * Privacy: entries carry booking request ids, times, counts and barber names —
 * never a client's name, address or contact details. Expanded, non-sensitive
 * detail goes in `details_json`; use `movesForDetail` to build it from the
 * engine's change list, which strips client labels.
 *
 * Best-effort: an activity write never blocks or alters a scheduling decision.
 */

export type RouteFlowEventType =
  | 'reshuffle'
  | 'fit'
  | 'reshuffle_applied'
  | 'skipped_threshold'
  | 'schedule_changed'
  | 'suggestion_created'
  /** The admin pressed Finalise Route and the day's route was built. */
  | 'route_finalised'
  /** A finalised day changed, so its route is out of date until rebuilt. */
  | 'route_needs_update';

/** The long-standing action names, still written for older readers. */
const LEGACY_ACTION: Record<RouteFlowEventType, string> = {
  reshuffle: 'route_flow_optimised',
  fit: 'route_flow_fitted_request',
  reshuffle_applied: 'route_flow_reshuffle_applied',
  skipped_threshold: 'route_flow_skipped_threshold',
  schedule_changed: 'route_flow_schedule_changed',
  suggestion_created: 'route_flow_suggestion_created',
  route_finalised: 'route_flow_route_finalised',
  route_needs_update: 'route_flow_route_needs_update',
};

export interface RouteFlowActivityInput {
  event_type: RouteFlowEventType;
  summary: string;
  detail?: string | null;
  /** The calendar date this activity affected. */
  schedule_date?: string | null;
  /** route_flow = automation; admin = a person acted. */
  actor_type?: 'route_flow' | 'admin';
  actor_name?: string | null;
  trigger_type?: string | null;
  outcome?: string | null;
  bookings_evaluated?: number | null;
  appointments_moved?: number | null;
  requests_placed?: number | null;
  requests_unscheduled?: number | null;
  drive_before?: number | null;
  drive_after?: number | null;
  idle_before?: number | null;
  idle_after?: number | null;
  /** Locked or confirmed appointments moved. Always 0 in a healthy run. */
  protected_moved?: number | null;
  reason_code?: string | null;
  reason_text?: string | null;
  previous_value?: string | null;
  new_value?: string | null;
  related_record_id?: string | null;
  related_record_type?: string | null;
  details?: Record<string, any> | null;
}

const num = (v: any): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const numOrNull = (v: any): number | null =>
  (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));

/** Writes one Route Flow activity entry. Service-role client required. */
export async function recordRouteFlowActivity(admin: any, entry: RouteFlowActivityInput): Promise<void> {
  try {
    await admin.entities.ActivityLog.create({
      // Legacy fields first — an activity entry always reads well as plain text.
      action: LEGACY_ACTION[entry.event_type] || 'route_flow_activity',
      actor: entry.actor_type === 'admin' ? 'barber' : 'base44_automation',
      summary: entry.summary,
      detail: entry.detail || null,
      previous_value: entry.previous_value || null,
      new_value: entry.new_value || null,
      // Structured fields — what the Activity view filters and renders.
      event_type: entry.event_type,
      schedule_date: entry.schedule_date || null,
      actor_type: entry.actor_type || 'route_flow',
      actor_name: entry.actor_name || null,
      trigger_type: entry.trigger_type || 'automation',
      outcome: entry.outcome || null,
      bookings_evaluated: num(entry.bookings_evaluated),
      appointments_moved: num(entry.appointments_moved),
      requests_placed: num(entry.requests_placed),
      requests_unscheduled: num(entry.requests_unscheduled),
      protected_appointments_moved: num(entry.protected_moved),
      drive_minutes_before: numOrNull(entry.drive_before),
      drive_minutes_after: numOrNull(entry.drive_after),
      idle_minutes_before: numOrNull(entry.idle_before),
      idle_minutes_after: numOrNull(entry.idle_after),
      reason_code: entry.reason_code || null,
      reason_text: entry.reason_text || null,
      details_json: entry.details || null,
      related_record_id: entry.related_record_id || null,
      related_record_type: entry.related_record_type || 'BookingRequest',
      timestamp: new Date().toISOString(),
    });
  } catch {
    /* the activity log is best-effort — it never blocks completed work */
  }
}

/**
 * The per-appointment before/after rows for the detail panel. Client labels are
 * deliberately dropped here, so expanded activity never carries personal data.
 */
export function movesForDetail(changes: any[]): Array<Record<string, any>> {
  return (changes || []).map((c: any) => ({
    booking_request_id: c?.booking_request_id || null,
    from_label: c?.from_label || null,
    to_label: c?.to_label || null,
    moving: c?.moving === true,
    protected: c?.protected === true,
  }));
}

/** "Wed 8 Oct" — compact label for a schedule date. */
export function scheduleDateLabel(dateStr?: string | null): string {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${months[m - 1]}`;
}