import { format } from 'date-fns';
import { VIOLATION_CODES } from '@/lib/placementValidation';

/**
 * Route Flow Activity — reads and organises the history Route Flow ALREADY
 * records. Nothing is logged twice here:
 *
 *   ActivityLog            — Route Flow's own actions: reshuffles, requests fitted
 *                            by rearranging a day, suggestions awaiting review,
 *                            skips (below threshold) and abandoned arrangements.
 *   PlacementValidationLog — every placement decision: what was placed, refused,
 *                            left Unscheduled, or overridden by a person.
 *
 * The two are merged into one newest-first feed. No scheduling logic lives here.
 */

export const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'placements', label: 'Placements' },
  { value: 'reshuffles', label: 'Reshuffles' },
  { value: 'unscheduled', label: 'Unscheduled' },
  { value: 'overrides', label: 'Overrides' },
  { value: 'system', label: 'System' },
];

/** Every ActivityLog action this view knows about. */
const ACTIVITY_ACTIONS = [
  'route_flow_optimised',
  'route_flow_fitted_request',
  'route_flow_reshuffle_applied',
  'route_flow_skipped_threshold',
  'route_flow_schedule_changed',
  'route_flow_suggestion_created',
  // The day-level route: finalised by an admin, or marked out of date by a change.
  'route_flow_route_finalised',
  'route_flow_route_needs_update',
];

const TRIGGER_LABELS = {
  automation: 'Booking change — automatic',
  admin_panel: 'Admin panel',
  manual_calendar: 'Calendar',
  reshuffle_apply: 'Reviewed reshuffle suggestion',
  schedule_change: 'The day changed underneath',
};

const OUTCOME_LABELS = {
  applied: 'Applied',
  placed: 'Placed',
  unscheduled: 'Left Unscheduled',
  skipped: 'Skipped',
  aborted: 'Abandoned',
  pending_review: 'Awaiting review',
  failed: 'Failed',
  saved: 'Saved',
  override_saved: 'Saved with override',
  validated: 'Checked — nothing written',
  rejected: 'Refused',
  no_valid_slot: 'No slot available',
};

/** Extra detail keys, in the words an admin uses. */
const DETAIL_LABELS = {
  evaluated_count: 'Candidate times evaluated',
  valid_count: 'Candidate times that fitted',
  candidate_count: 'Candidate times evaluated',
  blocking_codes: 'Blocking reasons',
  rearrangement_attempted: 'Day rearrangement attempted',
  rearrangement_reason: 'Rearrangement result',
  from_label: 'From',
  to_label: 'To',
  retries: 'Retries',
  attempts: 'Attempts made',
  reason: 'Reason',
  barber_name: 'Barber',
  protected_count: 'Protected appointments on the day',
  drive_minutes_saved: 'Driving minutes saved',
  idle_minutes_saved: 'Idle minutes saved',
  combined_saved: 'Driving + idle minutes saved',
  threshold_minutes: 'Improvement threshold (minutes)',
  would_move_count: 'Appointments that would move',
  would_be: 'Proposal only — nothing applied',
  suggestion_id: 'Suggestion',
  signature: 'Plan fingerprint',
  protected_skipped: 'Protected changes refused',
  invalid_skipped: 'Changes refused on live data',
  availability_override: 'Availability override',
  action: 'Action',
  slots: 'Suggested times',
  // Day-level route finalisation.
  appointments_included: 'Appointments included',
  drive_legs_created: 'Drive legs created',
  drive_legs: 'Drive legs on the route',
  start_location: 'Start location',
  first_leg_minutes: 'Start to first stop (minutes)',
  drive_minutes: 'Driving minutes',
  idle_minutes: 'Idle minutes',
  detected_by: 'Detected by',
};

const DETAIL_ORDER = [
  'barber_name', 'start_location', 'first_leg_minutes', 'appointments_included',
  'drive_minutes', 'idle_minutes', 'drive_legs_created', 'drive_legs', 'detected_by',
  'from_label', 'to_label', 'candidate_count', 'evaluated_count', 'valid_count',
  'rearrangement_attempted', 'rearrangement_reason', 'reason',
  'drive_minutes_saved', 'idle_minutes_saved', 'combined_saved', 'threshold_minutes',
  'would_move_count', 'would_be', 'protected_count', 'protected_skipped', 'invalid_skipped',
  'availability_override', 'attempts', 'retries', 'action', 'suggestion_id', 'signature',
];

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function toList(rows) {
  return Array.isArray(rows) ? rows : (rows?.items || []);
}

function dayKey(date) {
  return format(date, 'yyyy-MM-dd');
}

function dayAfter(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d));
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
}

/**
 * The day an entry belongs to, applied on the server. Newer entries carry the
 * schedule date they affected; older ones fall back to when they were written.
 */
function withDay(predicate, dateField, key, fallbackField) {
  if (!key) return predicate;
  const next = dayAfter(key);
  return {
    $or: [
      { ...predicate, [dateField]: key },
      {
        ...predicate,
        [dateField]: { $exists: false },
        [fallbackField]: { $gte: `${key}T00:00:00.000Z`, $lt: `${next}T00:00:00.000Z` },
      },
    ],
  };
}

function activityPredicate(category) {
  if (category === 'reshuffles') {
    return { action: { $in: ['route_flow_optimised', 'route_flow_fitted_request', 'route_flow_route_finalised'] } };
  }
  if (category === 'overrides') return { action: 'route_flow_reshuffle_applied' };
  if (category === 'system') {
    return {
      action: {
        $in: [
          'route_flow_skipped_threshold',
          'route_flow_schedule_changed',
          'route_flow_suggestion_created',
          'route_flow_route_needs_update',
        ],
      },
    };
  }
  // 'placements' and 'unscheduled' are never ActivityLog entries.
  if (category !== 'all') return null;
  return { action: { $in: ACTIVITY_ACTIONS } };
}

function placementPredicate(category) {
  switch (category) {
    case 'placements':
      return {
        $or: [
          { event_type: 'auto_placement' },
          // Rows written before the structured event existed.
          {
            event_type: { $exists: false },
            source: 'route_flow',
            outcome: 'saved',
            trigger: { $in: ['automation', 'admin_panel'] },
            detail: { $regex: '^Auto-placed' },
          },
        ],
      };
    case 'reshuffles':
      return {
        $or: [
          { event_type: { $in: ['reshuffle', 'fit'] } },
          {
            event_type: { $exists: false },
            $or: [
              { trigger: 'reshuffle_apply' },
              { detail: { $regex: '^(Stage 2 optimisation moved|Rearranged from|No slot on the day as it stood)' } },
            ],
          },
        ],
      };
    case 'unscheduled':
      return {
        $or: [
          { event_type: 'unscheduled' },
          { event_type: { $exists: false }, outcome: 'no_valid_slot' },
        ],
      };
    case 'overrides':
      return {
        $or: [
          { trigger: { $in: ['manual_calendar', 'admin_panel'] } },
          { override_used: true },
          { event_type: { $in: ['manual', 'override', 'reshuffle_applied'] } },
        ],
      };
    case 'system':
      return {
        $or: [
          { event_type: 'skipped' },
          { event_type: { $exists: false }, outcome: 'skipped' },
        ],
      };
    default:
      return {
        $or: [
          { source: 'route_flow' },
          { override_used: true },
          { trigger: { $in: ['manual_calendar', 'admin_panel'] } },
        ],
      };
  }
}

export function categoryOfActivity(eventType) {
  if (eventType === 'reshuffle' || eventType === 'fit' || eventType === 'route_finalised') return 'reshuffles';
  if (eventType === 'reshuffle_applied') return 'overrides';
  return 'system';
}

export function categoryOfPlacement(row) {
  const human = row.trigger === 'manual_calendar' || row.trigger === 'admin_panel';
  if (human || row.override_used === true) return 'overrides';
  switch (row.event_type) {
    case 'fit':
    case 'reshuffle':
    case 'reshuffle_applied':
      return 'reshuffles';
    case 'unscheduled':
      return 'unscheduled';
    case 'skipped':
      return 'system';
    case 'auto_placement':
      return 'placements';
    default:
      break;
  }
  // Rows written before the structured event existed.
  if (row.outcome === 'no_valid_slot') return 'unscheduled';
  if (row.outcome === 'skipped') return 'system';
  if (row.outcome === 'saved') return 'placements';
  return 'system';
}

/** The action name older activity entries used, mapped to a structured event. */
function legacyActivityEvent(action) {
  switch (action) {
    case 'route_flow_optimised': return 'reshuffle';
    case 'route_flow_fitted_request': return 'fit';
    case 'route_flow_reshuffle_applied': return 'reshuffle_applied';
    case 'route_flow_skipped_threshold': return 'skipped_threshold';
    case 'route_flow_schedule_changed': return 'schedule_changed';
    case 'route_flow_suggestion_created': return 'suggestion_created';
    case 'route_flow_route_finalised': return 'route_finalised';
    case 'route_flow_route_needs_update': return 'route_needs_update';
    default: return 'reshuffle';
  }
}

function titleForEvent(eventType) {
  switch (eventType) {
    case 'reshuffle': return 'Provisional appointments reshuffled';
    case 'fit': return 'Route Flow fitted an additional request';
    case 'reshuffle_applied': return 'Reshuffle applied by an admin';
    case 'skipped_threshold': return 'Optimisation skipped — saving below threshold';
    case 'schedule_changed': return 'Arrangement abandoned — the day changed';
    case 'suggestion_created': return 'Reshuffle suggested — awaiting review';
    case 'route_finalised': return 'Route finalised';
    case 'route_needs_update': return 'Route marked as needing an update';
    default: return 'Route Flow activity';
  }
}

function titleForPlacement(row, eventType) {
  switch (eventType) {
    case 'auto_placement': return 'Booking auto-placed';
    case 'unscheduled': return 'Request left Unscheduled';
    case 'skipped': return 'Route Flow did not place this request';
    case 'fit': return 'Appointment rearranged to fit a request';
    case 'reshuffle': return 'Appointment rearranged';
    case 'reshuffle_applied': return 'Reshuffle change applied';
    case 'override': return row.outcome === 'override_saved' ? 'Availability override applied' : 'Override attempted';
    case 'manual': return row.proposed_time ? 'Appointment scheduled manually' : 'Removed from the calendar';
    default: break;
  }
  if (row.outcome === 'validated') return 'Placement checked — nothing written';
  if (row.outcome === 'rejected') return 'Placement refused';
  return 'Scheduling decision';
}

function detailRows(details) {
  if (!details || typeof details !== 'object') return [];
  const seen = new Set();
  return DETAIL_ORDER
    .filter((key) => key in details && details[key] !== null && details[key] !== undefined && details[key] !== '')
    .filter((key) => (seen.has(key) ? false : seen.add(key)))
    .map((key) => ({ label: DETAIL_LABELS[key] || key.replace(/_/g, ' '), value: formatDetail(details[key]) }));
}

function formatDetail(value) {
  if (Array.isArray(value)) {
    return value.map((v) => VIOLATION_CODES[v] || String(v)).join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (value && typeof value === 'object') return '';
  return String(value);
}

function metrics(from) {
  return {
    driveBefore: num(from?.drive_minutes_before ?? from?.drive_before),
    driveAfter: num(from?.drive_minutes_after ?? from?.drive_after),
    idleBefore: num(from?.idle_minutes_before ?? from?.idle_before),
    idleAfter: num(from?.idle_minutes_after ?? from?.idle_after),
  };
}

function normaliseActivity(row) {
  const eventType = row.event_type || legacyActivityEvent(row.action);
  const details = row.details_json || null;
  const time = row.timestamp || row.created_date || null;
  return {
    id: `activity-${row.id}`,
    source: 'activity',
    event_type: eventType,
    category: categoryOfActivity(eventType),
    title: titleForEvent(eventType),
    timestamp: time,
    timeSort: time ? new Date(time).getTime() : 0,
    scheduleDate: row.schedule_date || null,
    actorType: row.actor_type === 'admin' ? 'admin' : 'route_flow',
    actor: row.actor_type === 'admin' ? (row.actor_name || 'Admin') : 'Route Flow',
    triggerType: row.trigger_type || null,
    outcome: row.outcome || null,
    summary: row.summary || '',
    detail: row.detail || '',
    counts: {
      evaluated: num(row.bookings_evaluated),
      moved: num(row.appointments_moved),
      placed: num(row.requests_placed),
      unscheduled: num(row.requests_unscheduled),
      protectedMoved: num(row.protected_appointments_moved) || 0,
    },
    metrics: metrics(row),
    reason: row.reason_text ? { code: row.reason_code || null, text: row.reason_text } : null,
    requestIds: [row.related_record_id].filter(Boolean),
    barberName: details?.barber_name || null,
    moves: Array.isArray(details?.moves) ? details.moves : [],
    codes: Array.isArray(details?.blocking_codes) ? details.blocking_codes : [],
    detailRows: detailRows(details),
    previousValue: row.previous_value || null,
    newValue: row.new_value || null,
  };
}

function normalisePlacement(row) {
  const eventType = row.event_type || '';
  const details = row.details_json || null;
  const time = row.decided_at || row.created_date || null;
  const category = categoryOfPlacement(row);
  const moved = eventType === 'reshuffle' || eventType === 'fit' || eventType === 'reshuffle_applied' ? 1 : 0;
  return {
    id: `placement-${row.id}`,
    source: 'placement',
    event_type: eventType || (row.outcome === 'no_valid_slot' ? 'unscheduled' : row.outcome),
    category,
    title: titleForPlacement(row, eventType),
    timestamp: time,
    timeSort: time ? new Date(time).getTime() : 0,
    scheduleDate: row.booking_date || null,
    actorType: row.trigger === 'manual_calendar' || row.trigger === 'admin_panel' ? 'admin' : 'route_flow',
    actor: row.trigger === 'manual_calendar' || row.trigger === 'admin_panel'
      ? (row.actor_name || row.actor_role || 'Admin')
      : 'Route Flow',
    triggerType: row.trigger || null,
    outcome: row.outcome || null,
    summary: row.detail || '',
    detail: '',
    counts: {
      evaluated: num(details?.evaluated_count ?? details?.candidate_count),
      moved: moved || null,
      placed: eventType === 'auto_placement' && row.outcome === 'saved' ? 1 : 0,
      unscheduled: category === 'unscheduled' ? 1 : 0,
      protectedMoved: 0,
    },
    metrics: metrics(details),
    reason: row.outcome === 'no_valid_slot' || row.outcome === 'rejected' || row.outcome === 'skipped'
      ? { code: (row.codes || [])[0] || null, text: row.detail || null }
      : null,
    requestIds: [row.booking_request_id].filter(Boolean),
    barberName: row.barber_name || details?.barber_name || null,
    moves: [],
    codes: row.codes || [],
    fromLabel: row.previous_time || details?.from_label || null,
    toLabel: row.proposed_time || null,
    detailRows: detailRows(details),
    previousValue: null,
    newValue: null,
  };
}

/**
 * One page of activity, newest first. Each category is filtered on the server;
 * the mapping above is then applied to the merged result so a legacy fallback
 * can never leak a row into a category it does not belong to.
 */
export async function loadRouteFlowActivity(base44, { category = 'all', date = null, limit = 80 } = {}) {
  const key = date ? dayKey(date) : null;
  const activityQuery = activityPredicate(category);
  const placementQuery = placementPredicate(category);

  const [activityRows, placementRows] = await Promise.all([
    activityQuery
      ? base44.entities.ActivityLog.filter(withDay(activityQuery, 'schedule_date', key, 'created_date'), '-created_date', 100)
      : Promise.resolve([]),
    placementQuery
      ? base44.entities.PlacementValidationLog.filter(withDay(placementQuery, 'booking_date', key, 'created_date'), '-created_date', 150)
      : Promise.resolve([]),
  ]);

  const items = [
    ...toList(activityRows).map(normaliseActivity),
    ...toList(placementRows).map(normalisePlacement),
  ]
    .filter((item) => category === 'all' || item.category === category)
    .sort((a, b) => b.timeSort - a.timeSort);

  return items.slice(0, limit);
}

export function iconKeyFor(item) {
  if (item.counts.protectedMoved > 0) return 'lock';
  if (item.actorType === 'admin') return 'user';
  switch (item.event_type) {
    case 'reshuffle':
    case 'fit':
    case 'suggestion_created':
      return 'reshuffle';
    case 'auto_placement':
    case 'route_finalised':
      return 'success';
    case 'route_needs_update':
      return 'warning';
    case 'unscheduled':
    case 'no_valid_slot':
      return 'unscheduled';
    case 'skipped':
    case 'skipped_threshold':
    case 'schedule_changed':
      return 'warning';
    default:
      break;
  }
  if (item.outcome === 'saved' || item.outcome === 'applied' || item.outcome === 'placed') return 'success';
  if (item.outcome === 'aborted' || item.outcome === 'skipped') return 'warning';
  return 'warning';
}

export function triggerLabel(trigger) {
  return TRIGGER_LABELS[trigger] || trigger || '—';
}

export function outcomeLabel(outcome) {
  return OUTCOME_LABELS[outcome] || outcome || '—';
}

export function codeLabel(code) {
  return VIOLATION_CODES[code] || code;
}

/** "62 → 44 min" (or just the value that exists). */
export function formatMinutes(before, after) {
  if (before === null && after === null) return null;
  if (before === null) return `${after} min`;
  if (after === null) return `${before} min`;
  return `${before} → ${after} min`;
}

export function formatStamp(timestamp) {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'h:mmaaa');
}

export function relativeDayLabel(scheduleDate) {
  if (!scheduleDate) return '';
  const [y, m, d] = String(scheduleDate).split('-').map(Number);
  if (!y || !m || !d) return '';
  const noon = new Date(Date.UTC(y, m - 1, d, 12));
  const target = new Date(y, m - 1, d);
  const today = new Date();
  const isSame = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (isSame(target, today)) return `Today · ${format(target, 'd MMM')}`;
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (isSame(target, yesterday)) return `Yesterday · ${format(target, 'd MMM')}`;
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (isSame(target, tomorrow)) return `Tomorrow · ${format(target, 'd MMM')}`;
  return format(noon, 'EEE d MMM');
}