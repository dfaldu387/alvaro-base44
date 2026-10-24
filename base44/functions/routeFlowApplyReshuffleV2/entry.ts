import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { parseTimeStr } from '../../shared/provisionalPlacement.ts';
import { validatePlacement } from '../../shared/schedulingValidator.ts';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { readDayVersion } from '../../shared/dayVersion.ts';
import { recordPlacementDecision, redactViolationDetail } from '../../shared/placementAudit.ts';
import { recordRouteFlowActivity, movesForDetail } from '../../shared/routeFlowActivity.ts';

/**
 * Route Flow — Apply a reviewed reshuffle suggestion (V2).
 *
 * Only runs when an admin explicitly presses "Apply Changes". The caller must
 * hold administrator authority (checked before the suggestion is read), and
 * automation is refused outright: a reshuffle is always a human decision.
 * Every change is re-validated server-side against the CURRENT database state —
 * the stored suggestion is never trusted on its own.
 *
 * Guarantees:
 *  - Only Provisional appointments may move
 *  - Locked / Confirmed / overridden appointments are never touched
 *  - The new time must sit completely inside the customer's availability window
 *  - Service duration, availability window, services and customer details are
 *    never modified — only assigned_time (and schedule_status for a brand new
 *    placement) is written
 *  - No availability override is ever created
 *  - Bookings that don't need to move are not written at all
 *  - Existing connected drive legs touching a moved appointment are marked stale
 */
const INACTIVE = ['declined', 'no_show', 'completed', 'could_not_fit'];

export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);

    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });
    if (actor.automation) {
      return Response.json({ error: 'A reshuffle must be applied by an administrator.' }, { status: 403 });
    }

    const admin = base44.asServiceRole;

    let body = {};
    try {
      body = await req.json();
    } catch {
      /* empty body */
    }

    const { suggestion_id } = body;
    if (!suggestion_id) {
      return Response.json({ error: 'suggestion_id required' }, { status: 400 });
    }

    let suggestion;
    try {
      suggestion = await admin.entities.RouteFlowSuggestion.get(suggestion_id);
    } catch {
      return Response.json({ error: 'suggestion not found' }, { status: 404 });
    }
    if (!suggestion) return Response.json({ error: 'suggestion not found' }, { status: 404 });
    if (suggestion.status === 'applied') {
      return Response.json({ skipped: true, reason: 'already_applied' });
    }

    const movedIds: string[] = [];
    const protectedSkipped: string[] = [];
    const invalidSkipped: string[] = [];
    const invalidReasons: any[] = [];
    // Every appointment this suggestion moves — excluded from the single-placement
    // capacity check because the reshuffle engine validates the set as a whole.
    const movingIds = (suggestion.changes || [])
      .filter((c: any) => c.moving || c.is_new)
      .map((c: any) => c.booking_request_id);
    // The day as it stands before any move is checked; compared again just before anything is written.
    const versionBefore = await readDayVersion(admin, String(suggestion.suggestion_date || ''));
    const planned: Array<{ booking: any; change: any; start: number; updates: Record<string, unknown> }> = [];

    for (const change of suggestion.changes || []) {
      if (!change.moving && !change.is_new) continue;

      let booking;
      try {
        booking = await admin.entities.BookingRequest.get(change.booking_request_id);
      } catch {
        booking = null;
      }
      // All or nothing: a move that cannot be applied means the suggestion no longer fits the day.
      if (!booking || INACTIVE.includes(booking.status)) {
        invalidSkipped.push(change.booking_request_id);
        invalidReasons.push({ booking_request_id: change.booking_request_id, codes: ['BOOKING_NO_LONGER_ACTIVE'], reasons: ['This booking is no longer active.'] });
        continue;
      }

      // Protection re-check against live data — Route Flow never overrides a commitment
      if (booking.schedule_status === 'locked' || booking.schedule_status === 'confirmed' || booking.availability_override) {
        protectedSkipped.push(change.booking_request_id);
        continue;
      }

      const start = parseTimeStr(change.to_label);
      if (isNaN(start)) {
        invalidSkipped.push(change.booking_request_id);
        continue;
      }

      // Hard constraints re-validated against LIVE data with the shared Category 1
      // engine — a stored suggestion can never authorise an invalid placement.
      const placement = await validatePlacement(admin, {
        booking,
        date: booking.requested_date,
        barberId: booking.team_member_id || null,
        start,
        options: {
          source: 'route_flow',
          ignore_appointment_ids: movingIds.filter((id: string) => id !== booking.id),
        },
      });
      if (!placement.valid) {
        invalidSkipped.push(change.booking_request_id);
        invalidReasons.push({
          booking_request_id: change.booking_request_id,
          client_name: booking.client_name,
          codes: placement.codes,
          reasons: placement.violations.map(v => v.message),
        });
        await recordPlacementDecision(admin, {
          booking_request_id: booking.id,
          booking_date: booking.requested_date || null,
          barber_id: booking.team_member_id || null,
          barber_name: booking.team_member_name || null,
          proposed_time: change.to_label || null,
          previous_time: booking.assigned_time || null,
          proposed_start_decimal: start,
          outcome: 'rejected',
          valid: false,
          codes: placement.codes,
          event_type: 'skipped',
          trigger: 'reshuffle_apply',
          source: 'route_flow',
          actor_name: actor.name,
          actor_role: actor.role_label,
          detail: `Reshuffle move refused on live data: ${redactViolationDetail(placement.violations) || 'refused'}`,
        });
        continue;
      }

      const updates: Record<string, unknown> = { assigned_time: change.to_label };
      if (!booking.schedule_status || booking.schedule_status === 'unscheduled') {
        updates.schedule_status = 'provisional';
      }

      planned.push({ booking, change, start, updates });
    }

    // ── All or nothing ─────────────────────────────────────────────────────
    const refusedCount = protectedSkipped.length + invalidSkipped.length;
    if (refusedCount > 0) {
      return Response.json({
        applied: false,
        message: `Nothing was moved: ${refusedCount} of the proposed changes can no longer be made. Re-run Route Flow for a fresh suggestion.`,
        protected_skipped: protectedSkipped.length,
        invalid_skipped: invalidSkipped.length,
        invalid_reasons: invalidReasons,
      }, { status: 409 });
    }
    if (planned.length > 0 && (await readDayVersion(admin, String(suggestion.suggestion_date || ''))) !== versionBefore) {
      return Response.json({
        applied: false,
        message: 'The day changed while the moves were being checked, so nothing was moved. Re-run Route Flow for a fresh suggestion.',
        protected_skipped: 0,
        invalid_skipped: 0,
        invalid_reasons: [],
      }, { status: 409 });
    }

    // Every move in one write.
    if (planned.length > 0) {
      await admin.entities.BookingRequest.bulkUpdate(planned.map(p => ({ id: p.booking.id, ...p.updates })));
    }
    for (const { booking, change, start, updates } of planned) {
      movedIds.push(booking.id);
      await recordPlacementDecision(admin, {
        booking_request_id: booking.id,
        booking_date: booking.requested_date || null,
        barber_id: booking.team_member_id || null,
        barber_name: booking.team_member_name || null,
        proposed_time: change.to_label || null,
        previous_time: booking.assigned_time || null,
        proposed_start_decimal: start,
        outcome: 'saved',
        valid: true,
        codes: [],
        event_type: 'reshuffle_applied',
        trigger: 'reshuffle_apply',
        source: 'route_flow',
        actor_name: actor.name,
        actor_role: actor.role_label,
        detail: `Applied reshuffle suggestion ${suggestion.id}${updates.schedule_status ? ' · provisional placement' : ''}`,
      });
    }

    // ── Mark affected drive legs stale ─────────────────────────────────────
    if (movedIds.length > 0) {
      try {
        const connections = await admin.entities.RouteConnection.list('-created_date', 500);
        for (const conn of connections || []) {
          const from = (conn.from_appointment_id || '').replace(/^db-/, '');
          const to = (conn.to_appointment_id || '').replace(/^db-/, '');
          if (movedIds.includes(from) || movedIds.includes(to)) {
            if (conn.status !== 'stale') {
              await admin.entities.RouteConnection.update(conn.id, { status: 'stale' });
            }
          }
        }
      } catch {
        /* drive legs are non-critical */
      }
    }

    const summary = `${movedIds.length} appointment${movedIds.length === 1 ? '' : 's'} moved`;

    await admin.entities.RouteFlowSuggestion.update(suggestion.id, {
      status: 'applied',
      applied_at: new Date().toISOString(),
      applied_by: actor.name || 'Admin',
      applied_summary: summary,
    });

    // The admin action itself, recorded as activity: a reshuffle a person
    // applied is never invisible, and never attributed to automation.
    await recordRouteFlowActivity(admin, {
      event_type: 'reshuffle_applied',
      summary: `${actor.name || 'Admin'} applied a Route Flow reshuffle`,
      detail: [
        summary,
        `${protectedSkipped.length} protected appointment${protectedSkipped.length === 1 ? '' : 's'} left untouched`,
        invalidSkipped.length > 0 ? `${invalidSkipped.length} proposed change${invalidSkipped.length === 1 ? '' : 's'} refused on live data` : '',
      ].filter(Boolean).join(' · '),
      schedule_date: suggestion.suggestion_date || null,
      actor_type: 'admin',
      actor_name: actor.name || null,
      trigger_type: 'reshuffle_apply',
      outcome: 'applied',
      bookings_evaluated: movingIds.length,
      appointments_moved: movedIds.length,
      requests_placed: 0,
      requests_unscheduled: 0,
      protected_moved: 0,
      drive_before: suggestion.current?.total_drive_minutes ?? null,
      drive_after: suggestion.proposed?.total_drive_minutes ?? null,
      idle_before: suggestion.current?.total_idle_minutes ?? null,
      idle_after: suggestion.proposed?.total_idle_minutes ?? null,
      reason_code: invalidSkipped.length > 0 ? 'some_changes_refused' : null,
      reason_text: invalidSkipped.length > 0
        ? `${invalidSkipped.length} proposed change${invalidSkipped.length === 1 ? '' : 's'} were refused when re-checked against the live calendar.`
        : null,
      related_record_id: suggestion.id,
      details: {
        barber_name: suggestion.team_member_name || null,
        suggestion_id: suggestion.id,
        protected_skipped: protectedSkipped.length,
        invalid_skipped: invalidSkipped.length,
        moves: movesForDetail((suggestion.changes || []).filter((c: any) => c.moving || c.is_new)),
      },
    });

    return Response.json({
      applied: true,
      moved_count: movedIds.length,
      protected_skipped: protectedSkipped.length,
      invalid_skipped: invalidSkipped.length,
      invalid_reasons: invalidReasons,
      summary,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}