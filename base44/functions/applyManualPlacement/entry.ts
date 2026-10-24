import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { parseStartTime } from '../../shared/schedulingValidator.ts';
import { revalidatePlacement } from '../../shared/placementRevalidate.ts';
import { resolveSchedulingActor, actorOwnsBooking } from '../../shared/schedulingAuth.ts';
import { recordPlacementDecision, redactViolationDetail } from '../../shared/placementAudit.ts';
import { placementPatch } from '../../shared/placementReason.ts';
import { recordAudit } from '../../shared/auditLog.ts';
import { enqueueBookingChanged } from '../../shared/bookingLifecycle.ts';
import { enqueueAvailabilityOverrideCheck } from '../../shared/availabilityOverrideNotice.ts';

/**
 * Manual placement — the single way a Calendar action writes an appointment time.
 *
 * The frontend never decides validity. Every manual drag-drop, manual booking
 * creation and "add existing request to the calendar" calls this endpoint, which
 * re-validates immediately before saving against the SAME shared Category 1
 * engine Route Flow uses (shared/schedulingValidator).
 *
 * Authorisation:
 *   - admin: may place/move any appointment and may use an explicit availability
 *     override ("Schedule Anyway"), which is recorded with its reason.
 *   - staff (linked, active TeamMember): may place/move only their own
 *     appointments, and may never override. Refused before any Mapbox work.
 *   - everyone else: refused.
 *
 * Concurrency: a placement is only written if (a) the booking has not changed
 * since the client last read it and (b) the slot is still free on a fresh read
 * taken immediately before the write. A racing placement is refused with
 * SCHEDULE_CHANGED instead of silently creating an overlap.
 *
 * Payload:
 *   booking_request_id      required
 *   proposed_start_time     "11:00" | "11:00am" | 11
 *   date                    optional — defaults to the request's requested_date
 *   barber_id               optional — defaults to the request's barber
 *   expected_updated_date   optional — the updated_date the client last saw
 *   override                true only when an admin pressed Schedule Anyway
 *   override_reason         short reason, recorded in the audit trail
 *   day / confirm_request   only when adding a request onto a specific day and
 *                           approving the request as part of that placement
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const actor = await resolveSchedulingActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    const admin = base44.asServiceRole;

    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const booking_request_id = body.booking_request_id;
    if (!booking_request_id) {
      return Response.json({ error: 'booking_request_id required' }, { status: 400 });
    }

    // ── Remove from the calendar ─────────────────────────────────────────────
    // Clearing a placement is also a backend-only write: same authority rules
    // (admin: any booking, staff: their own), and it is written to the audit log.
    if (body.action === 'unschedule') {
      let target;
      try {
        target = await admin.entities.BookingRequest.get(booking_request_id);
      } catch {
        target = null;
      }
      if (!target) return Response.json({ error: 'booking not found' }, { status: 404 });
      if (!actorOwnsBooking(actor, target)) {
        return Response.json({ error: 'You can only change appointments assigned to you.' }, { status: 403 });
      }
      const clear: Record<string, unknown> = {
        assigned_time: null,
        schedule_status: 'unscheduled',
        availability_override: false,
        override_status: 'none',
        // Returned to the requests list with its state and reason visible.
        ...placementPatch('unscheduled', 'Removed from the schedule'),
      };
      if (body.reset_status === true && target.status !== 'completed' && target.status !== 'declined') {
        clear.status = 'pending';
      }
      const cleared = await admin.entities.BookingRequest.update(target.id, clear);
      await recordPlacementDecision(admin, {
        booking_request_id: target.id,
        booking_date: target.requested_date || null,
        barber_id: target.team_member_id || null,
        barber_name: target.team_member_name || null,
        proposed_time: null,
        previous_time: target.assigned_time || null,
        outcome: 'saved',
        valid: true,
        codes: [],
        event_type: 'manual',
        trigger: 'manual_calendar',
        source: 'manual',
        actor_name: actor.name,
        actor_role: actor.role_label,
        detail: 'Removed from the calendar (returned to requests).',
        details_json: { action: 'unschedule', from_label: target.assigned_time || null },
      });
      return Response.json({
        saved: true,
        unscheduled: true,
        booking_request_id: target.id,
        updated_date: cleared?.updated_date || null,
      });
    }

    const start = parseStartTime(body.proposed_start_time);
    if (!isFinite(start)) {
      return Response.json({ error: 'A proposed start time is required.' }, { status: 400 });
    }

    // ── Override authority is never taken from the caller's intent alone ─────
    const overrideRequested = body.override === true || body.availability_override === true;
    if (overrideRequested && !actor.can_override) {
      return Response.json({
        saved: false,
        code: 'OVERRIDE_NOT_PERMITTED',
        error: 'Only an administrator can schedule outside the customer\'s availability.',
      }, { status: 403 });
    }
    // Travel that cannot be achieved is the barber's call, never automation's:
    // same authority rule as the availability override, same recorded reason.
    const travelOverrideRequested = body.override_travel === true;
    if (travelOverrideRequested && !actor.can_override) {
      return Response.json({
        saved: false,
        code: 'OVERRIDE_NOT_PERMITTED',
        error: 'Only an administrator can place an appointment when travel time may not be achievable.',
      }, { status: 403 });
    }
    const overrideReason = String(body.override_reason || '').trim().slice(0, 200);
    const note = String(body.note || '').trim().slice(0, 200);

    let booking;
    try {
      booking = await admin.entities.BookingRequest.get(booking_request_id);
    } catch {
      booking = null;
    }
    if (!booking) return Response.json({ error: 'booking not found' }, { status: 404 });

    if (!actorOwnsBooking(actor, booking)) {
      return Response.json({ error: 'You can only change appointments assigned to you.' }, { status: 403 });
    }

    // A request held by booking protection cannot reach the calendar until it is approved.
    if (booking.protection_hold === true) {
      return Response.json({ saved: false, error: 'This request is held for review. Approve it on the Requests page first.' }, { status: 409 });
    }

    const date = body.date || booking.requested_date || '';
    const barberId = body.barber_id || booking.team_member_id || null;

    const auditBase = {
      booking_request_id: booking.id,
      booking_date: date || null,
      barber_id: barberId,
      barber_name: booking.team_member_name || null,
      trigger: 'manual_calendar' as const,
      source: 'manual' as const,
      actor_name: actor.name,
      actor_role: actor.role_label,
    };

    // ── Concurrency guard 1: the record must be the one the client saw ───────
    const expected = body.expected_updated_date ? String(body.expected_updated_date) : null;
    if (expected && booking.updated_date && String(booking.updated_date) !== expected) {
      await recordPlacementDecision(admin, {
        ...auditBase,
        proposed_time: null,
        previous_time: booking.assigned_time || null,
        outcome: 'rejected',
        valid: false,
        codes: ['SCHEDULE_CHANGED'],
        event_type: 'manual',
        detail: 'The booking changed while the placement was being edited.',
      });
      return Response.json({
        saved: false,
        code: 'SCHEDULE_CHANGED',
        error: 'This appointment changed while you were editing it. Please reopen it and try again.',
      }, { status: 409 });
    }

    // ── Authoritative validation against live data ───────────────────────────
    const check = await revalidatePlacement(admin, {
      booking,
      date,
      barberId,
      start,
      options: {
        source: 'manual',
        // "Schedule Anyway" authorises both the customer-availability override
        // and the Booking Window override; the reason is recorded either way.
        admin_override_availability: overrideRequested,
        admin_override_window: overrideRequested,
        admin_override_travel: travelOverrideRequested,
      },
    });
    const result = check.result;

    if (check.stage === 'invalid') {
      await recordPlacementDecision(admin, {
        ...auditBase,
        booking_date: result.date || date || null,
        barber_id: result.barber_id || barberId,
        barber_name: result.barber_name || booking.team_member_name || null,
        proposed_time: result.proposed_start || null,
        previous_time: booking.assigned_time || null,
        proposed_start_decimal: result.proposed_start_decimal,
        outcome: 'rejected',
        valid: false,
        codes: result.codes,
        event_type: overrideRequested ? 'override' : 'manual',
        override_used: overrideRequested,
        override_reason: overrideRequested ? (overrideReason || null) : null,
        // Name-free summary — the detailed message goes to the admin's screen only.
        detail: redactViolationDetail(result.violations),
      });
      // If the Booking Window is the only thing blocking this time, ask for the
      // existing "Schedule Anyway" confirmation rather than refusing outright.
      // Nothing is written until the admin gives it, and an administrator's
      // override is the only authority that can — staff and automation cannot.
      const violations = result.violations || [];

      // ── Travel that cannot be achieved: ask, do not refuse ──────────────────
      // The barber keeps control. The shortfall is put to them with the facts
      // (required vs available travel) and nothing is written until they press
      // Place Anyway, which is recorded as an override with its reason.
      const travelBlocks = violations.some(v =>
        v.code === 'INSUFFICIENT_TRAVEL' || v.code === 'TRAVEL_UNVERIFIED');
      if (travelBlocks && actor.can_override && !travelOverrideRequested) {
        return Response.json({
          saved: false,
          valid: false,
          code: 'TRAVEL_OVERRIDE_REQUIRED',
          can_override: true,
          message: violations
            .find(v => v.code === 'INSUFFICIENT_TRAVEL' || v.code === 'TRAVEL_UNVERIFIED')?.message
            || 'Travel time may not be achievable for this time.',
          travel: result.travel || null,
          proposed_start: result.proposed_start || null,
          proposed_start_decimal: result.proposed_start_decimal ?? start,
          result,
        });
      }

      // Every remaining obstacle is one an administrator may deliberately accept:
      // the Booking Window (asked for explicitly) and the customer's availability
      // (a preference, never a lock). Anything else is a genuine refusal.
      const onlySoft = violations.length > 0 && violations.every(v =>
        v.code === 'OUTSIDE_CUSTOMER_AVAILABILITY'
        || v.code === 'BOOKING_TOO_SOON' || v.code === 'BOOKING_TOO_FAR_AHEAD');
      const windowBlocks = violations.some(v =>
        v.code === 'BOOKING_TOO_SOON' || v.code === 'BOOKING_TOO_FAR_AHEAD');
      if (onlySoft && windowBlocks && actor.can_override && !overrideRequested) {
        return Response.json({
          saved: false,
          valid: false,
          code: 'BOOKING_WINDOW_OVERRIDE_REQUIRED',
          can_override: true,
          message: violations[0]?.message || 'This appointment is outside the booking window.',
          result,
        });
      }

      // The customer's availability is a SOFT constraint: an administrator may
      // deliberately place outside it. When it is the only thing in the way, ask for
      // that decision instead of refusing — the drop explains itself, and the override
      // is never assumed. Nothing is written until the admin gives it, and the customer
      // is asked to confirm the time (see the queued message below).
      if (onlySoft && actor.can_override && !overrideRequested) {
        return Response.json({
          saved: false,
          valid: false,
          code: 'AVAILABILITY_OVERRIDE_REQUIRED',
          can_override: true,
          window_raw: result.availability?.window_raw || null,
          window: result.availability?.window || null,
          proposed_start: result.proposed_start || null,
          proposed_start_decimal: result.proposed_start_decimal ?? start,
          message: violations[0]?.message || 'This time is outside the availability the customer selected.',
          result,
        });
      }
      return Response.json({ saved: false, valid: false, result });
    }

    // ── Concurrency guard 2: the slot must still be free right now ───────────
    // (the second fresh read lives in shared/placementRevalidate)
    if (check.stage === 'raced') {
      const { race, raceCodes } = check;
      await recordPlacementDecision(admin, {
        ...auditBase,
        proposed_time: result.proposed_start || null,
        previous_time: booking.assigned_time || null,
        outcome: 'rejected',
        valid: false,
        codes: raceCodes,
        event_type: overrideRequested ? 'override' : 'manual',
        override_used: overrideRequested,
        override_reason: overrideRequested ? (overrideReason || null) : null,
        detail: `Slot taken during save: ${redactViolationDetail(race.violations) || 'slot no longer free'}`,
      });
      return Response.json({
        saved: false,
        valid: false,
        code: 'SCHEDULE_CHANGED',
        error: 'That time was just taken by another change. The calendar has been refreshed — please try again.',
        result: race,
      }, { status: 409 });
    }

    // ── Write the validated placement ────────────────────────────────────────
    const confirmedStart = result.proposed_start_decimal;
    const updates: Record<string, unknown> = {
      assigned_time: result.proposed_start,
      // A manually placed request is placed, not unresolved.
      ...placementPatch('placed', null),
    };
    if (!booking.schedule_status || booking.schedule_status === 'unscheduled') {
      updates.schedule_status = 'provisional';
    }
    // The availability flag means exactly that: the time sits outside the
    // customer's availability and needs their confirmation. An override given
    // for the Booking Window alone must not set it, so the two overrides stay
    // distinguishable on the calendar and in the audit trail.
    const availabilityOverridden = overrideRequested && result.availability?.override_used === true;
    // The barber's own decision, recorded as such: "placed anywhere the day needs".
    const travelOverridden = result.travel?.override_used === true;
    const anyOverride = overrideRequested || travelOverrideRequested;
    if (availabilityOverridden) {
      updates.availability_override = true;
      updates.override_status = 'awaiting_confirmation';
    } else {
      updates.availability_override = false;
      updates.override_status = 'none';
    }

    // A placement may deliberately target another date in the visible week (an
    // admin adding an existing request onto a chosen day), so the stored date
    // always follows the placement that was actually validated.
    if (body.date && String(body.date) !== String(booking.requested_date || '')) {
      updates.requested_date = body.date;
      if (body.day) updates.day = body.day;
    }
    // "Add to schedule" also approves the request itself; a plain move never does.
    if (body.confirm_request === true && booking.status !== 'completed' && booking.status !== 'declined') {
      updates.status = 'confirmed';
    }

    const saved = await admin.entities.BookingRequest.update(booking.id, updates);

    // A placement outside the customer's availability is not a normal placement: the
    // customer is asked whether the offered time works for them. Queued here, never
    // sent here — the sweep applies test data, opt-out and quiet hours. A failure to
    // queue it must never undo a placement that was already validated and saved.
    if (availabilityOverridden) {
      try {
        const placed = { ...booking, requested_date: updates.requested_date || booking.requested_date };
        const notice = await enqueueAvailabilityOverrideCheck(admin, placed, confirmedStart);
        if (!notice.queued) console.error('override check message not queued', notice.reason);
      } catch (e) {
        console.error('override check message failed', (e as Error)?.message);
      }
    }

    // A booking whose time was CONFIRMED with the customer has actually moved:
    // tell them (queued only; idempotent on the new start). A provisional or locked
    // booking being placed is planning and queues nothing. Never affects the save.
    const changeMessage = await enqueueBookingChanged(
      admin, booking, String(updates.requested_date || booking.requested_date || ''), String(result.proposed_start || ''),
    );

    // ── A time the client already has is never silently dropped ──────────────
    // The barber may always move any appointment. But when a confirmed or locked
    // time changes and the client could not be told the new one, the commitment
    // stands and is FLAGGED rather than quietly demoted: the appointment keeps its
    // confirmed status, automation leaves it alone, and the calendar shows that the
    // client still needs the new time. Telling them is the Confirm Appointments
    // step's job, never a side effect of a drag.
    const timeActuallyMoved = String(result.proposed_start || '') !== String(booking.assigned_time || '');
    const clientNeedsNotice = timeActuallyMoved
      && !availabilityOverridden
      && changeMessage.queued !== true
      && (booking.schedule_status === 'confirmed' || booking.schedule_status === 'locked');

    await recordPlacementDecision(admin, {
      ...auditBase,
      booking_date: result.date || date || null,
      barber_id: result.barber_id || barberId,
      barber_name: result.barber_name || booking.team_member_name || null,
      proposed_time: result.proposed_start || null,
      previous_time: booking.assigned_time || null,
      proposed_start_decimal: confirmedStart,
      outcome: anyOverride ? 'override_saved' : 'saved',
      valid: true,
      codes: result.codes,
      event_type: anyOverride ? 'override' : 'manual',
      details_json: {
        from_label: booking.assigned_time || 'Unscheduled',
        to_label: result.proposed_start || null,
        availability_override: availabilityOverridden === true,
        travel_override: travelOverridden === true,
      },
      override_used: anyOverride,
      override_reason: anyOverride ? (overrideReason || 'no reason recorded') : null,
      detail: [anyOverride ? `Authorised override: ${overrideReason || 'no reason recorded'}` : '',
        note,
        (result.warnings || []).map(w => w.message).join(' ')].filter(Boolean).join(' ').slice(0, 400) || null,
    });

    // One activity-log row for a placement that was actually saved (never for a check or a refusal).
    await recordAudit(admin, {
      action: anyOverride ? 'booking_placed_override' : 'booking_placed_manually',
      who: actor.name, automation: actor.automation,
      summary: travelOverridden
        ? 'A booking was placed where travel time may not be achievable (override)'
        : anyOverride ? 'A booking was placed outside the customer\'s availability (override)' : 'A booking was placed or moved on the calendar',
      note: `${booking.assigned_time || 'Unscheduled'} → ${result.proposed_start || 'unknown'}`,
      ids: { booking_request_id: booking.id }, related: { type: 'BookingRequest', id: booking.id },
    });

    return Response.json({
      saved: true,
      valid: true,
      booking_request_id: booking.id,
      assigned_time: result.proposed_start,
      proposed_start_decimal: confirmedStart,
      schedule_status: saved?.schedule_status ?? updates.schedule_status ?? booking.schedule_status ?? null,
      status: saved?.status ?? booking.status ?? null,
      date: result.date || date || null,
      change_message_queued: changeMessage.queued === true,
      // The client has the old time and has not been told the new one: the calendar
      // must say so rather than imply the move is invisible to them.
      notification_pending: clientNeedsNotice,
      override_used: anyOverride,
      travel_override_used: travelOverridden,
      override_status: saved?.override_status ?? updates.override_status ?? null,
      updated_date: saved?.updated_date || null,
      result,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}