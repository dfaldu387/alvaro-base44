import { resolveIsTest } from './testData.ts';
import { normaliseAuPhone, normaliseEmail, auPhoneSearchPattern, escapeRegex } from './auPhone.ts';
import { recordAudit } from './auditLog.ts';

/**
 * THE writer for client records made from the admin screens (Add Client form, the CSV
 * import, Create Booking's new client, and Favourite on a booking with no client yet).
 *
 *  - is_test is decided HERE by resolveIsTest from the name (plus, for Favourite only, the
 *    booking the favourite came from). A value sent by the browser is ignored.
 *  - An existing client's is_test is never changed: an update writes only the whitelisted
 *    fields below, and is_test is not one of them.
 *  - match_existing (the Add Client form): an exact phone or email match updates that
 *    client instead of creating a second one, inside the SAME test universe only.
 *  - Rows are created in one bulkCreate; one audit row is written per created client.
 */

const MAX_ROWS = 500;

// Fields a person may set. Deliberately absent: is_test, no_show_count, last_no_show_date,
// messaging_opted_out / opted_out_at / opt_out_source and the measured cadence_* values.
const TEXT = [
  'client_name', 'phone', 'email', 'address', 'suburb', 'postcode', 'usual_service', 'frequency', 'cadence_source',
  'scheduling_category', 'client_type', 'source', 'last_visit_date', 'next_reminder_date', 'preferred_day', 'preferred_time',
  'availability_window', 'reminder_status', 'reminder_message', 'notes', 'workflow_stage', 'recurring_frequency', 'recurring_day',
  'recurring_time', 'recurring_window_start', 'recurring_window_end', 'recurring_service', 'recurring_address',
];
const FLAGS = ['is_paused', 'archived', 'recurring_enabled', 'recurring_create_draft', 'recurring_weekly_confirmation', 'recurring_paused', 'recurring_skip_cycle', 'show_on_weekly_schedule', 'is_favourite'];

const asRows = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));

/** Only the fields a person may set, with plain types. Pure. */
export function cleanClientFields(raw: any): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of TEXT) if (typeof raw?.[k] === 'string') out[k] = raw[k].trim().slice(0, 1000);
  for (const k of FLAGS) if (typeof raw?.[k] === 'boolean') out[k] = raw[k];
  if (Number.isFinite(raw?.custom_frequency_days)) out.custom_frequency_days = raw.custom_frequency_days;
  if (Array.isArray(raw?.manual_tags)) out.manual_tags = raw.manual_tags.filter((t: unknown) => typeof t === 'string').map((t: string) => t.trim().slice(0, 60)).filter(Boolean).slice(0, 50);
  return out;
}

async function findMatch(admin: any, fields: any, isTest: boolean): Promise<any | null> {
  const scope = isTest ? { is_test: true } : { is_test: { $ne: true } };
  const phoneKey = normaliseAuPhone(fields.phone);
  const emailKey = normaliseEmail(fields.email);
  if (phoneKey) {
    const rows = asRows(await admin.entities.ReminderClient.filter({ ...scope, phone: { $regex: auPhoneSearchPattern(phoneKey) } }, 'created_date', 50));
    const hit = rows.find((c: any) => (c.is_test === true) === isTest && normaliseAuPhone(c.phone) === phoneKey);
    if (hit) return hit;
  }
  if (emailKey) {
    const rows = asRows(await admin.entities.ReminderClient.filter({ ...scope, email: { $regex: `^\\s*${escapeRegex(emailKey)}\\s*$`, $options: 'i' } }, 'created_date', 50));
    const hit = rows.find((c: any) => (c.is_test === true) === isTest && normaliseEmail(c.email) === emailKey);
    if (hit) return hit;
  }
  return null;
}

export async function createAdminClients(
  admin: any,
  { body, who }: { body: any; who: string },
): Promise<{ status?: number; body: any }> {
  const input: any[] = Array.isArray(body?.clients) ? body.clients : [];
  if (input.length === 0) return { status: 400, body: { error: 'There are no clients to save.' } };
  if (input.length > MAX_ROWS) return { status: 400, body: { error: `Save at most ${MAX_ROWS} clients at a time.` } };
  const matchExisting = body?.match_existing === true;

  // Classify every row first. Nothing is written until all rows are valid.
  const rows: { fields: Record<string, any>; isTest: boolean }[] = [];
  for (const raw of input) {
    const fields = cleanClientFields(raw);
    if (!fields.client_name) return { status: 400, body: { error: 'Every client needs a name.' } };
    // The name decides. Favourite alone also passes the booking it came from, so the flag
    // it ends up with is the booking's (the browser never sends the flag itself).
    let fromBookingTest = false;
    if (typeof raw?.from_booking_id === 'string' && raw.from_booking_id) {
      try { fromBookingTest = (await admin.entities.BookingRequest.get(raw.from_booking_id))?.is_test === true; }
      catch { return { status: 400, body: { error: 'That booking could not be found.' } }; }
    }
    rows.push({ fields: { frequency: 'Monthly', ...fields }, isTest: resolveIsTest(fromBookingTest, fields.client_name) });
  }

  const updated: any[] = [];
  const toCreate: { fields: Record<string, any>; isTest: boolean }[] = [];
  for (const r of rows) {
    const match = matchExisting ? await findMatch(admin, r.fields, r.isTest) : null;
    if (match) updated.push(await admin.entities.ReminderClient.update(match.id, r.fields));
    else toCreate.push(r);
  }

  let created: any[] = [];
  if (toCreate.length > 0) {
    created = asRows(await admin.entities.ReminderClient.bulkCreate(toCreate.map((r) => ({ ...r.fields, is_test: r.isTest }))));
    // One audit row per created client. A client without its record is removed again.
    const ids = await Promise.all(created.map((c) => recordAudit(admin, {
      action: 'client_created_by_admin',
      who,
      summary: `${who} added a client from the admin screens.`,
      ids: { client_id: c.id },
      related: { type: 'Client', id: c.id },
    })));
    const unaudited = created.filter((_c, i) => !ids[i]);
    if (unaudited.length > 0) {
      for (const c of unaudited) { try { await admin.entities.ReminderClient.delete(c.id); } catch { /* reported below */ } }
      return { status: 500, body: { error: 'Saved, but it could not be recorded in the activity log, so those clients were not kept. Please try again.', retryable: true } };
    }
  }
  return { body: { success: true, created, updated } };
}