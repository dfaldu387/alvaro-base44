/**
 * Route Flow (Stage 1) — automatic booking placement engine.
 *
 *   processBookingRequest(requestId)
 *     ├─ readiness check      (missing data → stays Unscheduled, reason recorded)
 *     ├─ generateCandidateSlots
 *     ├─ evaluatePlacement    (Stage 0 validator, unchanged, every candidate)
 *     ├─ scoreCandidate       (driving + idle)
 *     ├─ rankCandidates       (lowest waste wins, earlier start breaks ties)
 *     ├─ revalidate + write   (provisional only)
 *     └─ recordPlacementDecision
 *
 * Guarantees:
 *   - Server-side only. No client, no page, no admin click required.
 *   - NEW bookings only. Existing Provisional, Locked and Confirmed appointments
 *     are occupied time — Stage 1 never moves, removes or rearranges anything.
 *   - Only 'provisional' is ever written. Never locked, never confirmed, never an
 *     availability override.
 *   - Re-validated on a fresh read immediately before the write, and retried on a
 *     fresh context if the slot was taken while Route Flow was working.
 *   - Idempotent: a booking that already has a slot is never placed twice, so a
 *     workflow that fires twice cannot create a duplicate appointment.
 *   - Test bookings keep interacting only with test bookings (test separation is
 *     applied by the shared validator's context loader).
 */

import {
  loadPlacementContext,
  buildTravelIndex,
  evaluatePlacement,
  pointOf,
  DEAD_STATUSES,
} from './schedulingValidator.ts';
import { decimalToLabel, parseTimeStr } from './provisionalPlacement.ts';
import { recordPlacementDecision } from './placementAudit.ts';
import { movesForDetail } from './routeFlowActivity.ts';
import { generateCandidateSlots, summariseNoSlotReason, blockingCodes } from './routeFlowCandidates.ts';
import { scoreCandidate, rankCandidates, explainPlacement } from './routeFlowScoring.ts';
import { fitUnscheduledRequest } from './routeFlowFit.ts';
import {
  placementPatch,
  placementOutcomeForCodes,
  ROUTE_FLOW_OFF_REASON,
  AUTO_PLACE_OFF_REASON,
  type PlacementStatus,
} from './placementReason.ts';

/** One retry pass per racing write; three is plenty for a live calendar. */
const MAX_WRITE_ATTEMPTS = 3;
/** Grace period after a write, long enough for a simultaneous writer to land. */
const CONFLICT_SETTLE_MS = 500;
const TOP_SCORES_RETURNED = 8;

export interface ProcessOptions {
  bookingId: string;
  actorName: string;
  actorRole: 'admin' | 'automation';
  trigger?: 'automation' | 'admin_panel';
}

export interface ProcessOutcome {
  http: number;
  body: Record<string, any>;
}

export async function processBookingRequest(admin: any, opts: ProcessOptions): Promise<ProcessOutcome> {
  const { bookingId, actorName, actorRole } = opts;
  const trigger = opts.trigger || 'automation';

  // ── Route Flow must be active for automatic placement ──────────────────────
  // auto_optimise also places new requests: the day is first placed, then
  // rearranged by the Stage 2 optimiser.
  const settingsRows = await admin.entities.SchedulingBotSettings.list('-created_date', 1);
  const settings = (settingsRows || [])[0];
  const autoPlaceModes = ['auto_place', 'suggest', 'auto_optimise'];
  if (!settings || !settings.enabled || !autoPlaceModes.includes(settings.mode)) {
    // Route Flow is off, so nothing will ever place this request automatically.
    // It is recorded as needing review rather than left looking "in progress".
    await recordPlacementState(admin, bookingId, 'needs_review', ROUTE_FLOW_OFF_REASON);
    return { http: 200, body: { skipped: true, reason: 'route_flow_not_active' } };
  }
  if (settings.auto_place_new_requests === false) {
    await recordPlacementState(admin, bookingId, 'needs_review', AUTO_PLACE_OFF_REASON);
    return { http: 200, body: { skipped: true, reason: 'auto_place_disabled' } };
  }

  const auditBase = {
    trigger,
    source: 'route_flow' as const,
    actor_name: actorName,
    actor_role: actorRole,
  };

  // ── Attempt loop: re-read, regenerate, re-rank, revalidate ────────────────
  // A racing placement is seen on the next pass, so the stale one is never
  // written and the booking is re-placed into the next best free slot.
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt++) {
    let booking: any = null;
    try {
      booking = await admin.entities.BookingRequest.get(bookingId);
    } catch {
      booking = null;
    }
    if (!booking) return { http: 404, body: { error: 'booking not found' } };

    // Idempotency — a booking that already carries a slot is left exactly as is.
    if (booking.assigned_time && booking.schedule_status && booking.schedule_status !== 'unscheduled') {
      return {
        http: 200,
        body: {
          skipped: true,
          reason: 'already_placed',
          assigned_time: booking.assigned_time,
          schedule_status: booking.schedule_status,
        },
      };
    }

    const ctx = await loadPlacementContext(admin, {
      booking,
      date: booking.requested_date,
      barberId: booking.team_member_id || null,
    });

    // ── First-leg origin: the assigned barber's saved start location ──────────
    // Each barber's day starts where their own profile says it does. Route Flow
    // never assumes the day begins where the first customer happens to be, and a
    // missing start location is never treated as zero travel.
    const startMissing = !ctx.start_location?.configured;
    const startWarning = startMissing
      ? `Start location not configured${ctx.barber_name ? ` for ${ctx.barber_name}` : ''} — first-leg travel cannot be verified.`
      : null;

    // ── Required data — never guess. Leave the request Unscheduled + reason. ──
    const missing = missingRequiredData(booking, ctx);
    if (missing) {
      await recordPlacementState(admin, bookingId, 'needs_review', missing);
      await recordPlacementDecision(admin, {
        ...auditBase,
        booking_request_id: bookingId,
        booking_date: ctx.date || booking.requested_date || null,
        barber_id: ctx.barber_id,
        barber_name: ctx.barber_name,
        proposed_time: null,
        outcome: 'skipped',
        valid: false,
        codes: [],
        event_type: 'skipped',
        detail: `Auto-placement skipped: ${missing}`,
        details_json: { reason: missing },
      });
      return {
        http: 200,
        body: {
          placed: false,
          schedule_status: 'unscheduled',
          reason: 'missing_required_data',
          message: missing,
          attempts: 0,
        },
      };
    }

    // ── One Mapbox matrix covers every candidate below ───────────────────────
    // The barber's start location is included, so a candidate with no previous
    // appointment is measured from where the barber actually starts the day.
    const travel = await buildTravelIndex(ctx, pointOf(booking), { include_start_location: true });

    // ── Generate every candidate and put each through the Stage 0 validator ──
    const slots = generateCandidateSlots(ctx);
    const evaluated = slots.map(slot => ({
      slot,
      result: evaluatePlacement(ctx, slot.start, { source: 'route_flow', travel }),
    }));

    const valid = evaluated.filter(e => e.result.valid);
    if (valid.length === 0) {
      const results = evaluated.map(e => e.result);
      const codes = blockingCodes(results);
      // A missing start location means the first leg of the day cannot be
      // verified at all — say that plainly instead of blaming travel in general.
      const startBlocked = startMissing && codes.includes('TRAVEL_UNVERIFIED');
      const reason = startBlocked ? startWarning : summariseNoSlotReason(results, ctx);

      // ── Stage 2.1 — can the flexible part of the day be rearranged? ─────────
      // The request does not fit the day as it stands, so Route Flow asks the
      // second question: can the movable Provisional appointments be rearranged
      // around it? This is where existing Provisionals stop being hard occupancy.
      // Locked and Confirmed appointments stay fixed anchors, no scheduled booking
      // is ever dropped, the whole arrangement is validated against the shared
      // engine and then written as ONE atomic change. Fitting the extra booking is
      // itself the improvement, so the rearranged day is not required to be
      // cheaper to run.
      const fit = await fitUnscheduledRequest(admin, {
        requestId: bookingId,
        actorName,
        actorRole,
        trigger,
      });

      if (fit.fitted) {
        // The arrangement write carried the request's placed state with it, so the
        // request is never momentarily visible as unresolved after being placed.
        await recordPlacementDecision(admin, {
          ...auditBase,
          booking_request_id: bookingId,
          booking_date: ctx.date || booking.requested_date || null,
          barber_id: ctx.barber_id,
          barber_name: ctx.barber_name,
          proposed_time: fit.assigned_time || null,
          outcome: 'saved',
          valid: true,
          codes: [],
          event_type: 'fit',
          details_json: {
            moved_count: fit.moved_count,
            provisional_count: fit.provisional_count,
            drive_before: fit.current?.drive_minutes ?? null,
            drive_after: fit.proposed?.drive_minutes ?? null,
            idle_before: fit.current?.idle_minutes ?? null,
            idle_after: fit.proposed?.idle_minutes ?? null,
            moves: movesForDetail(fit.changes || []),
          },
          detail: [
            'No slot on the day as it stood — the day was rearranged to fit it',
            `${fit.moved_count} provisional move${fit.moved_count === 1 ? '' : 's'}`,
            `drive ${fit.current.drive_minutes} → ${fit.proposed.drive_minutes} min`,
            `idle ${fit.current.idle_minutes} → ${fit.proposed.idle_minutes} min`,
          ].join(' · '),
        });
        return {
          http: 200,
          body: {
            placed: true,
            booking_request_id: bookingId,
            assigned_time: fit.assigned_time,
            schedule_status: 'provisional',
            placed_by: 'day_rearrangement',
            rearranged: true,
            moved_count: fit.moved_count,
            evaluated_count: fit.provisional_count,
            // Backwards-compatible field: how many candidate slots were tried.
            attempts: evaluated.length,
            candidate_count: evaluated.length,
            current: fit.current,
            proposed: fit.proposed,
            improvement: fit.improvement,
            changes: fit.changes,
            warnings: [...(startBlocked ? [startWarning] : []), ...(fit.warnings || [])].filter(Boolean),
          },
        };
      }

      // Nothing could be fitted either. The request stays visible with the
      // dominant human-readable reason: the blockers Stage 1 found, upgraded to
      // the day-level verdict when the whole day was searched and still failed.
      const outcome = placementOutcomeForCodes(codes);
      let placementReason = outcome.reason;
      if (outcome.status === 'unscheduled') {
        if (fit.placement_reason) placementReason = fit.placement_reason;
        else if (fit.reason === 'travel_infeasible') placementReason = 'Rearranging the day cannot fit the travel';
        else if (fit.reason === 'no_feasible_arrangement' || fit.reason === 'not_meaningfully_better' || fit.reason === 'no_arrangement_found') {
          placementReason = 'The day cannot be rearranged to fit this request';
        }
      }
      await recordPlacementState(admin, bookingId, outcome.status, placementReason);
      await recordPlacementDecision(admin, {
        ...auditBase,
        booking_request_id: bookingId,
        booking_date: ctx.date || booking.requested_date || null,
        barber_id: ctx.barber_id,
        barber_name: ctx.barber_name,
        proposed_time: null,
        outcome: 'no_valid_slot',
        valid: false,
        codes,
        event_type: 'unscheduled',
        details_json: {
          candidate_count: evaluated.length,
          blocking_codes: codes,
          rearrangement_attempted: fit.attempted === true,
          rearrangement_reason: fit.reason || null,
        },
        detail: [
          `No valid slot · ${reason} · ${evaluated.length} candidate${evaluated.length === 1 ? '' : 's'} evaluated`,
          fit.attempted ? `day rearranged: ${fit.reason || 'no arrangement'}` : '',
        ].filter(Boolean).join(' · '),
      });
      return {
        http: 200,
        body: {
          placed: false,
          schedule_status: 'unscheduled',
          reason: startBlocked ? 'start_location_missing' : 'no_valid_slot',
          message: reason,
          attempts: evaluated.length,
          candidate_count: evaluated.length,
          blocking_codes: codes,
          warnings: startBlocked ? [startWarning] : [],
          window: ctx.window,
          working_hours: ctx.work.normal,
          rearrangement: {
            attempted: fit.attempted,
            fitted: false,
            reason: fit.reason,
            message: fit.message,
            evaluated_count: fit.provisional_count,
            warnings: fit.warnings,
          },
        },
      };
    }

    // ── Lowest waste wins; equal cost → earlier start ────────────────────────
    const ranked = rankCandidates(valid.map(e => scoreCandidate(ctx, e.result)));
    const winner = ranked[0];

    // ── Revalidate the winning slot on a fresh read, immediately before writing ──
    // The same travel index is reused: a neighbour that appeared in the meantime
    // resolves to no estimate, which fails the candidate and triggers a retry
    // with a fresh matrix rather than writing a placement we cannot verify.
    const fresh = await loadPlacementContext(admin, {
      booking,
      date: ctx.date,
      barberId: ctx.barber_id,
    });
    const raced = await bookingAlreadyPlaced(admin, bookingId, fresh);
    if (raced) {
      return { http: 200, body: { skipped: true, reason: 'already_placed', ...raced } };
    }

    const recheck = evaluatePlacement(fresh, winner.start, { source: 'route_flow', travel });
    if (!recheck.valid) {
      if (attempt < MAX_WRITE_ATTEMPTS) continue;
      await recordPlacementState(admin, bookingId, 'unscheduled', SLOT_CHANGED_REASON);
      await recordPlacementDecision(admin, {
        ...auditBase,
        booking_request_id: bookingId,
        booking_date: fresh.date || ctx.date || null,
        barber_id: fresh.barber_id,
        barber_name: fresh.barber_name,
        proposed_time: winner.label,
        outcome: 'rejected',
        valid: false,
        codes: recheck.codes,
        event_type: 'unscheduled',
        details_json: { attempts: attempt, reason: 'slot_taken_during_placement' },
        detail: 'The chosen slot was taken while Route Flow was working.',
      });
      return {
        http: 409,
        body: {
          placed: false,
          schedule_status: 'unscheduled',
          code: 'SCHEDULE_CHANGED',
          reason: 'slot_taken_during_placement',
          attempts: attempt,
        },
      };
    }

    // ── Write the provisional placement — nothing else is ever changed ───────
    const written = decimalToLabel(winner.start);
    const saved = await admin.entities.BookingRequest.update(bookingId, {
      assigned_time: written,
      schedule_status: 'provisional',
    });

    // ── Concurrent write detection ───────────────────────────────────────────
    // Two writers can clear the pre-write check in the same instant, because
    // checking and writing are not one atomic step. The LATER write yields: its
    // check runs after both writes have landed, so the clash is always seen and
    // always resolved by the side that created it. Both sides reach the same
    // verdict from the same data, so exactly one keeps the slot. The yielding
    // booking returns to Unscheduled and is re-placed into the next best free
    // slot, so a double booking can never persist on the calendar.
    const clash = await detectConcurrentWrite(admin, {
      booking,
      ctx: fresh,
      start: winner.start,
      ourStamp: String(saved?.updated_date || ''),
    });
    if (clash) {
      let current: any = null;
      try { current = await admin.entities.BookingRequest.get(bookingId); } catch { current = null; }
      if (current && current.assigned_time === written && current.schedule_status === 'provisional') {
        await admin.entities.BookingRequest.update(bookingId, {
          assigned_time: null,
          schedule_status: 'unscheduled',
        });
      }
      if (attempt < MAX_WRITE_ATTEMPTS) continue;
      await recordPlacementState(admin, bookingId, 'unscheduled', SLOT_CHANGED_REASON);
      await recordPlacementDecision(admin, {
        ...auditBase,
        booking_request_id: bookingId,
        booking_date: fresh.date || ctx.date || null,
        barber_id: fresh.barber_id,
        barber_name: fresh.barber_name,
        proposed_time: winner.label,
        outcome: 'rejected',
        valid: false,
        codes: ['APPOINTMENT_OVERLAP'],
        event_type: 'unscheduled',
        details_json: { attempts: attempt, reason: 'concurrent_placement' },
        detail: 'Another placement took the slot at the same moment.',
      });
      return {
        http: 409,
        body: {
          placed: false,
          schedule_status: 'unscheduled',
          code: 'SCHEDULE_CHANGED',
          reason: 'slot_taken_during_placement',
          attempts: attempt,
        },
      };
    }

    // The request now has a slot — recorded on the request itself, after the
    // concurrency check, so a placed request is never shown as unresolved.
    await recordPlacementState(admin, bookingId, 'placed', null);

    await recordPlacementDecision(admin, {
      ...auditBase,
      booking_request_id: bookingId,
      booking_date: fresh.date || ctx.date || null,
      barber_id: fresh.barber_id,
      barber_name: fresh.barber_name,
      proposed_time: winner.label,
      proposed_start_decimal: winner.start,
      outcome: 'saved',
      valid: true,
      codes: [],
      event_type: 'auto_placement',
      details_json: {
        evaluated_count: evaluated.length,
        valid_count: valid.length,
        from_label: 'Unscheduled',
        driving_minutes: winner.driving_minutes,
        idle_minutes: winner.idle_minutes,
        retries: attempt - 1,
      },
      detail: explainPlacement(winner, valid.length, evaluated.length, attempt - 1),
    });

    return {
      http: 200,
      body: {
        placed: true,
        booking_request_id: bookingId,
        assigned_time: winner.label,
        schedule_status: saved?.schedule_status || 'provisional',
        calendar_minutes: ctx.calendar_minutes,
        service_minutes: ctx.service_minutes,
        coverage_tier: winner.result.coverage?.tier || null,
        travel: winner.result.travel,
        // Backwards-compatible field: how many candidate slots were tried.
        attempts: evaluated.length,
        candidate_count: evaluated.length,
        valid_count: valid.length,
        waste_minutes: winner.wasted_minutes,
        driving_minutes: winner.driving_minutes,
        idle_minutes: winner.idle_minutes,
        retries: attempt - 1,
        scored: ranked.slice(0, TOP_SCORES_RETURNED).map(s => ({
          time: s.label,
          driving_minutes: s.driving_minutes,
          idle_minutes: s.idle_minutes,
          waste_minutes: s.wasted_minutes,
          previous: s.previous_label,
          previous_from_start: s.previous_from_start,
          next: s.next_label,
        })),
      },
    };
  }

  return { http: 500, body: { placed: false, error: 'placement could not be completed' } };
}

/** Shown when another writer took the slot while Route Flow was working. */
const SLOT_CHANGED_REASON = 'Slot was taken while placing — needs re-placing';

/**
 * Writes the request's visible placement state onto the request itself, so an
 * admin can always see where a request stands without reading the audit trail.
 * Best-effort: a failure here must never change the placement decision.
 */
async function recordPlacementState(
  admin: any,
  bookingId: string,
  status: PlacementStatus,
  reason?: string | null,
) {
  try {
    await admin.entities.BookingRequest.update(bookingId, placementPatch(status, reason));
  } catch { /* the audit trail still holds the decision */ }
}

/**
 * The engine will not place a request that does not have what a real placement
 * needs. Each reason is recorded in the audit trail and returned to the caller.
 */
function missingRequiredData(booking: any, ctx: any): string | null {
  if (!ctx.date) return 'No appointment date on the request';
  if (!(ctx.service_minutes > 0)) return 'No usable service duration on the request';
  if (!ctx.window && !ctx.window_flexible) {
    return ctx.window_raw
      ? `The availability window "${ctx.window_raw}" could not be read`
      : 'No availability window on the request';
  }
  if (ctx.coverage_error) return ctx.coverage_error;
  if (ctx.work.status === 'closed') return 'No capacity during barber hours';
  return null;
}

/**
 * Finds an appointment that landed on top of the placement we just wrote.
 *
 * Only a simultaneous writer can produce this — the slot was validated as free
 * moments earlier. The comparison is deterministic and symmetric, so both
 * writers reach the same verdict and only one yields: the LATER write yields to
 * the one already on the calendar, with the record id breaking an identical
 * timestamp tie. The later side is the one that must yield because its check
 * runs after both writes have landed — it is therefore always the side that can
 * see the clash.
 */
async function detectConcurrentWrite(
  admin: any,
  { booking, ctx, start, ourStamp }: { booking: any; ctx: any; start: number; ourStamp: string },
) {
  // Give the other writer time to commit before deciding who yields.
  await new Promise(resolve => setTimeout(resolve, CONFLICT_SETTLE_MS));

  const end = start + (Number(ctx?.calendar_minutes) || 0) / 60;
  let rows: any[] = [];
  try {
    rows = await admin.entities.BookingRequest.filter({ requested_date: ctx.date }, '-created_date', 200);
  } catch {
    return null;
  }

  for (const r of (rows || [])) {
    if (r.id === booking.id) continue;
    // Same separation rules the validator applied: test records only ever
    // clash with test records, and capacity is per barber.
    if ((r.is_test === true) !== (booking.is_test === true)) continue;
    if (ctx.barber_id && r.team_member_id && r.team_member_id !== ctx.barber_id) continue;
    if (!r.assigned_time || DEAD_STATUSES.includes(r.status)) continue;

    const otherStart = parseTimeStr(r.assigned_time);
    if (!isFinite(otherStart)) continue;
    // The other appointment's occupancy exactly as the shared validator computed
    // it (service + ITS configured buffer) — never a second guess at the timing.
    const otherBlock = (ctx?.occupied || []).find((o: any) => o.id === r.id);
    const otherEnd = otherBlock
      ? otherBlock.occupied_end
      : otherStart + (Number(r.duration_mins) || 30) / 60;
    if (!(start < otherEnd - 1e-9 && end > otherStart + 1e-9)) continue;

    const otherStamp = String(r.updated_date || '');
    if (otherStamp < ourStamp || (otherStamp === ourStamp && String(r.id) < String(booking.id))) {
      return r;
    }
  }
  return null;
}

/** True when another writer placed this booking while we were working. */
async function bookingAlreadyPlaced(admin: any, bookingId: string, freshCtx: any) {
  let current: any = freshCtx?.booking || null;
  try {
    current = await admin.entities.BookingRequest.get(bookingId);
  } catch {
    current = freshCtx?.booking || null;
  }
  if (current?.assigned_time && current.schedule_status && current.schedule_status !== 'unscheduled') {
    return { assigned_time: current.assigned_time, schedule_status: current.schedule_status };
  }
  return null;
}