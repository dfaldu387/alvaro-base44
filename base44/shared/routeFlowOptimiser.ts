/**
 * Route Flow (Stage 2) — automatic optimisation of a provisional day.
 *
 *   optimiseDay(date, barber)
 *     ├─ load the day as it stands        (one barber, one date)
 *     ├─ anchors  = Locked / Confirmed / overridden / blocked / outside normal hours
 *     ├─ movables = Provisional appointments only
 *     ├─ evaluateSchedule                 (search for a lower-drive, lower-idle day)
 *     ├─ improvement = drive + idle saved (combined, minimum 10 minutes)
 *     ├─ evaluatePlacement                (Stage 0 validator, EVERY proposed time)
 *     ├─ versioned re-read               (abort + retry if the day changed)
 *     ├─ bulkUpdate                       (the whole plan, or nothing at all)
 *     └─ activity + audit trail
 *
 * Guarantees:
 *  - Only Provisional appointments may move. Locked and Confirmed are fixed
 *    anchors, and an availability override is never created.
 *  - No booking is ever dropped, displaced or returned to Unscheduled: Stage 2
 *    changes times only, and it never places an unscheduled request.
 *  - Every proposed time stays completely inside that customer's own submitted
 *    availability window, inside the barber's normal working hours, inside
 *    service coverage and outside every other appointment's occupancy.
 *  - The first leg of the proposed day is measured from the barber's saved start
 *    location — it is never scored as zero travel.
 *  - A partial reshuffle is impossible: every move is validated first, then the
 *    whole set is written in one call. If anything fails, nothing is written.
 *  - Test bookings only ever rearrange other test bookings.
 */

import { mapboxDriveMatrix, toTravelMins } from './mapboxTravel.ts';
import { evaluateSchedule } from './reshuffleEngine.ts';
import {
  loadPlacementContext,
  evaluatePlacement,
  readStartLocation,
  resolveWorkWindow,
} from './schedulingValidator.ts';
import { resolveBookingTiming, occupancyMinutes } from './appointmentTiming.ts';
import { parseTimeStr, parseWindow, isAutomationAllowed, isFixedForAutomation } from './provisionalPlacement.ts';
import { recordPlacementDecision, redactViolationDetail } from './placementAudit.ts';
import { recordRouteFlowActivity, movesForDetail } from './routeFlowActivity.ts';

/** Minimum combined drive + idle saving before Route Flow moves anything. */
export const MIN_COMBINED_SAVED_MINUTES = 10;
/** Drive-matrix key for the barber's saved start location. */
const START_KEY = 'START';
/** Retries when the day changes while Route Flow is working. */
const MAX_ATTEMPTS = 3;
/** Statuses that never occupied real time. */
const INACTIVE_STATUSES = ['declined', 'no_show', 'completed', 'could_not_fit'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface DayTarget {
  date: string;
  teamMemberId?: string;
  /** Optimise the test-data universe instead of production data. */
  isTest?: boolean;
}

export interface DayMetrics {
  drive_minutes: number;
  idle_minutes: number;
  waste_minutes: number;
}

export interface DayOptimisationResult {
  date: string;
  day: string;
  team_member_id: string;
  team_member_name: string;
  applied: boolean;
  dry_run: boolean;
  attempts: number;
  moved_count: number;
  provisional_count: number;
  protected_count: number;
  current: DayMetrics;
  proposed: DayMetrics;
  improvement: { drive_minutes_saved: number; idle_minutes_saved: number; combined_saved: number };
  changes: Array<{ booking_request_id: string; from_label: string; to_label: string; moving: boolean; protected: boolean }>;
  reason?: string;
  message?: string;
  warnings: string[];
  invalid?: Array<{ booking_request_id: string; codes: string[]; reasons: string[] }>;
}

function blank(date: string, day: string, barberId = '', barberName = ''): DayOptimisationResult {
  const zero: DayMetrics = { drive_minutes: 0, idle_minutes: 0, waste_minutes: 0 };
  return {
    date,
    day,
    team_member_id: barberId,
    team_member_name: barberName,
    applied: false,
    dry_run: false,
    attempts: 0,
    moved_count: 0,
    provisional_count: 0,
    protected_count: 0,
    current: { ...zero },
    proposed: { ...zero },
    improvement: { drive_minutes_saved: 0, idle_minutes_saved: 0, combined_saved: 0 },
    changes: [],
    warnings: [],
  };
}

/** "8 Oct" — compact date label for the activity entry. */
function dateLabel(dateStr: string): string {
  const [, m, d] = String(dateStr || '').split('-').map(Number);
  if (!m || !d) return dateStr;
  return `${d} ${MONTHS[m - 1] || ''}`.trim();
}

// ── Day loading ──────────────────────────────────────────────────────────────

interface LoadedDay {
  ok: boolean;
  reason?: string;
  barberId: string;
  barberName: string;
  startLocation: any;
  workStart: number;
  workEnd: number;
  items: any[];
  byId: Record<string, any>;
  provisionalCount: number;
  protectedCount: number;
  fingerprint: string;
  warnings: string[];
  driveFn: (from: string, to: string) => number | null;
  travelFor: (proposedId: string) => any;
}

/**
 * Reads one barber's day and turns it into an optimisation problem: which
 * appointments are immovable, which are movable, and how long every leg of the
 * day actually takes. Read-only — nothing is written here.
 */
export async function loadDay(
  admin: any,
  params: {
    date: string;
    day: string;
    teamMemberId: string;
    /** true / false = read only that universe; null = the barber's whole day. */
    isTest?: boolean | null;
    /**
     * An unresolved request to include in the day as a movable candidate, so an
     * arrangement that contains it can be found by rearranging the provisionals
     * around it (Stage 2.1). Omitted = the day is loaded exactly as it stands.
     */
    includeRequestId?: string;
  },
): Promise<LoadedDay> {
  const fail = (reason: string, barberId = '', barberName = '', warnings: string[] = []): LoadedDay => ({
    ok: false, reason, barberId, barberName, warnings,
    startLocation: null, workStart: 0, workEnd: 0, items: [], byId: {},
    provisionalCount: 0, protectedCount: 0, fingerprint: '', driveFn: () => null, travelFor: () => null,
  });

  let rows: any = [];
  try {
    rows = await admin.entities.BookingRequest.filter({ requested_date: params.date }, '-created_date', 300);
  } catch {
    return fail('load_failed');
  }
  const all = Array.isArray(rows) ? rows : (rows?.items || []);

  // Live catalogue, so every appointment contributes its OWN configured buffer.
  // A missing catalogue resolves to 0 — never to a hidden default.
  const serviceByName = new Map<string, any>();
  const addonByName = new Map<string, any>();
  try {
    const [serviceRows, addonRows] = await Promise.all([
      admin.entities.Service.list('sort_order', 200),
      admin.entities.AddOn.list('sort_order', 200),
    ]);
    for (const s of (serviceRows || [])) {
      if (s.is_active !== false) serviceByName.set(String(s.name || '').trim().toLowerCase(), s);
    }
    for (const a of (addonRows || [])) {
      if (a.is_active !== false) addonByName.set(String(a.name || '').trim().toLowerCase(), a);
    }
  } catch {
    /* no catalogue: buffers resolve to 0, never to a hidden default */
  }

  // Test separation: an explicit universe filter narrows the day to one universe
  // (QA and the automation ask for one). Without a filter the barber's WHOLE day is
  // read, so the route an admin connects covers every stop they can see on the
  // calendar — a real appointment is never left stranded beside a test one.
  let list = params.isTest == null
    ? (all || [])
    : (all || []).filter((r: any) => (r.is_test === true) === params.isTest);
  // Capacity and travel are per barber. Unassigned legacy rows still belong here.
  if (params.teamMemberId) {
    list = list.filter((r: any) => !r.team_member_id || r.team_member_id === params.teamMemberId);
  }

  // Stage 2 MVP: one barber's day at a time.
  const barbers = Array.from(new Set(list.map((r: any) => r.team_member_id).filter(Boolean)));
  if (!params.teamMemberId && barbers.length > 1) return fail('multiple_barbers');
  const barberId = params.teamMemberId || String(barbers[0] || '');

  // The fingerprint is the version stamp for this day: if it changes while the
  // optimisation is being worked out, the arrangement is thrown away and retried.
  const fingerprint = list
    .map((r: any) => `${r.id}:${r.assigned_time || ''}:${r.schedule_status || ''}:${r.status || ''}:${r.updated_date || ''}`)
    .sort()
    .join('|');

  let member: any = null;
  if (barberId) {
    try {
      member = await admin.entities.TeamMember.get(barberId);
    } catch {
      member = null;
    }
  }
  const barberName = member?.name || '';

  // The same working-window authority the validator uses, so every slot Route
  // Flow proposes here is a slot the validator will afterwards accept.
  const work = resolveWorkWindow(member, null, params.date, params.day);
  if (work.status !== 'open' || !work.normal) return fail('barber_not_working', barberId, barberName);
  const workStart = work.normal.start;
  const workEnd = work.normal.end;

  const startLocation = readStartLocation(member);
  const warnings: string[] = [];
  if (!startLocation?.configured) {
    warnings.push(
      `Start location not configured${barberName ? ` for ${barberName}` : ''} — the first leg of the day cannot be verified, so the first appointment is never moved.`,
    );
  }

  // ── Items ────────────────────────────────────────────────────────────────
  const items: any[] = [];
  const byId: Record<string, any> = {};
  const pointIndex: Record<string, number> = {};
  const points: Array<{ lat: number; lng: number }> = [];
  let missingLocation = false;

  const includeRequestId = String(params.includeRequestId || '');

  for (const r of list) {
    byId[r.id] = r;
    if (!r.assigned_time) {
      // Unplaced requests are normally left alone — Stage 2 rearranges a day that
      // already exists. The one exception is an explicit fit request, which joins
      // the pool as a movable candidate so the search can make room for it.
      if (r.id === includeRequestId && !INACTIVE_STATUSES.includes(r.status)) {
        const hasPoint = typeof r.address_lat === 'number' && typeof r.address_lng === 'number';
        if (!hasPoint) missingLocation = true;
        const win = parseWindow(r.availability_window);
        const serviceMins = Number(r.duration_mins) || 30;
        // Occupancy = service + this booking's own configured buffer.
        const occupancyMins = occupancyMinutes(serviceMins, resolveBookingTiming(r, serviceByName, addonByName).buffer_minutes);
        items.push({
          id: r.id,
          clientName: r.client_name || 'Client',
          start: null,
          durationHours: occupancyMins / 60,
          windowStart: win ? win.start : null,
          windowEnd: win ? win.end : null,
          anchor: false,
          anchorReason: null,
          block: false,
          candidate: true,
          lat: hasPoint ? r.address_lat : null,
          lng: hasPoint ? r.address_lng : null,
        });
        if (hasPoint) {
          pointIndex[r.id] = points.length;
          points.push({ lat: r.address_lat, lng: r.address_lng });
        }
      }
      continue;
    }
    if (INACTIVE_STATUSES.includes(r.status)) continue;   // cancelled / completed never occupied time
    const start = parseTimeStr(r.assigned_time);
    if (!isFinite(start)) continue;

    const isBlock = String(r.client_name || '').startsWith('[BLOCK]') || r.status === 'blocked';
    const serviceMins = Number(r.duration_mins) || 30;
    // Occupancy is what the calendar actually holds: service + this booking's own
    // configured buffer. Buffer time is therefore never counted as idle, and a
    // break has no buffer at all. Travel is separate and never included here.
    const occupancyHours = (isBlock
      ? serviceMins
      : occupancyMinutes(serviceMins, resolveBookingTiming(r, serviceByName, addonByName).buffer_minutes)
    ) / 60;
    const win = isBlock ? null : parseWindow(r.availability_window);
    const hasPoint = typeof r.address_lat === 'number' && typeof r.address_lng === 'number';
    if (!isBlock && !hasPoint) missingLocation = true;

    let anchor = true;
    let anchorReason: string | null = 'protected';
    // A time the customer already has (confirmed, locked, or asked to confirm via an
    // override) is fixed. A time the barber simply dragged into place is not: the
    // three-way rule lives in one shared helper so the calendar, Auto Sort and Route
    // Flow can never disagree about what may move.
    const fixed = isFixedForAutomation(r);
    if (isBlock) {
      anchorReason = 'block';
    } else if (fixed && r.availability_override === true && String(r.override_status || 'none') !== 'none') {
      anchorReason = 'override';
    } else if (!fixed && isAutomationAllowed(r.schedule_status)) {
      // A provisional appointment that already sits outside normal hours is left
      // exactly where it is — automation may not rearrange its way into or out of
      // after-hours time.
      const inNormal = start >= workStart - 1e-9 && start + occupancyHours <= workEnd + 1e-9;
      if (inNormal) {
        anchor = false;
        anchorReason = null;
      } else {
        anchorReason = 'outside_normal_hours';
      }
    } else {
      anchorReason = r.schedule_status || 'protected';
    }

    items.push({
      id: r.id,
      clientName: r.client_name || (isBlock ? 'Blocked' : 'Client'),
      start,
      durationHours: occupancyHours,
      windowStart: win ? win.start : null,
      windowEnd: win ? win.end : null,
      anchor,
      anchorReason,
      block: isBlock,
      candidate: false,
      lat: hasPoint ? r.address_lat : null,
      lng: hasPoint ? r.address_lng : null,
    });

    if (!isBlock && hasPoint) {
      pointIndex[r.id] = points.length;
      points.push({ lat: r.address_lat, lng: r.address_lng });
    }
  }

  if (missingLocation) return fail('addresses_incomplete', barberId, barberName, warnings);

  // ── One travel matrix for the whole day, start location included ─────────
  const startPoint = startLocation?.configured && startLocation.point ? startLocation.point : null;
  if (startPoint) {
    pointIndex[START_KEY] = points.length;
    points.push(startPoint);
  }

  let driveFn: (from: string, to: string) => number | null = () => null;
  if (points.length >= 2) {
    const matrix = await mapboxDriveMatrix(points);
    if (!matrix.ok || !matrix.durations) return fail('travel_unavailable', barberId, barberName, warnings);
    driveFn = (fromId: string, toId: string) => {
      const i = pointIndex[fromId];
      const j = pointIndex[toId];
      if (i == null || j == null) return null;
      const seconds = matrix.durations?.[i]?.[j];
      return toTravelMins(seconds == null ? null : seconds);
    };
  } else if (points.length === 1) {
    driveFn = () => 0;   // a single point on the day: no journey exists to measure
  }

  const travelFor = (proposedId: string) => ({
    available: true,
    reason: null,
    start: startLocation || undefined,
    mins: (fromKey: string, toKey: string) => driveFn(
      fromKey === 'PROPOSED' ? proposedId : fromKey,
      toKey === 'PROPOSED' ? proposedId : toKey,
    ),
  });

  const provisionalCount = items.filter(i => !i.anchor && !i.block && !i.candidate).length;
  const protectedCount = items.filter(i => i.anchor && !i.block).length;

  return {
    ok: true,
    barberId,
    barberName,
    startLocation,
    workStart,
    workEnd,
    items,
    byId,
    provisionalCount,
    protectedCount,
    fingerprint,
    warnings,
    driveFn,
    travelFor,
  };
}

// ── The optimisation itself ──────────────────────────────────────────────────

export interface OptimiseOptions {
  /** Work out the better arrangement and report it, but write nothing. */
  dryRun?: boolean;
  actorName?: string;
  actorRole?: 'admin' | 'automation';
  trigger?: 'automation' | 'admin_panel';
}

/**
 * Optimises one barber's day. Returns what it found — and what it did — without
 * ever leaving the day half-rearranged.
 */
export async function optimiseDay(
  admin: any,
  target: DayTarget,
  opts: OptimiseOptions = {},
): Promise<DayOptimisationResult> {
  const date = String(target.date || '').trim();
  const day = String((target as any).day || '') || weekdayNameOf(date);
  const dryRun = opts.dryRun === true;
  const actorName = opts.actorName || 'Route Flow';
  const actorRole: 'admin' | 'automation' = opts.actorRole || 'automation';
  const trigger = opts.trigger || 'automation';

  if (!date) {
    return { ...blank(date, day), reason: 'missing_date', message: 'No date to optimise.' };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // ── 1. Load the day as it stands ────────────────────────────────────────
    const loaded = await loadDay(admin, {
      date,
      day,
      teamMemberId: String(target.teamMemberId || ''),
      isTest: target.isTest === true,
    });
    if (!loaded.ok) {
      return {
        ...blank(date, day, loaded.barberId, loaded.barberName),
        reason: loaded.reason,
        message: MESSAGES[loaded.reason || ''] || 'The day could not be optimised.',
        warnings: loaded.warnings,
      };
    }

    const result = blank(date, day, loaded.barberId, loaded.barberName);
    result.attempts = attempt;
    result.provisional_count = loaded.provisionalCount;
    result.protected_count = loaded.protectedCount;
    result.warnings = loaded.warnings;
    result.dry_run = dryRun;

    if (loaded.provisionalCount === 0) {
      result.reason = 'no_provisional_appointments';
      result.message = 'Nothing to rearrange — no Provisional appointments on this day.';
      return result;
    }

    // ── 2. Score the day, then search for a better arrangement ──────────────
    const evaluation = evaluateSchedule(loaded.items, loaded.workStart, loaded.workEnd, loaded.driveFn, {
      startKey: loaded.startLocation?.configured ? START_KEY : null,
    });

    const currentWaste = evaluation.current.totalDriveMinutes + evaluation.current.totalIdleMinutes;
    const proposedWaste = evaluation.proposed.totalDriveMinutes + evaluation.proposed.totalIdleMinutes;
    const driveSaved = evaluation.current.totalDriveMinutes - evaluation.proposed.totalDriveMinutes;
    const idleSaved = evaluation.current.totalIdleMinutes - evaluation.proposed.totalIdleMinutes;
    const combinedSaved = currentWaste - proposedWaste;

    result.current = {
      drive_minutes: evaluation.current.totalDriveMinutes,
      idle_minutes: evaluation.current.totalIdleMinutes,
      waste_minutes: currentWaste,
    };
    result.proposed = {
      drive_minutes: evaluation.proposed.totalDriveMinutes,
      idle_minutes: evaluation.proposed.totalIdleMinutes,
      waste_minutes: proposedWaste,
    };
    result.improvement = {
      drive_minutes_saved: driveSaved,
      idle_minutes_saved: idleSaved,
      combined_saved: combinedSaved,
    };
    result.changes = (evaluation.changes || []).map((c: any) => ({
      booking_request_id: c.booking_request_id,
      from_label: c.from_label,
      to_label: c.to_label,
      moving: c.moving,
      protected: c.protected,
    }));

    const moves = (evaluation.changes || []).filter((c: any) => !c.protected && c.moving);

    if (moves.length === 0) {
      result.reason = 'already_optimal';
      result.message = 'No better arrangement found — the day already stands well.';
      return result;
    }

    // ── 3. Only a real saving is worth moving anyone for ────────────────────
    if (combinedSaved < MIN_COMBINED_SAVED_MINUTES) {
      result.reason = 'below_threshold';
      result.message = `Only ${Math.max(0, combinedSaved)} minutes of driving and idle time would be saved — below the ${MIN_COMBINED_SAVED_MINUTES}-minute threshold, so nothing moved.`;
      // Visible, not silent: a better arrangement was found and deliberately not
      // applied. Nothing here changes the decision itself.
      await recordRouteFlowActivity(admin, {
        event_type: 'skipped_threshold',
        summary: `Route Flow skipped ${day} ${dateLabel(date)} — saving below threshold`,
        detail: [
          `${moves.length} appointment${moves.length === 1 ? '' : 's'} could have moved`,
          `${Math.max(0, combinedSaved)} min combined saving`,
          `${MIN_COMBINED_SAVED_MINUTES} min threshold`,
          'nothing moved',
        ].join(' · '),
        schedule_date: date,
        actor_type: actorRole === 'admin' ? 'admin' : 'route_flow',
        actor_name: actorRole === 'admin' ? actorName : null,
        trigger_type: trigger,
        outcome: 'skipped',
        bookings_evaluated: loaded.provisionalCount,
        appointments_moved: 0,
        requests_placed: 0,
        requests_unscheduled: 0,
        protected_moved: 0,
        drive_before: result.current.drive_minutes,
        drive_after: result.proposed.drive_minutes,
        idle_before: result.current.idle_minutes,
        idle_after: result.proposed.idle_minutes,
        reason_code: 'below_threshold',
        reason_text: result.message,
        related_record_id: moves[0]?.booking_request_id || null,
        details: {
          barber_name: loaded.barberName || null,
          threshold_minutes: MIN_COMBINED_SAVED_MINUTES,
          combined_saved: combinedSaved,
          would_move_count: moves.length,
          would_be: true,
          moves: movesForDetail(moves),
        },
      });
      return result;
    }

    if (dryRun) {
      result.reason = 'dry_run';
      result.message = `${moves.length} appointment${moves.length === 1 ? '' : 's'} would move · ${combinedSaved} minutes saved.`;
      return result;
    }

    // ── 4. Every proposed time must pass the Stage 0 validator on live data ─
    const movingIds = moves.map((m: any) => m.booking_request_id);
    const invalid: Array<{ booking_request_id: string; codes: string[]; reasons: string[] }> = [];

    for (const move of moves) {
      const booking = loaded.byId[move.booking_request_id];
      const start = parseTimeStr(move.to_label);
      if (!booking || !isFinite(start)) {
        invalid.push({
          booking_request_id: move.booking_request_id,
          codes: ['MISSING_REQUIRED_DATA'],
          reasons: ['The proposed time could not be read.'],
        });
        continue;
      }

      const ctx = await loadPlacementContext(admin, {
        booking,
        date,
        barberId: loaded.barberId || null,
      });
      const placement = evaluatePlacement(ctx, start, {
        source: 'route_flow',
        travel: loaded.travelFor(booking.id),
        // The reshuffle is validated as ONE set: the other appointments that are
        // moving with it must not count as occupied time.
        ignore_appointment_ids: movingIds.filter((id: string) => id !== booking.id),
      });

      if (!placement.valid) {
        invalid.push({
          booking_request_id: booking.id,
          codes: placement.codes,
          reasons: placement.violations.map((v: any) => v.message),
        });
      }
    }

    if (invalid.length > 0) {
      // The whole plan is abandoned — an arrangement the validator will not
      // accept in full is never applied in part.
      result.reason = 'validation_failed';
      result.invalid = invalid;
      result.message = `${invalid.length} proposed time${invalid.length === 1 ? '' : 's'} failed scheduling validation, so nothing was moved.`;
      for (const bad of invalid) {
        const booking = loaded.byId[bad.booking_request_id];
        await recordPlacementDecision(admin, {
          booking_request_id: bad.booking_request_id,
          booking_date: date,
          barber_id: loaded.barberId || null,
          barber_name: loaded.barberName || null,
          proposed_time: moves.find((m: any) => m.booking_request_id === bad.booking_request_id)?.to_label || null,
          outcome: 'rejected',
          valid: false,
          codes: bad.codes,
          event_type: 'skipped',
          trigger,
          source: 'route_flow',
          actor_name: actorName,
          actor_role: actorRole,
          detail: `Stage 2 optimisation abandoned: ${redactViolationDetail(bad.reasons.map((r: string) => ({ code: bad.codes[0] }))) || 'validation failed'}`,
        });
      }
      return result;
    }

    // ── 5. Versioned re-read: the day must not have changed under us ────────
    const fresh = await loadDay(admin, {
      date,
      day,
      teamMemberId: loaded.barberId,
      isTest: target.isTest === true,
    });
    if (!fresh.ok) {
      result.reason = fresh.reason || 'load_failed';
      result.message = MESSAGES[fresh.reason || ''] || 'The day could not be re-read before saving.';
      return result;
    }
    if (fresh.fingerprint !== loaded.fingerprint) {
      // Someone else changed the day while Route Flow was deciding. The stale
      // arrangement is discarded — never half-applied — and the whole evaluation
      // starts again from the new state.
      if (attempt < MAX_ATTEMPTS) continue;
      result.reason = 'schedule_changed';
      result.message = 'The day kept changing while Route Flow was working, so nothing was moved.';
      await recordRouteFlowActivity(admin, {
        event_type: 'schedule_changed',
        summary: `Route Flow abandoned ${day} ${dateLabel(date)} — the day kept changing`,
        detail: [
          `The day changed while Route Flow was working`,
          `${MAX_ATTEMPTS} attempt${MAX_ATTEMPTS === 1 ? '' : 's'} made`,
          'nothing moved',
        ].join(' · '),
        schedule_date: date,
        actor_type: actorRole === 'admin' ? 'admin' : 'route_flow',
        actor_name: actorRole === 'admin' ? actorName : null,
        trigger_type: trigger,
        outcome: 'aborted',
        bookings_evaluated: loaded.provisionalCount,
        appointments_moved: 0,
        requests_placed: 0,
        requests_unscheduled: 0,
        protected_moved: 0,
        reason_code: 'schedule_changed',
        reason_text: result.message,
        related_record_id: moves[0]?.booking_request_id || null,
        details: {
          barber_name: loaded.barberName || null,
          attempts: MAX_ATTEMPTS,
          would_move_count: moves.length,
          moves: movesForDetail(moves),
        },
      });
      return result;
    }

    // ── 6. Apply the whole plan in one write, or nothing at all ─────────────
    try {
      await admin.entities.BookingRequest.bulkUpdate(
        moves.map((m: any) => ({ id: m.booking_request_id, assigned_time: m.to_label })),
      );
    } catch (error) {
      result.reason = 'write_failed';
      result.message = 'The new arrangement could not be saved, so nothing was moved.';
      return result;
    }

    result.applied = true;
    result.moved_count = moves.length;

    // ── 7. Trailing work: drive legs, audit trail, activity entry ───────────
    await markDriveLegsStale(admin, date, movingIds);

    for (const move of moves) {
      const booking = loaded.byId[move.booking_request_id];
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
        detail: `Stage 2 optimisation moved the appointment from ${move.from_label} to ${move.to_label} · ${combinedSaved} min saved (drive ${driveSaved}, idle ${idleSaved}) · day waste ${currentWaste} → ${proposedWaste} min${booking ? '' : ''}`,
      });
    }

    await recordActivity(admin, {
      date,
      day,
      actorName,
      actorRole,
      trigger,
      barberName: loaded.barberName,
      evaluatedCount: loaded.provisionalCount,
      movedCount: moves.length,
      protectedCount: loaded.protectedCount,
      driveSaved,
      idleSaved,
      current: result.current,
      proposed: result.proposed,
      combinedSaved,
      changes: moves,
      firstBookingId: moves[0].booking_request_id,
    });

    // A pending suggestion for a day Route Flow has just optimised is stale.
    await supersedeSuggestions(admin, date, loaded.barberId);

    result.message = `${moves.length} appointment${moves.length === 1 ? '' : 's'} moved · ${driveSaved} min driving and ${idleSaved} min idle saved.`;
    return result;
  }

  return { ...blank(date, day), reason: 'schedule_changed', message: 'The day kept changing, so nothing was moved.' };
}

const MESSAGES: Record<string, string> = {
  multiple_barbers: 'Stage 2 optimises one barber at a time — this day has more than one.',
  barber_not_working: 'The barber is not working on this day.',
  load_failed: 'The day could not be read.',
  travel_unavailable: 'Driving times could not be verified, so the day was left unchanged.',
  addresses_incomplete: 'An appointment on this day has no verified location, so the day was left unchanged.',
};

function weekdayNameOf(dateStr: string): string {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || '';
}

/** Drive legs touching a moved appointment are no longer trustworthy. */
export async function markDriveLegsStale(admin: any, date: string, movingIds: string[]): Promise<void> {
  try {
    const rows = await admin.entities.RouteConnection.filter({ date }, '-created_date', 200);
    const stale = (rows || [])
      .filter((c: any) => {
        const from = String(c.from_appointment_id || '').replace(/^db-/, '');
        const to = String(c.to_appointment_id || '').replace(/^db-/, '');
        return c.status !== 'stale' && (movingIds.includes(from) || movingIds.includes(to));
      })
      .map((c: any) => ({ id: c.id, status: 'stale' }));
    if (stale.length > 0) await admin.entities.RouteConnection.bulkUpdate(stale);
  } catch {
    /* drive legs are non-critical */
  }
}

/** The simple activity entry: what Route Flow changed, and what it saved. */
async function recordActivity(
  admin: any,
  entry: {
    date: string;
    day: string;
    actorName: string;
    actorRole: 'admin' | 'automation';
    trigger: string;
    barberName: string;
    evaluatedCount: number;
    movedCount: number;
    protectedCount: number;
    driveSaved: number;
    idleSaved: number;
    combinedSaved: number;
    current: DayMetrics;
    proposed: DayMetrics;
    changes: any[];
    firstBookingId: string;
  },
): Promise<void> {
  await recordRouteFlowActivity(admin, {
    event_type: 'reshuffle',
    summary: `Route Flow optimised ${entry.day} ${dateLabel(entry.date)}`.trim(),
    detail: [
      `${entry.movedCount} provisional appointment${entry.movedCount === 1 ? '' : 's'} moved`,
      `${Math.max(0, entry.driveSaved)} min driving saved`,
      `${Math.max(0, entry.idleSaved)} min idle saved`,
      '0 protected appointments moved',
    ].join(' · '),
    schedule_date: entry.date,
    actor_type: entry.actorRole === 'admin' ? 'admin' : 'route_flow',
    actor_name: entry.actorRole === 'admin' ? entry.actorName : null,
    trigger_type: entry.trigger,
    outcome: 'applied',
    bookings_evaluated: entry.evaluatedCount,
    appointments_moved: entry.movedCount,
    requests_placed: 0,
    requests_unscheduled: 0,
    protected_moved: 0,
    drive_before: entry.current.drive_minutes,
    drive_after: entry.proposed.drive_minutes,
    idle_before: entry.current.idle_minutes,
    idle_after: entry.proposed.idle_minutes,
    previous_value: `${entry.current.drive_minutes} min drive · ${entry.current.idle_minutes} min idle · ${entry.current.waste_minutes} min waste`,
    new_value: `${entry.proposed.drive_minutes} min drive · ${entry.proposed.idle_minutes} min idle · ${entry.proposed.waste_minutes} min waste · ${entry.combinedSaved} min saved`,
    related_record_id: entry.firstBookingId,
    details: {
      barber_name: entry.barberName || null,
      protected_count: entry.protectedCount,
      drive_minutes_saved: entry.driveSaved,
      idle_minutes_saved: entry.idleSaved,
      combined_saved: entry.combinedSaved,
      moves: movesForDetail(entry.changes),
    },
  });
}

/** A suggestion that has been overtaken by an applied optimisation is no longer pending. */
export async function supersedeSuggestions(admin: any, date: string, barberId: string): Promise<void> {
  try {
    const rows = await admin.entities.RouteFlowSuggestion.filter({ suggestion_date: date, status: 'pending' }, '-created_date', 20);
    const mine = (rows || [])
      .filter((s: any) => (s.team_member_id || '') === (barberId || ''))
      .map((s: any) => ({ id: s.id, status: 'superseded' }));
    if (mine.length > 0) await admin.entities.RouteFlowSuggestion.bulkUpdate(mine);
  } catch {
    /* suggestions are advisory only */
  }
}