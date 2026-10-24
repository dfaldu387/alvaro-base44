/**
 * Day Route — the boundary between planning and execution.
 *
 *   Calendar = planning.   Route = execution.
 *
 * The Calendar is a flexible draft: Route Flow auto-places, the admin drags, and
 * provisional appointments sit on the day WITHOUT being connected one pair at a
 * time. When the admin is happy, they press Finalise Route once. This module is
 * that button's whole behaviour:
 *
 *   finaliseDayRoute(date, barber)          ← "Connect Appointments"
 *     ├─ load the day            (shared Stage 2 loader: real occupancy, real travel)
 *     ├─ chainDay                (connect in the barber's order, drive time between stops)
 *     ├─ evaluatePlacement       (shared validator, EVERY proposed time)
 *     ├─ one Mapbox matrix       (start location + every stop → leg times/distances)
 *     ├─ versioned re-read       (abandon the plan if the day changed under us)
 *     ├─ bulkUpdate              (all moves, or nothing at all)
 *     ├─ replace drive legs      (derived from the final arrangement)
 *     └─ DayRoute record         (finalised + the fingerprint it was built from)
 *
 * Cost is driving + idle minutes. No favourite weighting, no revenue weighting,
 * no commercial displacement. Travel is counted exactly once per leg and drive
 * blocks are derived information — they are never added as extra occupancy.
 *
 * Safety: a finalisation never moves a Locked or Confirmed appointment, never
 * overrides customer availability, never breaks the working window, never
 * overlaps another appointment, never drops a booking, and never applies in
 * part. If no complete valid arrangement exists, nothing is written and the
 * reason is returned.
 *
 * The route is date-bound and barber-bound. Test data keeps its own universe —
 * exactly as Route Flow separates it everywhere else.
 */

import { mapboxDriveMatrix, toTravelMins, MAX_MATRIX_POINTS } from './mapboxTravel.ts';
import { chainDay } from './connectedSchedule.ts';
import { loadDay } from './routeFlowOptimiser.ts';
import { loadPlacementContext, evaluatePlacement } from './schedulingValidator.ts';
import { recordPlacementDecision, redactViolationDetail } from './placementAudit.ts';
import { recordRouteFlowActivity, movesForDetail, scheduleDateLabel } from './routeFlowActivity.ts';
import { parseTimeStr, decimalToLabel } from './provisionalPlacement.ts';
import { isBlockRow, isRouteAppointment, routeDayRows, routeFingerprint } from './routeFingerprint.ts';

/** Drive-matrix key for the barber's saved start location. */
const START_KEY = 'START';
/** Retries when the day changes while the finalisation is being worked out. */
const MAX_ATTEMPTS = 3;
/** A route needs at least this many appointments for the button to be offered. */
export const MIN_STOPS_TO_FINALISE = 2;
/** How long a 'finalising' record may sit before it is treated as abandoned. */
const FINALISING_GRACE_MS = 3 * 60 * 1000;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type RouteStatus = 'draft' | 'finalising' | 'finalised' | 'needs_update';

/** Shown whenever a finalised route no longer matches the day it describes. */
export const ROUTE_CHANGED_REASON = 'The day changed after the route was finalised';

export interface RouteTarget {
  team_member_id: string;
  team_member_name: string;
  /** True when every appointment on this route is test data. */
  is_test: boolean;
  /**
   * Which universe to read: true / false when a caller asked for one (QA and the
   * automation), null for the barber's whole day — which is what Connect
   * Appointments acts on, because the day the admin sees is one sequence of stops.
   */
  universe: boolean | null;
}

export interface DayRouteStop {
  booking_request_id: string;
  order: number;
  start_label: string;
  start_decimal: number;
  end_label: string;
  drive_minutes: number | null;
}

export interface RouteGroupState {
  team_member_id: string;
  team_member_name: string;
  is_test: boolean;
  status: RouteStatus;
  changed: boolean;
  appointments: number;
  drive_minutes: number;
  idle_minutes: number;
  waste_minutes: number;
  drive_legs_created: number;
  start_location_address: string;
  start_location_configured: boolean;
  first_leg_minutes: number | null;
  stops: DayRouteStop[];
  finalised_at: string | null;
  finalised_by: string | null;
  needs_update_reason: string | null;
  record_id: string | null;
}

export interface DayRouteOverview {
  date: string;
  day: string;
  status: RouteStatus;
  changed: boolean;
  reason: string | null;
  appointments: number;
  drive_minutes: number;
  idle_minutes: number;
  waste_minutes: number;
  drive_legs_created: number;
  start_location_address: string;
  start_location_configured: boolean;
  first_leg_minutes: number | null;
  stops: DayRouteStop[];
  finalised_at: string | null;
  finalised_by: string | null;
  eligible: boolean;
  groups: RouteGroupState[];
}

// ── Small helpers ────────────────────────────────────────────────────────────

function listRows(res: any): any[] {
  return Array.isArray(res) ? res : (res?.items || []);
}

export function weekdayNameOf(dateStr: string): string {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || '';
}

/** "8 Oct" — compact date label for activity entries. */
function shortDate(dateStr: string): string {
  const [, m, d] = String(dateStr || '').split('-').map(Number);
  if (!m || !d) return dateStr;
  return `${d} ${MONTHS[m - 1] || ''}`.trim();
}

function num(v: any): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

/**
 * What the day costs as it stands: driving between consecutive appointments and
 * the idle left over once that drive has happened. Protected breaks are time, not
 * a destination, so they are never counted as waste.
 */
function currentDayCost(
  items: any[],
  driveFn: (fromId: string, toId: string) => number | null,
  startKey?: string | null,
): { drive: number; idle: number } {
  const real = items.filter(i => !i.block && i.start != null).sort((a, b) => num(a.start) - num(b.start));
  const blocks = items.filter(i => i.block && i.start != null)
    .map(b => ({ start: num(b.start), end: num(b.start) + num(b.durationHours) }));

  let drive = 0;
  let idle = 0;
  if (startKey && real.length > 0) {
    const toFirst = driveFn(startKey, real[0].id);
    if (toFirst != null) drive += Math.max(0, toFirst);
  }
  for (let i = 0; i < real.length - 1; i += 1) {
    const aEnd = num(real[i].start) + num(real[i].durationHours);
    const bStart = num(real[i + 1].start);
    let gap = (bStart - aEnd) * 60;
    for (const blk of blocks) {
      const covered = Math.min(bStart, blk.end) - Math.max(aEnd, blk.start);
      if (covered > 0) gap -= covered * 60;
    }
    const d = Math.max(0, driveFn(real[i].id, real[i + 1].id) ?? 0);
    drive += d;
    if (Math.max(0, gap) > d) idle += Math.max(0, gap) - d;
  }
  return { drive: Math.round(drive), idle: Math.round(idle) };
}

/** The calendar's drive-leg rating: green ≤ 15 min, yellow ≤ 25 min, else red. */
function efficiencyOf(mins: number): 'green' | 'yellow' | 'red' {
  if (mins <= 15) return 'green';
  if (mins <= 25) return 'yellow';
  return 'red';
}

// isBlockRow, isRouteAppointment and routeFingerprint live in routeFingerprint.ts
// (so the ETA module can use them without importing the optimiser). Re-exported here.
export { isBlockRow, isRouteAppointment, routeDayRows, routeFingerprint };

// ── Day reads ────────────────────────────────────────────────────────────────

/** Every booking on a date, both universes, before any grouping. */
async function dayBookings(admin: any, date: string): Promise<any[]> {
  try {
    const rows = await admin.entities.BookingRequest.filter({ requested_date: date }, '-created_date', 400);
    return listRows(rows);
  } catch {
    return [];
  }
}

async function loadDayRouteRecords(admin: any, params: { date: string; teamMemberId?: string | null }): Promise<any[]> {
  try {
    const query: Record<string, any> = { date: params.date };
    if (params.teamMemberId) query.team_member_id = params.teamMemberId;
    const rows = await admin.entities.DayRoute.filter(query, '-created_date', 50);
    return listRows(rows);
  } catch {
    return [];
  }
}

/**
 * The day's route record for one barber. A route covers its barber's whole day, so
 * when no universe was asked for it is matched by barber: the real record when one
 * exists, otherwise whatever is stored there (a day that was finalised as test-only
 * and has since gained real work).
 */
function findRecord(records: any[], target: RouteTarget): any | null {
  const mine = (records || []).filter((r: any) =>
    String(r.team_member_id || '') === String(target.team_member_id || ''),
  );
  if (target.universe == null) {
    return mine.find((r: any) => r.is_test !== true) || mine[0] || null;
  }
  return mine.find((r: any) => (r.is_test === true) === target.universe) || null;
}

/**
 * Which barbers this date actually holds work for — one route per barber with at
 * least one placed appointment. A route covers that barber's whole day, so a real
 * appointment is never left stranded in a route of its own beside test data: with
 * three appointments on the day there are two drive legs, always.
 *
 * A route is tagged as test data only when every appointment on it is test data,
 * which keeps a QA-only day in its own universe.
 */
export async function resolveRouteTargets(
  admin: any,
  params: { date: string; teamMemberId?: string | null; isTest?: boolean },
): Promise<{ targets: RouteTarget[]; rows: any[]; eligible: boolean; appointments: number }> {
  const rows = await dayBookings(admin, params.date);
  const scoped = params.teamMemberId ? rows.filter((r: any) => String(r.team_member_id || '') === params.teamMemberId) : rows;
  const universe = params.isTest == null ? scoped : scoped.filter((r: any) => (r.is_test === true) === params.isTest);

  const members = new Map<string, any>();
  try {
    const res = await admin.entities.TeamMember.list('name', 100);
    for (const m of listRows(res)) members.set(m.id, m);
  } catch { /* names are display only */ }

  const seen = new Map<string, RouteTarget>();
  let appointments = 0;
  for (const r of universe) {
    if (!isRouteAppointment(r) || isBlockRow(r)) continue;
    appointments += 1;
    const teamMemberId = String(r.team_member_id || '');
    const existing = seen.get(teamMemberId);
    if (!existing) {
      seen.set(teamMemberId, {
        team_member_id: teamMemberId,
        team_member_name: members.get(teamMemberId)?.name || r.team_member_name || '',
        is_test: r.is_test === true,
        universe: params.isTest == null ? null : params.isTest === true,
      });
    } else if (r.is_test !== true) {
      // One real appointment makes the whole route a real one.
      existing.is_test = false;
    }
  }

  return {
    targets: Array.from(seen.values()),
    rows,
    appointments,
    eligible: appointments >= MIN_STOPS_TO_FINALISE,
  };
}

// ── Day-level state ──────────────────────────────────────────────────────────

/**
 * The state of one (barber, universe) group: draft until it is finalised, then
 * finalised — and needs_update the moment the day stops matching the route that
 * was built from it.
 *
 * Reconciliation is deliberately part of reading: a change can arrive from any
 * direction (a new booking, an admin drag, a cancellation, a service edit), so
 * comparing the stored fingerprint with the day as it stands is the one check
 * that cannot be bypassed. The transition is recorded once, and the outdated
 * route is kept for reference rather than silently rebuilt.
 */
async function groupState(
  admin: any,
  params: { date: string; rows: any[]; target: RouteTarget; records: any[]; reconcile: boolean; actorName: string },
): Promise<RouteGroupState> {
  const { date, rows, target, records } = params;
  // One route per barber: the whole day, unless a caller asked for one universe.
  // The route is stamped from this same set, so the two can never disagree.
  const mine = routeDayRows(rows, target);
  const placed = mine.filter(r => isRouteAppointment(r) && !isBlockRow(r));
  const fingerprint = routeFingerprint(mine);
  let record = findRecord(records, target);

  let status: RouteStatus = 'draft';
  let changed = false;

  if (record && (record.route_status === 'finalised' || record.route_status === 'needs_update')) {
    changed = String(record.fingerprint || '') !== fingerprint;
    status = changed ? 'needs_update' : 'finalised';
    if (changed && params.reconcile && record.route_status !== 'needs_update') {
      record = await markRouteNeedsUpdate(admin, { record, actorName: params.actorName });
    }
  } else if (record && record.route_status === 'finalising') {
    // An in-flight run that never finished (a crash, a closed tab) is not a state
    // to leave the day stuck in — an abandoned attempt is simply a draft again.
    const stamp = Date.parse(record.updated_date || record.finalised_at || '') || 0;
    status = stamp && Date.now() - stamp < FINALISING_GRACE_MS ? 'finalising' : 'draft';
  }

  const live = record && status !== 'draft' ? record : null;

  return {
    team_member_id: target.team_member_id,
    team_member_name: target.team_member_name || record?.team_member_name || '',
    is_test: target.is_test,
    status,
    changed,
    appointments: placed.length,
    drive_minutes: num(live?.drive_minutes),
    idle_minutes: num(live?.idle_minutes),
    waste_minutes: num(live?.waste_minutes),
    drive_legs_created: num(live?.drive_legs_created),
    start_location_address: live?.start_location_address || '',
    start_location_configured: live?.start_location_configured === true,
    first_leg_minutes: live?.first_leg_minutes == null ? null : num(live.first_leg_minutes),
    stops: Array.isArray(live?.stops) ? live.stops : [],
    finalised_at: live?.finalised_at || null,
    finalised_by: live?.finalised_by || null,
    needs_update_reason: status === 'needs_update' ? (live?.needs_update_reason || ROUTE_CHANGED_REASON) : null,
    record_id: record?.id || null,
  };
}

const STATUS_RANK: Record<RouteStatus, number> = { draft: 0, finalised: 1, needs_update: 2, finalising: 3 };

/** The whole day: every group's state, plus the one status the day is showing. */
export async function dayRouteOverview(
  admin: any,
  params: { date: string; teamMemberId?: string | null; reconcile?: boolean; actorName?: string },
): Promise<DayRouteOverview> {
  const date = String(params.date || '').trim();
  const day = weekdayNameOf(date);
  const empty: DayRouteOverview = {
    date, day, status: 'draft', changed: false, reason: null, appointments: 0,
    drive_minutes: 0, idle_minutes: 0, waste_minutes: 0, drive_legs_created: 0,
    start_location_address: '', start_location_configured: false, first_leg_minutes: null,
    stops: [], finalised_at: null, finalised_by: null, eligible: false, groups: [],
  };
  if (!date) return empty;

  const { targets, rows, eligible } = await resolveRouteTargets(admin, {
    date,
    teamMemberId: params.teamMemberId || null,
  });
  if (targets.length === 0) return { ...empty, eligible };

  const records = await loadDayRouteRecords(admin, { date, teamMemberId: params.teamMemberId || null });
  const groups: RouteGroupState[] = [];
  for (const target of targets) {
    groups.push(await groupState(admin, {
      date, rows, target, records,
      reconcile: params.reconcile !== false,
      actorName: params.actorName || 'Admin',
    }));
  }

  const worst = groups.reduce<RouteStatus>((acc, g) => (STATUS_RANK[g.status] > STATUS_RANK[acc] ? g.status : acc), 'draft');
  const reference = groups.find(g => g.status === 'finalised')
    || groups.find(g => g.status === 'needs_update' || g.status === 'finalising')
    || groups[0];
  const changedGroup = groups.find(g => g.changed);

  return {
    date,
    day,
    status: worst,
    changed: groups.some(g => g.changed),
    reason: changedGroup?.needs_update_reason || (worst === 'needs_update' ? ROUTE_CHANGED_REASON : null),
    appointments: groups.reduce((sum, g) => sum + g.appointments, 0),
    drive_minutes: groups.reduce((sum, g) => sum + g.drive_minutes, 0),
    idle_minutes: groups.reduce((sum, g) => sum + g.idle_minutes, 0),
    waste_minutes: groups.reduce((sum, g) => sum + g.waste_minutes, 0),
    drive_legs_created: groups.reduce((sum, g) => sum + g.drive_legs_created, 0),
    start_location_address: reference?.start_location_address || '',
    start_location_configured: reference?.start_location_configured === true,
    first_leg_minutes: reference?.first_leg_minutes ?? null,
    stops: reference?.stops || [],
    finalised_at: reference?.finalised_at || null,
    finalised_by: reference?.finalised_by || null,
    eligible,
    groups,
  };
}

/**
 * A finalised route whose day has changed is marked out of date, and the reason
 * is recorded in the Route Flow activity trail. The stored route is kept — it is
 * shown for reference until the admin rebuilds it.
 */
export async function markRouteNeedsUpdate(
  admin: any,
  params: { record: any; reason?: string; actorName?: string },
): Promise<any> {
  const record = params.record;
  if (!record) return record;
  const reason = params.reason || ROUTE_CHANGED_REASON;
  const now = new Date().toISOString();
  let updated = record;
  try {
    updated = await admin.entities.DayRoute.update(record.id, {
      route_status: 'needs_update',
      needs_update_at: now,
      needs_update_reason: reason,
    });
  } catch { /* the state is still reported from the comparison itself */ }

  await recordRouteFlowActivity(admin, {
    event_type: 'route_needs_update',
    summary: `Route marked as needing an update · ${scheduleDateLabel(record.date)}${record.team_member_name ? ` · ${record.team_member_name}` : ''}`,
    detail: [
      'The day changed after the route was finalised',
      `${num(record.appointments_count)} appointment${num(record.appointments_count) === 1 ? '' : 's'} on the previous route`,
      'the route is kept for reference until it is rebuilt',
    ].join(' · '),
    schedule_date: record.date,
    actor_type: 'route_flow',
    actor_name: null,
    trigger_type: 'schedule_change',
    outcome: 'pending_review',
    bookings_evaluated: num(record.appointments_count),
    appointments_moved: 0,
    protected_moved: 0,
    reason_code: 'route_changed',
    reason_text: reason,
    previous_value: `route ${record.route_status}`,
    new_value: 'route needs_update',
    details: {
      barber_name: record.team_member_name || null,
      drive_minutes: num(record.drive_minutes),
      idle_minutes: num(record.idle_minutes),
      drive_legs: num(record.drive_legs_created),
      detected_by: params.actorName || null,
    },
  });
  return updated;
}

// ── Finalisation ─────────────────────────────────────────────────────────────

export interface FinaliseOptions {
  date: string;
  teamMemberId?: string | null;
  isTest?: boolean;
  dryRun?: boolean;
  actorName: string;
  actorRole?: 'admin' | 'automation';
  trigger?: string;
}

export interface FinalisedRoute {
  team_member_id: string;
  team_member_name: string;
  is_test: boolean;
  appointments: number;
  moved: number;
  /** Locked or confirmed appointments moved. Always 0 in a healthy run. */
  protected_moved: number;
  drive_minutes: number;
  idle_minutes: number;
  waste_minutes: number;
  drive_before: number;
  idle_before: number;
  drive_legs_created: number;
  /** Segments whose travel could not be estimated (shown, never dropped). */
  drive_legs_unavailable: number;
  /** Segments whose travel does not fit the room between two appointments. */
  drive_legs_conflict: number;
  start_location_address: string;
  start_location_configured: boolean;
  first_leg_minutes: number | null;
  stops: DayRouteStop[];
  warnings: string[];
  record_id: string | null;
  message: string;
}

export interface FinaliseFailure {
  team_member_id: string;
  team_member_name: string;
  is_test: boolean;
  reason: string;
  message: string;
  warnings: string[];
}

export interface FinaliseResult {
  date: string;
  day: string;
  dry_run: boolean;
  ok: boolean;
  code: string | null;
  message: string;
  appointments: number;
  moved: number;
  drive_minutes: number;
  idle_minutes: number;
  waste_minutes: number;
  drive_before: number;
  idle_before: number;
  drive_legs_created: number;
  drive_legs_unavailable: number;
  drive_legs_conflict: number;
  protected_moved: number;
  eligible: boolean;
  finalised: FinalisedRoute[];
  failed: FinaliseFailure[];
}

/** Every failure is explained in one plain sentence an admin can act on. */
const FAIL_MESSAGES: Record<string, string> = {
  no_appointments: 'There is nothing to route on this day.',
  not_enough_appointments: `A route needs at least ${MIN_STOPS_TO_FINALISE} appointments on the day.`,
  multiple_barbers: 'This day holds more than one barber, so it must be finalised one barber at a time.',
  barber_not_working: 'The barber is not working on this day.',
  load_failed: 'The day could not be read.',
  travel_unavailable: 'Driving times could not be verified, so nothing was finalised.',
  addresses_incomplete: 'An appointment on this day has no verified location, so nothing was finalised.',
  no_feasible_arrangement: 'The day cannot be arranged with every appointment kept on the calendar.',
  no_arrangement_found: 'No valid arrangement of this day was found.',
  validation_failed: 'A proposed time failed scheduling validation, so nothing was finalised.',
  outside_normal_hours: 'A proposed time falls outside normal working hours.',
  too_many_stops: `Too many appointments on this day to verify travel in one request (limit ${MAX_MATRIX_POINTS - 1}).`,
  schedule_changed: 'The day kept changing while the route was being built, so nothing was finalised.',
  write_failed: 'The route could not be saved, so nothing was moved.',
};

function fail(target: RouteTarget, reason: string, extra: Partial<FinaliseFailure> = {}): FinaliseFailure {
  return {
    team_member_id: target.team_member_id,
    team_member_name: target.team_member_name,
    is_test: target.is_test,
    reason,
    message: FAIL_MESSAGES[reason] || 'The route could not be finalised.',
    warnings: [],
    ...extra,
  };
}

function blankResult(date: string, dryRun: boolean): FinaliseResult {
  return {
    date,
    day: weekdayNameOf(date),
    dry_run: dryRun,
    ok: false,
    code: null,
    message: '',
    appointments: 0,
    moved: 0,
    drive_minutes: 0,
    idle_minutes: 0,
    waste_minutes: 0,
    drive_before: 0,
    idle_before: 0,
    drive_legs_created: 0,
    drive_legs_unavailable: 0,
    drive_legs_conflict: 0,
    protected_moved: 0,
    eligible: false,
    finalised: [],
    failed: [],
  };
}

/** One Mapbox matrix covering the whole route: start location, then every stop. */
async function routeMatrix(stops: DayRouteStop[], loaded: any) {
  const points: Array<{ lat: number; lng: number }> = [];
  const indexByStop: Record<string, number> = {};
  let startIndex: number | null = null;

  const startPoint = loaded?.startLocation?.configured ? loaded.startLocation.point : null;
  if (startPoint) {
    startIndex = points.length;
    points.push(startPoint);
  }
  for (const stop of stops) {
    const row = loaded?.byId?.[stop.booking_request_id];
    if (!row || typeof row.address_lat !== 'number' || typeof row.address_lng !== 'number') {
      return { ok: false, error: 'An appointment on this day has no verified location.' } as any;
    }
    indexByStop[stop.booking_request_id] = points.length;
    points.push({ lat: row.address_lat, lng: row.address_lng });
  }
  if (points.length > MAX_MATRIX_POINTS) {
    return { ok: false, error: `Too many stops to verify in one request (limit ${MAX_MATRIX_POINTS - 1}).` } as any;
  }
  if (points.length < 2) {
    return { ok: true, leg: () => ({ mins: 0, km: null }), startLeg: () => null } as any;
  }

  const matrix = await mapboxDriveMatrix(points);
  if (!matrix.ok || !matrix.durations) {
    return { ok: false, error: matrix.error || 'Driving estimates are unavailable.' } as any;
  }
  const at = (a: number | null, b: number | null) => {
    if (a == null || b == null) return null;
    const secs = matrix.durations?.[a]?.[b];
    if (secs == null || !isFinite(secs)) return null;
    const metres = matrix.distances?.[a]?.[b];
    return {
      mins: toTravelMins(secs),
      km: metres == null ? null : Math.round((metres / 1000) * 10) / 10,
    };
  };
  return {
    ok: true,
    leg: (fromStopId: string, toStopId: string) => at(indexByStop[fromStopId], indexByStop[toStopId]),
    startLeg: (firstStopId: string) => (startIndex == null ? null : at(startIndex, indexByStop[firstStopId])),
  } as any;
}

/** One derived drive leg, exactly as it is stored. */
export interface DayDriveLeg {
  from_appointment_id: string;
  to_appointment_id: string;
  day: string;
  date: string;
  is_test: boolean;
  start_time: string;
  end_time: string;
  status: 'current';
  fits_gap: boolean;
  availability: 'known' | 'unavailable';
  needs_review: boolean;
  duration_minutes?: number;
  distance_km?: number;
  gap_minutes?: number;
  earliest_feasible_start?: string;
  efficiency?: 'green' | 'yellow' | 'red';
}

export interface DriveLegPlan {
  legs: DayDriveLeg[];
  /** Segments whose travel could not be estimated. */
  unavailable: number;
  /** Segments whose travel does not fit the room between the two appointments. */
  conflict: number;
  /** Every segment a person has to look at. */
  review: number;
}

/**
 * One drive leg for EVERY consecutive pair of stops, in order.
 *
 * Connecting the day means connecting every consecutive stop: three appointments
 * produce two legs, five produce four, and no pair is ever skipped. A pair whose
 * travel could not be estimated, and a pair whose travel is longer than the room
 * between the two appointments, are still legs — they carry `needs_review` and are
 * shown as Travel unavailable / Travel conflict with the earliest feasible start.
 *
 * Pure: it reads the stops it is given and writes nothing.
 */
export function planDriveLegs(
  stops: DayRouteStop[],
  params: { date: string; day: string; isTest: boolean },
): DriveLegPlan {
  const legs: DayDriveLeg[] = [];
  let unavailable = 0;
  let conflict = 0;

  for (let i = 0; i < stops.length - 1; i += 1) {
    const stop = stops[i];
    const next = stops[i + 1];
    // The drive leaves when the previous appointment's occupancy ends (service plus
    // that booking's own buffer) and must arrive before the next one starts.
    const fromEnd = parseTimeStr(stop.end_label);
    const nextStart = parseTimeStr(next.start_label);
    const gap = isFinite(fromEnd) && isFinite(nextStart) ? Math.round((nextStart - fromEnd) * 60) : null;
    const mins = stop.drive_minutes == null ? null : num(stop.drive_minutes);
    const known = mins != null;
    // The same test the optimiser applies: required travel longer than the room
    // free between the two appointments is a shortfall.
    const fits = !known || gap == null || mins <= gap + 0.5;
    if (!known) unavailable += 1;
    if (known && !fits) conflict += 1;

    legs.push({
      from_appointment_id: `db-${stop.booking_request_id}`,
      to_appointment_id: `db-${next.booking_request_id}`,
      day: params.day,
      date: params.date,
      is_test: params.isTest,
      start_time: stop.end_label,
      end_time: known ? decimalToLabel(fromEnd + mins / 60) : stop.end_label,
      status: 'current',
      fits_gap: fits,
      availability: known ? 'known' : 'unavailable',
      needs_review: !known || !fits,
      ...(known ? { duration_minutes: mins, efficiency: efficiencyOf(mins) } : {}),
      ...((stop as any).distance_km == null ? {} : { distance_km: (stop as any).distance_km }),
      ...(gap == null ? {} : { gap_minutes: gap }),
      ...(known && !fits ? { earliest_feasible_start: decimalToLabel(fromEnd + mins / 60) } : {}),
    });
  }

  return { legs, unavailable, conflict, review: unavailable + conflict };
}

/**
 * Replaces the day's derived drive legs with the ones the final arrangement
 * produces. Legs are derived information: a stale one is never kept, and travel is
 * never counted twice — exactly one leg between one pair of consecutive stops.
 */
async function writeDriveLegs(
  admin: any,
  params: { date: string; stops: DayRouteStop[]; plan: DriveLegPlan },
): Promise<number> {
  const { date, stops, plan } = params;
  const bookingIds = new Set(stops.map(s => s.booking_request_id));

  // 1. Remove the legs this day can no longer justify.
  try {
    const rows = listRows(await admin.entities.RouteConnection.filter({ date }, '-created_date', 200));
    const doomed = rows
      .filter((c: any) => {
        const from = String(c.from_appointment_id || '');
        const to = String(c.to_appointment_id || '');
        const fromId = from.replace(/^db-/, '');
        const toId = to.replace(/^db-/, '');
        return bookingIds.has(fromId) || bookingIds.has(toId) || bookingIds.has(from) || bookingIds.has(to);
      })
      .map((c: any) => c.id);
    if (doomed.length > 0) await admin.entities.RouteConnection.deleteMany({ id: { $in: doomed } });
  } catch { /* a leftover leg is corrected by the write below */ }

  // 2. Write every leg the final arrangement produces — one per consecutive pair.
  if (plan.legs.length === 0) return 0;
  try {
    await admin.entities.RouteConnection.bulkCreate(plan.legs);
    return plan.legs.length;
  } catch {
    return 0;
  }
}

/**
 * Finalises one barber's day: connects the appointments in the order they are
 * already arranged, validates every move, writes the route and derives its drive
 * legs — or writes nothing at all. Nothing is confirmed and nobody is messaged:
 * that is the separate Confirm Appointments step.
 */
async function finaliseOne(
  admin: any,
  opts: FinaliseOptions & { date: string; day: string },
  target: RouteTarget,
): Promise<{ route?: FinalisedRoute; failure?: FinaliseFailure }> {
  const { date, day } = opts;
  const dryRun = opts.dryRun === true;
  const actorName = opts.actorName || 'Admin';
  const actorRole: 'admin' | 'automation' = opts.actorRole || 'admin';
  const trigger = opts.trigger || 'admin_panel';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // ── 1. The day as it stands ─────────────────────────────────────────────
    const loaded = await loadDay(admin, {
      date,
      day,
      teamMemberId: target.team_member_id,
      // null = the barber's whole day, so no stop is left outside the route.
      isTest: target.universe,
    });
    if (!loaded.ok) return { failure: fail(target, loaded.reason || 'load_failed', { warnings: loaded.warnings }) };

    const appointmentItems = loaded.items.filter((i: any) => !i.block);
    if (appointmentItems.length === 0) return { failure: fail(target, 'no_appointments', { warnings: loaded.warnings }) };

    // ── 2. Connect: chain the day in the order the barber arranged ──────────
    // Organising (dragging, Auto Sort) decides the ORDER. Connecting only decides
    // the TIMES: the first appointment anchors the day, and every appointment
    // after it starts when the one before it finishes, plus the drive to the next
    // customer. No appointment is re-ordered here, no time is confirmed, and
    // nothing messages a client.
    const startKey = loaded.startLocation?.configured ? START_KEY : null;
    const chain = chainDay(
      loaded.items.map((it: any) => ({
        id: it.id,
        start: it.start,
        durationHours: it.durationHours,
        windowStart: it.windowStart,
        windowEnd: it.windowEnd,
        anchor: it.anchor,
        block: it.block,
      })),
      { workStart: loaded.workStart, workEnd: loaded.workEnd, driveFor: loaded.driveFn, startKey, anchorFirst: true },
    );

    // ── 3. The chained times, stop by stop ──────────────────────────────────
    const proposed = new Map<string, number>();
    for (const [id, start] of chain.assigned) proposed.set(id, start);
    const stops: DayRouteStop[] = appointmentItems
      .map((item: any) => {
        const start = proposed.has(item.id) ? proposed.get(item.id)! : num(item.start);
        const hours = num(item.durationHours);
        return {
          booking_request_id: item.id,
          order: 0,
          start_label: decimalToLabel(start),
          start_decimal: start,
          end_label: decimalToLabel(start + hours),
          drive_minutes: null,
        };
      })
      .filter((s: DayRouteStop) => isFinite(s.start_decimal))
      .sort((a: DayRouteStop, b: DayRouteStop) => a.start_decimal - b.start_decimal)
      .map((s: DayRouteStop, i: number) => ({ ...s, order: i + 1 }));

    if (stops.length === 0) return { failure: fail(target, 'no_appointments', { warnings: loaded.warnings }) };

    // Only a chained appointment moves — a protected one keeps the time its client
    // holds, so connecting can never move a confirmed or locked appointment.
    const protectedIds = new Set(loaded.items.filter((i: any) => i.anchor).map((i: any) => i.id));
    const moves = appointmentItems
      .map((it: any) => ({
        booking_request_id: it.id,
        from: num(it.start),
        to: proposed.has(it.id) ? (proposed.get(it.id) as number) : num(it.start),
      }))
      .filter((m: any) => !protectedIds.has(m.booking_request_id) && isFinite(m.from) && Math.abs(m.to - m.from) > 1e-9)
      .map((m: any) => ({
        booking_request_id: m.booking_request_id,
        from_label: decimalToLabel(m.from),
        to_label: decimalToLabel(m.to),
        moving: true,
        protected: false,
      }));
    const protectedMoved = 0;

    // ── 4. Travel for the whole route, in one matrix call ───────────────────
    // Fetched BEFORE anything is written: a day whose travel cannot be verified
    // is left exactly as it was, never half-finalised.
    const matrix = await routeMatrix(stops, loaded);
    if (!matrix.ok) {
      const reason = /no verified location/i.test(String(matrix.error)) ? 'addresses_incomplete' : 'travel_unavailable';
      return { failure: fail(target, reason, { warnings: [...loaded.warnings, String(matrix.error)] }) };
    }
    const firstLeg = matrix.startLeg(stops[0].booking_request_id);
    const withLegs: DayRouteStop[] = stops.map((stop: DayRouteStop, i: number) => {
      const next = stops[i + 1];
      if (!next) return { ...stop, drive_minutes: null };
      const leg = matrix.leg(stop.booking_request_id, next.booking_request_id);
      return { ...stop, drive_minutes: leg ? leg.mins : null, distance_km: leg ? leg.km : null } as any;
    });

    // ── 5. Every proposed time must pass the shared validator ───────────────
    // Validated as ONE set: appointments moving together are excluded from each
    // other's capacity, exactly as the optimiser judged them. The Booking Window
    // is not re-applied here — these appointments were already accepted onto the
    // calendar, and finalising the day they sit on is not a new booking. Every
    // other hard constraint still applies in full.
    const movingIds = moves.map((m: any) => m.booking_request_id);
    const invalid: Array<{ booking_request_id: string; codes: string[]; reasons: string[] }> = [];

    for (const move of moves) {
      const row = loaded.byId[move.booking_request_id];
      const start = parseTimeStr(move.to_label);
      if (!row || !isFinite(start)) {
        invalid.push({
          booking_request_id: move.booking_request_id,
          codes: ['MISSING_REQUIRED_DATA'],
          reasons: ['The proposed time could not be read.'],
        });
        continue;
      }
      const ctx = await loadPlacementContext(admin, { booking: row, date, barberId: loaded.barberId || null });
      const placement = evaluatePlacement(ctx, start, {
        source: 'manual',
        admin_override_window: true,
        travel: loaded.travelFor(row.id),
        ignore_appointment_ids: movingIds.filter((id: string) => id !== row.id),
      });
      const outsideNormalHours = placement.working_hours?.eligibility !== 'normal';
      if (!placement.valid || outsideNormalHours) {
        invalid.push({
          booking_request_id: row.id,
          codes: outsideNormalHours && placement.valid ? ['OUTSIDE_WORKING_HOURS'] : placement.codes,
          reasons: placement.violations.map((v: any) => v.message),
        });
      }
    }

    if (invalid.length > 0) {
      const outside = invalid.some(i => i.codes.includes('OUTSIDE_WORKING_HOURS'));
      for (const bad of invalid) {
        await recordPlacementDecision(admin, {
          booking_request_id: bad.booking_request_id,
          booking_date: date,
          barber_id: loaded.barberId || null,
          barber_name: loaded.barberName || null,
          outcome: 'rejected',
          valid: false,
          codes: bad.codes,
          event_type: 'skipped',
          trigger,
          source: 'route_flow',
          actor_name: actorName,
          actor_role: actorRole,
          detail: `Route finalisation abandoned: ${redactViolationDetail(bad.reasons.map((r: string) => ({ code: bad.codes[0] }))) || 'validation failed'}`,
        });
      }
      return {
        failure: fail(target, outside ? 'outside_normal_hours' : 'validation_failed', {
          warnings: [...loaded.warnings, ...invalid.flatMap(i => i.reasons).slice(0, 3)],
        }),
      };
    }

    const before = currentDayCost(loaded.items, loaded.driveFn, startKey);
    const driveBefore = before.drive;
    const idleBefore = before.idle;
    const driveAfter = Math.round(num(chain.driveMinutes));
    const idleAfter = Math.round(num(chain.idleMinutes));

    const summaryLine = `${withLegs.length} stop${withLegs.length === 1 ? '' : 's'} · ${driveAfter} min driving · ${idleAfter} min idle`;

    // ── 5b. One drive leg for every consecutive pair ────────────────────────
    // Worked out before anything is written, so the estimate the admin sees and the
    // legs that are stored come from exactly the same plan.
    const legPlan = planDriveLegs(withLegs, { date, day, isTest: target.is_test });
    const legWarnings: string[] = [];
    if (chain.unplaced.length > 0) {
      legWarnings.push(`${chain.unplaced.length} appointment${chain.unplaced.length === 1 ? '' : 's'} could not be connected without breaking an availability window — left exactly where ${chain.unplaced.length === 1 ? 'it is' : 'they are'}.`);
    }
    if (legPlan.unavailable > 0) {
      legWarnings.push(`${legPlan.unavailable} drive segment${legPlan.unavailable === 1 ? '' : 's'} could not be estimated — shown between the appointments as Travel unavailable and flagged for review.`);
    }
    if (legPlan.conflict > 0) {
      legWarnings.push(`${legPlan.conflict} drive segment${legPlan.conflict === 1 ? '' : 's'} needs more time than the gap between the two appointments — shown as Travel conflict with the earliest feasible start. A locked or confirmed appointment is never moved to make room.`);
    }

    // ── 6. Nothing is written for an estimate ───────────────────────────────
    if (dryRun) {
      return {
        route: {
          team_member_id: loaded.barberId,
          team_member_name: loaded.barberName || target.team_member_name,
          is_test: target.is_test,
          appointments: withLegs.length,
          moved: moves.length,
          drive_minutes: driveAfter,
          idle_minutes: idleAfter,
          waste_minutes: driveAfter + idleAfter,
          drive_before: driveBefore,
          idle_before: idleBefore,
          drive_legs_created: legPlan.legs.length,
          drive_legs_unavailable: legPlan.unavailable,
          drive_legs_conflict: legPlan.conflict,
          protected_moved: protectedMoved,
          start_location_address: loaded.startLocation?.address || '',
          start_location_configured: loaded.startLocation?.configured === true,
          first_leg_minutes: firstLeg ? firstLeg.mins : null,
          stops: withLegs,
          warnings: [...loaded.warnings, ...legWarnings],
          record_id: null,
          message: summaryLine,
        },
      };
    }

    // ── 7. Versioned re-read: the day must not have changed while we decided ─
    const fresh = await loadDay(admin, { date, day, teamMemberId: target.team_member_id, isTest: target.universe });
    if (!fresh.ok) return { failure: fail(target, fresh.reason || 'load_failed', { warnings: loaded.warnings }) };
    if (fresh.fingerprint !== loaded.fingerprint) {
      if (attempt < MAX_ATTEMPTS) continue;
      return { failure: fail(target, 'schedule_changed', { warnings: loaded.warnings }) };
    }

    // ── 8. Apply: the whole route's time changes in one write ───────────────
    if (moves.length > 0) {
      try {
        await admin.entities.BookingRequest.bulkUpdate(
          moves.map((m: any) => ({ id: m.booking_request_id, assigned_time: m.to_label })),
        );
      } catch {
        return { failure: fail(target, 'write_failed', { warnings: loaded.warnings }) };
      }
    }

    // ── 9. Derived drive legs ───────────────────────────────────────────────
    const legCount = await writeDriveLegs(admin, { date, stops: withLegs, plan: legPlan });

    // ── 10. The day-level record ────────────────────────────────────────────
    // The fingerprint is read back from the day AFTER the write, so the stored
    // route is compared against reality rather than against our own intention.
    // Stamped from exactly the set the route is later judged against (routeDayRows):
    // a real route covers its barber's whole day, test appointments included, so
    // stamping from the real universe alone would outdate the route immediately.
    const savedRows = await dayBookings(admin, date);
    const savedFingerprint = routeFingerprint(routeDayRows(savedRows, target));

    const now = new Date().toISOString();
    const patch = {
      date,
      day,
      team_member_id: target.team_member_id,
      team_member_name: loaded.barberName || target.team_member_name,
      is_test: target.is_test,
      route_status: 'finalised',
      fingerprint: savedFingerprint,
      finalised_at: now,
      finalised_by: actorName,
      needs_update_at: null,
      needs_update_reason: null,
      appointments_count: withLegs.length,
      appointments_moved: moves.length,
      drive_minutes: driveAfter,
      idle_minutes: idleAfter,
      waste_minutes: driveAfter + idleAfter,
      drive_legs_created: legCount,
      protected_moved: protectedMoved,
      start_location_address: loaded.startLocation?.address || '',
      start_location_configured: loaded.startLocation?.configured === true,
      start_time: withLegs[0]?.start_label || '',
      end_time: withLegs[withLegs.length - 1]?.end_label || '',
      first_leg_minutes: firstLeg ? firstLeg.mins : null,
      // Only the fields the record stores — leg distances live on the drive legs.
      stops: withLegs.map((s: any) => ({
        booking_request_id: s.booking_request_id,
        order: s.order,
        start_label: s.start_label,
        start_decimal: s.start_decimal,
        end_label: s.end_label,
        drive_minutes: s.drive_minutes,
      })),
      summary: summaryLine,
    };

    const existing = findRecord(
      await loadDayRouteRecords(admin, { date, teamMemberId: target.team_member_id }),
      target,
    );
    let record: any = null;
    try {
      record = existing
        ? await admin.entities.DayRoute.update(existing.id, patch)
        : await admin.entities.DayRoute.create(patch);
    } catch { /* the route itself is saved; the record is reporting */ }

    // ── 11. The audit trail and one activity entry ──────────────────────────
    for (const move of moves) {
      const from = parseTimeStr(move.from_label);
      await recordPlacementDecision(admin, {
        booking_request_id: move.booking_request_id,
        booking_date: date,
        barber_id: loaded.barberId || null,
        barber_name: loaded.barberName || null,
        proposed_time: move.to_label,
        previous_time: move.from_label || null,
        proposed_start_decimal: parseTimeStr(move.to_label),
        event_type: 'reshuffle',
        outcome: 'saved',
        valid: true,
        codes: [],
        trigger,
        source: 'route_flow',
        actor_name: actorName,
        actor_role: actorRole,
        detail: `Route finalised — moved from ${move.from_label} to ${move.to_label}${isFinite(from) ? ` · ${Math.round((parseTimeStr(move.to_label) - from) * 60)} min` : ''}`,
      });
    }

    await recordRouteFlowActivity(admin, {
      event_type: 'route_finalised',
      summary: `Route finalised · ${shortDate(date)}${loaded.barberName ? ` · ${loaded.barberName}` : ''}`,
      detail: [
        `${withLegs.length} appointment${withLegs.length === 1 ? '' : 's'} included`,
        `${moves.length} moved`,
        `Drive: ${driveBefore} → ${driveAfter} min`,
        `Idle: ${idleBefore} → ${idleAfter} min`,
        `${legCount} drive leg${legCount === 1 ? '' : 's'} created`,
        `${legPlan.review} segment${legPlan.review === 1 ? '' : 's'} needing review`,
        '0 protected appointments moved',
      ].join(' · '),
      schedule_date: date,
      actor_type: actorRole === 'admin' ? 'admin' : 'route_flow',
      actor_name: actorRole === 'admin' ? actorName : null,
      trigger_type: trigger,
      outcome: 'applied',
      bookings_evaluated: withLegs.length,
      appointments_moved: moves.length,
      protected_moved: protectedMoved,
      drive_before: driveBefore,
      drive_after: driveAfter,
      idle_before: idleBefore,
      idle_after: idleAfter,
      previous_value: `${driveBefore} min drive · ${idleBefore} min idle`,
      new_value: `${driveAfter} min drive · ${idleAfter} min idle · ${legCount} drive legs`,
      related_record_id: record?.id || null,
      related_record_type: 'DayRoute',
      details: {
        barber_name: loaded.barberName || null,
        start_location: loaded.startLocation?.address || null,
        first_leg_minutes: firstLeg ? firstLeg.mins : null,
        drive_legs_created: legCount,
        appointments_included: withLegs.length,
        moves: movesForDetail(moves),
        stops: withLegs.map((s: DayRouteStop) => ({
          booking_request_id: s.booking_request_id,
          start_label: s.start_label,
          drive_minutes: s.drive_minutes,
        })),
      },
    });

    return {
      route: {
        team_member_id: loaded.barberId,
        team_member_name: loaded.barberName || target.team_member_name,
        is_test: target.is_test,
        appointments: withLegs.length,
        moved: moves.length,
        drive_minutes: driveAfter,
        idle_minutes: idleAfter,
        waste_minutes: driveAfter + idleAfter,
        drive_before: driveBefore,
        idle_before: idleBefore,
        drive_legs_created: legCount,
        drive_legs_unavailable: legPlan.unavailable,
        drive_legs_conflict: legPlan.conflict,
        protected_moved: protectedMoved,
        start_location_address: loaded.startLocation?.address || '',
        start_location_configured: loaded.startLocation?.configured === true,
        first_leg_minutes: firstLeg ? firstLeg.mins : null,
        stops: withLegs,
        warnings: [...loaded.warnings, ...legWarnings],
        record_id: record?.id || null,
        message: summaryLine,
      },
    };
  }

  return { failure: fail(target, 'schedule_changed') };
}

/**
 * Finalise Route — one press for the whole selected day.
 *
 * Always estimates first when asked (dryRun), and applies the day's routes
 * atomically per barber: every appointment in the final arrangement is validated
 * before anything is written, and a day that cannot be arranged completely is
 * left exactly as it was.
 */
export async function finaliseDayRoute(admin: any, opts: FinaliseOptions): Promise<FinaliseResult> {
  const date = String(opts.date || '').trim();
  const dryRun = opts.dryRun === true;
  const result = blankResult(date, dryRun);
  if (!date) {
    return { ...result, code: 'MISSING_DATE', message: 'No date was given to finalise.' };
  }

  const { targets, appointments, eligible } = await resolveRouteTargets(admin, {
    date,
    teamMemberId: opts.teamMemberId || null,
    isTest: opts.isTest,
  });
  result.eligible = eligible;
  result.appointments = appointments;

  if (targets.length === 0) {
    return { ...result, code: 'NO_APPOINTMENTS', message: FAIL_MESSAGES.no_appointments };
  }
  if (appointments < MIN_STOPS_TO_FINALISE) {
    return { ...result, code: 'NOT_ENOUGH_APPOINTMENTS', message: FAIL_MESSAGES.not_enough_appointments };
  }

  for (const target of targets) {
    const { route, failure } = await finaliseOne(admin, { ...opts, date, day: weekdayNameOf(date) }, target);
    if (route) result.finalised.push(route);
    if (failure) result.failed.push(failure);
  }

  const routes = result.finalised;
  const sum = (key: keyof FinalisedRoute) => routes.reduce((total, r) => total + num(r[key]), 0);
  result.moved = sum('moved');
  result.drive_minutes = sum('drive_minutes');
  result.idle_minutes = sum('idle_minutes');
  result.waste_minutes = sum('waste_minutes');
  result.drive_before = sum('drive_before');
  result.idle_before = sum('idle_before');
  result.drive_legs_created = sum('drive_legs_created');
  result.drive_legs_unavailable = sum('drive_legs_unavailable');
  result.drive_legs_conflict = sum('drive_legs_conflict');
  result.protected_moved = sum('protected_moved');

  // A segment that needs a person to look at it is stated in the outcome itself,
  // never left for someone to notice on the calendar.
  const reviewCount = result.drive_legs_unavailable + result.drive_legs_conflict;
  const reviewNote = reviewCount > 0 ? ` · ${reviewCount} segment${reviewCount === 1 ? '' : 's'} need review` : '';

  result.ok = result.failed.length === 0 && routes.length > 0;
  result.code = result.ok ? null : (result.failed[0]?.reason || 'FINALISE_FAILED');
  result.message = result.ok
    ? (dryRun
      ? `${sum('appointments')} appointment${sum('appointments') === 1 ? '' : 's'} ready · ${result.drive_minutes} min driving · ${result.idle_minutes} min idle${reviewNote}`
      : `Route finalised · ${sum('appointments')} appointment${sum('appointments') === 1 ? '' : 's'} · ${result.drive_minutes} min driving · ${result.idle_minutes} min idle${reviewNote}`)
    : (result.failed[0]?.message || 'The route could not be finalised.');
  return result;
}