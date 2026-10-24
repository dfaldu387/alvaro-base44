import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { validatePlacement, parseStartTime } from '../../shared/schedulingValidator.ts';
import { resolveSchedulingActor, actorOwnsBooking } from '../../shared/schedulingAuth.ts';
import { recordPlacementDecision, redactViolationDetail } from '../../shared/placementAudit.ts';

/**
 * Category 1 — Booking Validity & Hard Constraints (V2).
 *
 * Validates ONE proposed placement using the shared scheduling engine that
 * Route Flow and the manual calendar both use. Read-only: this function never
 * creates or changes an appointment record. Callers re-validate immediately
 * before any write (see applyManualPlacement).
 *
 * Authorisation — checked BEFORE the booking is read, so no private client
 * location information is ever retrieved for an unauthorised caller:
 *   - admin: any booking, may request an explicit availability/lead-time override
 *   - staff (linked, active TeamMember): their own appointments only, never an override
 *   - anyone else (including an authenticated account with no staff record): refused
 *   - automation may never borrow a manual override permission
 *
 * Payload:
 *   booking_request_id   required
 *   proposed_start_time  "11:00am" | "11:00" | 11   (decimal hour also accepted)
 *   date                 YYYY-MM-DD  (defaults to the request's requested_date)
 *   barber_id            optional — defaults to the request's assigned barber
 *   options              { source: 'manual' | 'route_flow', log: true to record an
 *                          audit row, admin_override_availability, admin_override_window }
 *
 * The frontend never decides validity — it only renders this result.
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

    let booking;
    try {
      booking = await admin.entities.BookingRequest.get(booking_request_id);
    } catch {
      booking = null;
    }
    if (!booking) return Response.json({ error: 'booking not found' }, { status: 404 });

    if (!actorOwnsBooking(actor, booking)) {
      return Response.json({ error: 'You can only validate appointments assigned to you.' }, { status: 403 });
    }

    const start = parseStartTime(body.proposed_start_time);
    if (!isFinite(start)) {
      return Response.json({
        valid: false,
        violations: [{ code: 'MISSING_REQUIRED_DATA', message: 'A proposed start time is required.' }],
        codes: ['MISSING_REQUIRED_DATA'],
      }, { status: 400 });
    }

    const source = body.options?.source === 'route_flow' ? 'route_flow' : 'manual';
    // An override is an explicitly recorded admin action. Automation can never
    // borrow it, and a staff member can never request it.
    const canOverride = source === 'manual' && actor.can_override;
    const options = {
      source,
      admin_override_availability: canOverride && body.options?.admin_override_availability === true,
      admin_override_window: canOverride && body.options?.admin_override_window === true,
      admin_override_travel: canOverride && body.options?.admin_override_travel === true,
    };

    const result = await validatePlacement(admin, {
      booking,
      date: body.date || booking.requested_date,
      barberId: body.barber_id || booking.team_member_id || null,
      start,
      options,
    });

    // The admin panel asks for an audit row. Scheduled writes record their own
    // decision, so this stays opt-in and never duplicates them.
    if (body.options?.log === true) {
      await recordPlacementDecision(admin, {
        booking_request_id: booking.id,
        booking_date: result.date || body.date || booking.requested_date || null,
        barber_id: result.barber_id,
        barber_name: result.barber_name,
        proposed_time: result.proposed_start || null,
        proposed_start_decimal: result.proposed_start_decimal,
        outcome: result.valid ? 'validated' : 'rejected',
        valid: result.valid,
        codes: result.codes,
        override_used: false,
        trigger: 'admin_panel',
        source,
        actor_name: actor.name,
        actor_role: actor.role_label,
        detail: result.valid
          ? `Checked in the admin panel using ${source} rules.`
          : redactViolationDetail(result.violations),
      });
    }

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}