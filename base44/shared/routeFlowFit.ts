/**
 * Route Flow (Stage 2.1) — fit an unresolved request by rearranging the day.
 *
 * Stage 1 asks "does this request fit into the day as it stands?". When it does
 * not, this stage asks the second question: "can the FLEXIBLE part of the day be
 * rearranged so that it fits — without dropping or displacing anything?"
 *
 *   fitUnscheduledRequest(requestId)
 *     ├─ pool    = the unresolved request + every movable Provisional on the day
 *     ├─ anchors = Locked / Confirmed / overridden / blocked / outside normal hours
 *     ├─ evaluateSchedule(objective: 'fit')
 *     │     every movable AND the request must be placed, or it is not feasible
 *     │     lowest driving + idle wins, ties resolved to the earlier schedule
 *     ├─ evaluatePlacement   (shared validator, EVERY proposed time)
 *     ├─ versioned re-read   (abort + retry when the day changed under us)
 *     ├─ bulkUpdate          (the whole arrangement, or nothing at all)
 *     └─ one activity entry + the audit trail
 *
 * Guarantees:
 *  - No already-scheduled appointment is ever dropped to make room: a proposed
 *    arrangement is only accepted when every existing Provisional is still on the
 *    calendar AND the new request has been added.
 *  - Fitting the request decides the outcome. The rearranged day is not required
 *    to be cheaper to run, because one extra valid booking is itself the gain.
 *  - Locked, Confirmed and overridden appointments are immovable anchors, and no
 *    availability override is ever created.
 *  - Cost is driving + idle minutes only: no commercial, favourite, displacement
 *    or revenue weighting.
 *  - The first leg of the day runs from the barber's saved start location, so the
 *    first appointment is never treated as costing zero travel.
 *  - A partial reshuffle is impossible: every proposed time is validated against
 *    the shared engine first, then the whole arrangement is written in one call.
 *  - Test bookings only ever rearrange other test bookings (enforced by the
 *    shared day loader).
 */

import { evaluateSchedule } from './reshuffleEngine.ts';
import { loadDay, markDriveLegsStale, supersedeSuggestions } from './routeFlowOptimiser.ts';
import { loadPlacementContext, evaluatePlacement } from './schedulingValidator.ts';
import { parseTimeStr } from './provisionalPlacement.ts';
import { recordPlacementDecision, redactViolationDetail } from './placementAudit.ts';
import { recordRouteFlowActivity, movesForDetail } from './routeFlowActivity.ts';
import { placementPatch, reasonFromCodes } from './placementReason.ts';
import { holdIfFinalised } from './finalisedDayGate.ts';

/** Drive-matrix key for the barber's saved start location. */
const START_KEY = 'START';
/** Retries when the day changes while Route Flow is working. */
const MAX_ATTEMPTS = 3;
/** The Stage 2 optimiser's own threshold — reported, never applied here. */
const OPTIMISER_THRESHOLD_MINUTES = 10;

export interface FitMetrics {
  drive_minutes: number;
  idle_minutes: number;
  waste_minutes: number;
}

export interface FitChange {
  booking_request_id: string;
  from_label: string;
  to_label: string;
  moving: boolean;
  is_new: boolean;
  duration_mins: number;
}

export interface FitResult {
  attempted: boolean;
  fitted: boolean;
  applied: boolean;
  reason: string | null;
  message: string | null;
  /** Short admin-facing reason to store on the request when the fit failed. */
  placement_reason: string | null;
  evaluated_count: number;
  moved_count: number;
  provisional_count: number;
  protected_count: number;
  placed_request_id: string | null;
  assigned_time: string | null;
  current: FitMetrics;
  proposed: FitMetrics;
  improvement: {
    drive_minutes_saved: number;
    idle_minutes_saved: number;
    combined_saved: number;
    additional_bookings_fit: number;
    below_optimiser_threshold: boolean;
  };
  changes: FitChange[];
  warnings: string[];
  invalid?: Array<{ booking_request_id: string; codes: string[]; reasons: string[] }>;
}

export interface FitOptions {
  requestId: string;
  actorName: string;
  actorRole: 'admin' | 'automation';
  trigger?: 'automation' | 'admin_panel';
}

/** Every outcome is described in one short, honest sentence. */
const MESSAGES: Record<string, string> = {
  booking_not_found: 'The request could not be found.',
  already_placed: 'The request already holds an appointment time.',
  no_appointment_date: 'The request has no appointment date.',
  no_provisional_appointments: 'There are no movable provisional appointments on this day to rearrange.',
  no_feasible_arrangement: 'The day cannot be rearranged to fit this request without taking an existing booking off the calendar.',
  travel_infeasible: 'The day cannot be rearranged to fit this request in the available travel time.',
  no_arrangement_found: 'No arrangement of this day was found for the request.',
  not_meaningfully_better: 'No arrangement of this day fits the request.',
  validation_failed: 'A proposed time failed scheduling validation, so nothing was moved.',
  schedule_changed: 'The day kept changing while Route Flow was working, so nothing was moved.',
  load_failed: 'The day could not be read.',
  travel_unavailable: 'Driving times could not be verified, so nothing was moved.',
  addresses_incomplete: 'An appointment on this day has no verified location, so nothing was moved.',
  barber_not_working: 'The barber is not working on this day.',
  multiple_barbers: 'This day holds more than one barber, so it cannot be rearranged automatically.',
  write_failed: 'The new arrangement could not be saved, so nothing was moved.',
};

const ZERO: FitMetrics = { drive_minutes: 0, idle_minutes: 0, waste_minutes: 0 };

function blankFit(): FitResult {
  return {
    attempted: true,
    fitted: false,
    applied: false,
    reason: null,
    message: null,
    placement_reason: null,
    evaluated_count: 0,
    moved_count: 0,
    provisional_count: 0,
    protected_count: 0,
    placed_request_id: null,
    assigned_time: null,
    current: { ...ZERO },
    proposed: { ...ZERO },
    improvement: {
      drive_minutes_saved: 0,
      idle_minutes_saved: 0,
      combined_saved: 0,
      additional_bookings_fit: 0,
      below_optimiser_threshold: false,
    },
    changes: [],
    warnings: [],
  };
}

function failFit(reason: string, extra: Partial<FitResult> = {}): FitResult {
  const attempted = reason !== 'booking_not_found' && reason !== 'already_placed';
  return {
    ...blankFit(),
    attempted,
    ...extra,
    reason,
    message: MESSAGES[reason] || 'The day could not be rearranged.',
  };
}

function metricsOf(set: any): FitMetrics {
  const drive = Math.round(Number(set?.totalDriveMinutes) || 0);
  const idle = Math.round(Number(set?.totalIdleMinutes) || 0);
  return { drive_minutes: drive, idle_minutes: idle, waste_minutes: drive + idle };
}

function changesOf(evaluation: any): FitChange[] {
  return (evaluation?.changes || []).map((c: any) => ({
    booking_request_id: c.booking_request_id,
    from_label: c.from_label,
    to_label: c.to_label,
    moving: c.moving === true,
    is_new: c.is_new === true,
    duration_mins: c.duration_mins,
  }));
}

/** Everything the caller can be told about a day that was loaded and scored. */
function reporting(loaded: any, evaluation?: any): Partial<FitResult> {
  return {
    evaluated_count: Number(loaded?.provisionalCount) || 0,
    provisional_count: Number(loaded?.provisionalCount) || 0,
    protected_count: Number(loaded?.protectedCount) || 0,
    current: metricsOf(evaluation?.current),
    proposed: metricsOf(evaluation?.proposed),
    changes: changesOf(evaluation),
    warnings: loaded?.warnings || [],
  };
}

function weekdayNameOf(dateStr: string): string {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return '';
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[new Date(Date.UTC(y, m - 1, d)).getUTCDay()] || '';
}

/**
 * Tries to fit one unresolved request by rearranging the movable Provisional
 * appointments on its day. Applies the whole arrangement, or writes nothing.
 */
export async function fitUnscheduledRequest(admin: any, opts: FitOptions): Promise<FitResult> {
  const actorName = opts.actorName || 'Route Flow';
  const actorRole: 'admin' | 'automation' = opts.actorRole || 'automation';
  const trigger = opts.trigger || 'automation';
  const auditBase = {
    trigger,
    source: 'route_flow' as const,
    actor_name: actorName,
    actor_role: actorRole,
  };

  let booking: any = null;
  try {
    booking = await admin.entities.BookingRequest.get(opts.requestId);
  } catch {
    booking = null;
  }
  if (!booking) return failFit('booking_not_found');
  // Idempotency — a request that already holds a time is never rearranged for.
  if (booking.assigned_time && booking.schedule_status && booking.schedule_status !== 'unscheduled') {
    return failFit('already_placed');
  }

  const date = String(booking.requested_date || '').trim();
  if (!date) return failFit('no_appointment_date');
  const day = String(booking.day || '') || weekdayNameOf(date);
  const teamMemberId = String(booking.team_member_id || '');
  const isTest = booking.is_test === true;

  // Automatic fitting never rearranges a finalised day; a person fitting a request still can.
  if (actorRole === 'automation') {
    const held = await holdIfFinalised(admin, { date, teamMemberId, isTest });
    if (held) return { ...failFit(held.reason), message: held.message };
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // ── 1. The day as it stands, with the request in the pool ───────────────
    const loaded = await loadDay(admin, { date, day, teamMemberId, isTest, includeRequestId: booking.id });
    if (!loaded.ok) return failFit(loaded.reason || 'load_failed', { warnings: loaded.warnings });
    if (loaded.provisionalCount === 0) {
      // Nothing is movable, so there is nothing to rearrange — Stage 1 already
      // proved the request does not fit the day as it stands.
      return failFit('no_provisional_appointments', reporting(loaded));
    }

    // ── 2. Search for a complete arrangement containing the request ─────────
    const evaluation = evaluateSchedule(loaded.items, loaded.workStart, loaded.workEnd, loaded.driveFn, {
      startKey: loaded.startLocation?.configured ? START_KEY : null,
      objective: 'fit',
    });

    if (!evaluation.meaningful) {
      return failFit(evaluation.reason || 'no_feasible_arrangement', reporting(loaded, evaluation));
    }

    const moves = (evaluation.changes || []).filter((c: any) => !c.protected && (c.moving || c.is_new));
    const added = moves.find((c: any) => c.is_new);
    if (!added || moves.length === 0) {
      return failFit('no_feasible_arrangement', reporting(loaded, evaluation));
    }

    // ── 3. Every proposed time must pass the shared validator ───────────────
    // The arrangement is validated as ONE set: the appointments moving with it are
    // excluded from single-placement capacity, exactly as the reshuffle engine
    // judged them. Anything the validator refuses abandons the whole plan.
    const movingIds = moves.map((c: any) => c.booking_request_id);
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

      const ctx = await loadPlacementContext(admin, {
        booking: row,
        date,
        barberId: loaded.barberId || null,
      });
      const placement = evaluatePlacement(ctx, start, {
        source: 'route_flow',
        travel: loaded.travelFor(row.id),
        ignore_appointment_ids: movingIds.filter((id: string) => id !== row.id),
      });

      if (!placement.valid) {
        invalid.push({
          booking_request_id: row.id,
          codes: placement.codes,
          reasons: placement.violations.map((v: any) => v.message),
        });
      }
    }

    if (invalid.length > 0) {
      for (const bad of invalid) {
        const proposed = moves.find((m: any) => m.booking_request_id === bad.booking_request_id);
        await recordPlacementDecision(admin, {
          ...auditBase,
          booking_request_id: bad.booking_request_id,
          booking_date: date,
          barber_id: loaded.barberId || null,
          barber_name: loaded.barberName || null,
          proposed_time: proposed?.to_label || null,
          outcome: 'rejected',
          valid: false,
          codes: bad.codes,
          event_type: 'skipped',
          detail: `Rearrangement abandoned: ${redactViolationDetail(bad.codes.map((c: string) => ({ code: c }))) || 'validation failed'}`,
        });
      }
      // When the REQUEST's own proposed time is the refused one, its blockers are
      // the honest reason to store — the request itself is what cannot be placed.
      const bad = invalid.find((i) => i.booking_request_id === added.booking_request_id);
      return failFit('validation_failed', {
        ...reporting(loaded, evaluation),
        invalid,
        placement_reason: bad ? reasonFromCodes(bad.codes) : 'The day cannot be rearranged to fit this request',
      });
    }

    // ── 4. Versioned re-read: the day must not have changed under us ────────
    const fresh = await loadDay(admin, { date, day, teamMemberId, isTest, includeRequestId: booking.id });
    if (!fresh.ok) return failFit(fresh.reason || 'load_failed', reporting(loaded, evaluation));
    if (fresh.fingerprint !== loaded.fingerprint) {
      // Someone else moved something while Route Flow was deciding. Nothing is
      // written; the whole search starts again from the new state.
      if (attempt < MAX_ATTEMPTS) continue;
      return failFit('schedule_changed', reporting(loaded, evaluation));
    }

    // ── 5. Apply the whole arrangement in one write, or nothing at all ──────
    const updates = moves.map((c: any) => {
      const row = loaded.byId[c.booking_request_id];
      const update: Record<string, unknown> = { id: c.booking_request_id, assigned_time: c.to_label };
      if (c.is_new || !row?.schedule_status || row.schedule_status === 'unscheduled') {
        update.schedule_status = 'provisional';
      }
      // The request's visible state travels with the placement itself, so a fitted
      // request is never briefly shown as unresolved.
      if (c.is_new) Object.assign(update, placementPatch('placed', null));
      return update;
    });

    try {
      await admin.entities.BookingRequest.bulkUpdate(updates);
    } catch {
      return failFit('write_failed', reporting(loaded, evaluation));
    }

    const moved = moves.filter((c: any) => !c.is_new);
    const current = metricsOf(evaluation.current);
    const proposed = metricsOf(evaluation.proposed);
    const combinedSaved = current.waste_minutes - proposed.waste_minutes;

    // ── 6. Trailing work: drive legs, audit rows, one activity entry ────────
    await markDriveLegsStale(admin, date, movingIds);

    for (const move of moves) {
      await recordPlacementDecision(admin, {
        ...auditBase,
        booking_request_id: move.booking_request_id,
        booking_date: date,
        barber_id: loaded.barberId || null,
        barber_name: loaded.barberName || null,
        proposed_time: move.to_label,
        previous_time: move.is_new ? null : move.from_label || null,
        proposed_start_decimal: parseTimeStr(move.to_label),
        outcome: 'saved',
        valid: true,
        codes: [],
        event_type: 'fit',
        detail: move.is_new
          ? `No slot on the day as it stood — the day was rearranged to fit it · ${moved.length} provisional move${moved.length === 1 ? '' : 's'}`
          : `Rearranged from ${move.from_label} to ${move.to_label} to fit an additional request`,
      });
    }

    await recordActivity(admin, {
      requestId: booking.id,
      scheduleDate: date,
      barberName: loaded.barberName,
      actorName,
      actorRole,
      trigger,
      evaluatedCount: loaded.provisionalCount,
      protectedCount: loaded.protectedCount,
      movedCount: moved.length,
      current,
      proposed,
      changes: moves,
    });

    // A pending suggestion for a day Route Flow has just rearranged is stale.
    await supersedeSuggestions(admin, date, loaded.barberId);

    return {
      ...blankFit(),
      fitted: true,
      applied: true,
      reason: null,
      message: `Fitted the request by rearranging ${moved.length} appointment${moved.length === 1 ? '' : 's'}.`,
      evaluated_count: loaded.provisionalCount,
      moved_count: moved.length,
      provisional_count: loaded.provisionalCount,
      protected_count: loaded.protectedCount,
      placed_request_id: added.booking_request_id,
      assigned_time: added.to_label,
      current,
      proposed,
      improvement: {
        drive_minutes_saved: current.drive_minutes - proposed.drive_minutes,
        idle_minutes_saved: current.idle_minutes - proposed.idle_minutes,
        combined_saved: combinedSaved,
        additional_bookings_fit: 1,
        // Reported so it is visible when an extra booking was fitted by a change
        // the normal optimisation threshold would have refused.
        below_optimiser_threshold: combinedSaved < OPTIMISER_THRESHOLD_MINUTES,
      },
      changes: changesOf(evaluation),
      warnings: loaded.warnings,
    };
  }

  return failFit('schedule_changed');
}

/**
 * The compact activity entry: what Route Flow fitted, what moved, and what the
 * day costs now. Never contains a client's name or contact details.
 */
async function recordActivity(
  admin: any,
  entry: {
    requestId: string;
    scheduleDate: string;
    barberName: string;
    actorName: string;
    actorRole: 'admin' | 'automation';
    trigger: string;
    evaluatedCount: number;
    protectedCount: number;
    movedCount: number;
    current: FitMetrics;
    proposed: FitMetrics;
    changes: any[];
  },
): Promise<void> {
  await recordRouteFlowActivity(admin, {
    event_type: 'fit',
    summary: 'Route Flow fitted an additional request',
    detail: [
      `${entry.evaluatedCount} provisional booking${entry.evaluatedCount === 1 ? '' : 's'} evaluated`,
      `${entry.movedCount} appointment${entry.movedCount === 1 ? '' : 's'} moved`,
      '1 new request placed',
      `Drive: ${entry.current.drive_minutes} → ${entry.proposed.drive_minutes} min`,
      `Idle: ${entry.current.idle_minutes} → ${entry.proposed.idle_minutes} min`,
      'No protected appointments moved',
    ].join(' · '),
    schedule_date: entry.scheduleDate,
    actor_type: entry.actorRole === 'admin' ? 'admin' : 'route_flow',
    actor_name: entry.actorRole === 'admin' ? entry.actorName : null,
    trigger_type: entry.trigger,
    outcome: 'applied',
    bookings_evaluated: entry.evaluatedCount,
    appointments_moved: entry.movedCount,
    requests_placed: 1,
    requests_unscheduled: 0,
    protected_moved: 0,
    drive_before: entry.current.drive_minutes,
    drive_after: entry.proposed.drive_minutes,
    idle_before: entry.current.idle_minutes,
    idle_after: entry.proposed.idle_minutes,
    previous_value: `${entry.current.drive_minutes} min drive · ${entry.current.idle_minutes} min idle · ${entry.current.waste_minutes} min waste`,
    new_value: `${entry.proposed.drive_minutes} min drive · ${entry.proposed.idle_minutes} min idle · ${entry.proposed.waste_minutes} min waste · 1 request fitted`,
    related_record_id: entry.requestId,
    details: {
      barber_name: entry.barberName || null,
      protected_count: entry.protectedCount,
      combined_saved: entry.current.waste_minutes - entry.proposed.waste_minutes,
      moves: movesForDetail(entry.changes),
    },
  });
}