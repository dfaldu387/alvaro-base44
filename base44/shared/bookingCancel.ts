import { enqueueBookingCancelled } from './bookingLifecycle.ts';

/**
 * Takes a booking out of the active queue by declining it: never a deletion, the request keeps its record, its
 * reason and its audit trail. A provisional slot is released; a locked or confirmed time is left untouched.
 * Idempotent: an already-declined booking is a no-op, so a double click writes one audit entry.
 *
 * This is an explicit act chosen by an admin (declineBookingRequest, or a refund that was chosen to cancel).
 * It never reads the payment, and the payment never reads it: status and payment state are independent.
 */
export async function declineBooking(admin: any, booking: any, p: { reason: string; actorName: string }) {
  const reason = p.reason;
  if (booking.status === 'declined') return { already: true as const, reason: booking.decline_reason || reason };

  const now = new Date().toISOString();
  const releaseProvisional = booking.schedule_status === 'provisional';

  await admin.entities.BookingRequest.update(booking.id, {
    status: 'declined',
    decline_reason: reason,
    declined_at: now,
    declined_by: p.actorName,
    closed_date: now,
    // A declined request must not keep occupying the calendar. Only a provisional placeholder is released.
    ...(releaseProvisional
      ? { assigned_time: null, schedule_status: 'unscheduled', availability_override: false, override_status: 'none' }
      : {}),
  });

  // Drive legs that referenced the released placeholder are removed, exactly as the calendar does.
  if (releaseProvisional) {
    try {
      const [fromLegs, toLegs] = await Promise.all([
        admin.entities.RouteConnection.filter({ from_appointment_id: booking.id }, '-created_date', 50).catch(() => []),
        admin.entities.RouteConnection.filter({ to_appointment_id: booking.id }, '-created_date', 50).catch(() => []),
      ]);
      const legIds = Array.from(new Set([...(fromLegs || []), ...(toLegs || [])].map((l: any) => l.id).filter(Boolean)));
      if (legIds.length > 0) await admin.entities.RouteConnection.deleteMany({ id: { $in: legIds } }).catch(() => {});
    } catch { /* travel blocks are recalculated by the calendar anyway */ }
  }

  // Audit trail. The reason is a fixed option, never client details.
  try {
    await admin.entities.ActivityLog.create({
      action: 'booking_request_declined',
      actor: 'barber',
      summary: `Booking request declined — ${reason}`.slice(0, 200),
      detail: [`Reason: ${reason}`, releaseProvisional ? 'Provisional slot released' : '', `by ${p.actorName}`].filter(Boolean).join(' · ').slice(0, 400),
      related_record_id: booking.id,
      related_record_type: 'BookingRequest',
      previous_value: booking.status || null,
      new_value: 'declined',
      timestamp: now,
    });
  } catch { /* an audit failure must never change the decline */ }

  // Customer cancellation text, queued and sent by the central sweep (test-data, opt-out and quiet-hours rules apply).
  // A duplicate request is an internal tidy-up, so the customer is not told about it.
  const message = reason === 'Duplicate request' ? { queued: false } : await enqueueBookingCancelled(admin, booking);
  return { already: false as const, reason, releaseProvisional, message_queued: (message as any).queued === true };
}