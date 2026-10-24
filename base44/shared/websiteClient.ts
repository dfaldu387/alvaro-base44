/**
 * Finds or creates the ReminderClient for a public website booking.
 *
 * - Phone match first, then email match. Never matches on name.
 * - Test isolation: a test booking only ever matches TEST clients, a real
 *   booking only ever matches NON-test clients. An existing client's is_test is
 *   never changed, and test data is never attached to a real customer.
 * - Several matches → narrowed by email when matching on phone; if still more
 *   than one, nothing is linked (status 'ambiguous') instead of guessing.
 * - An existing client is reused as-is; its details are never overwritten.
 * - Duplicate protection: after creating, the oldest matching client wins and
 *   any newer duplicate made by a concurrent request deletes itself.
 */
import { normaliseAuPhone, normaliseEmail, auPhoneSearchPattern, escapeRegex } from './auPhone.ts';

export type ClientLinkStatus = 'linked' | 'created' | 'ambiguous' | 'failed';
export interface ClientLink {
  status: ClientLinkStatus;
  client_id: string | null;
  matched_by: 'phone' | 'email' | null;
}

const SETTLE_MS = 400;
const asList = (res: any): any[] => (Array.isArray(res) ? res : (res?.items || []));
const byAge = (a: any, b: any) => {
  const ta = String(a.created_date || '');
  const tb = String(b.created_date || '');
  if (ta !== tb) return ta < tb ? -1 : 1;
  return String(a.id) < String(b.id) ? -1 : 1;
};

async function findCandidates(admin: any, sanitized: any, isTest: boolean) {
  const scope = isTest ? { is_test: true } : { is_test: { $ne: true } };
  const phoneKey = normaliseAuPhone(sanitized.phone);
  const emailKey = normaliseEmail(sanitized.email);

  if (phoneKey) {
    const rows = asList(await admin.entities.ReminderClient.filter(
      { ...scope, phone: { $regex: auPhoneSearchPattern(phoneKey) } }, 'created_date', 50,
    ));
    const hits = rows.filter((c: any) => normaliseAuPhone(c.phone) === phoneKey).sort(byAge);
    if (hits.length > 0) return { by: 'phone' as const, list: hits, emailKey };
  }
  if (emailKey) {
    const rows = asList(await admin.entities.ReminderClient.filter(
      { ...scope, email: { $regex: `^\\s*${escapeRegex(emailKey)}\\s*$`, $options: 'i' } }, 'created_date', 50,
    ));
    const hits = rows.filter((c: any) => normaliseEmail(c.email) === emailKey).sort(byAge);
    if (hits.length > 0) return { by: 'email' as const, list: hits, emailKey };
  }
  return { by: null, list: [] as any[], emailKey };
}

/** Decides among the candidates already found. Pure: no reads, no writes. null = nobody matched. */
function pickClient(found: { by: 'phone' | 'email' | null; list: any[]; emailKey: string | null }): ClientLink | null {
  if (found.list.length === 1) {
    return { status: 'linked', client_id: found.list[0].id, matched_by: found.by };
  }
  if (found.list.length > 1) {
    const narrowed = found.by === 'phone' && found.emailKey
      ? found.list.filter((c: any) => normaliseEmail(c.email) === found.emailKey)
      : [];
    if (narrowed.length === 1) return { status: 'linked', client_id: narrowed[0].id, matched_by: 'phone' };
    return { status: 'ambiguous', client_id: null, matched_by: found.by };
  }
  return null;
}

/**
 * The same phone-first, email-second match as resolveWebsiteClient, but READ-ONLY: it never creates,
 * updates or deletes anything. null means nobody matched (a new customer would be created).
 */
export async function lookupWebsiteClient(admin: any, sanitized: any, isTest: boolean): Promise<ClientLink | null> {
  return pickClient(await findCandidates(admin, sanitized, isTest));
}

export async function resolveWebsiteClient(admin: any, sanitized: any, isTest: boolean): Promise<ClientLink> {
  const found = await findCandidates(admin, sanitized, isTest);

  const picked = pickClient(found);
  if (picked) {
    if (picked.status === 'ambiguous') {
      console.error('[websiteClient] ambiguous client match', found.by, found.list.length, 'candidates — not linking');
    }
    return picked;
  }

  const firstService = sanitized.participants?.[0]?.primary_service || sanitized.services?.[0] || '';
  const mine = await admin.entities.ReminderClient.create({
    client_name: sanitized.client_name,
    phone: sanitized.phone || '',
    email: sanitized.email || '',
    address: sanitized.address || '',
    suburb: sanitized.address_suburb || '',
    postcode: sanitized.address_postcode || '',
    usual_service: firstService,
    frequency: 'Monthly',
    // Nobody chose this; a measured cadence beats it once there is enough history.
    cadence_source: 'default',
    client_type: 'New',
    source: 'Website',
    is_test: isTest,
    ...(isTest ? { notes: 'Created from a test booking.' } : {}),
  });

  // A simultaneous request may have created the same client. The oldest row stays.
  await new Promise(resolve => setTimeout(resolve, SETTLE_MS));
  const after = await findCandidates(admin, sanitized, isTest);
  if (after.list.some((c: any) => c.id === mine.id) && after.list[0].id !== mine.id) {
    try { await admin.entities.ReminderClient.delete(mine.id); } catch { /* the oldest row is still the one linked */ }
    return { status: 'linked', client_id: after.list[0].id, matched_by: after.by };
  }
  return { status: 'created', client_id: mine.id, matched_by: null };
}