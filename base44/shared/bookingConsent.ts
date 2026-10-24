/**
 * Applies the booking-form consent checkbox to the booking's client.
 *
 *  - Not ticked, and the client was just created by this booking: the client is
 *    opted out (source booking_form). Nobody is messaged without agreeing.
 *  - Not ticked, existing client: left exactly as it was — one booking never
 *    silently changes an established client's preference (the sweep still skips
 *    this booking's own messages because the booking records the refusal).
 *  - Ticked, and the client was opted out only by an earlier booking form: the
 *    opt-out is lifted. An STOP reply or an admin opt-out is never lifted here.
 */
export async function applyBookingConsent(
  admin: any,
  link: { status: string; client_id: string | null },
  consent: boolean,
): Promise<void> {
  if (!link.client_id) return;

  if (!consent) {
    if (link.status === 'created') {
      await admin.entities.ReminderClient.update(link.client_id, {
        messaging_opted_out: true,
        opted_out_at: new Date().toISOString(),
        opt_out_source: 'booking_form',
      });
    }
    return;
  }

  if (link.status === 'linked') {
    const client = await admin.entities.ReminderClient.get(link.client_id);
    if (client?.messaging_opted_out === true && client.opt_out_source === 'booking_form') {
      await admin.entities.ReminderClient.update(link.client_id, {
        messaging_opted_out: false,
        opted_out_at: null,
        opt_out_source: null,
      });
    }
  }
}