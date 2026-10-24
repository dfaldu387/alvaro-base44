import { findClientsByPhone } from './messagingProtections.ts';
import { escapeRegex } from './auPhone.ts';

/**
 * The recipient checks the sweep runs before every send (after the item's own
 * is_test flag, before quiet hours). Returns the suppression reason, or null
 * when the recipient may be messaged.
 *
 * Fail-safe: a lookup that throws propagates, so the item is retried later and
 * is never sent on a guess.
 *
 * Moved here unchanged from processMessageOutbox/guards.ts so that re-queueing a
 * dead letter uses this same check; guards.ts re-exports it.
 */
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const safeGet = async (admin: any, entity: string, id: string) => {
  try { return await admin.entities[entity].get(id); } catch { return null; }
};

export async function recipientBlock(admin: any, item: any): Promise<'test data' | 'opted out' | 'no messaging consent' | null> {
  const booking = item.booking_request_id ? await safeGet(admin, 'BookingRequest', item.booking_request_id) : null;
  const linked = item.client_id || booking?.client_id || null;
  const client = linked ? await safeGet(admin, 'ReminderClient', linked) : null;

  if (client?.is_test === true || booking?.is_test === true) return 'test data';

  if (client?.messaging_opted_out === true) return 'opted out';

  // Anyone else sharing the number or email who has opted out also blocks the send.
  if (item.channel === 'email') {
    const rows = asList(await admin.entities.ReminderClient.filter(
      { email: { $regex: `^\\s*${escapeRegex(String(item.to_address).trim())}\\s*$`, $options: 'i' }, messaging_opted_out: true }, 'created_date', 1,
    ));
    if (rows.length > 0) return 'opted out';
  } else if ((await findClientsByPhone(admin, item.to_address)).some((c: any) => c.messaging_opted_out === true)) {
    return 'opted out';
  }

  // The customer declined on this booking's form.
  if (booking?.messaging_consent === false) return 'no messaging consent';
  return null;
}