/**
 * The customer answered the "we can fit you at ... — reply YES or NO" text.
 *
 * A YES confirms the time we offered outside their availability: the override
 * stops waiting (override_status → confirmed) and the booking stays exactly where
 * it was placed. A NO never lands here — it is stored as a needs-attention reply
 * flag and the booking is left untouched for a person to deal with.
 *
 * Called by the inbound message webhook. It never throws into the webhook.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

export async function confirmOverrideFromReply(admin: any, bookingId: string): Promise<boolean> {
  const id = String(bookingId || '').trim();
  if (!id) return false;
  let booking: any = null;
  try {
    booking = await admin.entities.BookingRequest.get(id);
  } catch {
    return false;
  }
  if (!booking) return false;
  // Only a placement that is genuinely waiting to hear back is confirmed by a text.
  if (booking.availability_override !== true || booking.override_status !== 'awaiting_confirmation') return false;

  await admin.entities.BookingRequest.update(booking.id, { override_status: 'confirmed' });
  try {
    await admin.entities.ActivityLog.create({
      action: 'availability_override_confirmed_by_reply',
      actor: 'base44_automation',
      actor_type: 'route_flow',
      summary: 'The customer confirmed the time offered outside their availability',
      detail: `Accepted by text reply · ${String(booking.assigned_time || 'time on record')}`.slice(0, 200),
      related_record_id: booking.id,
      related_record_type: 'BookingRequest',
      client_id: booking.client_id || undefined,
      schedule_date: booking.requested_date || undefined,
      new_value: 'awaiting_confirmation → confirmed',
      timestamp: new Date().toISOString(),
    });
  } catch {
    /* the confirmation stands even if the log could not be written */
  }
  return true;
}

/** The unanswered override checks, used only to widen inbound reply matching. */
export async function awaitingOverrideBookings(admin: any, clientIds: string[]): Promise<any[]> {
  const ids = (clientIds || []).filter(Boolean);
  if (ids.length === 0) return [];
  return asList(await admin.entities.BookingRequest.filter(
    { client_id: { $in: ids }, availability_override: true, override_status: 'awaiting_confirmation' },
    'created_date', 10,
  ));
}