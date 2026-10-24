import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { requireAdminActor } from '../../shared/schedulingAuth.ts';
import { findValidSlots } from '../../shared/slotSearch.ts';

/**
 * Suggested valid times for one booking request — read-only.
 *
 * This is the Route Flow pipeline run without writing anything: the same
 * candidate generator, the same shared Category 1 validator, the same travel
 * index and the same scoring (all in shared/slotSearch, which the AI assistant
 * also uses). So a time offered here is exactly a time the automation would
 * accept, and "no valid times" carries the same reason Route Flow would record.
 *
 * Admin-only. Nothing is written: the caller picks a time and places it through
 * applyManualPlacement, which re-validates immediately before saving.
 */
export default async function (req) {
  try {
    const base44 = createClientFromRequest(req);
    const admin = base44.asServiceRole;

    const actor = await requireAdminActor(base44, req);
    if (!actor.ok) return Response.json({ error: actor.error }, { status: actor.status });

    let body = {};
    try { body = await req.json(); } catch { /* empty body */ }

    const bookingId = String(body.booking_request_id || '').trim();
    if (!bookingId) return Response.json({ error: 'booking_request_id required' }, { status: 400 });

    let booking: any = null;
    try { booking = await admin.entities.BookingRequest.get(bookingId); } catch { booking = null; }
    if (!booking) return Response.json({ error: 'booking request not found' }, { status: 404 });

    const limit = Math.min(Math.max(Number(body.limit) || 8, 1), 20);
    const date = String(body.date || booking.requested_date || '');

    const { ctx, evaluated, valid, ranked, suggestions, reason, blocking_codes } = await findValidSlots(admin, {
      booking,
      date,
      barberId: booking.team_member_id || null,
      limit,
    });

    return Response.json({
      booking_request_id: booking.id,
      client_name: booking.client_name || '',
      date: ctx.date,
      day: ctx.day,
      availability_window: booking.availability_window || '',
      duration_mins: ctx.service_minutes,
      calendar_minutes: ctx.calendar_minutes,
      working_hours: ctx.work ? { status: ctx.work.status, normal: ctx.work.normal } : null,
      window: ctx.window,
      window_flexible: ctx.window_flexible,
      has_valid: ranked.length > 0,
      candidate_count: evaluated.length,
      valid_count: valid.length,
      slots: suggestions.map((s: any) => ({
        start_decimal: s.start,
        label: s.label,
        driving_minutes: s.driving_minutes,
        idle_minutes: s.idle_minutes,
        waste_minutes: s.wasted_minutes,
      })),
      reason,
      blocking_codes,
      context_errors: ctx.errors || [],
      coverage_error: ctx.coverage_error || null,
      start_location_configured: ctx.start_location ? ctx.start_location.configured === true : false,
    });
  } catch (error: any) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}